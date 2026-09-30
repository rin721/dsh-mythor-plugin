import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  LlmAdapter,
  ToolCallId,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgressService } from '../src/application/progress.ts'
import { CreativeService } from '../src/application/creative.ts'
import { registerInterview } from '../src/application/interview.ts'
import { WorkspaceNovels } from '../src/application/workspaces.ts'
import { registerCreativeTools } from '../src/application/agent-tools.ts'
import { installNovelContext } from '../src/index.ts'
import { EntitySchema, type Snapshot } from '../src/shared/contracts.ts'

// Real exact-read behavior; full-text search is unnecessary in this fixture.
class ExactQuery extends SessionQueryEngine {
  async readSession(id: SessionId) {
    if (this.ctx.agents.get(id))
      throw new Error('session/writer-held: live readers must use the native snapshot')
    return super.readSession(id)
  }
  async searchSessions(): Promise<never> {
    throw new Error('not used')
  }
  async searchEvents(): Promise<never> {
    throw new Error('not used')
  }
}
function call(name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: ToolCallId(`call-${Math.random()}`),
        name,
        arguments: JSON.stringify(args),
      },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
const stop: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '继续探索你的故事。' } },
  { type: 'finish', reason: { kind: 'stop' } },
]
class ControlledModel extends LlmAdapter {
  root?: () => { name: string; args: object }
  requests: GenerateOptions[] = []
  childResult: (options: GenerateOptions) => object = () => ({
    creating: true,
    reason: '作者明确继续创作',
  })
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.tools?.some((t) => t.name === 'structured_output'))
      yield* call('structured_output', this.childResult(options))
    else if (this.root) {
      const next = this.root()
      this.root = undefined
      yield* call(next.name, next.args)
    } else yield* stop
  }
}
it('uses the real Harness loop, fresh children, native decisions and transactional scene reconciliation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mythor-loop-'))
  const ctx = new Context()
  let novels: WorkspaceNovels | undefined
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    registerInterview(ctx)
    await ctx.plugin(ExactQuery)
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Subagents)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(UserQuestions)
    let questions = 0
    let keepDraft = false
    ctx.on('user-questions/request', async (request) => {
      questions++
      return {
        answers: request.questions.map((q) => ({
          id: q.id,
          selected: [keepDraft ? '保留草稿' : '按这个方向继续'],
        })),
      }
    })
    const model = new ControlledModel()
    ctx.llm.registerAdapter(['controlled'], model)
    const { agent } = await ctx.agents.create({
      sessionId: SessionId('novelist'),
      meta: { cwd },
      agentOptions: { provider: 'controlled', model: 'controlled' },
    })
    const members = [agent.id]
    const registry = {
      resolveByPath: async (path: string) =>
        path === cwd
          ? { id: 'workspace', path: cwd, title: '测试', sessionIds: members }
          : undefined,
    } as unknown as WorkspaceRegistry
    novels = new WorkspaceNovels(
      registry,
      {},
      new URL('../lib/worker.js', import.meta.url),
      undefined,
      ctx.agents,
    )
    const creative = new CreativeService(ctx, novels)
    registerCreativeTools(agent, creative)
    installNovelContext(agent, novels)
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => {
      errors.push(error)
    })
    async function turn(text: string, command: (agent: Agent) => { name: string; args: object }) {
      model.root = () => command(agent)
      agent.followup(
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
      )
      await agent.whenIdle()
      expect(errors).toEqual([])
    }
    const evidence = (a: Agent, quote: string) => [
      {
        seq: Number(
          a.session
            .snapshotEvents()
            .findLast((e) => e.type === 'user/message' && e.data.source.kind === 'user')!.seq,
        ),
        quote,
      },
    ]
    await turn('小说通常如何开头？', (a) => ({
      name: 'mythor_intake',
      args: {
        phase: 'discussion',
        evidence: evidence(a, '小说通常如何开头？'),
        fragments: [],
        questions: [],
        reason: '普通讨论',
      },
    }))
    expect(existsSync(join(cwd, '.mythor'))).toBe(false)
    await turn('天空中有一座倒悬的城市。', () => ({
      name: 'mythor_intake',
      args: {
        phase: 'exploring',
        evidence: [{ quote: '天空中有一座倒悬的城市。' }],
        fragments: [{ text: '倒悬城市', nature: 'expressed' }],
        questions: ['谁第一次看到它？'],
        reason: '只有画面',
      },
    }))
    expect(existsSync(join(cwd, '.mythor'))).toBe(false)
    const projectProgress = new ProgressService(ctx, novels)
    const firstExploration = await projectProgress.read(agent)
    expect(firstExploration.records.some((r) => r.text === '天空中有一座倒悬的城市。')).toBe(true)
    const question = firstExploration.records.find((r) => r.kind === 'question')!
    const { agent: second } = await ctx.agents.create({
      sessionId: SessionId('second-novelist'),
      meta: { cwd },
      agentOptions: { provider: 'controlled', model: 'controlled' },
    })
    members.push(second.id)
    registerCreativeTools(second, creative)
    installNovelContext(second, novels)
    expect((await projectProgress.read(second)).records).toEqual(firstExploration.records)
    members.push(SessionId('unavailable-old-session'))
    const partial = await projectProgress.read(second)
    expect(partial.unavailableSessions).toEqual(['unavailable-old-session'])
    expect(partial.records).toEqual(firstExploration.records)
    members.pop()
    const input = '是一个不愿相信别人的孩子。'
    model.root = () => ({
      name: 'mythor_intake',
      args: {
        phase: 'exploring',
        evidence: [{ quote: input }],
        fragments: [{ text: '不信任他人的孩子', nature: 'expressed' }],
        questions: [],
        answeredQuestionIds: [question.id],
        reason: '补充画面',
      },
    })
    second.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }),
    )
    await second.whenIdle()
    expect(errors).toEqual([])
    const shared = await projectProgress.read(agent)
    expect(shared.records.find((r) => r.id === question.id)?.status).toBe('resolved')
    expect(shared.records.some((r) => r.sources[0].sessionId === String(second.id))).toBe(true)
    expect(existsSync(join(cwd, '.mythor'))).toBe(false)
    expect(model.requests.some((r) => JSON.stringify(r).includes('天空中有一座倒悬的城市。'))).toBe(
      true,
    )
    await turn('请继续写这个故事。', (a) => ({
      name: 'mythor_intake',
      args: {
        phase: 'creating',
        evidence: evidence(a, '请继续写这个故事。'),
        fragments: [],
        questions: [],
        reason: '明确推进',
      },
    }))
    expect(
      existsSync(join(cwd, '.mythor', 'novel.sqlite')),
      JSON.stringify(agent.session.snapshotEvents().slice(-10)),
    ).toBe(true)
    expect((await projectProgress.read(second)).records.some((r) => r.text === input)).toBe(true)
    expect(
      (await creative.call<Snapshot>(agent, 'snapshot')).creativeRecords?.some(
        (r) => r.text === input,
      ),
    ).toBe(true)
    model.childResult = () => ({
      seedNotes: '从城市入口开始',
      entities: [
        EntitySchema.parse({
          id: 'scene-plan',
          kind: 'plan',
          name: '第一次进入',
          informationStatus: 'plan',
          attributes: {
            level: 'scene',
            goal: '抵达城市入口',
            constraints: ['不解释城市的秘密'],
            status: 'active',
            entityIds: [],
            baseRevision: 1,
            consequences: [],
          },
        }),
      ],
      proposals: ['先写抵达城市入口'],
      questions: [],
    })
    await turn('先写他走到城市入口。', (a) => ({
      name: 'mythor_develop',
      args: { intent: '规划开场', evidence: evidence(a, '先写他走到城市入口。') },
    }))
    const snapshot = () => creative.call<Snapshot>(agent, 'snapshot')
    const candidate = (await snapshot()).changes.find((c) => c.status === 'pending')!
    await turn('就这样写。', () => ({ name: 'mythor_decide', args: { id: candidate.id } }))
    expect((await snapshot()).entities.find((e) => e.id === 'scene-plan')?.editorialStatus).toBe(
      'accepted',
    )
    model.childResult = (options) => {
      const tool = options.tools!.find((t) => t.name === 'structured_output')!
      const properties = (tool.parameters as { properties: Record<string, unknown> }).properties
      if (properties.expectedChanges) return { expectedChanges: [], blockers: [], unknowns: [] }
      if (properties.document)
        return {
          document: {
            id: 'draft',
            revisionId: 'draft-rev',
            title: '入口',
            text: '他走到入口，停下来。',
          },
          summary: '开场',
        }
      if (properties.coverage)
        return {
          operations: [],
          coverage: [
            'world',
            'character',
            'relationship',
            'knowledge',
            'item',
            'plotline',
            'secret',
            'foreshadow',
            'timeline',
          ].map((category) => ({
            category,
            before: '',
            after: '',
            operationIds: [],
            sources: [],
            unchanged: true,
            nature: 'unchanged',
          })),
          uncertainties: [],
        }
      return {
        findings: [],
        majorDecisions: [],
        proseConsistent: true,
        extractionComplete: true,
        planOutcome: 'fulfilled',
      }
    }
    await turn('现在写下来。', () => ({
      name: 'mythor_scene',
      args: { planId: 'scene-plan', perspective: 'reader', intent: '写开场' },
    }))
    const final = await snapshot()
    expect(final.documents).toHaveLength(1)
    expect(final.documents[0].text).toContain('入口')
    const history = await creative.call<{ actor: string }[]>(agent, 'history')
    expect(history[0]?.actor).toBe('policy:scene-reconciliation')
    expect(final.changes.filter((c) => c.status === 'pending')).toHaveLength(0)
    const childRequests = model.requests.filter((r) =>
      r.tools?.some((t) => t.name === 'structured_output'),
    )
    expect(childRequests.length).toBeGreaterThanOrEqual(5)
    const writerRequest = childRequests.find(
      (r) =>
        (
          r.tools?.find((t) => t.name === 'structured_output')?.parameters.properties as Record<
            string,
            unknown
          >
        )?.document,
    )
    expect(JSON.stringify(writerRequest)).not.toContain('请继续写这个故事。')
    expect(childRequests.every((r) => r.tools?.every((t) => t.name === 'structured_output'))).toBe(
      true,
    )
    const plan = (id: string, level: string, parentId?: string) =>
      EntitySchema.parse({
        id,
        kind: 'plan',
        name: id,
        informationStatus: 'plan',
        attributes: {
          level,
          ...(parentId ? { parentId } : {}),
          goal: '探索城市',
          constraints: ['不解释城市的秘密'],
          status: 'active',
          entityIds: [],
          baseRevision: 0,
          consequences: [],
        },
      })
    model.childResult = () => ({
      seedNotes: '长期方向',
      entities: [plan('long-plan', 'arc')],
      proposals: ['逐渐探索城市'],
      questions: [],
    })
    await turn('接着逐渐探索城市。', (a) => ({
      name: 'mythor_develop',
      args: { intent: '长期方向', evidence: evidence(a, '接着逐渐探索城市。') },
    }))
    const direction = (await snapshot()).changes.find((c) => c.status === 'pending')!
    await turn('沿这个方向继续。', () => ({ name: 'mythor_decide', args: { id: direction.id } }))
    for (let chapter = 2; chapter <= 10; chapter++) {
      model.childResult = () => ({
        seedNotes: `第 ${chapter} 章`,
        entities: [plan(`chapter-${chapter}`, 'scene', 'long-plan')],
        proposals: [],
        questions: [],
      })
      await turn(`继续第 ${chapter} 章。`, (a) => ({
        name: 'mythor_develop',
        args: { intent: '继续已有方向', evidence: evidence(a, `继续第 ${chapter} 章。`) },
      }))
      expect((await snapshot()).entities.some((e) => e.id === `chapter-${chapter}`)).toBe(true)
      model.childResult = (options) => {
        const props = options.tools!.find((t) => t.name === 'structured_output')!.parameters
          .properties as Record<string, unknown>
        if (props.expectedChanges) return { expectedChanges: [], blockers: [], unknowns: [] }
        if (props.document)
          return {
            document: {
              id: 'draft',
              revisionId: 'draft-rev',
              title: `第 ${chapter} 章`,
              text: '他继续探索，没有发现新的秘密。',
            },
            summary: '继续',
          }
        if (props.coverage)
          return {
            operations: [],
            coverage: [
              'world',
              'character',
              'relationship',
              'knowledge',
              'item',
              'plotline',
              'secret',
              'foreshadow',
              'timeline',
            ].map((category) => ({
              category,
              before: '',
              after: '',
              operationIds: [],
              sources: [],
              unchanged: true,
              nature: 'unchanged',
            })),
            uncertainties: [],
          }
        return {
          findings: [],
          majorDecisions: [],
          proseConsistent: true,
          extractionComplete: true,
          planOutcome: 'fulfilled',
        }
      }
      await turn('写下来。', () => ({
        name: 'mythor_scene',
        args: { planId: `chapter-${chapter}`, perspective: 'reader', intent: '继续已有方向' },
      }))
    }
    expect((await snapshot()).documents).toHaveLength(10)
    expect(questions).toBe(2)
    await novels.close()
    const { agent: resumed } = await ctx.agents.create({
      sessionId: SessionId('another-day'),
      meta: { cwd },
      agentOptions: { provider: 'controlled', model: 'controlled' },
    })
    const resumedRegistry = {
      resolveByPath: async () => ({
        id: 'workspace',
        path: cwd,
        title: '测试',
        sessionIds: [resumed.id],
      }),
    } as unknown as WorkspaceRegistry
    novels = new WorkspaceNovels(
      resumedRegistry,
      {},
      new URL('../lib/worker.js', import.meta.url),
      undefined,
      ctx.agents,
    )
    const nextService = new CreativeService(ctx, novels)
    registerCreativeTools(resumed, nextService)
    const restored = await nextService.call<Snapshot>(resumed, 'snapshot')
    expect(restored.documents).toHaveLength(10)
    expect(restored.entities.find((e) => e.id === 'chapter-10')?.attributes.status).toBe(
      'fulfilled',
    )
    expect(restored.entities.find((e) => e.id === 'long-plan')?.attributes.status).toBe('active')
    installNovelContext(resumed, novels)
    const resumeTurn = async (text: string, name: string, args: object) => {
      model.root = () => ({ name, args })
      resumed.followup(
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
      )
      await resumed.whenIdle()
      expect(errors).toEqual([])
    }
    const writingResult = model.childResult
    model.childResult = () => ({
      seedNotes: '第十一章',
      entities: [plan('chapter-11', 'scene', 'long-plan')],
      proposals: [],
      questions: [],
    })
    await resumeTurn('继续第十一章。', 'mythor_develop', {
      intent: '继续已有方向',
      evidence: [{ quote: '继续第十一章。' }],
    })
    model.childResult = (options) => {
      const props = options.tools!.find((t) => t.name === 'structured_output')!.parameters
        .properties as Record<string, unknown>
      if (!props.coverage) return writingResult(options)
      const inputText = options.messages
        .flatMap((m) =>
          'content' in m && Array.isArray(m.content)
            ? m.content.flatMap((b) => (b.type === 'text' ? [b.text] : []))
            : [],
        )
        .find((t) => t.startsWith('{"document"'))!
      const { document } = JSON.parse(inputText) as {
        document: { id: string; revisionId: string; text: string }
      }
      const source = {
        documentId: document.id,
        revisionId: document.revisionId,
        start: 0,
        end: document.text.length,
      }
      const result = writingResult(options) as {
        operations: object[]
        coverage: {
          category: string
          before: string
          after: string
          operationIds: string[]
          sources: object[]
          unchanged: boolean
          nature: string
        }[]
        uncertainties: string[]
      }
      result.operations = [
        {
          type: 'entity.put',
          value: EntitySchema.parse({
            id: 'latest-event',
            kind: 'event',
            name: '继续探索',
            informationStatus: 'fact',
            editorialStatus: 'accepted',
            summary: '他继续探索，没有发现新的秘密。',
            sources: [source],
            time: { start: 11, end: 11 },
          }),
        },
      ]
      result.coverage = result.coverage.map((c) =>
        c.category === 'timeline'
          ? {
              ...c,
              after: '第十一章探索发生',
              operationIds: ['latest-event'],
              sources: [source],
              unchanged: false,
              nature: 'explicit',
            }
          : c,
      )
      return result
    }
    await resumeTurn('写第十一章。', 'mythor_scene', {
      planId: 'chapter-11',
      perspective: 'reader',
      intent: '继续探索',
    })
    expect((await nextService.call<Snapshot>(resumed, 'snapshot')).documents).toHaveLength(11)
    const nextContext = await nextService.call<{ entities: { id: string }[] }>(resumed, 'context')
    expect(nextContext.entities.some((e) => e.id === 'latest-event')).toBe(true)
    expect(questions).toBe(2)
    model.childResult = writingResult
    const pasted = '城市里有一只钟。' + '这是作者的参考笔记。'.repeat(1300)
    await resumeTurn(pasted, 'mythor_import', {
      title: '城市笔记',
      text: pasted,
      materialKind: 'notes',
      evidence: [{ quote: pasted }],
    })
    const materials = await nextService.call<
      { id: string; nextBatch: number; batchCount: number }[]
    >(resumed, 'material.list')
    expect(materials).toHaveLength(1)
    expect(materials[0].batchCount).toBeGreaterThan(1)
    for (let batch = 0; batch < materials[0].batchCount; batch++)
      await resumeTurn('继续理解材料。', 'mythor_material', { id: materials[0].id })
    const progress = await nextService.call<{ nextBatch: number; batchCount: number }[]>(
      resumed,
      'material.list',
    )
    expect(progress[0].nextBatch).toBe(progress[0].batchCount)
    const beforeRetry = (await nextService.call<Snapshot>(resumed, 'snapshot')).novel.revision
    await resumeTurn('继续理解材料。', 'mythor_material', { id: materials[0].id })
    expect((await nextService.call<Snapshot>(resumed, 'snapshot')).novel.revision).toBe(beforeRetry)
    expect(
      (await nextService.call<{ text: string }>(resumed, 'export', { format: 'markdown' })).text,
    ).not.toContain('作者的参考笔记')
    keepDraft = true
    model.childResult = () => ({
      seedNotes: '新方向',
      entities: [
        EntitySchema.parse({
          id: 'new-person',
          kind: 'character',
          name: '陌生来客',
          informationStatus: 'hypothesis',
        }),
      ],
      proposals: ['增加陌生来客'],
      questions: [],
    })
    await resumeTurn('加入一个陌生来客。', 'mythor_develop', {
      intent: '新增角色方向',
      evidence: [{ quote: '加入一个陌生来客。' }],
    })
    const decisionCandidate = (await nextService.call<Snapshot>(resumed, 'snapshot')).changes.find(
      (c) => c.status === 'pending',
    )!
    expect(decisionCandidate).toBeDefined()
    await resumeTurn('先看看。', 'mythor_decide', { id: decisionCandidate.id })
    await resumeTurn('我喜欢这个方案。', 'mythor_decide', {
      id: decisionCandidate.id,
      evidence: [{ quote: '我喜欢这个方案。' }],
    })
    expect(
      (await nextService.call<Snapshot>(resumed, 'snapshot')).changes.find(
        (c) => c.id === decisionCandidate.id,
      )?.status,
    ).toBe('pending')
    await resumeTurn('确认采用，但先别提交。', 'mythor_decide', {
      id: decisionCandidate.id,
      evidence: [{ quote: '确认采用' }],
    })
    expect(
      (await nextService.call<Snapshot>(resumed, 'snapshot')).changes.find(
        (c) => c.id === decisionCandidate.id,
      )?.status,
    ).toBe('pending')
    await resumeTurn('确认采用。', 'mythor_decide', {
      id: decisionCandidate.id,
      evidence: [{ quote: '确认采用。' }],
    })
    const decided = await nextService.call<Snapshot>(resumed, 'snapshot')
    expect(decided.changes.find((c) => c.id === decisionCandidate.id)?.status).toBe('committed')
    expect(decided.entities.find((e) => e.id === 'new-person')?.informationStatus).toBe(
      'hypothesis',
    )
  } finally {
    await novels?.close()
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}, 30000)
