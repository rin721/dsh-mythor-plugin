import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/storage/store.ts'
import {
  EntitySchema,
  type Actor,
  type ChangeSet,
  type Commit,
  type Entity,
  type Json,
  type Operation,
  type Request,
  type Snapshot,
  type WorkflowRun,
} from '../src/shared/contracts.ts'
import { validate } from '../src/domain/validation.ts'
import { changeHash } from '../src/domain/continuity.ts'
import { splitMaterial } from '../src/domain/materials.ts'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
const author: Actor = { kind: 'author' }
const artifacts: Record<string, Json> = {
  read: { revision: 0, evidenceIds: [], missing: ['kept'] },
  goals: { direction: '地图交易', goal: '取得地图', obstacle: '对方不信任' },
  plan: { planId: 'scene_plan', choices: ['交换消息'], expectedConsequences: ['得到地图'] },
  simulate: { changes: ['地图转交'], unknowns: [] },
  write: { documentId: 'scene', revisionId: 'scene_v1', planId: 'scene_plan', perspective: 'lin' },
  extract: {
    documentRevisionIds: ['scene_v1'],
    changes: ['获得地图'],
    unchanged: ['世界规则'],
    uncertainties: [],
  },
}
let store: Store, root: string
const entity = (id: string, kind: Entity['kind'] = 'character', extra: Partial<Entity> = {}) =>
  EntitySchema.parse({ id, kind, name: id, ...extra })
function call<T>(action: Request['action'], payload: Record<string, Json> = {}, actor = author): T {
  return store.execute({ action, payload }, actor) as T
}
function propose(operations: Operation[], taskId?: string) {
  return call<ChangeSet>(
    'changes.propose',
    JSON.parse(
      JSON.stringify({
        baseRevision: call<Snapshot>('snapshot').novel.revision,
        summary: '测试候选',
        operations,
        taskId,
      }),
    ),
  )
}
function commit(change: ChangeSet, actor = author, key: string = randomUUID()) {
  return call<Commit>(
    'changes.commit',
    { id: change.id, idempotencyKey: key, acknowledgeWarnings: actor.kind === 'author' },
    actor,
  )
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mythor-test-'))
  store = new Store(root)
  store.execute({ action: 'novel.enable', payload: { title: '车站与地图' } }, author)
})
it('rejects forged policy receipts and requires author decisions for major changes even when the critic is silent', () => {
  const change = propose([
    { type: 'entity.put', value: entity('new-rule', 'rule', { informationStatus: 'fact' }) },
  ])
  expect(() =>
    call('scene.evidence', { id: change.id, report: {} }, { kind: 'agent', sessionId: 'model' }),
  ).toThrow(/宿主/)
  const policy: Actor = {
    kind: 'policy',
    changeHash: changeHash(change),
    reason: 'scene-reconciliation',
  }
  call(
    'scene.evidence',
    {
      id: change.id,
      report: { findings: [], majorDecisions: [], proseConsistent: true, extractionComplete: true },
    },
    policy,
  )
  expect(() => commit(change, policy)).toThrow(/作者确认/)
  expect(call<Snapshot>('snapshot').novel.revision).toBe(0)
})
it('merges persistent session drafts without losing focus or author interview references', () => {
  call('session.save', { id: 'root', value: { editor: { text: '尚未保存的中文正文' } } })
  call('session.save', { id: 'root', value: { focus: ['hero'] } })
  expect(call('session.state', { id: 'root' })).toEqual({
    editor: { text: '尚未保存的中文正文' },
    focus: ['hero'],
  })
})
it('splits immutable materials into bounded resumable batches without losing text or surrogate pairs', () => {
  const text = '天空😀\r\n'.repeat(8000)
  const batches = splitMaterial(text)
  expect(batches.join('')).toBe(text)
  expect(batches.every((b) => b.length <= 12000 && !/[\uD800-\uDBFF]$/.test(b))).toBe(true)
})
it('backs up a v2 database before upgrading and preserves task products for revalidation', () => {
  const task = call<WorkflowRun>('task.start', { kind: 'write', intent: '继续', sessionId: 'old' })
  call('task.advance', { id: task.id, stage: 'read', artifact: artifacts.read })
  store.close()
  const db = new DatabaseSync(join(root, 'novel.sqlite'))
  db.exec('PRAGMA user_version=2')
  db.close()
  store = new Store(root)
  expect(existsSync(join(root, 'novel.v2-backup.sqlite'))).toBe(true)
  expect(call<WorkflowRun>('task.read', { id: task.id })).toMatchObject({
    needsRevalidation: true,
    artifacts: { read: artifacts.read },
  })
  expect(JSON.parse(call<{ text: string }>('backup').text).version).toBe(3)
})
it('rejects cyclic or inverted planning hierarchies', () => {
  const a = entity('a', 'plan', {
    attributes: {
      level: 'scene',
      parentId: 'b',
      goal: '进入',
      constraints: [],
      status: 'active',
      entityIds: [],
      baseRevision: 0,
    },
  })
  const b = entity('b', 'plan', { attributes: { ...a.attributes, parentId: 'a' } })
  const change = propose([
    { type: 'entity.put', value: a },
    { type: 'entity.put', value: b },
  ])
  expect(() => commit(change)).toThrow(/阻止提交/)
})
afterEach(() => {
  store.close()
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup target')
  rmSync(root, { recursive: true, force: true })
})

describe('formal story commits', () => {
  it('keeps proposals outside Canon and atomically commits a scene with relationships', () => {
    const change = propose([
      { type: 'entity.put', value: entity('lin') },
      { type: 'entity.put', value: entity('map', 'item') },
      {
        type: 'relation.put',
        value: {
          id: 'owns_map',
          from: 'lin',
          to: 'map',
          kind: 'owns',
          summary: '',
          sources: [],
          revision: 0,
        },
      },
      {
        type: 'document.put',
        value: { id: 'station', revisionId: 'text1', title: '废弃车站', text: '林烬拿到地图。' },
      },
    ])
    expect(call<Snapshot>('snapshot').entities).toHaveLength(0)
    const result = commit(change)
    const world = call<Snapshot>('snapshot')
    expect(result.revision).toBe(1)
    expect(world.entities).toHaveLength(2)
    expect(world.documents).toHaveLength(1)
    expect(world.relations).toHaveLength(1)
  })
  it('rejects dangling references without partially changing entities or revision', () => {
    const change = propose([
      { type: 'entity.put', value: entity('lin') },
      {
        type: 'relation.put',
        value: {
          id: 'bad',
          from: 'lin',
          to: 'missing',
          kind: 'owns',
          summary: '',
          sources: [],
          revision: 0,
        },
      },
    ])
    expect(() => commit(change)).toThrow('存在阻止提交')
    const world = call<Snapshot>('snapshot')
    expect(world.novel.revision).toBe(0)
    expect(world.entities).toHaveLength(0)
  })
  it('rejects stale baseline, and idempotent retries return the original commit', () => {
    const first = propose([{ type: 'entity.put', value: entity('lin') }])
    const stale = propose([{ type: 'entity.put', value: entity('gu') }])
    const result = commit(first, author, 'repeat')
    expect(commit(first, author, 'repeat')).toEqual(result)
    expect(() => commit(stale)).toThrow()
    expect(() => commit(stale, author, 'repeat')).toThrow('幂等键')
    expect(call<Commit[]>('history')).toHaveLength(1)
  })
  it('preserves document revisions and invalidates dependent extracted information', () => {
    commit(
      propose([
        {
          type: 'document.put',
          value: { id: 'chapter', revisionId: 'v1', title: '第一章', text: '林烬得到地图。' },
        },
        {
          type: 'entity.put',
          value: entity('lin', 'character', {
            sources: [{ documentId: 'chapter', revisionId: 'v1', start: 0, end: 2 }],
          }),
        },
      ]),
    )
    commit(
      propose([
        {
          type: 'document.put',
          value: {
            id: 'chapter',
            revisionId: 'v2',
            parentRevisionId: 'v1',
            title: '第一章',
            text: '林烬没有得到地图。',
          },
        },
      ]),
    )
    expect(call<Snapshot>('snapshot').entities[0].stale).toBe(true)
    expect(call<{ entities: Entity[] }>('context').entities).toHaveLength(0)
    expect(call<Snapshot>('snapshot').tasks[0].kind).toBe('check')
  })
  it('rejects mutable revision IDs and incorrect source offsets', () => {
    commit(
      propose([
        { type: 'document.put', value: { id: 'd', revisionId: 'v1', title: '章', text: 'abc' } },
      ]),
    )
    expect(() =>
      commit(
        propose([
          {
            type: 'document.put',
            value: {
              id: 'd',
              revisionId: 'v1',
              parentRevisionId: 'v1',
              title: '章',
              text: 'other',
            },
          },
        ]),
      ),
    ).toThrow()
    expect(() =>
      commit(
        propose([
          {
            type: 'entity.put',
            value: entity('lin', 'character', {
              sources: [{ documentId: 'd', revisionId: 'v1', start: 0, end: 90 }],
            }),
          },
        ]),
      ),
    ).toThrow()
  })
  it('creates compensating commits and rejects undo after dependent edits to the same object', () => {
    const first = commit(propose([{ type: 'entity.put', value: entity('lin') }]))
    const undo = call<ChangeSet>('history.undo', { id: first.id })
    commit(undo)
    expect(call<Snapshot>('snapshot').entities).toHaveLength(0)
    expect(call<Commit[]>('history')).toHaveLength(2)
    expect(() => call('history.undo', { id: first.id })).toThrow('后续提交')
  })
  it('survives reopening and restores only into an empty novel store', () => {
    commit(propose([{ type: 'entity.put', value: entity('lin') }]))
    const backup = call<{ text: string }>('backup')
    store.close()
    store = new Store(root)
    expect(call<Snapshot>('snapshot').entities).toHaveLength(1)
    expect(call<Snapshot>('snapshot').entities[0].id).toBe('lin')
    expect(() => call('restore', { text: backup.text })).toThrow('已有小说内容')
  })
})

describe('epistemic and temporal boundaries', () => {
  it('reports critical omissions with fifty chapters instead of treating budget truncation as complete', () => {
    const operations: Operation[] = Array.from({ length: 50 }, (_, i) => ({
      type: 'document.put',
      value: {
        id: `chapter${i}`,
        revisionId: `rev${i}`,
        title: `第${i + 1}章`,
        text: '历史正文。'.repeat(1000),
      },
    }))
    for (let i = 0; i < 50; i++)
      operations.push({
        type: 'entity.put',
        value: entity(`rule${i}`, 'rule', {
          summary: '关键世界约束'.repeat(100),
          informationStatus: 'fact',
          editorialStatus: 'accepted',
        }),
      })
    operations.push(
      { type: 'entity.put', value: entity('focus', 'character') },
      {
        type: 'entity.put',
        value: entity('truth', 'assertion', {
          attributes: { value: '秘密' },
          informationStatus: 'fact',
        }),
      },
      {
        type: 'entity.put',
        value: entity('known', 'knowledge', {
          attributes: { knower: 'focus', assertion: 'truth', mode: 'known' },
        }),
      },
    )
    commit(propose(operations))
    expect(() => call('context', { focus: ['focus'] })).toThrow(
      '关键依据与缺口说明超过预算，暂停写作',
    )
  })
  it('bounds the serialized context including dense relationships and quoted text', () => {
    const operations: Operation[] = Array.from({ length: 12 }, (_, i) => ({
      type: 'entity.put',
      value: entity(`n${i}`),
    }))
    for (let i = 1; i < 12; i++)
      operations.push({
        type: 'relation.put',
        value: {
          id: `r${i}`,
          from: 'n0',
          to: `n${i}`,
          kind: 'related',
          summary: 'x'.repeat(2000),
          sources: [],
          revision: 0,
        },
      })
    operations.push({
      type: 'document.put',
      value: { id: 'd', revisionId: 'v1', title: 'text', text: '"\\\n'.repeat(20_000) },
    })
    commit(propose(operations))
    const pack = call<{ truncated: boolean }>('context')
    expect(pack.truncated).toBe(true)
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(24_000)
  })
  it('checks long causal chains without recursive stack overflow and validates rule definitions', () => {
    const entities = Array.from({ length: 12_000 }, (_, i) => entity(`n${i}`, 'event'))
    const relations = entities.slice(1).map((e, i) => ({
      id: `r${i}`,
      from: `n${i}`,
      to: e.id,
      kind: 'before',
      summary: '',
      sources: [],
      revision: 0,
    }))
    expect(validate({ entities, relations, documents: [] })).toEqual([])
    expect(
      validate({
        entities: [entity('rule', 'rule', { attributes: { evaluator: 'required_attribute' } })],
        relations: [],
        documents: [],
      })[0].code,
    ).toBe('rule-definition')
  })
  it('separates world time from narrative position and excludes unrevealed secrets', () => {
    commit(
      propose([
        { type: 'entity.put', value: entity('lin') },
        {
          type: 'entity.put',
          value: entity('secret', 'assertion', {
            summary: '凶手是叔叔',
            informationStatus: 'fact',
          }),
        },
        {
          type: 'entity.put',
          value: entity('belief', 'knowledge', {
            attributes: { knower: 'lin', assertion: 'secret', mode: '误信' },
            time: { start: 8 },
          }),
        },
        {
          type: 'entity.put',
          value: entity('reveal', 'revelation', {
            attributes: { assertion: 'secret' },
            narrativeOrder: 12,
          }),
        },
        {
          type: 'entity.put',
          value: entity('murder', 'event', { time: { start: 1 }, narrativeOrder: 10 }),
        },
      ]),
    )
    expect(
      call<{ entities: Entity[] }>('context', { perspective: 'lin', time: 3 }).entities.map(
        (e) => e.id,
      ),
    ).not.toContain('secret')
    expect(
      call<{ entities: Entity[] }>('context', { perspective: 'lin', time: 9 }).entities.map(
        (e) => e.id,
      ),
    ).not.toContain('secret')
    expect(
      call<{ entities: Entity[] }>('context', { perspective: 'reader', narrativeOrder: 2 })
        .entities,
    ).toHaveLength(0)
    expect(
      call<{ entities: Entity[] }>('context', {
        perspective: 'reader',
        narrativeOrder: 13,
      }).entities.map((e) => e.id),
    ).toContain('secret')
  })
  it('detects a causal cycle and natural-language rules remain unknown', () => {
    const nodes = [
      entity('a', 'event'),
      entity('b', 'event'),
      entity('rule', 'rule', { summary: '人物应该可信' }),
    ]
    const edges = [
      { id: 'ab', from: 'a', to: 'b', kind: 'before', summary: '', sources: [], revision: 0 },
      { id: 'ba', from: 'b', to: 'a', kind: 'causes', summary: '', sources: [], revision: 0 },
    ]
    const findings = validate({ entities: nodes, relations: edges, documents: [] })
    expect(findings.some((f) => f.code === 'causal-cycle')).toBe(true)
    expect(findings.some((f) => f.severity === 'unknown')).toBe(true)
  })
  it('searches two-character Chinese names and bounds graph neighborhoods', () => {
    commit(
      propose([
        {
          type: 'entity.put',
          value: entity('lin', 'character', { name: '林烬', summary: '寻找地图' }),
        },
        { type: 'entity.put', value: entity('gu', 'character', { name: '顾清' }) },
      ]),
    )
    expect(call<{ items: Entity[] }>('query', { text: '林烬' }).items[0].id).toBe('lin')
    expect(call<{ nodes: Entity[]; truncated: boolean }>('graph', { limit: 1 }).truncated).toBe(
      true,
    )
  })
})

describe('workflow authority', () => {
  const agent: Actor = { kind: 'agent', sessionId: 'session1' }
  it('rejects model-signed authority', () => {
    expect(call('context', {}, agent)).toBeTruthy()
    expect(() => call('grant', { taskId: 'any', entityIds: ['lin'] }, agent)).toThrow('只能由作者')
    expect(() => commit(propose([{ type: 'entity.put', value: entity('lin') }]), agent)).toThrow(
      '需要已完成校验的任务',
    )
  })
  it('persists stage artifacts, rejects skips and requires bounded grants to commit', () => {
    const task = call<WorkflowRun>('task.start', { kind: 'write', intent: '车站交换地图' }, agent)
    expect(() =>
      call('task.advance', { id: task.id, stage: 'write', artifact: '草稿' }, agent),
    ).toThrow('当前需要完成')
    for (const stage of ['read', 'goals', 'plan', 'simulate', 'write', 'extract'])
      call('task.advance', { id: task.id, stage, artifact: artifacts[stage] }, agent)
    const change = propose([{ type: 'entity.put', value: entity('lin') }], task.id)
    call('changes.validate', { id: change.id }, agent)
    expect(() => commit(change, agent)).toThrow('授权')
    call('grant', {
      taskId: task.id,
      entityIds: ['lin'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    commit(change, agent)
    expect(call<Snapshot>('snapshot').tasks[0].status).toBe('completed')
  })
  it('cancellation revokes authority and preserves artifacts', () => {
    const task = call<WorkflowRun>('task.start', { kind: 'write', intent: 'draft' })
    call('task.advance', { id: task.id, stage: 'read', artifact: artifacts.read })
    call('task.cancel', { id: task.id })
    expect(call<Snapshot>('snapshot').tasks[0].artifacts.read).toEqual(artifacts.read)
    expect(() => call('task.advance', { id: task.id, stage: 'goals', artifact: 'x' })).toThrow(
      '已结束',
    )
  })
  it('records model failure without losing artifacts and resumes from that stage', () => {
    const task = call<WorkflowRun>('task.start', { kind: 'write', intent: 'draft' })
    call('task.advance', { id: task.id, stage: 'read', artifact: artifacts.read })
    call('task.fail', { id: task.id, error: 'model unavailable' })
    expect(() => call('task.advance', { id: task.id, stage: 'goals', artifact: 'x' })).toThrow(
      '失败',
    )
    const resumed = call<WorkflowRun>('task.resume', { id: task.id })
    expect(resumed.stage).toBe('goals')
    expect(resumed.artifacts.read).toEqual(artifacts.read)
    expect(resumed.error).toBeUndefined()
  })
  it('keeps Critic uncertainty in review even under an author grant', () => {
    const task = call<WorkflowRun>('task.start', { kind: 'write', intent: '地图交易' }, agent)
    for (const stage of ['read', 'goals', 'plan', 'simulate', 'write', 'extract'])
      call('task.advance', { id: task.id, stage, artifact: artifacts[stage] }, agent)
    call(
      'task.critique',
      {
        id: task.id,
        findings: [
          {
            code: 'motivation',
            severity: 'unknown',
            message: '交换地图的动机还需要作者确认',
            entityIds: ['lin'],
            sources: [],
          },
        ],
      },
      agent,
    )
    const change = propose([{ type: 'entity.put', value: entity('lin') }], task.id)
    call('changes.validate', { id: change.id }, agent)
    call('grant', {
      taskId: task.id,
      entityIds: ['lin'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(() => commit(change, agent)).toThrow('需要作者确认')
    call('changes.commit', { id: change.id, idempotencyKey: 'reviewed', acknowledgeWarnings: true })
    expect(call<Snapshot>('snapshot').tasks[0].status).toBe('completed')
  })
  it('imports chapters as proposals, with a separate extraction task', () => {
    const result = call<{ change: ChangeSet; chapters: number }>('import', {
      title: '测试',
      text: '# 第一章\n林烬出发。\n# 第二章\n顾清等待。',
    })
    expect(result.chapters).toBe(2)
    expect(call<Snapshot>('snapshot').documents).toHaveLength(0)
    commit(result.change)
    expect(call<Snapshot>('snapshot').documents).toHaveLength(3)
    expect(call<Snapshot>('snapshot').entities.every((e) => e.kind === 'chapter')).toBe(true)
  })
  it('resumes an imported task in the author-selected execution session', () => {
    const result = call<{ task: WorkflowRun }>('import', { title: '章', text: '林烬出发。' })
    const task = call<WorkflowRun>('task.resume', { id: result.task.id, sessionId: 'session1' })
    expect(task.sessionId).toBe('session1')
    expect(() => call('task.resume', { id: task.id, sessionId: 'other' }, agent)).toThrow(
      '只能由作者',
    )
  })
})

describe('backup and source evidence', () => {
  it('restores immutable revisions by revision ID and rejects malformed records before creating a project', () => {
    commit(
      propose([
        {
          type: 'document.put',
          value: { id: 'd', revisionId: 'v1', title: '章', text: '林烬出发。' },
        },
      ]),
    )
    commit(
      propose([
        {
          type: 'document.put',
          value: {
            id: 'd',
            revisionId: 'v2',
            parentRevisionId: 'v1',
            title: '章',
            text: '林烬返回。',
          },
        },
      ]),
    )
    const backup = call<{ text: string }>('backup')
    const restoredStore = new Store(join(root, 'restored'))
    restoredStore.execute({ action: 'novel.enable', payload: { title: '恢复目标' } }, author)
    restoredStore.execute({ action: 'restore', payload: { text: backup.text } }, author)
    const result = restoredStore.execute(
      { action: 'document.read', payload: { revisionId: 'v1' } },
      author,
    ) as { text: string }
    expect(result.text).toBe('林烬出发。')
    restoredStore.close()
    const malformed = JSON.parse(backup.text)
    malformed.tables.relations = [{ id: 'broken' }]
    const malformedStore = new Store(join(root, 'malformed'))
    malformedStore.execute({ action: 'novel.enable', payload: { title: '损坏目标' } }, author)
    expect(() =>
      malformedStore.execute(
        { action: 'restore', payload: { text: JSON.stringify(malformed) } },
        author,
      ),
    ).toThrow()
    expect(
      (malformedStore.execute({ action: 'snapshot', payload: {} }, author) as unknown as Snapshot)
        .entities,
    ).toHaveLength(0)
    malformedStore.close()
  })
  it('exports in narrative order instead of document insertion order', () => {
    commit(
      propose([
        { type: 'entity.put', value: entity('second', 'chapter', { narrativeOrder: 2 }) },
        { type: 'entity.put', value: entity('first', 'chapter', { narrativeOrder: 1 }) },
        {
          type: 'document.put',
          value: {
            id: 'd2',
            entityId: 'second',
            revisionId: 'v2',
            title: '第二章',
            text: '后发生',
          },
        },
        {
          type: 'document.put',
          value: { id: 'd1', entityId: 'first', revisionId: 'v1', title: '第一章', text: '先发生' },
        },
      ]),
    )
    expect(call<{ text: string }>('export').text.startsWith('# 第一章')).toBe(true)
  })
})
