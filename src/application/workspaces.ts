import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { Actor, ApiResult, Limits, Request } from '../shared/contracts.ts'
import { MythorApplication } from './service.ts'

export interface NovelScope {
  readonly path: string
  readonly workspaceId: string
  readonly workspaceTitle: string
}

/** Owns one application Worker per canonical Harness Workspace. */
export class WorkspaceNovels {
  private readonly applications = new Map<string, MythorApplication>()
  private readonly focus = new Map<string, string[]>()
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly limits: Partial<Limits>,
    private readonly workerUrl?: URL,
    private readonly legacyRoot?: string,
    private readonly agents?: AgentRegistry,
  ) {}

  async resolve(agent: Agent): Promise<NovelScope> {
    const cwd = agent.session.header.cwd
    if (!cwd) throw new Error('当前会话没有工作目录，请先使用 Harness 工作区选择器选择项目')
    const workspace = await this.registry.resolveByPath(cwd)
    const root = this.agents
      ?.roots()
      .find((owner) => this.agents!.isOwnedBy(agent.id, owner) && owner.session.header.cwd === cwd)
    if (
      !workspace ||
      !workspace.sessionIds.some(
        (id) => String(id) === String(agent.id) || (root && String(id) === String(root.id)),
      )
    )
      throw new Error('当前会话不属于有效的 Harness 工作区，请重新选择项目')
    return {
      path: workspace.path,
      workspaceId: String(workspace.id),
      workspaceTitle: workspace.title,
    }
  }

  /**
   * Checks whether extensions should be installed during `agent/created`.
   * Harness has resolved the workspace path at that point, but adds the new
   * session id to WorkspaceRegistry only after creation listeners finish.
   * Every actual request still goes through resolve() and its ownership check.
   */
  async shouldInstall(agent: Agent): Promise<boolean> {
    const cwd = agent.session.header.cwd
    if (!cwd) return false
    const workspace = await this.registry.resolveByPath(cwd)
    if (!workspace) return false
    return this.isEnabled({
      path: workspace.path,
      workspaceId: String(workspace.id),
      workspaceTitle: workspace.title,
    })
  }

  activeSession(id: Agent['id']) {
    return this.agents?.get(id)?.session
  }

  async memberSessions(agent: Agent) {
    const scope = await this.resolve(agent)
    const workspace = await this.registry.resolveByPath(scope.path)
    return workspace!.sessionIds
  }

  async matchesWorkspace(scope: NovelScope, cwd: string) {
    return String((await this.registry.resolveByPath(cwd))?.id) === scope.workspaceId
  }

  private databasePath(scope: NovelScope) {
    return join(scope.path, '.mythor', 'novel.sqlite')
  }

  isEnabled(scope: NovelScope) {
    return existsSync(this.databasePath(scope))
  }

  private open(scope: NovelScope, create: boolean) {
    let application = this.applications.get(scope.path)
    if (application) return application
    if (!create && !this.isEnabled(scope)) return undefined
    const root = join(scope.path, '.mythor')
    mkdirSync(root, { recursive: true })
    const ignore = join(root, '.gitignore')
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n!.gitignore\n', 'utf8')
    application = new MythorApplication(root, this.limits, this.workerUrl)
    this.applications.set(scope.path, application)
    return application
  }

  async request(
    agent: Agent,
    request: Request,
    actor: Actor,
    signal?: AbortSignal,
  ): Promise<ApiResult> {
    let scope: NovelScope
    try {
      scope = await this.resolve(agent)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'workspace-unavailable',
          message: error instanceof Error ? error.message : '当前会话没有可用的 Harness 工作区',
        },
      }
    }
    if (request.action === 'legacy.list') return { ok: true, value: this.legacyList() }
    if (request.action === 'legacy.migrate') {
      if (actor.kind !== 'author')
        return { ok: false, error: { code: 'author-only', message: '旧版迁移只能由作者发起' } }
      return this.migrateLegacy(scope, request, actor, signal)
    }
    if (request.action === 'restore' && !this.isEnabled(scope)) {
      if (actor.kind !== 'author')
        return { ok: false, error: { code: 'author-only', message: '备份恢复只能由作者发起' } }
      return this.installBackup(scope, String(request.payload.text ?? ''), actor, signal)
    }
    if (request.action === 'novel.status' && !this.isEnabled(scope))
      return { ok: true, value: { enabled: false } }
    const application = this.open(scope, request.action === 'novel.enable')
    if (!application)
      return {
        ok: false,
        error: {
          code: 'novel-not-enabled',
          message: '当前 Harness 项目尚未启用 Mythor，请先运行 /mythor enable <作品标题>',
        },
      }
    const normalized =
      request.action === 'session.save' || request.action === 'session.state'
        ? { ...request, payload: { ...request.payload, id: String(agent.id) } }
        : request.action === 'task.start' || request.action === 'task.resume'
          ? {
              ...request,
              payload: { ...request.payload, sessionId: String(agent.id) },
            }
          : request
    const result = await application.request(normalized, actor, signal)
    if (
      result.ok &&
      ![
        'novel.status',
        'workspace.progress',
        'snapshot',
        'query',
        'context',
        'graph',
        'document.read',
        'history',
        'export',
        'backup',
        'legacy.list',
        'task.list',
        'task.read',
        'material.list',
        'material.read',
        'session.state',
        'session.save',
      ].includes(request.action)
    )
      this.notify(scope.path)
    return result
  }

  setFocus(agent: Agent, ids: string[]) {
    this.focus.set(String(agent.id), ids)
    void this.request(
      agent,
      { action: 'session.save', payload: { value: { focus: ids } } },
      { kind: 'author' },
    )
  }

  getFocus(agent: Agent) {
    return this.focus.get(String(agent.id)) ?? []
  }
  async restoreFocus(agent: Agent) {
    if (this.focus.has(String(agent.id))) return this.getFocus(agent)
    const result = await this.request(
      agent,
      { action: 'session.state', payload: {} },
      { kind: 'author' },
    )
    if (result.ok) {
      const saved = result.value as { focus?: unknown }
      if (Array.isArray(saved.focus) && saved.focus.every((id) => typeof id === 'string'))
        this.focus.set(String(agent.id), saved.focus)
    }
    return this.getFocus(agent)
  }

  async *watch(agent: Agent, signal: AbortSignal): AsyncIterable<{ generation: number }> {
    const scope = await this.resolve(agent)
    let generation = 0
    let wake: (() => void) | undefined
    let pending = true
    const changed = () => {
      pending = true
      wake?.()
      wake = undefined
    }
    const listeners = this.listeners.get(scope.path) ?? new Set<() => void>()
    listeners.add(changed)
    this.listeners.set(scope.path, listeners)
    const abort = () => changed()
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (!pending) await new Promise<void>((resolve) => (wake = resolve))
        if (signal.aborted) break
        pending = false
        yield { generation: ++generation }
      }
    } finally {
      signal.removeEventListener('abort', abort)
      listeners.delete(changed)
      if (listeners.size === 0) this.listeners.delete(scope.path)
    }
  }

  private notify(path: string) {
    for (const listener of this.listeners.get(path) ?? []) listener()
  }

  async invalidate(agent: Agent) {
    const scope = await this.resolve(agent)
    this.notify(scope.path)
  }

  private legacyList(): { id: string; name: string; revision: number; archived: boolean }[] {
    const catalogPath = this.legacyRoot && join(this.legacyRoot, 'catalog.sqlite')
    if (!catalogPath || !existsSync(catalogPath)) return []
    const catalog = new DatabaseSync(catalogPath, { readOnly: true })
    try {
      return catalog
        .prepare('SELECT data FROM projects ORDER BY rowid')
        .all()
        .map((row) => JSON.parse(String((row as { data: string }).data)))
    } finally {
      catalog.close()
    }
  }

  private legacyBackup(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('旧版小说 ID 无效')
    const project = this.legacyList().find((entry) => entry.id === id)
    const sourcePath = this.legacyRoot && join(this.legacyRoot, `${id}.sqlite`)
    if (!project || !sourcePath || !existsSync(sourcePath))
      throw new Error('旧版 Mythor 小说不存在')
    const database = new DatabaseSync(sourcePath, { readOnly: true })
    const tables = [
      'entities',
      'relations',
      'documents',
      'revisions',
      'changes',
      'commits',
      'tasks',
      'grants',
    ]
    try {
      database.exec('BEGIN')
      const content = Object.fromEntries(
        tables.map((table) => [
          table,
          database
            .prepare(`SELECT data FROM ${table}`)
            .all()
            .map((row) => JSON.parse(String((row as { data: string }).data))),
        ]),
      )
      database.exec('COMMIT')
      return JSON.stringify({ format: 'mythor', version: 1, project, tables: content })
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    } finally {
      database.close()
    }
  }

  private async migrateLegacy(
    scope: NovelScope,
    request: Request,
    actor: Actor,
    signal?: AbortSignal,
  ): Promise<ApiResult> {
    const legacyId = String(request.payload.legacyId ?? '')
    const project = this.legacyList().find((entry) => entry.id === legacyId)
    if (!project)
      return { ok: false, error: { code: 'legacy-not-found', message: '旧版 Mythor 小说不存在' } }
    if (this.isEnabled(scope))
      return {
        ok: false,
        error: {
          code: 'restore-target-not-empty',
          message: '当前 Harness 项目已启用 Mythor，不能迁入旧版小说',
        },
      }
    const backup = this.legacyBackup(legacyId)
    const result = await this.installBackup(scope, backup, actor, signal, project.name)
    if (!result.ok && result.error.code === 'invalid-request')
      return {
        ok: false,
        error: {
          code: 'legacy-incompatible',
          message: '旧版小说数据无法迁入。请确认数据来自受支持的 Mythor 0.1.x 版本。',
        },
      }
    return result
  }

  private async installBackup(
    scope: NovelScope,
    text: string,
    actor: Actor,
    signal?: AbortSignal,
    initialTitle = '正在恢复的小说',
  ): Promise<ApiResult> {
    const finalRoot = join(scope.path, '.mythor')
    const tempRoot = join(scope.path, `.mythor-install-${randomUUID()}`)
    if (dirname(resolve(tempRoot)) !== resolve(scope.path))
      return { ok: false, error: { code: 'unsafe-path', message: '迁移临时目录不在当前工作区' } }
    const application = new MythorApplication(tempRoot, this.limits, this.workerUrl)
    try {
      const enabled = await application.request(
        { action: 'novel.enable', payload: { title: initialTitle } },
        actor,
        signal,
      )
      if (!enabled.ok) return enabled
      const restored = await application.request(
        { action: 'restore', payload: { text } },
        actor,
        signal,
      )
      if (!restored.ok) return restored
      await application.close()
      writeFileSync(join(tempRoot, '.gitignore'), '*\n!.gitignore\n', 'utf8')
      if (existsSync(finalRoot))
        return {
          ok: false,
          error: {
            code: 'restore-target-not-empty',
            message: '当前 Harness 项目已存在 Mythor 数据',
          },
        }
      renameSync(tempRoot, finalRoot)
      this.notify(scope.path)
      return restored
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'restore-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    } finally {
      await application.close().catch(() => undefined)
      if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
    }
  }

  async close() {
    const applications = [...this.applications.values()]
    this.applications.clear()
    await Promise.all(applications.map((application) => application.close()))
  }
}
