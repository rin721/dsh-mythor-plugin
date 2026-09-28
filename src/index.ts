import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { MythorApplication } from './application/service.ts'
import { descriptor } from './shared/remote.ts'
import {
  RequestSchema,
  WorkflowSchema,
  type ApiResult,
  type Request,
  type WorkflowRun,
} from './shared/contracts.ts'
import { ROLE_GUIDANCE } from './domain/workflows.ts'

export const name = 'mythor'
export const inject = ['tools', 'commands', 'systemPrompt', 'typert']
export interface Config {
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
  agents?: Context['agents']
  private active = new Map<string, WorkflowRun>()
  track(task: WorkflowRun) {
    if (task.sessionId) this.active.set(task.sessionId, task)
  }
  dispatch(agent: Agent, task: WorkflowRun) {
    const current = this.active.get(agent.id)
    if (agent.status === 'running' && current?.id === task.id) return
    if (agent.status === 'running' && current?.id !== task.id)
      throw new Error('会话正在处理其他工作，请等待结束或使用新会话')
    this.active.set(agent.id, task)
    agent.followup(taskMessage(task))
  }
  async failed(sessionId: string, error: unknown) {
    const task = this.active.get(sessionId)
    if (!task) return
    this.active.delete(sessionId)
    await this.application.request({
      action: 'task.fail',
      projectId: task.projectId,
      payload: {
        id: task.id,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      },
    })
  }
  cancel(task: WorkflowRun) {
    if (task.sessionId && this.active.get(task.sessionId)?.id === task.id) {
      this.agents?.get(task.sessionId as Agent['id'])?.cancel({ kind: 'user' })
      this.active.delete(task.sessionId)
    }
  }
  constructor(
    ctx: Context,
    private readonly application: MythorApplication,
  ) {
    super(ctx, 'mythor')
  }
  @Remote
  async request(request: Request, signal: AbortSignal): Promise<ApiResult> {
    const parsed = RequestSchema.parse(request)
    let result = await this.application.request(parsed, { kind: 'author' }, signal)
    if (result.ok && parsed.action === 'task.cancel')
      this.cancel(WorkflowSchema.parse(result.value))
    if (result.ok && (parsed.action === 'task.start' || parsed.action === 'task.resume')) {
      let task = WorkflowSchema.parse(result.value)
      try {
        const agents = this.agents
        if (!agents) throw new Error('宿主未提供 Agents 服务')
        if (!task.sessionId) {
          const sessionId = randomUUID() as Agent['id']
          const handle = await agents.create({
            sessionId,
            meta: { cwd: this.application.root },
            signal,
          })
          this.ctx.effect(() => () => handle.dispose())
          const bound = await this.application.request({
            action: 'binding.set',
            projectId: task.projectId,
            payload: { sessionId },
          })
          if (!bound.ok) return bound
          result = await this.application.request({
            action: 'task.resume',
            projectId: task.projectId,
            payload: { id: task.id, sessionId },
          })
          if (!result.ok) return result
          task = WorkflowSchema.parse(result.value)
        }
        const binding = await this.application.request({
          action: 'binding.get',
          payload: { sessionId: task.sessionId! },
        })
        if (
          !binding.ok ||
          !binding.value ||
          (binding.value as { projectId?: string }).projectId !== task.projectId
        )
          return {
            ok: false,
            error: {
              code: 'project-scope',
              message: '任务已保存，但会话绑定不同项目；请绑定后恢复任务',
            },
          }
        let agent = agents.get(task.sessionId as Agent['id'])
        if (!agent) {
          const handle = await agents.resume({
            resumeSessionId: task.sessionId as Agent['id'],
            signal,
          })
          this.ctx.effect(() => () => handle.dispose())
          agent = handle.agent
        }
        this.dispatch(agent, task)
      } catch (error) {
        await this.application.request({
          action: 'task.fail',
          projectId: task.projectId,
          payload: {
            id: task.id,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
          },
        })
        return {
          ok: false,
          error: {
            code: 'agent-unavailable',
            message: `任务已保存，可在宿主 Agent 可用后恢复：${error instanceof Error ? error.message : String(error)}`,
            details: { taskId: task.id },
          },
        }
      }
    }
    return result
  }
}

function taskMessage(task: WorkflowRun) {
  return createUserMessage({
    source: { kind: 'user' },
    content: [
      {
        type: 'text',
        text: `执行 Mythor 任务 ${task.id}，项目 ${task.projectId}，基线版本 ${task.baseRevision}。意图：${task.intent}\n当前阶段 ${task.stage}：${ROLE_GUIDANCE[task.stage]}\n已保存产物：${JSON.stringify(task.artifacts)}\n${GENERIC_HELP}`,
      },
    ],
  })
}

const tools: {
  name: string
  action?: Request['action']
  description: string
}[] = [
  {
    name: 'mythor_critique',
    action: 'task.critique',
    description:
      'Save Critic findings in validate/review stage: payload {id: taskId, findings:[{code,severity:"warning"|"unknown",message,entityIds,sources,suggestion?}]}. Advisory only, never a proof of literary quality or permission to commit.',
  },
  {
    name: 'mythor_projects',
    action: 'project.list',
    description:
      'List available novel projects. Ask the author to bind a project with /mythor project use <id> before operating.',
  },
  {
    name: 'mythor_binding',
    action: 'binding.get',
    description: 'Read this session’s current novel project and focus.',
  },
  {
    name: 'mythor_query',
    action: 'query',
    description: 'Search canonical novel objects by text and kind. Returns stable IDs and sources.',
  },
  {
    name: 'mythor_context',
    action: 'context',
    description:
      'Read a bounded, versioned context pack. Specify focus, perspective (author/reader/character ID), world time and narrativeOrder. Restricted knowledge never implies world truth.',
  },
  {
    name: 'mythor_graph',
    action: 'graph',
    description: 'Read a bounded story relationship neighborhood by focus, depth, kinds and time.',
  },
  {
    name: 'mythor_propose',
    action: 'changes.propose',
    description:
      'Save a pending ChangeSet: baseRevision, summary, taskId and typed operations. Does not modify Canon. Read shared operation guidance in mythor context.',
  },
  {
    name: 'mythor_validate',
    action: 'changes.validate',
    description:
      'Validate a pending ChangeSet by id; return findings and affected IDs. Advances the task’s validation stage.',
  },
  {
    name: 'mythor_check',
    action: 'world.validate',
    description:
      'Validate current novel world and sources. Optional taskId advances a check task from validate to review.',
  },
  {
    name: 'mythor_document',
    action: 'document.read',
    description:
      'Read a complete manuscript document by id or a specific immutable revisionId for source extraction.',
  },
  {
    name: 'mythor_commit',
    action: 'changes.commit',
    description:
      'Commit a validated ChangeSet by id and idempotencyKey only under an existing author-issued task grant. Cannot self-authorize.',
  },
  {
    name: 'mythor_task',
    description:
      'Manage a creative task using action task.start/task.advance/task.resume/task.cancel. Advance read/goals/plan/simulate/write/extract with saved artifact; review and commit are service-owned.',
  },
  {
    name: 'mythor_history',
    action: 'history',
    description: 'Read immutable novel commit history.',
  },
]
const GENERIC_HELP = `Mythor supports long-form fiction through versioned domain tools. Use mythor_binding, then mythor_context. Story is desire → obstacle → choice → consequence. World time, narrative order, character knowledge and reader revelation are separate. Model outputs are candidates. Never claim a commit without a successful mythor_commit result. Author grants cannot be created by tools.
Operations: {type:'entity.put',value:{id,kind,name,summary,attributes,informationStatus:'fact'|'plan'|'hypothesis',sources:[]}}; {type:'relation.put',value:{id,from,to,kind,summary,sources:[]}}; {type:'document.put',value:{id,revisionId,parentRevisionId?,entityId?,title,text}}; delete variants carry id. IDs use letters/digits/_/-. SourceRef is {documentId,revisionId,start,end} in UTF-16 offsets. knowledge.attributes={knower,assertion}; revelation.attributes={assertion}, with narrativeOrder. Rule attributes use evaluator required_attribute/attribute_equals/forbidden_relation, field/value/targetKind/targetId/strength; prose-only rules require review.
Read each task stage output before proceeding. Save artifacts with mythor_task. For writing, form a ChangeSet during extract, then advance extract and validate. Use explicit evidence; no invented extracted facts.`

export function apply(ctx: Context, config: Config): void {
  const app = new MythorApplication(config.dataDirectory, config)
  const remote = new MythorRemote(ctx, app)
  ctx.on('agent/error', ({ agent, error }) => {
    void remote.failed(agent.id, error)
  })
  ctx.inject(['agents'], (scope) => {
    remote.agents = scope.agents
    scope.effect(() => () => {
      remote.agents = undefined
    })
  })
  ctx.effect(() => () => app.close())
  ctx.effect(() =>
    ctx.typert.register({
      package: 'dsh-mythor-plugin',
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: [descriptor],
    }),
  )
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'mythor:creation',
      order: 80,
      text: GENERIC_HELP,
      interpolate: false,
    }),
  )
  for (const entry of tools)
    ctx.effect(() =>
      ctx.tools.register({
        name: entry.name,
        description: entry.description,
        parameters: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            ...(entry.action
              ? {}
              : {
                  action: {
                    type: 'string',
                    enum: ['task.start', 'task.advance', 'task.resume', 'task.cancel'],
                  },
                }),
            payload: { type: 'object', additionalProperties: true },
          },
          required:
            entry.action && ['project.list', 'binding.get'].includes(entry.action)
              ? []
              : ['projectId', 'payload'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (args, exec) => {
          const input = z
            .object({
              projectId: z.string().optional(),
              action: z
                .enum(['task.start', 'task.advance', 'task.resume', 'task.cancel'])
                .optional(),
              payload: z.record(z.string(), z.json()).default({}),
            })
            .parse(args)
          const action = entry.action ?? input.action
          if (!action) throw new Error('task action is required')
          if (!exec.agent) throw new Error('Mythor tools require an active Harness agent')
          const result = await app.request(
            { action, projectId: input.projectId, payload: input.payload },
            { kind: 'agent', sessionId: exec.agent.id },
            exec.signal,
          )
          if (result.ok && action.startsWith('task.')) {
            const task = WorkflowSchema.parse(result.value)
            if (action === 'task.cancel') remote.cancel(task)
            else remote.track(task)
            return { ...result, instructions: ROLE_GUIDANCE[task.stage] }
          }
          return result
        },
      }),
    )
  ctx.effect(() =>
    ctx.commands.register({
      name: 'mythor',
      description: '小说项目、场景创作与正式事实审阅',
      input: {
        hint: 'project list | project create 名称 | project use ID | write 意图 | review | commit ID',
      },
      handler: async (invocation) => {
        try {
          const words = invocation.rawInput.trim().split(/\s+/)
          const [verb, sub, ...rest] = words
          const request = async (r: Request) =>
            app.request(r, { kind: 'author' }, invocation.signal)
          const bindingResult = await request({
            action: 'binding.get',
            payload: { sessionId: invocation.agent.id },
          })
          const binding = bindingResult.ok
            ? (bindingResult.value as {
                projectId?: string
                focus?: string[]
              } | null)
            : null
          let result: ApiResult
          if (verb === 'project' && sub === 'list')
            result = await request({ action: 'project.list', payload: {} })
          else if (verb === 'project' && sub === 'create')
            result = await request({
              action: 'project.create',
              payload: { name: rest.join(' ') },
            })
          else if (verb === 'project' && sub === 'use')
            result = await request({
              action: 'binding.set',
              projectId: rest[0],
              payload: { sessionId: invocation.agent.id },
            })
          else {
            if (!binding?.projectId)
              return {
                kind: 'error',
                text: '请先 /mythor project use <项目 ID>',
              }
            const projectId = binding.projectId
            if (verb === 'focus')
              result = await request({
                action: 'binding.set',
                projectId,
                payload: {
                  sessionId: invocation.agent.id,
                  focus: words.slice(1),
                },
              })
            else if (['plan', 'write', 'revise', 'check'].includes(verb)) {
              result = await request({
                action: 'task.start',
                projectId,
                payload: {
                  kind: verb,
                  intent: words.slice(1).join(' '),
                  focus: binding.focus ?? [],
                  sessionId: invocation.agent.id,
                },
              })
              if (result.ok) {
                const task = WorkflowSchema.parse(result.value)
                remote.dispatch(invocation.agent, task)
              }
            } else if (verb === 'commit')
              result = await request({
                action: 'changes.commit',
                projectId,
                payload: {
                  id: sub,
                  idempotencyKey: `author_${sub}`,
                  acknowledgeWarnings: rest.includes('--acknowledge'),
                },
              })
            else if (verb === 'review')
              result = await request({
                action: sub ? 'changes.validate' : 'snapshot',
                projectId,
                payload: sub ? { id: sub } : {},
              })
            else if (verb === 'history')
              result = await request({
                action: 'history',
                projectId,
                payload: {},
              })
            else if (verb === 'resume' || verb === 'cancel') {
              result = await request({
                action: verb === 'resume' ? 'task.resume' : 'task.cancel',
                projectId,
                payload: {
                  id: sub,
                  ...(verb === 'resume' ? { sessionId: invocation.agent.id } : {}),
                },
              })
              if (result.ok) {
                const task = WorkflowSchema.parse(result.value)
                if (verb === 'resume') remote.dispatch(invocation.agent, task)
                else remote.cancel(task)
              }
            } else if (verb === 'export')
              result = await request({
                action: 'export',
                projectId,
                payload: {},
              })
            else if (verb === 'import')
              result = await request({
                action: 'import',
                projectId,
                payload: {
                  title: '对话导入',
                  text: invocation.rawInput.trim().slice('import'.length).trim(),
                },
              })
            else
              return {
                kind: 'success',
                text: 'Mythor：project list/create/use · focus · plan/write/revise/check · review · commit ID [--acknowledge] · history · resume/cancel · import/export。完整编辑、授权与关系图在 Mythor 工作台。',
              }
          }
          return result.ok
            ? { kind: 'success', text: JSON.stringify(result.value, null, 2) }
            : {
                kind: 'error',
                text: `${result.error.code}: ${result.error.message}`,
              }
        } catch (error) {
          return {
            kind: 'error',
            text: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),
  )
}
