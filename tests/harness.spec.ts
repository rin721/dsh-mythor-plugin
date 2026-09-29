import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { WorkspaceNovels } from '../src/application/workspaces.ts'
import { installNovelContext } from '../src/index.ts'
import { descriptor } from '../src/shared/remote.ts'
import { EntitySchema, type ChangeSet, type Snapshot } from '../src/shared/contracts.ts'

let root: string | undefined
afterEach(() => {
  if (!root) return
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup target')
  rmSync(root, { recursive: true, force: true })
  root = undefined
})

function fixture() {
  root = mkdtempSync(join(tmpdir(), 'mythor-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  mkdirSync(first)
  mkdirSync(second)
  const records = [
    { id: 'w1', path: first, title: '第一部', sessionIds: ['s1', 's1b'] },
    { id: 'w2', path: second, title: '第二部', sessionIds: ['s2'] },
  ]
  const registry = {
    resolveByPath: async (path: string) => records.find((record) => record.path === path),
  } as unknown as WorkspaceRegistry
  const agent = (id: string, cwd: string) =>
    ({ id, session: { header: { cwd } } }) as unknown as Agent
  return {
    first,
    second,
    registry,
    a1: agent('s1', first),
    a1b: agent('s1b', first),
    a2: agent('s2', second),
  }
}

it('uses the Agent-scoped Typert boundary and never accepts a novel project id', () => {
  expect(descriptor.scope).toEqual({ context: 'agent', wire: 'agentId' })
  expect(descriptor.parameters[0]).toMatchObject({ source: 'lookup', lookup: 'agent' })
  const request = descriptor.parameters[1]
  expect(request?.source).toBe('json')
})

it('does not create data before enable and shares one novel inside a Harness Workspace', async () => {
  const { first, registry, a1, a1b } = fixture()
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  const status = await novels.request(
    a1,
    { action: 'novel.status', payload: {} },
    { kind: 'author' },
  )
  expect(status).toEqual({ ok: true, value: { enabled: false } })
  expect(existsSync(join(first, '.mythor'))).toBe(false)
  await novels.request(
    a1,
    { action: 'novel.enable', payload: { title: '车站与地图' } },
    { kind: 'author' },
  )
  const shared = await novels.request(a1b, { action: 'snapshot', payload: {} }, { kind: 'author' })
  expect(shared.ok && (shared.value as unknown as Snapshot).novel.title).toBe('车站与地图')
  expect(existsSync(join(first, '.mythor', 'novel.sqlite'))).toBe(true)
  expect(existsSync(join(first, '.mythor', '.gitignore'))).toBe(true)
  await novels.close()
})

it('detects an enabled workspace while a newly created session is not registered yet', async () => {
  const { first, registry, a1 } = fixture()
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  await novels.request(
    a1,
    { action: 'novel.enable', payload: { title: '创建期扩展' } },
    { kind: 'author' },
  )
  const creating = {
    ...a1,
    id: 'creating-session',
    session: { header: { cwd: first } },
  } as unknown as Agent
  expect(await novels.shouldInstall(creating)).toBe(true)
  await expect(
    novels.request(creating, { action: 'novel.status', payload: {} }, { kind: 'author' }),
  ).resolves.toMatchObject({ ok: false, error: { code: 'workspace-unavailable' } })
  await novels.close()
})

it('assembles the latest enabled novel context through the Agent-scoped system prompt hook', async () => {
  const { registry, a1 } = fixture()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  const agent = { ...a1, ctx } as unknown as Agent
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  let dispose: (() => void) | undefined
  try {
    await novels.request(
      agent,
      { action: 'novel.enable', payload: { title: '动态上下文' } },
      { kind: 'author' },
    )
    dispose = installNovelContext(agent, novels)
    const first = await ctx.systemPrompt.assemble({ agent })
    expect(first.contexts).toContainEqual(
      expect.objectContaining({
        name: 'mythor:novel',
        text: expect.stringContaining('"revision":0'),
      }),
    )
    const proposed = await novels.request(
      agent,
      {
        action: 'changes.propose',
        payload: {
          baseRevision: 0,
          summary: '更新故事种子',
          operations: [
            {
              type: 'seed.put',
              value: { desire: '找到失踪的地图' },
            },
          ],
        },
      },
      { kind: 'author' },
    )
    expect(proposed.ok).toBe(true)
    const change = proposed.ok ? (proposed.value as unknown as ChangeSet) : undefined
    await novels.request(
      agent,
      {
        action: 'changes.commit',
        payload: { id: change!.id, idempotencyKey: 'context-test', acknowledgeWarnings: true },
      },
      { kind: 'author' },
    )
    const second = await ctx.systemPrompt.assemble({ agent })
    const text = second.contexts.find((entry) => entry.name === 'mythor:novel')?.text
    expect(text).toContain('"revision":1')
    expect(text).toContain('找到失踪的地图')
  } finally {
    dispose?.()
    await novels.close()
  }
})

it('isolates different Harness Workspaces and rejects mismatched sessions', async () => {
  const { registry, a1, a2, first } = fixture()
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  await novels.request(
    a1,
    { action: 'novel.enable', payload: { title: '第一部' } },
    { kind: 'author' },
  )
  await novels.request(
    a2,
    { action: 'novel.enable', payload: { title: '第二部' } },
    { kind: 'author' },
  )
  const firstSnapshot = await novels.request(
    a1,
    { action: 'snapshot', payload: {} },
    { kind: 'author' },
  )
  const secondSnapshot = await novels.request(
    a2,
    { action: 'snapshot', payload: {} },
    { kind: 'author' },
  )
  expect(firstSnapshot.ok && (firstSnapshot.value as unknown as Snapshot).novel.title).toBe(
    '第一部',
  )
  expect(secondSnapshot.ok && (secondSnapshot.value as unknown as Snapshot).novel.title).toBe(
    '第二部',
  )
  const intruder = {
    ...a1,
    id: 'not-owned',
    session: { header: { cwd: first } },
  } as unknown as Agent
  await expect(novels.resolve(intruder)).rejects.toThrow('不属于有效的 Harness 工作区')
  await novels.close()
})

it('keeps Agent scene proposals outside Canon until author commit and shares the next context', async () => {
  const { registry, a1, a1b } = fixture()
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  const reader = { ...a1b, ctx } as unknown as Agent
  let dispose: (() => void) | undefined
  try {
    await novels.request(
      a1,
      { action: 'novel.enable', payload: { title: '影子车站' } },
      { kind: 'author' },
    )
    const proposed = await novels.request(
      a1,
      {
        action: 'changes.propose',
        payload: {
          baseRevision: 0,
          summary: '从零散想法形成场景、正文与物品变化',
          operations: [
            { type: 'seed.put', value: { worldRule: '死者留下影子', desire: '寻找姐姐' } },
            {
              type: 'entity.put',
              value: EntitySchema.parse({ id: 'lin', kind: 'character', name: '林烬' }),
            },
            {
              type: 'entity.put',
              value: EntitySchema.parse({ id: 'map', kind: 'item', name: '地图' }),
            },
            {
              type: 'entity.put',
              value: EntitySchema.parse({ id: 'station', kind: 'scene', name: '影子车站' }),
            },
            {
              type: 'relation.put',
              value: {
                id: 'map_owner',
                from: 'lin',
                to: 'map',
                kind: 'owns',
                summary: '取得地图',
                sources: [],
                revision: 0,
              },
            },
            {
              type: 'document.put',
              value: {
                id: 'text',
                entityId: 'station',
                revisionId: 'text_v1',
                title: '影子车站',
                text: '林烬在车站取得姐姐留下的地图。',
              },
            },
          ],
        },
      },
      { kind: 'agent', sessionId: 's1' },
    )
    expect(proposed.ok).toBe(true)
    const change = proposed.ok ? (proposed.value as unknown as ChangeSet) : undefined
    const before = await novels.request(
      a1b,
      { action: 'snapshot', payload: {} },
      { kind: 'author' },
    )
    expect(before.ok && (before.value as unknown as Snapshot).documents).toHaveLength(0)
    const denied = await novels.request(
      a1,
      { action: 'changes.commit', payload: { id: change!.id, idempotencyKey: 'ungranted_scene' } },
      { kind: 'agent', sessionId: 's1' },
    )
    expect(denied.ok).toBe(false)
    const checked = await novels.request(
      a1b,
      { action: 'changes.validate', payload: { id: change!.id } },
      { kind: 'author' },
    )
    expect(checked.ok).toBe(true)
    const committed = await novels.request(
      a1b,
      {
        action: 'changes.commit',
        payload: { id: change!.id, idempotencyKey: 'accepted_scene', acknowledgeWarnings: true },
      },
      { kind: 'author' },
    )
    expect(committed.ok).toBe(true)
    dispose = installNovelContext(reader, novels)
    const assembly = await ctx.systemPrompt.assemble({ agent: reader })
    const text = assembly.contexts.find((entry) => entry.name === 'mythor:novel')?.text
    expect(text).toContain('"revision":1')
    expect(text).toContain('寻找姐姐')
    expect(text).toContain('map_owner')
    expect(text).toContain('林烬在车站取得姐姐留下的地图。')
  } finally {
    dispose?.()
    await novels.close()
  }
})

it('installs a backup atomically and leaves an unenabled workspace untouched on failure', async () => {
  const { registry, a1, first } = fixture()
  const novels = new WorkspaceNovels(registry, {}, new URL('../lib/worker.js', import.meta.url))
  const failed = await novels.request(
    a1,
    { action: 'restore', payload: { text: '{"format":"wrong"}' } },
    { kind: 'author' },
  )
  expect(failed.ok).toBe(false)
  expect(existsSync(join(first, '.mythor'))).toBe(false)
  expect(readdirSync(first).some((name) => name.startsWith('.mythor-install-'))).toBe(false)
  await novels.close()
})

it('streams invalidations and explicitly migrates an unchanged 0.1.x novel', async () => {
  const { registry, a1, first } = fixture()
  const legacyRoot = join(root!, 'legacy')
  mkdirSync(legacyRoot)
  const project = { id: 'old1', name: '旧车站', revision: 0, archived: false, createdAt: '' }
  const catalog = new DatabaseSync(join(legacyRoot, 'catalog.sqlite'))
  catalog.exec('CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL)')
  catalog.prepare('INSERT INTO projects VALUES(?, ?)').run(project.id, JSON.stringify(project))
  catalog.close()
  const source = new DatabaseSync(join(legacyRoot, 'old1.sqlite'))
  for (const table of [
    'entities',
    'relations',
    'documents',
    'revisions',
    'changes',
    'commits',
    'tasks',
    'grants',
  ])
    source.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
  const legacyChange = {
    id: 'legacy_change',
    projectId: project.id,
    baseRevision: 0,
    summary: '旧版候选',
    operations: [],
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const legacyTask = {
    id: 'legacy_task',
    projectId: project.id,
    sessionId: 'legacy_session',
    kind: 'plan',
    intent: '继续规划',
    focus: [],
    baseRevision: 0,
    stage: 'review',
    status: 'waiting_review',
    artifacts: {},
  }
  source
    .prepare('INSERT INTO changes VALUES(?, ?)')
    .run(legacyChange.id, JSON.stringify(legacyChange))
  source.prepare('INSERT INTO tasks VALUES(?, ?)').run(legacyTask.id, JSON.stringify(legacyTask))
  source.close()

  const novels = new WorkspaceNovels(
    registry,
    {},
    new URL('../lib/worker.js', import.meta.url),
    legacyRoot,
  )
  const controller = new AbortController()
  const stream = novels.watch(a1, controller.signal)[Symbol.asyncIterator]()
  await expect(stream.next()).resolves.toMatchObject({ value: { generation: 1 } })
  const listed = await novels.request(
    a1,
    { action: 'legacy.list', payload: {} },
    { kind: 'author' },
  )
  expect(listed.ok && (listed.value as unknown[])).toHaveLength(1)
  const changed = stream.next()
  const migrated = await novels.request(
    a1,
    { action: 'legacy.migrate', payload: { legacyId: 'old1' } },
    { kind: 'author' },
  )
  expect(migrated.ok).toBe(true)
  await expect(changed).resolves.toMatchObject({ value: { generation: 2 } })
  expect(existsSync(join(first, '.mythor', 'novel.sqlite'))).toBe(true)
  expect(existsSync(join(legacyRoot, 'old1.sqlite'))).toBe(true)
  const snapshot = await novels.request(a1, { action: 'snapshot', payload: {} }, { kind: 'author' })
  expect(snapshot.ok && (snapshot.value as unknown as Snapshot).changes[0]).toMatchObject({
    id: legacyChange.id,
    novelId: project.id,
  })
  expect(snapshot.ok && (snapshot.value as unknown as Snapshot).tasks[0]).toMatchObject({
    id: legacyTask.id,
    novelId: project.id,
    status: 'pending',
  })
  controller.abort()
  await stream.return?.()
  await novels.close()
})
