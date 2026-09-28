import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Tools from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MythorApplication } from '../src/application/service.ts'
import { descriptor } from '../src/shared/remote.ts'
import type { ApiResult, Project, Snapshot, WorkflowRun } from '../src/shared/contracts.ts'
let ctx: Context | undefined, app: MythorApplication | undefined, root: string | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  await app?.close()
  if (root) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup target')
    rmSync(root, { recursive: true, force: true })
  }
})
it('serves the built plugin through the real Cordis Typert Gateway and rejects malformed wire arguments', async () => {
  root = mkdtempSync(join(tmpdir(), 'mythor-harness-'))
  ctx = new Context()
  const { MythorRemote } = await import(pathToFileURL(resolve('lib/index.js')).href)
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  app = new MythorApplication(root, {}, pathToFileURL(resolve('lib/worker.js')))
  new MythorRemote(ctx, app)
  ctx.typert.register({
    package: 'dsh-mythor-plugin',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [descriptor],
  })
  const result = (await ctx.typertGateway.invoke({
    namespace: 'mythor',
    method: 'request',
    args: { request: { action: 'project.create', payload: { name: 'Gateway 小说' } } },
  })) as ApiResult
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Project fixture failed')
  const project = result.value as unknown as Project
  const taskResult = await ctx.mythor.request(
    {
      action: 'task.start',
      projectId: project.id,
      payload: { kind: 'write', intent: '等待模型恢复' },
    },
    new AbortController().signal,
  )
  expect(taskResult.ok).toBe(false)
  const saved = await ctx.mythor.request(
    { action: 'snapshot', projectId: project.id, payload: {} },
    new AbortController().signal,
  )
  expect(saved.ok && (saved.value as unknown as Snapshot).tasks[0].status).toBe('failed')
  await expect(
    ctx.typertGateway.invoke({
      namespace: 'mythor',
      method: 'request',
      args: { request: { action: 'unknown' } },
    }),
  ).rejects.toThrow()
})

it('dispatches a saved task, records Harness errors and resumes the same session', async () => {
  root = mkdtempSync(join(tmpdir(), 'mythor-agent-'))
  ctx = new Context()
  const { MythorRemote } = await import(pathToFileURL(resolve('lib/index.js')).href)
  app = new MythorApplication(root, {}, pathToFileURL(resolve('lib/worker.js')))
  const remote = new MythorRemote(ctx, app)
  const followup = vi.fn()
  const cancel = vi.fn()
  const dispose = vi.fn()
  let current:
    | { id: string; status: string; followup: typeof followup; cancel: typeof cancel }
    | undefined
  remote.agents = {
    create: vi.fn(async ({ sessionId }: { sessionId: string }) => {
      current = { id: sessionId, status: 'idle', followup, cancel }
      return { agent: current, dispose }
    }),
    get: vi.fn(() => current),
  }
  const result = await app.request({
    action: 'project.create',
    payload: { name: '固定模型调度夹具' },
  })
  if (!result.ok) throw new Error('fixture failed')
  const projectId = (result.value as unknown as Project).id
  const signal = new AbortController().signal
  const first = await remote.request(
    { action: 'task.start', projectId, payload: { kind: 'write', intent: '车站交换地图' } },
    signal,
  )
  expect(first.ok).toBe(true)
  const task = first.value as WorkflowRun
  expect(task.sessionId).toBe(current?.id)
  expect(followup).toHaveBeenCalledTimes(1)
  await remote.failed(task.sessionId!, new Error('fixture: model unavailable'))
  const snapshot = await app.request({ action: 'snapshot', projectId, payload: {} })
  expect(snapshot.ok && (snapshot.value as unknown as Snapshot).tasks[0].status).toBe('failed')
  const resumed = await remote.request(
    { action: 'task.resume', projectId, payload: { id: task.id } },
    signal,
  )
  expect(resumed.ok).toBe(true)
  expect(remote.agents.create).toHaveBeenCalledTimes(1)
  expect(followup).toHaveBeenCalledTimes(2)
  await remote.request({ action: 'task.cancel', projectId, payload: { id: task.id } }, signal)
  expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
})
it('loads the complete built plugin and releases its service on unload', async () => {
  root = mkdtempSync(join(tmpdir(), 'mythor-plugin-'))
  ctx = new Context()
  await ctx.plugin(Registry)
  await ctx.plugin(Prompt)
  await ctx.plugin(Tools, { mode: 'native' })
  await ctx.plugin(Commands)
  const plugin = await import(pathToFileURL(resolve('lib/index.js')).href)
  const fiber = ctx.plugin(plugin, { dataDirectory: root })
  await fiber
  expect(ctx.get('mythor')).toBeDefined()
  const result = await ctx.mythor.request(
    { action: 'project.create', payload: { name: '完整插件' } },
    new AbortController().signal,
  )
  expect(result.ok).toBe(true)
  await fiber.dispose()
  expect(ctx.get('mythor')).toBeUndefined()
})
