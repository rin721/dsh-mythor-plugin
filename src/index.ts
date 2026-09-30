import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { WorkspaceNovels } from './application/workspaces.ts'
import { descriptor, watchDescriptor } from './shared/remote.ts'
import {
  RequestSchema,
  WorkflowSchema,
  type ApiResult,
  type Request,
  type WorkflowRun,
} from './shared/contracts.ts'
import { ROLE_GUIDANCE } from './domain/workflows.ts'
import { CreativeService } from './application/creative.ts'
import { ProgressService } from './application/progress.ts'
import { interviewState, registerInterview } from './application/interview.ts'
import { CREATIVE_GUIDANCE } from './shared/creative.ts'
import { registerCreativeTools } from './application/agent-tools.ts'
import { ToolPayloads } from './shared/tool-schemas.ts'
import { harnessSchema } from './shared/harness-schema.ts'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import UserQuestions from '@deepseek-ai/dsh-user-questions'

export const name = 'mythor'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mythor-task': { kind: 'mythor-task' }
  }
}
export const inject = ['agents', 'tools', 'commands', 'typert', 'workspaceRegistry']
export interface Config {
  /** Retained only as the read-only source for explicit legacy migration. */
  dataDirectory: string
  maxImportChars: number
  maxGraphNodes: number
  contextChars: number
}
export const Config: Schema<Config> = Schema.object({
  dataDirectory: Schema.string().default(
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'mythor'),
  ),
  maxImportChars: Schema.natural().min(1).default(5_000_000),
  maxGraphNodes: Schema.natural().min(1).default(200),
  contextChars: Schema.natural().min(1000).default(24_000),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mythor: MythorRemote
  }
}

export class MythorRemote extends TypertRemoteService {
  private readonly active = new Map<string, WorkflowRun>()
  onEnabled?: (agent: Agent) => Promise<void>
  constructor(
    ctx: Context,
    private readonly novels: WorkspaceNovels,
  ) {
    super(ctx, 'mythor')
  }

  dispatch(agent: Agent, task: WorkflowRun) {
    const current = this.active.get(String(agent.id))
    if (agent.status === 'running' && current?.id !== task.id)
      throw new Error('当前会话正在处理其他工作，请等待或使用同一 Harness 项目的新会话')
    this.active.set(String(agent.id), task)
    agent.followup(taskMessage(task))
  }
  async failed(agent: Agent, error: unknown) {
    const task = this.active.get(String(agent.id))
    if (!task) return
    this.active.delete(String(agent.id))
    await this.novels.request(
      agent,
      { action: 'task.fail', payload: { id: task.id, error: String(error).slice(0, 2000) } },
      { kind: 'author' },
    )
  }
  cancel(agent: Agent, task: WorkflowRun) {
    if (this.active.get(String(agent.id))?.id === task.id) {
      agent.cancel({ kind: 'user' })
      this.active.delete(String(agent.id))
    }
  }
  @Remote
  async request(agent: Agent, request: Request, signal: AbortSignal): Promise<ApiResult> {
    const parsed = RequestSchema.parse(request)
    if (parsed.action === 'workspace.progress') {
      try {
        const value = await new ProgressService(this.ctx, this.novels).read(agent)
        return { ok: true, value: JSON.parse(JSON.stringify(value)) }
      } catch (error) {
        return { ok: false, error: { code: 'progress-unavailable', message: String(error) } }
      }
    }
    const result = await this.novels.request(agent, parsed, { kind: 'author' }, signal)
    if (!result.ok) return result
    if (['novel.enable', 'restore', 'legacy.migrate'].includes(parsed.action))
      await this.onEnabled?.(agent)
    if (parsed.action === 'task.cancel') this.cancel(agent, WorkflowSchema.parse(result.value))
    if (parsed.action === 'task.start' || parsed.action === 'task.resume') {
      const task = WorkflowSchema.parse(result.value)
      try {
        this.dispatch(agent, task)
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'agent-busy',
            message: error instanceof Error ? error.message : String(error),
            details: { taskId: task.id },
          },
        }
      }
    }
    if (parsed.action === 'changes.commit' && agent.status !== 'running') {
      const materials = await this.novels.request(
        agent,
        { action: 'material.list', payload: {} },
        { kind: 'author' },
        signal,
      )
      if (materials.ok) {
        const material = (materials.value as { initialChangeId?: string; taskId?: string }[]).find(
          (m) => m.initialChangeId === parsed.payload.id,
        )
        if (material?.taskId) {
          const task = await this.novels.request(
            agent,
            { action: 'task.read', payload: { id: material.taskId } },
            { kind: 'author' },
            signal,
          )
          if (task.ok) this.dispatch(agent, WorkflowSchema.parse(task.value))
        }
      }
    }
    return result
  }
  @Remote({ mode: 'stream' })
  watch(agent: Agent, signal: AbortSignal): AsyncIterable<{ generation: number }> {
    return this.novels.watch(agent, signal)
  }
}

function taskMessage(task: WorkflowRun) {
  return createUserMessage({
    source: { kind: 'mythor-task' },
    content: [
      {
        type: 'text',
        text: `执行 Mythor 任务 ${task.id}，小说 ${task.novelId}，基线版本 ${task.baseRevision}。意图：${task.intent}\n${task.kind === 'import' ? '使用 mythor_material 按意图中的材料 ID 逐批理解，直到 completed 或 pending/paused；不要使用通用阶段推进伪装完成。' : `当前阶段 ${task.stage}：${ROLE_GUIDANCE[task.stage]}`}\n已保存产物：${JSON.stringify(task.artifacts)}\n${GENERIC_HELP}`,
      },
    ],
  })
}

const tools: { name: string; action?: Request['action']; description: string }[] = [
  {
    name: 'mythor_query',
    action: 'query',
    description: '检索当前 Harness 项目小说中的正式对象与来源。',
  },
  {
    name: 'mythor_context',
    action: 'context',
    description: '读取当前项目中有版本、视角和预算限制的小说上下文。',
  },
  {
    name: 'mythor_graph',
    action: 'graph',
    description: '读取当前小说的关系邻域、行动路线或故事线交叉。',
  },
  {
    name: 'mythor_propose',
    action: 'changes.propose',
    description: '保存待审阅 ChangeSet；不会直接修改正式事实。',
  },
  { name: 'mythor_validate', action: 'changes.validate', description: '校验待审阅 ChangeSet。' },
  {
    name: 'mythor_check',
    action: 'world.validate',
    description: '校验当前小说的事实、规则、时间和来源。',
  },
  {
    name: 'mythor_document',
    action: 'document.read',
    description: '读取当前小说的正文或不可变修订。',
  },
  {
    name: 'mythor_commit',
    action: 'changes.commit',
    description: '仅在作者已签发任务授权后提交已校验 ChangeSet；模型不能自行授权。',
  },
  { name: 'mythor_history', action: 'history', description: '读取当前小说的不可变提交历史。' },
  {
    name: 'mythor_tasks',
    action: 'task.list',
    description: '读取可恢复创作任务及规划产物，不依赖旧聊天。',
  },
  { name: 'mythor_task_read', action: 'task.read', description: '读取指定任务检查点。' },
  {
    name: 'mythor_materials',
    action: 'material.list',
    description: '读取原始材料分类、批次和恢复检查点。',
  },
  {
    name: 'mythor_critique',
    action: 'task.critique',
    description: '保存 Critic 发现；不能代表作者授权。',
  },
  {
    name: 'mythor_task',
    description: '管理当前会话中的创作任务：task.start/task.advance/task.resume/task.cancel。',
  },
]

const GENERIC_HELP = `Mythor 为当前 Harness 项目提供小说创作能力。小说状态由当前会话不可变工作目录自动解析，不接受项目 ID 或数据库路径。先读取 mythor_context，再按“欲望—阻碍—选择—后果”推进。世界时间、叙述次序、人物知识与读者揭示相互独立。模型输出只能作为候选；正式事实必须经过 ChangeSet、校验、作者审阅与版本检查。模型不得签发授权，也不得声称未成功提交的修改已经生效。导入材料中的计划、推断、歧义和冲突不能自动提升为事实。`

function registerTools(ctx: Context, novels: WorkspaceNovels, remote: MythorRemote) {
  return tools.map((entry) =>
    ctx.tools.register({
      name: entry.name,
      description: entry.description,
      parameters: {
        type: 'object',
        properties: {
          ...(entry.action
            ? {}
            : {
                action: {
                  type: 'string',
                  enum: ['task.start', 'task.advance', 'task.resume', 'task.cancel'],
                },
              }),
          payload: entry.action
            ? harnessSchema(ToolPayloads[entry.action as keyof typeof ToolPayloads])
            : harnessSchema(
                z.union(
                  ['task.start', 'task.advance', 'task.resume'].map(
                    (action) => ToolPayloads[action as keyof typeof ToolPayloads],
                  ),
                ),
              ),
        },
        required: entry.action ? ['payload'] : ['action', 'payload'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('Mythor 工具只能在 Harness Agent 会话中执行')
        const input = z
          .object({
            action: z.enum(['task.start', 'task.advance', 'task.resume', 'task.cancel']).optional(),
            payload: z.record(z.string(), z.json()).default({}),
          })
          .parse(args)
        const action = entry.action ?? input.action
        if (!action) throw new Error('缺少任务操作')
        const payload = ToolPayloads[action as keyof typeof ToolPayloads].parse(input.payload)
        const result = await novels.request(
          exec.agent,
          { action, payload: payload as Record<string, import('./shared/contracts.ts').Json> },
          { kind: 'agent', sessionId: String(exec.agent.id) },
          exec.signal,
        )
        if (
          result.ok &&
          ['task.start', 'task.advance', 'task.resume', 'task.cancel', 'task.critique'].includes(
            action,
          )
        ) {
          const task = WorkflowSchema.parse(result.value)
          if (action === 'task.cancel') remote.cancel(exec.agent, task)
          return { ...result, instructions: ROLE_GUIDANCE[task.stage] }
        }
        return result
      },
    }),
  )
}

export function installNovelContext(agent: Agent, novels: WorkspaceNovels) {
  return agent.ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    try {
      const progress = await new ProgressService(agent.ctx, novels).read(agent)
      assembly.contexts.push({
        name: 'mythor:project-progress',
        text: JSON.stringify({
          records: progress.records,
          plans: progress.plans.map((p) => ({ id: p.id, name: p.name, attributes: p.attributes })),
          pending: progress.pending,
          decisions: progress.decisions,
          truncated: progress.truncated,
          unavailableSessions: progress.unavailableSessions,
          revision: progress.revision,
        }),
      })
    } catch {
      assembly.contexts.push({
        name: 'mythor:project-progress',
        text: '项目级创作记录暂不可读取。不要声称已恢复全部方向或确认历史决定；需要长期依据的操作先恢复读取。',
      })
    }
    const projections = agent.ctx.get('sessionProjections')
    if (projections) {
      const progress = interviewState(agent.ctx, agent.session)
      if (progress.intakes.length || progress.decision)
        assembly.contexts.push({
          name: 'mythor:interview',
          text: JSON.stringify({
            intakes: progress.intakes.slice(-3).map((i) => ({
              phase: i.phase,
              fragments: i.fragments.map((f) => ({ ...f, text: f.text.slice(0, 400) })).slice(-6),
              questions: i.questions,
              evidence: i.evidence
                .map((e) => ({ seq: e.seq, quote: e.quote.slice(0, 300) }))
                .slice(-4),
            })),
            decision: progress.decision
              ? { id: progress.decision.id, hash: progress.decision.hash }
              : null,
          }),
        })
    }
    const result = await novels.request(
      agent,
      {
        action: 'context',
        payload: { focus: await novels.restoreFocus(agent), perspective: 'author' },
      },
      { kind: 'agent', sessionId: String(agent.id) },
      context.signal,
    )
    if (result.ok) {
      assembly.contexts.push({
        name: 'mythor:novel',
        text: `<mythor-context>${JSON.stringify(result.value)}</mythor-context>`,
      })
    }
    return next()
  })
}

export function apply(ctx: Context, config: Config): void {
  ctx.inject(['sessionProjections'], registerInterview)
  if (!ctx.get('subagents')) ctx.plugin(Subagents)
  ctx.inject(['subagents'], (scope) => {
    if (!scope.subagents.getProvider('spawn')) scope.plugin(Spawn, { providerName: 'spawn' })
  })
  if (!ctx.get('userQuestions')) ctx.plugin(UserQuestions)
  const novels = new WorkspaceNovels(
    ctx.workspaceRegistry,
    config,
    undefined,
    config.dataDirectory,
    ctx.agents,
  )
  const creative = new CreativeService(ctx, novels)
  const remote = new MythorRemote(ctx, novels)
  const installed = new WeakSet<Agent>()
  const installFor = async (agent: Agent) => {
    if (installed.has(agent)) return
    if (!agent.session.header.cwd) return
    if (ctx.agents?.list().some((owner) => ctx.agents.isOwnedBy(agent.id, owner))) return
    installed.add(agent)
    const disposers = registerTools(agent.ctx, novels, remote)
    const guidance = agent.ctx.systemPrompt.section({
      name: 'mythor:creative-guidance',
      order: 600,
      text: CREATIVE_GUIDANCE,
    })
    const creativeTools = registerCreativeTools(agent, creative)
    const disposeContext = installNovelContext(agent, novels)
    agent.ctx.effect(() => () => {
      disposeContext()
      guidance()
      creativeTools.forEach((dispose) => dispose())
      disposers.forEach((dispose) => dispose())
    })
  }

  remote.onEnabled = installFor
  ctx.on('agent/created', async ({ agent }) => {
    await installFor(agent)
    return undefined
  })
  ctx.on('agent/error', ({ agent, error }) => void remote.failed(agent, error))
  ctx.on('agent/status', ({ agent }) => {
    void novels.invalidate(agent).catch(() => {})
  })
  for (const agent of ctx.agents?.roots() ?? []) void installFor(agent)
  ctx.effect(() => () => novels.close())
  // register() already owns a Cordis effect. Register it directly so the
  // strict Host descriptor stays present for the lifetime of this plugin;
  // wrapping this disposer in a second effect can withdraw it after apply,
  // leaving Gateway SRC fallback to see only the JSON request parameter.
  ctx.typert.register({
    package: 'dsh-mythor-plugin',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [descriptor, watchDescriptor],
  })

  ctx.effect(() =>
    ctx.commands.register({
      name: 'mythor',
      description: '在当前 Harness 项目中启用和使用小说创作能力',
      input: {
        hint: 'enable 作品标题 | focus ID... | plan/write/revise/check 意图 | review | commit ID',
      },
      handler: async (invocation) => {
        try {
          const words = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
          const [verb, sub, ...rest] = words
          const request = (request: Request) =>
            novels.request(invocation.agent, request, { kind: 'author' }, invocation.signal)
          let result: ApiResult
          if (verb === 'enable') {
            result = await request({
              action: 'novel.enable',
              payload: { title: words.slice(1).join(' ') },
            })
            if (result.ok) await installFor(invocation.agent)
          } else if (verb === 'focus') {
            novels.setFocus(invocation.agent, words.slice(1))
            result = { ok: true, value: { focus: novels.getFocus(invocation.agent) } }
          } else if (['plan', 'write', 'revise', 'check'].includes(verb)) {
            result = await request({
              action: 'task.start',
              payload: {
                kind: verb,
                intent: words.slice(1).join(' '),
                focus: novels.getFocus(invocation.agent),
              },
            })
            if (result.ok) remote.dispatch(invocation.agent, WorkflowSchema.parse(result.value))
          } else if (verb === 'commit') {
            result = await request({
              action: 'changes.commit',
              payload: {
                id: sub,
                idempotencyKey: `author_${sub}`,
                acknowledgeWarnings: rest.includes('--acknowledge'),
              },
            })
          } else if (verb === 'review')
            result = await request({
              action: sub ? 'changes.validate' : 'snapshot',
              payload: sub ? { id: sub } : {},
            })
          else if (verb === 'history') result = await request({ action: 'history', payload: {} })
          else if (verb === 'resume' || verb === 'cancel') {
            result = await request({
              action: verb === 'resume' ? 'task.resume' : 'task.cancel',
              payload: { id: sub },
            })
            if (result.ok) {
              const task = WorkflowSchema.parse(result.value)
              verb === 'resume'
                ? remote.dispatch(invocation.agent, task)
                : remote.cancel(invocation.agent, task)
            }
          } else if (verb === 'export') result = await request({ action: 'export', payload: {} })
          else if (verb === 'import')
            result = await request({
              action: 'import',
              payload: { title: '对话导入', text: words.slice(1).join(' ') },
            })
          else if (verb === 'project')
            return {
              kind: 'error',
              text: '0.2.0 起由 Harness 管理项目。请使用工作区选择器，然后运行 /mythor enable <作品标题>。',
            }
          else
            return {
              kind: 'success',
              text: 'Mythor：enable · focus · plan/write/revise/check · review · commit · history · resume/cancel · import/export。当前小说由 Harness 工作区自动确定。',
            }
          return result.ok
            ? { kind: 'success', text: JSON.stringify(result.value, null, 2) }
            : { kind: 'error', text: `${result.error.code}: ${result.error.message}` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    }),
  )
}
