import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { CritiqueSchema } from '../shared/contracts.ts'
import {
  ChangeSetSchema,
  CommitSchema,
  DEFAULT_LIMITS,
  DocumentSchema,
  EntitySchema,
  Id,
  OperationSchema,
  RelationSchema,
  RequestSchema,
  WorkflowSchema,
  type Actor,
  type ChangeSet,
  type Commit,
  type ContextPack,
  type Document,
  type Entity,
  type Json,
  type Limits,
  type Operation,
  type Project,
  type Relation,
  type Request,
  type Snapshot,
  type WorkflowRun,
} from '../shared/contracts.ts'
import { MythorError, requireValue } from '../domain/errors.ts'
import { applyOperations, impacted, validate } from '../domain/validation.ts'
import { advance } from '../domain/workflows.ts'
import { movement, crossings } from '../domain/projections.ts'

const uid = () => randomUUID()
const now = () => new Date().toISOString()
const stringify = (v: unknown) => JSON.stringify(v)
function decode<T>(row: unknown): T {
  return JSON.parse((row as { data: string }).data) as T
}
const Body = z.object({ id: Id })
const safeJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json
const TABLES = [
  'entities',
  'relations',
  'documents',
  'revisions',
  'changes',
  'commits',
  'tasks',
  'grants',
] as const
type Table = (typeof TABLES)[number]

export class Store {
  private readonly catalog: DatabaseSync
  private readonly open = new Map<string, DatabaseSync>()
  readonly limits: Limits
  constructor(
    readonly root: string,
    limits: Partial<Limits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    mkdirSync(root, { recursive: true })
    this.catalog = new DatabaseSync(join(root, 'catalog.sqlite'))
    this.catalog.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    )
  }
  close() {
    for (const db of this.open.values()) db.close()
    this.open.clear()
    this.catalog.close()
  }
  private db(id: string): DatabaseSync {
    Id.parse(id)
    if (this.open.has(id)) return this.open.get(id)!
    requireValue(
      this.catalog.prepare('SELECT id FROM projects WHERE id=?').get(id),
      'project-not-found',
      '小说项目不存在',
    )
    const db = new DatabaseSync(join(this.root, `${id}.sqlite`))
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) {
      db.close()
      throw new MythorError('future-schema', '数据库来自更新版本，拒绝写入')
    }
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    )
    for (const table of TABLES)
      db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
    db.exec(
      'CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, kind UNINDEXED, tokens); PRAGMA user_version=1',
    )
    this.open.set(id, db)
    for (const task of this.all<WorkflowRun>(db, 'tasks'))
      if (task.status === 'running')
        this.put(db, 'tasks', task.id, {
          ...task,
          status: 'pending',
          error: '运行中断，可从已保存阶段恢复',
        })
    return db
  }
  private all<T>(db: DatabaseSync, table: Table): T[] {
    return db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((row) => decode<T>(row))
  }
  private get<T>(db: DatabaseSync, table: Table, id: string): T {
    return decode<T>(requireValue(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id)))
  }
  private maybe<T>(db: DatabaseSync, table: Table, id: string): T | undefined {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id)
    return row ? decode<T>(row) : undefined
  }
  private put(db: DatabaseSync, table: Table, id: string, value: unknown) {
    db.prepare(
      `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    ).run(id, stringify(value))
  }
  private project(db: DatabaseSync): Project {
    return decode<Project>(
      requireValue(db.prepare("SELECT data FROM meta WHERE id='project'").get()),
    )
  }
  private setProject(db: DatabaseSync, project: Project) {
    db.prepare(
      "INSERT INTO meta(id,data) VALUES('project',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(stringify(project))
  }
  private snapshot(db: DatabaseSync): Snapshot {
    return {
      project: this.project(db),
      entities: this.all(db, 'entities'),
      relations: this.all(db, 'relations'),
      documents: this.all(db, 'documents'),
      changes: this.all(db, 'changes'),
      tasks: this.all(db, 'tasks'),
    }
  }

  execute(raw: Request, actor: Actor): Json {
    const req = RequestSchema.parse(raw)
    const p = req.payload
    if (actor.kind === 'agent') {
      if (
        [
          'project.create',
          'project.archive',
          'grant',
          'restore',
          'binding.set',
          'history.undo',
          'task.finish',
          'task.fail',
        ].includes(req.action)
      )
        throw new MythorError('author-only', '该操作只能由作者发起')
      if (req.projectId) {
        const binding = this.binding(actor.sessionId)
        if (binding?.projectId !== req.projectId)
          throw new MythorError(
            'project-scope',
            '模型请求与当前会话绑定项目不一致，请作者先使用 /mythor project use',
          )
      }
    }
    if (req.action === 'project.list')
      return safeJson(
        this.catalog
          .prepare('SELECT data FROM projects')
          .all()
          .map((row) => {
            const project = decode<Project>(row)
            return this.project(this.db(project.id))
          }),
      )
    if (req.action === 'project.create') {
      const name = z.string().trim().min(1).max(200).parse(p.name)
      const project: Project = { id: uid(), name, revision: 0, archived: false, createdAt: now() }
      this.catalog.prepare('INSERT INTO projects VALUES(?,?)').run(project.id, stringify(project))
      this.setProject(this.db(project.id), project)
      return safeJson(project)
    }
    if (req.action === 'binding.get')
      return safeJson(
        this.binding(actor.kind === 'agent' ? actor.sessionId : Id.parse(p.sessionId)) ?? null,
      )
    if (req.action === 'binding.set') {
      const sessionId = Id.parse(p.sessionId)
      const projectId = Id.parse(req.projectId)
      this.db(projectId)
      const value = { projectId, focus: z.array(Id).default([]).parse(p.focus) }
      this.catalog
        .prepare(
          'INSERT INTO bindings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        )
        .run(sessionId, stringify(value))
      return safeJson(value)
    }
    if (req.action === 'restore') return this.restore(p)
    const projectId = Id.parse(req.projectId)
    const db = this.db(projectId)
    const project = this.project(db)
    if (
      project.archived &&
      !['snapshot', 'query', 'history', 'export', 'backup', 'project.archive'].includes(req.action)
    )
      throw new MythorError('project-archived', '项目已归档，请先恢复项目')
    switch (req.action) {
      case 'project.archive':
        this.setProject(db, { ...project, archived: z.boolean().parse(p.archived) })
        return safeJson(this.project(db))
      case 'snapshot':
        return safeJson(this.snapshot(db))
      case 'query':
        return this.query(db, p)
      case 'context':
        return safeJson(this.context(db, p))
      case 'graph':
        return this.graph(db, p)
      case 'document.read':
        return safeJson(
          p.revisionId
            ? this.get<Document>(db, 'revisions', Id.parse(p.revisionId))
            : this.get<Document>(db, 'documents', Body.parse(p).id),
        )
      case 'world.validate': {
        const findings = validate(this.snapshot(db), this.all(db, 'revisions'))
        if (p.taskId) {
          const task = this.ownedTask(db, Id.parse(p.taskId), actor)
          if (
            task.kind !== 'check' ||
            task.stage !== 'validate' ||
            ['cancelled', 'completed'].includes(task.status)
          )
            throw new MythorError('stage-order', '当前任务未到世界校验阶段')
          findings.push(...(task.critique ?? []))
          this.put(db, 'tasks', task.id, {
            ...task,
            stage: 'review',
            status: 'waiting_review',
            artifacts: { ...task.artifacts, validate: safeJson(findings) },
          })
        }
        return safeJson({ revision: project.revision, findings })
      }
      case 'changes.propose':
        return safeJson(this.propose(db, p, actor))
      case 'changes.validate': {
        const change = this.get<ChangeSet>(db, 'changes', Body.parse(p).id)
        const result = this.check(db, change)
        if (change.taskId) {
          const task = this.ownedTask(db, change.taskId, actor)
          if (['cancelled', 'completed'].includes(task.status))
            throw new MythorError('task-closed', '任务已结束')
          if (task.stage !== 'validate' && task.stage !== 'review')
            throw new MythorError('stage-order', '请先完成提取阶段')
          this.put(db, 'tasks', task.id, {
            ...task,
            stage: 'review',
            status: 'waiting_review',
            artifacts: { ...task.artifacts, validate: safeJson(result) },
          })
        }
        return safeJson(result)
      }
      case 'changes.commit':
        return safeJson(this.commit(db, p, actor))
      case 'changes.reject': {
        if (actor.kind !== 'author') throw new MythorError('author-only', '拒绝候选由作者决定')
        const change = this.get<ChangeSet>(db, 'changes', Body.parse(p).id)
        if (change.status !== 'pending') throw new MythorError('change-closed', '变更已结束')
        this.put(db, 'changes', change.id, { ...change, status: 'rejected' })
        return { rejected: change.id }
      }
      case 'history':
        return safeJson(this.all<Commit>(db, 'commits').sort((a, b) => b.revision - a.revision))
      case 'history.undo':
        return safeJson(this.undo(db, Body.parse(p).id))
      case 'task.start':
        return safeJson(this.startTask(db, p, actor))
      case 'task.critique': {
        const input = z.object({ id: Id, findings: z.array(CritiqueSchema).max(100) }).parse(p)
        const task = this.ownedTask(db, input.id, actor)
        if (
          !['validate', 'review'].includes(task.stage) ||
          ['cancelled', 'completed', 'failed'].includes(task.status)
        )
          throw new MythorError('stage-order', '语义检查只能在校验或审阅阶段记录')
        const next = { ...task, critique: input.findings }
        this.put(db, 'tasks', task.id, next)
        return safeJson(next)
      }
      case 'task.fail': {
        const input = z.object({ id: Id, error: z.string().max(2000) }).parse(p)
        const task = this.get<WorkflowRun>(db, 'tasks', input.id)
        if (['completed', 'cancelled'].includes(task.status)) return safeJson(task)
        const next = { ...task, status: 'failed', error: input.error }
        this.put(db, 'tasks', task.id, next)
        return safeJson(next)
      }
      case 'task.finish': {
        const task = this.get<WorkflowRun>(db, 'tasks', Body.parse(p).id)
        if (
          !['plan', 'check'].includes(task.kind) ||
          task.stage !== 'review' ||
          task.status !== 'waiting_review'
        )
          throw new MythorError('stage-order', '仅可接受待审阅的规划或检查任务')
        this.put(db, 'tasks', task.id, {
          ...task,
          status: 'completed',
          artifacts: { ...task.artifacts, review: { accepted: true } },
        })
        return safeJson(this.get(db, 'tasks', task.id))
      }
      case 'task.advance': {
        const input = z
          .object({
            id: Id,
            stage: z.enum(['read', 'goals', 'plan', 'simulate', 'write', 'extract']),
            artifact: z.json(),
          })
          .parse(p)
        const task = this.ownedTask(db, input.id, actor)
        const next = advance(task, input.stage, input.artifact)
        this.put(db, 'tasks', next.id, next)
        return safeJson(next)
      }
      case 'task.cancel':
      case 'task.resume': {
        const task = this.ownedTask(db, Body.parse(p).id, actor)
        if (task.status === 'completed') throw new MythorError('task-closed', '已完成任务不能恢复')
        const cancel = req.action === 'task.cancel'
        const next: WorkflowRun = {
          ...task,
          error: undefined,
          status: cancel ? 'cancelled' : task.stage === 'review' ? 'waiting_review' : 'pending',
        }
        if (!cancel && p.sessionId) {
          if (actor.kind !== 'author')
            throw new MythorError('author-only', '任务会话只能由作者重新绑定')
          next.sessionId = Id.parse(p.sessionId)
          if (this.binding(next.sessionId)?.projectId !== projectId)
            throw new MythorError('project-scope', '请先将会话绑定至任务所在项目')
          if (next.sessionId !== task.sessionId)
            db.prepare('DELETE FROM grants WHERE id=?').run(task.id)
        }
        if (!cancel && task.baseRevision !== project.revision) {
          next.baseRevision = project.revision
          next.stage = 'read'
          next.artifacts = {}
          next.critique = undefined
          next.error = '项目版本改变，需要重新读取与规划；旧候选保留供比较'
        }
        this.put(db, 'tasks', task.id, next)
        if (cancel) db.prepare('DELETE FROM grants WHERE id=?').run(task.id)
        return safeJson(next)
      }
      case 'grant': {
        const input = z
          .object({ taskId: Id, entityIds: z.array(Id).min(1), expiresAt: z.string().datetime() })
          .parse(p)
        const task = this.get<WorkflowRun>(db, 'tasks', input.taskId)
        if (['cancelled', 'completed'].includes(task.status))
          throw new MythorError('task-closed', '任务已结束')
        this.put(db, 'grants', task.id, input)
        return safeJson(input)
      }
      case 'import':
        return safeJson(this.importText(db, p, actor))
      case 'export': {
        const order = new Map(
          this.all<Entity>(db, 'entities').map((e) => [e.id, e.narrativeOrder ?? Infinity]),
        )
        return {
          name: `${project.name}.md`,
          text: this.all<Document>(db, 'documents')
            .sort(
              (a, b) =>
                (order.get(a.entityId ?? '') ?? Infinity) -
                (order.get(b.entityId ?? '') ?? Infinity),
            )
            .map((d) => `# ${d.title}\n\n${d.text}`)
            .join('\n\n'),
        }
      }
      case 'backup':
        return this.backup(db)
      default:
        throw new MythorError('unknown-action', `不支持的操作 ${req.action}`)
    }
  }

  private binding(sessionId: string): { projectId: string; focus: string[] } | undefined {
    const row = this.catalog.prepare('SELECT data FROM bindings WHERE id=?').get(sessionId)
    return row ? decode(row) : undefined
  }
  private ownedTask(db: DatabaseSync, id: string, actor: Actor): WorkflowRun {
    const task = this.get<WorkflowRun>(db, 'tasks', id)
    if (actor.kind === 'agent' && task.sessionId !== actor.sessionId)
      throw new MythorError('task-scope', '该任务不属于当前会话')
    return task
  }
  private propose(db: DatabaseSync, p: Record<string, Json>, actor: Actor): ChangeSet {
    const input = z
      .object({
        baseRevision: z.number().int().nonnegative(),
        summary: z.string().min(1).max(2000),
        taskId: Id.optional(),
        operations: z.array(OperationSchema).min(1).max(10_000),
      })
      .parse(p)
    const project = this.project(db)
    if (input.baseRevision !== project.revision)
      throw new MythorError('revision-conflict', '项目已更新，请重新读取', {
        currentRevision: project.revision,
      })
    if (input.taskId) {
      const task = this.ownedTask(db, input.taskId, actor)
      if (['cancelled', 'completed'].includes(task.status))
        throw new MythorError('task-closed', '任务已结束')
    }
    const touched = new Set<string>()
    for (const op of input.operations) {
      const key = `${op.type.split('.')[0]}:${'value' in op ? op.value.id : op.id}`
      if (touched.has(key))
        throw new MythorError('duplicate-operation', '一个变更集中同一对象只能修改一次')
      touched.add(key)
    }
    const change: ChangeSet = {
      ...input,
      id: uid(),
      projectId: project.id,
      status: 'pending',
      createdAt: now(),
    }
    this.put(db, 'changes', change.id, change)
    return change
  }
  private check(db: DatabaseSync, change: ChangeSet) {
    const snapshot = this.snapshot(db)
    const next = applyOperations(snapshot, change.operations)
    const findings = validate(next, [...this.all<Document>(db, 'revisions'), ...next.documents])
    if (change.taskId)
      findings.push(...(this.get<WorkflowRun>(db, 'tasks', change.taskId).critique ?? []))
    if (change.baseRevision !== snapshot.project.revision)
      findings.unshift({
        code: 'revision-conflict',
        severity: 'error',
        message: '候选基于旧版本，需重新构造变更',
        entityIds: [],
        sources: [],
      })
    for (const op of change.operations)
      if (op.type === 'document.put') {
        const previous = this.maybe<Document>(db, 'documents', op.value.id)
        const sameRevision = this.maybe<Document>(db, 'revisions', op.value.revisionId)
        if (sameRevision && stringify(sameRevision) !== stringify(op.value))
          findings.push({
            code: 'immutable-revision',
            severity: 'error',
            message: '已有正文修订不可覆盖',
            entityIds: [],
            sources: [],
          })
        if (previous && op.value.parentRevisionId !== previous.revisionId)
          findings.push({
            code: 'document-conflict',
            severity: 'error',
            message: '正文父修订不是当前版本',
            entityIds: [],
            sources: [],
          })
      }
    return {
      revision: snapshot.project.revision,
      findings,
      affected: impacted(snapshot, change.operations),
    }
  }
  private commit(db: DatabaseSync, p: Record<string, Json>, actor: Actor): Commit {
    const input = z
      .object({ id: Id, idempotencyKey: Id, acknowledgeWarnings: z.boolean().default(false) })
      .parse(p)
    const prior = db.prepare('SELECT data FROM receipts WHERE id=?').get(input.idempotencyKey)
    if (prior) {
      const result = decode<Commit>(prior)
      if (result.changeSetId !== input.id)
        throw new MythorError('idempotency-conflict', '幂等键属于其他变更')
      return result
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const change = this.get<ChangeSet>(db, 'changes', input.id)
      if (change.status !== 'pending') throw new MythorError('change-closed', '变更已提交或拒绝')
      let task: WorkflowRun | undefined
      if (change.taskId) {
        task = this.ownedTask(db, change.taskId, actor)
        if (task.status === 'cancelled' || task.status === 'completed')
          throw new MythorError('task-closed', '任务已结束')
      }
      const checked = this.check(db, change)
      if (checked.findings.some((f) => f.severity === 'error'))
        throw new MythorError('validation-failed', '存在阻止提交的问题', safeJson(checked.findings))
      if (checked.findings.length && (actor.kind !== 'author' || !input.acknowledgeWarnings))
        throw new MythorError(
          'review-required',
          '需要作者确认警告及未确定规则',
          safeJson(checked.findings),
        )
      if (actor.kind === 'agent') {
        if (!task || task.stage !== 'review' || !task.artifacts.validate)
          throw new MythorError('review-required', '模型提交需要已完成校验的任务')
        const grant = this.maybe<{ entityIds: string[]; expiresAt: string }>(db, 'grants', task.id)
        const targets = change.operations.flatMap((op) =>
          op.type === 'relation.put'
            ? [op.value.from, op.value.to]
            : op.type === 'document.put'
              ? [op.value.entityId ?? op.value.id]
              : 'value' in op
                ? [op.value.id]
                : [op.id],
        )
        if (
          !grant ||
          Date.parse(grant.expiresAt) <= Date.now() ||
          targets.some((id) => !grant.entityIds.includes(id))
        )
          throw new MythorError('grant-required', '任务没有覆盖本次修改的有效作者授权')
      }
      const project = this.project(db)
      const revision = project.revision + 1
      const inverse: Operation[] = []
      const staleIds = new Set<string>()
      const changedDocuments = new Set<string>()
      for (const op of change.operations) {
        if (op.type === 'entity.put' || op.type === 'entity.delete') {
          const id = 'value' in op ? op.value.id : op.id
          const old = this.maybe<Entity>(db, 'entities', id)
          inverse.unshift(old ? { type: 'entity.put', value: old } : { type: 'entity.delete', id })
          if (op.type === 'entity.put')
            this.put(db, 'entities', id, { ...op.value, editorialStatus: 'accepted', revision })
          else db.prepare('DELETE FROM entities WHERE id=?').run(id)
        } else if (op.type === 'relation.put' || op.type === 'relation.delete') {
          const id = 'value' in op ? op.value.id : op.id
          const old = this.maybe<Relation>(db, 'relations', id)
          inverse.unshift(
            old ? { type: 'relation.put', value: old } : { type: 'relation.delete', id },
          )
          if (op.type === 'relation.put') this.put(db, 'relations', id, { ...op.value, revision })
          else db.prepare('DELETE FROM relations WHERE id=?').run(id)
        } else {
          const id = 'value' in op ? op.value.id : op.id
          const old = this.maybe<Document>(db, 'documents', id)
          inverse.unshift(
            old ? { type: 'document.put', value: old } : { type: 'document.delete', id },
          )
          if (op.type === 'document.put') {
            this.put(db, 'documents', id, op.value)
            this.put(db, 'revisions', op.value.revisionId, op.value)
          } else db.prepare('DELETE FROM documents WHERE id=?').run(id)
          if (old) changedDocuments.add(id)
        }
      }
      // Reconcile after all operations so operation order cannot revive old extraction.
      const currentDocs = new Map(
        this.all<Document>(db, 'documents').map((d) => [d.id, d.revisionId]),
      )
      for (const entity of this.all<Entity>(db, 'entities'))
        if (
          entity.sources.some(
            (s) =>
              changedDocuments.has(s.documentId) && currentDocs.get(s.documentId) !== s.revisionId,
          )
        ) {
          if (
            !change.operations.some((op) => op.type === 'entity.put' && op.value.id === entity.id)
          )
            inverse.unshift({ type: 'entity.put', value: entity })
          this.put(db, 'entities', entity.id, { ...entity, stale: true, revision })
          staleIds.add(entity.id)
        }
      const commit: Commit = {
        id: uid(),
        revision,
        changeSetId: change.id,
        summary: change.summary,
        operations: change.operations,
        inverse,
        actor: actor.kind === 'author' ? 'author' : `agent:${actor.sessionId}`,
        createdAt: now(),
      }
      this.put(db, 'commits', commit.id, commit)
      this.put(db, 'changes', change.id, { ...change, status: 'committed', revision })
      this.setProject(db, { ...project, revision })
      if (staleIds.size)
        this.startTask(
          db,
          {
            kind: 'check',
            intent: `正文修改后复查来源与关联对象（提交 ${commit.id}）`,
            focus: [...staleIds],
          },
          { kind: 'author' },
        )
      if (task)
        this.put(db, 'tasks', task.id, {
          ...task,
          stage: 'commit',
          status: 'completed',
          artifacts: { ...task.artifacts, commit: { commitId: commit.id, revision } },
        })
      db.prepare('INSERT INTO receipts VALUES(?,?)').run(input.idempotencyKey, stringify(commit))
      this.reindex(db)
      db.exec('COMMIT')
      return commit
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  private undo(db: DatabaseSync, id: string): ChangeSet {
    const commit = this.get<Commit>(db, 'commits', id)
    const history = this.all<Commit>(db, 'commits')
    const keys = (ops: Operation[]) =>
      ops.map((op) => `${op.type.split('.')[0]}:${'value' in op ? op.value.id : op.id}`)
    const targets = new Set(keys([...commit.operations, ...commit.inverse]))
    if (
      history.some(
        (c) =>
          c.revision > commit.revision &&
          keys([...c.operations, ...c.inverse]).some((k) => targets.has(k)),
      )
    )
      throw new MythorError('undo-conflict', '后续提交修改了相同对象，请通过新的修复候选处理')
    const operations = commit.inverse.map((op) =>
      op.type === 'document.put'
        ? {
            ...op,
            value: {
              ...op.value,
              revisionId: uid(),
              parentRevisionId: this.maybe<Document>(db, 'documents', op.value.id)?.revisionId,
            },
          }
        : op,
    )
    return this.propose(
      db,
      {
        baseRevision: this.project(db).revision,
        summary: `撤销：${commit.summary}`,
        operations: safeJson(operations),
      },
      { kind: 'author' },
    )
  }
  private startTask(db: DatabaseSync, p: Record<string, Json>, actor: Actor): WorkflowRun {
    const input = z
      .object({
        kind: z.enum(['plan', 'write', 'revise', 'check', 'import']),
        intent: z.string().min(1),
        focus: z.array(Id).default([]),
        sessionId: Id.optional(),
      })
      .parse(p)
    const task: WorkflowRun = {
      ...input,
      id: uid(),
      projectId: this.project(db).id,
      baseRevision: this.project(db).revision,
      sessionId: actor.kind === 'agent' ? actor.sessionId : input.sessionId,
      stage: 'read',
      status: 'pending',
      artifacts: {},
    }
    this.put(db, 'tasks', task.id, task)
    return task
  }
  private importText(db: DatabaseSync, p: Record<string, Json>, actor: Actor) {
    const input = z
      .object({
        title: z.string().min(1),
        text: z.string().min(1).max(this.limits.maxImportChars),
        preview: z.boolean().default(false),
      })
      .parse(p)
    const parts = input.text
      .replace(/^\uFEFF/, '')
      .split(/(?=^#{1,3} .+$|^第[一二三四五六七八九十百千\d]+[章节卷].*$)/m)
      .filter((v) => v.trim())
    const documents = parts.map((part, index) => {
      const lines = part.trim().split('\n')
      const title = /^(#{1,3} |第)/.test(lines[0])
        ? lines.shift()!.replace(/^#+\s*/, '')
        : `${input.title} ${index + 1}`
      return { id: uid(), revisionId: uid(), title, text: lines.join('\n').trim() }
    })
    if (input.preview)
      return { chapters: documents.map((d) => ({ title: d.title, chars: d.text.length })) }
    const task = this.startTask(
      db,
      { kind: 'import', intent: `提取《${input.title}》的世界、人物与事件`, focus: [] },
      actor,
    )
    const operations: Operation[] = documents.flatMap((doc, index) => {
      const entity = EntitySchema.parse({
        id: uid(),
        kind: 'chapter',
        name: doc.title,
        narrativeOrder: index,
      })
      return [
        { type: 'entity.put', value: entity },
        { type: 'document.put', value: { ...doc, entityId: entity.id } },
      ]
    })
    const change = this.propose(
      db,
      {
        baseRevision: this.project(db).revision,
        summary: `导入 ${documents.length} 个章节：${input.title}`,
        operations: safeJson(operations),
      },
      actor,
    )
    return {
      change,
      task,
      chapters: documents.length,
      note: '原文先经作者接受；世界事实需要独立提取与审阅。',
    }
  }
  private reindex(db: DatabaseSync) {
    db.exec('DELETE FROM search')
    const insert = db.prepare('INSERT INTO search(id,kind,tokens) VALUES(?,?,?)')
    for (const e of this.all<Entity>(db, 'entities'))
      insert.run(e.id, e.kind, tokenize(`${e.name} ${e.aliases.join(' ')} ${e.summary}`))
    for (const d of this.all<Document>(db, 'documents'))
      insert.run(d.id, 'document', tokenize(`${d.title} ${d.text}`))
  }
  private query(db: DatabaseSync, p: Record<string, Json>): Json {
    const input = z
      .object({
        text: z.string().default(''),
        kind: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      })
      .parse(p)
    let entities = this.all<Entity>(db, 'entities').filter(
      (e) => !input.kind || e.kind === input.kind,
    )
    if (input.text) {
      const tokens = tokenize(input.text).split(' ').filter(Boolean)
      const ids = new Set(
        tokens.length
          ? db
              .prepare('SELECT id FROM search WHERE search MATCH ? ORDER BY rank LIMIT 500')
              .all(tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(' OR '))
              .map((row) => String(row.id))
          : [],
      )
      entities = entities.filter(
        (e) =>
          ids.has(e.id) ||
          e.name.includes(input.text) ||
          e.aliases.some((a) => a.includes(input.text)),
      )
    }
    return safeJson({
      items: entities.slice(input.offset, input.offset + input.limit),
      total: entities.length,
      nextOffset: input.offset + input.limit < entities.length ? input.offset + input.limit : null,
    })
  }
  private context(db: DatabaseSync, p: Record<string, Json>): ContextPack {
    const input = z
      .object({
        focus: z.array(Id).max(20).default([]),
        perspective: Id.default('author'),
        time: z.number().optional(),
        narrativeOrder: z.number().optional(),
        text: z.string().max(1000).default(''),
      })
      .parse(p)
    const world = this.snapshot(db)
    const gaps: string[] = []
    const valid = world.entities.filter(
      (e) =>
        !e.stale &&
        e.editorialStatus !== 'retired' &&
        (input.time === undefined ||
          ((e.time?.start ?? -Infinity) <= input.time && (e.time?.end ?? Infinity) >= input.time)),
    )
    let allowed = valid
    if (input.perspective !== 'author') {
      const evidence = valid.filter((e) =>
        input.perspective === 'reader'
          ? e.kind === 'revelation' &&
            input.narrativeOrder !== undefined &&
            e.narrativeOrder !== undefined &&
            e.narrativeOrder <= input.narrativeOrder
          : e.kind === 'knowledge' &&
            e.attributes.knower === input.perspective &&
            (input.time === undefined ||
              (e.time?.start !== undefined && e.time.start <= input.time)),
      )
      const known = new Set(evidence.map((e) => String(e.attributes.assertion)))
      const records = new Set(evidence.map((e) => e.id))
      allowed = valid.filter(
        (e) => known.has(e.id) || e.id === input.perspective || records.has(e.id),
      )
      gaps.push('受限视角：未明确获知的信息已排除；空结果不表示世界中不存在该事实。')
    }
    const focus = new Set(input.focus)
    const seeds = new Set(input.focus)
    for (const r of world.relations)
      if (seeds.has(r.from) || seeds.has(r.to)) {
        focus.add(r.from)
        focus.add(r.to)
      }
    allowed.sort(
      (a, b) =>
        Number(b.kind === 'rule') - Number(a.kind === 'rule') ||
        Number(focus.has(b.id)) - Number(focus.has(a.id)),
    )
    if (input.text)
      allowed = allowed.filter(
        (e) =>
          e.kind === 'rule' || focus.has(e.id) || `${e.name} ${e.summary}`.includes(input.text),
      )
    if (world.entities.some((e) => e.stale)) gaps.push('存在来源失效的记录，已从上下文排除。')
    const pack: ContextPack = {
      projectId: world.project.id,
      revision: world.project.revision,
      perspective: input.perspective,
      focus: input.focus,
      time: input.time,
      narrativeOrder: input.narrativeOrder,
      entities: [],
      relations: [],
      excerpts: [],
      gaps,
      truncated: false,
    }
    // Reserve envelope and truncation diagnostics, and count every serialized payload component.
    const budget = this.limits.contextChars - 180
    let size = stringify(pack).length
    if (size > budget)
      throw new MythorError('context-budget', '焦点和请求元数据已超过上下文预算，请减少焦点对象')
    for (const e of allowed) {
      const chars = stringify(e).length + 1
      if (size + chars > budget) {
        pack.truncated = true
        continue
      }
      pack.entities.push(e)
      size += chars
    }
    const ids = new Set(pack.entities.map((e) => e.id))
    for (const r of world.relations)
      if (
        ids.has(r.from) &&
        ids.has(r.to) &&
        (input.time === undefined ||
          ((r.time?.start ?? -Infinity) <= input.time && (r.time?.end ?? Infinity) >= input.time))
      ) {
        const chars = stringify(r).length + 1
        if (size + chars > budget) {
          pack.truncated = true
          continue
        }
        pack.relations.push(r)
        size += chars
      }
    if (input.perspective === 'author')
      for (const d of world.documents
        .filter((d) => !input.focus.length || focus.has(d.entityId ?? ''))
        .slice(-3)) {
        const excerpt = { documentId: d.id, revisionId: d.revisionId, text: d.text }
        while (stringify(excerpt).length + size + 1 > budget && excerpt.text.length)
          excerpt.text = excerpt.text.slice(0, Math.max(0, Math.floor(excerpt.text.length * 0.8)))
        if (excerpt.text.length < d.text.length) pack.truncated = true
        const chars = stringify(excerpt).length + 1
        if (excerpt.text && size + chars <= budget) {
          pack.excerpts.push(excerpt)
          size += chars
        }
      }
    if (pack.truncated)
      pack.gaps.push('上下文预算不足，部分对象、规则、关系或正文被截断；请缩小焦点继续检索。')
    return pack
  }
  private graph(db: DatabaseSync, p: Record<string, Json>): Json {
    const input = z
      .object({
        focus: Id.optional(),
        depth: z.number().int().min(0).max(4).default(1),
        kinds: z.array(z.string()).default([]),
        time: z.number().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(this.limits.maxGraphNodes)
          .default(this.limits.maxGraphNodes),
      })
      .parse(p)
    const world = this.snapshot(db)
    let relations = world.relations.filter(
      (r) => !input.kinds.length || input.kinds.includes(r.kind),
    )
    if (input.time !== undefined)
      relations = relations.filter(
        (r) =>
          (r.time?.start ?? -Infinity) <= input.time! && (r.time?.end ?? Infinity) >= input.time!,
      )
    let ids = new Set<string>()
    if (input.focus) {
      ids.add(input.focus)
      for (let depth = 0; depth < input.depth; depth++) {
        const previous = new Set(ids)
        for (const r of relations)
          if (previous.has(r.from) || previous.has(r.to)) {
            ids.add(r.from)
            ids.add(r.to)
          }
      }
    } else ids = new Set(world.entities.map((e) => e.id))
    const all = world.entities.filter(
      (e) =>
        ids.has(e.id) &&
        (input.time === undefined ||
          ((e.time?.start ?? -Infinity) <= input.time && (e.time?.end ?? Infinity) >= input.time)),
    )
    const nodes = all.slice(0, input.limit)
    ids = new Set(nodes.map((e) => e.id))
    const edges = relations.filter((r) => ids.has(r.from) && ids.has(r.to))
    return safeJson({
      nodes,
      edges,
      total: all.length,
      truncated: all.length > nodes.length,
      visits: movement(
        nodes,
        edges,
        nodes.find((e) => e.id === input.focus)?.kind === 'character' ? input.focus : undefined,
      ),
      ...crossings(nodes, edges),
    })
  }
  private backup(db: DatabaseSync): Json {
    db.exec('BEGIN')
    try {
      const data = {
        format: 'mythor',
        version: 1,
        project: this.project(db),
        tables: Object.fromEntries(TABLES.map((t) => [t, this.all(db, t)])),
      }
      const json = stringify(data)
      return {
        name: `${this.project(db).name}.mythor.json`,
        text: json,
        sha256: createHash('sha256').update(json).digest('hex'),
      }
    } finally {
      db.exec('COMMIT')
    }
  }
  private restore(p: Record<string, Json>): Json {
    const input = z.object({ text: z.string().max(100_000_000) }).parse(p)
    const data = z
      .object({
        format: z.literal('mythor'),
        version: z.literal(1),
        project: z.object({
          name: z.string().min(1).max(200),
          revision: z.number().int().nonnegative(),
          createdAt: z.string(),
        }),
        tables: z
          .object({
            entities: z.array(EntitySchema),
            relations: z.array(RelationSchema),
            documents: z.array(DocumentSchema),
            revisions: z.array(DocumentSchema),
            changes: z.array(ChangeSetSchema),
            commits: z.array(CommitSchema),
            tasks: z.array(WorkflowSchema),
            grants: z.array(z.json()),
          })
          .strict(),
      })
      .parse(JSON.parse(input.text))
    for (const table of TABLES.filter((t) => t !== 'grants')) {
      const records = data.tables[table]
      const keys = records.map((r) => (table === 'revisions' ? (r as Document).revisionId : r.id))
      if (new Set(keys).size !== keys.length)
        throw new MythorError('invalid-backup', `备份 ${table} 存在重复 ID`)
    }
    const { entities, documents, relations } = data.tables
    const findings = validate({ entities, documents, relations }, data.tables.revisions)
    if (findings.some((f) => f.severity === 'error'))
      throw new MythorError('invalid-backup', '备份包含无效引用', safeJson(findings))
    const project: Project = {
      ...data.project,
      id: uid(),
      name: `${data.project.name}（恢复）`,
      archived: false,
    }
    this.catalog.prepare('INSERT INTO projects VALUES(?,?)').run(project.id, stringify(project))
    const db = this.db(project.id)
    db.exec('BEGIN IMMEDIATE')
    try {
      this.setProject(db, project)
      for (const table of TABLES.filter((t) => t !== 'grants'))
        for (const record of data.tables[table]) {
          const value = {
            ...record,
            ...(Object.hasOwn(record, 'projectId') ? { projectId: project.id } : {}),
            ...(table === 'tasks'
              ? {
                  sessionId: undefined,
                  status: ['completed', 'cancelled'].includes((record as WorkflowRun).status)
                    ? (record as WorkflowRun).status
                    : 'pending',
                }
              : {}),
          }
          this.put(
            db,
            table,
            table === 'revisions' ? (record as Document).revisionId : record.id,
            value,
          )
        }
      this.reindex(db)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      this.catalog.prepare('DELETE FROM projects WHERE id=?').run(project.id)
      throw error
    }
    return safeJson(project)
  }
}

export function tokenize(text: string): string {
  const tokens = new Set<string>()
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0]
    tokens.add(word)
    if (/[\p{Script=Han}]/u.test(word)) {
      const chars = [...word]
      for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1])
    }
  }
  return [...tokens].join(' ')
}
