import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { CritiqueSchema } from '../shared/contracts.ts'
import {
  ChangeSetSchema,
  CreativeRecordSchema,
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
  type Finding,
  type Json,
  type Limits,
  type Operation,
  type NovelState,
  type Relation,
  type Request,
  type Snapshot,
  type WorkflowRun,
} from '../shared/contracts.ts'
import { MythorError, requireValue } from '../domain/errors.ts'
import { applyOperations, impacted, validate } from '../domain/validation.ts'
import { advance } from '../domain/workflows.ts'
import { movement, crossings } from '../domain/projections.ts'
import { changeHash, continuity, acceptanceRisks } from '../domain/continuity.ts'
import { splitMaterial } from '../domain/materials.ts'
import { MaterialSchema } from '../shared/creative.ts'

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
  private readonly database: DatabaseSync
  readonly limits: Limits
  constructor(
    readonly root: string,
    limits: Partial<Limits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    mkdirSync(root, { recursive: true })
    this.database = new DatabaseSync(join(root, 'novel.sqlite'))
    const version = Number(this.database.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 3) {
      this.database.close()
      throw new MythorError('future-schema', '数据库来自更新版本，拒绝写入')
    }
    if (version === 2 && !existsSync(join(root, 'novel.v2-backup.sqlite')))
      this.database.prepare('VACUUM INTO ?').run(join(root, 'novel.v2-backup.sqlite'))
    this.database.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    )
    for (const table of TABLES)
      this.database.exec(
        `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      )
    this.database.exec(
      'CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, kind UNINDEXED, tokens);',
    )
    if (version === 2) {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        for (const task of this.all<WorkflowRun>(this.database, 'tasks'))
          this.put(this.database, 'tasks', task.id, { ...task, needsRevalidation: true })
        this.database.exec('PRAGMA user_version=3; COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
    } else this.database.exec('PRAGMA user_version=3')
    for (const task of this.all<WorkflowRun>(this.database, 'tasks'))
      if (task.status === 'running')
        this.put(this.database, 'tasks', task.id, {
          ...task,
          status: 'pending',
          error: '运行中断，可从已保存阶段恢复',
        })
  }
  close() {
    this.database.close()
  }
  private db(): DatabaseSync {
    return this.database
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
  private novel(db: DatabaseSync): NovelState {
    // Novel ownership is always resolved by the Host before entering this store.
    return decode<NovelState>(
      requireValue(
        db.prepare("SELECT data FROM meta WHERE id='novel'").get(),
        'novel-not-enabled',
        '当前 Harness 项目尚未启用 Mythor',
      ),
    )
  }
  private setNovel(db: DatabaseSync, novel: NovelState) {
    db.prepare(
      "INSERT INTO meta(id,data) VALUES('novel',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(stringify(novel))
  }
  private meta(db: DatabaseSync, id: string): Record<string, Json> | undefined {
    const row = db.prepare('SELECT data FROM meta WHERE id=?').get(id)
    return row ? decode<Record<string, Json>>(row) : undefined
  }
  private materials(db: DatabaseSync): Record<string, Json>[] {
    const row = db.prepare("SELECT data FROM meta WHERE id='materials'").get()
    return row ? z.array(MaterialSchema).parse(decode(row)) : []
  }
  private snapshot(db: DatabaseSync): Snapshot {
    return {
      creativeRecords: db
        .prepare("SELECT data FROM meta WHERE id LIKE 'creative:%'")
        .all()
        .map((row) => CreativeRecordSchema.parse(decode(row))),
      novel: this.novel(db),
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
    if (
      ['scene.evidence', 'decision.record', 'material.advance'].includes(req.action) &&
      actor.kind !== 'policy'
    )
      throw new MythorError('host-only', '接纳证据只能由宿主服务写入')
    if (actor.kind === 'agent') {
      if (
        [
          'novel.enable',
          'novel.update',
          'grant',
          'restore',
          'history.undo',
          'task.finish',
          'task.fail',
        ].includes(req.action)
      )
        throw new MythorError('author-only', '该操作只能由作者发起')
    }
    const db = this.db()
    if (req.action === 'novel.status') {
      const row = db.prepare("SELECT data FROM meta WHERE id='novel'").get()
      return safeJson({ enabled: Boolean(row), ...(row ? { novel: decode<NovelState>(row) } : {}) })
    }
    if (req.action === 'novel.enable') {
      const existing = db.prepare("SELECT data FROM meta WHERE id='novel'").get()
      if (existing) return safeJson(decode<NovelState>(existing))
      const title = z.string().trim().min(1).max(200).parse(p.title)
      const novel: NovelState = {
        id: uid(),
        title,
        revision: 0,
        status: 'active',
        createdAt: now(),
        seed: {
          worldRule: '',
          protagonist: '',
          desire: '',
          obstacle: '',
          stakes: '',
          centralQuestion: '',
          notes: '',
        },
      }
      this.setNovel(db, novel)
      return safeJson(novel)
    }
    if (req.action === 'restore') return this.restore(p)
    const novel = this.novel(db)
    if (
      novel.status === 'paused' &&
      ![
        'snapshot',
        'workspace.progress',
        'session.state',
        'session.save',
        'query',
        'history',
        'export',
        'backup',
        'novel.update',
      ].includes(req.action)
    )
      throw new MythorError('novel-paused', '小说创作已暂停，请先恢复')
    switch (req.action) {
      case 'workspace.progress': {
        db.exec('BEGIN')
        try {
          const snapshot = this.snapshot(db)
          const result = safeJson({
            snapshot,
            history: this.all<Commit>(db, 'commits'),
            decisions: snapshot.changes
              .filter((c) => c.status === 'pending')
              .flatMap((c) => {
                const receipt = this.meta(db, `coordination:${c.id}`)
                const report =
                  receipt?.hash === changeHash(c)
                    ? (receipt.report as Record<string, Json> | undefined)
                    : undefined
                return [
                  ...(Array.isArray(report?.majorDecisions) ? report.majorDecisions : []),
                  ...(Array.isArray(report?.uncertainties) ? report.uncertainties : []),
                ].map((text) => ({ id: c.id, text: String(text), baseRevision: c.baseRevision }))
              }),
          })
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      case 'task.list':
        return safeJson(this.all<WorkflowRun>(db, 'tasks'))
      case 'task.read':
        return safeJson(this.get<WorkflowRun>(db, 'tasks', Body.parse(p).id))
      case 'session.state':
        return safeJson(this.meta(db, `session:${Id.parse(p.id)}`) ?? {})
      case 'session.save': {
        if (actor.kind !== 'author') throw new MythorError('author-only', '界面草稿只能由作者保存')
        const key = `session:${Id.parse(p.id)}`
        const value = { ...this.meta(db, key), ...z.record(z.string(), z.json()).parse(p.value) }
        db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, stringify(value))
        return value
      }
      case 'scene.evidence': {
        const change = this.get<ChangeSet>(db, 'changes', Body.parse(p).id)
        if (actor.kind !== 'policy' || changeHash(change) !== actor.changeHash)
          throw new MythorError('evidence-conflict', '候选已经改变')
        db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
          `coordination:${change.id}`,
          stringify({ hash: actor.changeHash, report: p.report, reason: actor.reason }),
        )
        return true
      }
      case 'decision.record': {
        db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
          `decision:${Id.parse(p.id)}`,
          stringify(p),
        )
        return true
      }
      case 'material.list':
        return safeJson(
          this.materials(db).map((m) => ({
            id: m.id,
            title: m.title,
            kind: m.kind,
            nextBatch: m.nextBatch,
            batchCount: (m.batches as Json[]).length,
            taskId: m.taskId ?? null,
            pendingChangeId: m.pendingChangeId ?? null,
            initialChangeId: m.initialChangeId ?? null,
          })),
        )
      case 'material.read':
        return safeJson(requireValue(this.materials(db).find((m) => m.id === Id.parse(p.id))))
      case 'material.advance': {
        const materials = this.materials(db),
          index = materials.findIndex((m) => m.id === p.id)
        if (index < 0) throw new MythorError('not-found', '材料不存在')
        const previous = Number(materials[index].nextBatch)
        const next = z
          .number()
          .int()
          .min(previous)
          .max(previous + 1)
          .parse(p.nextBatch)
        if (next > (materials[index].batches as Json[]).length)
          throw new MythorError('material-checkpoint', '批次超出材料范围')
        if (next > previous && p.changeId) {
          const accepted = this.get<ChangeSet>(db, 'changes', Id.parse(p.changeId))
          if (
            accepted.status !== 'committed' ||
            actor.kind !== 'policy' ||
            changeHash(accepted) !== actor.changeHash
          )
            throw new MythorError('material-checkpoint', '批次尚未正式接纳')
        }
        materials[index] = {
          ...materials[index],
          nextBatch: p.nextBatch,
          changeId: p.changeId,
          pendingChangeId: p.pendingChangeId ?? null,
        }
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
            'materials',
            stringify(materials),
          )
          if (
            Array.isArray(materials[index].batches) &&
            Number(p.nextBatch) >= (materials[index].batches as Json[]).length
          ) {
            const taskId = materials[index].taskId
            if (typeof taskId === 'string') {
              const task = this.maybe<WorkflowRun>(db, 'tasks', taskId)
              if (task && task.status !== 'cancelled')
                this.put(db, 'tasks', task.id, {
                  ...task,
                  stage: 'commit',
                  status: 'completed',
                  artifacts: {
                    ...task.artifacts,
                    extract: {
                      documentRevisionIds: [materials[index].originalRevisionId],
                      changes: ['材料各批已提取并处理'],
                      unchanged: [],
                      uncertainties: [],
                    },
                  },
                })
            }
            for (const id of materials[index].documentIds as string[]) {
              const doc = this.maybe<Document>(db, 'documents', id)
              if (doc)
                db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
                  `document-state:${id}`,
                  stringify({ revisionId: doc.revisionId, coordinated: true }),
                )
            }
          }
          db.exec('COMMIT')
          return safeJson(materials[index])
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      case 'novel.update': {
        const update = z
          .object({
            title: z.string().trim().min(1).max(200).optional(),
            status: z.enum(['active', 'paused']).optional(),
          })
          .parse(p)
        this.setNovel(db, { ...novel, ...update })
        return safeJson(this.novel(db))
      }
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
        return safeJson({ revision: novel.revision, findings })
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
            throw new MythorError('author-only', '任务会话只能由作者重新指定')
          next.sessionId = Id.parse(p.sessionId)
          if (next.sessionId !== task.sessionId)
            db.prepare('DELETE FROM grants WHERE id=?').run(task.id)
        }
        if (!cancel && task.baseRevision !== novel.revision) {
          next.baseRevision = novel.revision
          next.stage = 'read'
          next.needsRevalidation = true
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
          name: `${novel.title}.md`,
          text: this.all<Document>(db, 'documents')
            .filter(
              (d) => d.materialId !== d.id && (!d.materialKind || d.materialKind === 'manuscript'),
            )
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
    const novel = this.novel(db)
    if (input.baseRevision !== novel.revision)
      throw new MythorError('revision-conflict', '项目已更新，请重新读取', {
        currentRevision: novel.revision,
      })
    if (input.taskId) {
      const task = this.ownedTask(db, input.taskId, actor)
      if (['cancelled', 'completed'].includes(task.status))
        throw new MythorError('task-closed', '任务已结束')
    }
    const touched = new Set<string>()
    for (const op of input.operations) {
      const key =
        op.type === 'seed.put'
          ? 'seed'
          : `${op.type.split('.')[0]}:${'value' in op ? op.value.id : op.id}`
      if (touched.has(key))
        throw new MythorError('duplicate-operation', '一个变更集中同一对象只能修改一次')
      touched.add(key)
    }
    const change: ChangeSet = {
      ...input,
      id: uid(),
      novelId: novel.id,
      status: 'pending',
      createdAt: now(),
    }
    this.put(db, 'changes', change.id, change)
    return change
  }
  private check(db: DatabaseSync, change: ChangeSet) {
    const snapshot = this.snapshot(db)
    const next = applyOperations(snapshot, change.operations)
    for (const op of change.operations)
      if (
        op.type === 'document.put' &&
        this.materials(db).some((m) => m.id === op.value.id) &&
        snapshot.documents.some(
          (d) =>
            d.id === op.value.id &&
            (d.text !== op.value.text || d.revisionId !== op.value.revisionId),
        )
      )
        throw new MythorError('material-immutable', '原始材料不可覆盖，请作为新来源迁入')
    const findings = validate(next, [...this.all<Document>(db, 'revisions'), ...next.documents])
    findings.push(...continuity(snapshot, change.operations))
    const evidence = this.meta(db, `coordination:${change.id}`)
    if (evidence?.reason !== 'verified-author-idea')
      for (const message of acceptanceRisks(snapshot, change.operations))
        findings.push({
          code: 'host-decision',
          severity: 'warning',
          message,
          entityIds: [],
          sources: [],
        })
    if (
      evidence?.hash === changeHash(change) &&
      evidence.report &&
      typeof evidence.report === 'object' &&
      !Array.isArray(evidence.report)
    ) {
      const report = evidence.report as Record<string, Json>
      if (Array.isArray(report.findings))
        findings.push(...(report.findings as unknown as Finding[]))
      for (const message of [
        ...(Array.isArray(report.majorDecisions) ? report.majorDecisions : []),
        ...(Array.isArray(report.uncertainties) ? report.uncertainties : []),
      ])
        findings.push({
          code: 'creative-decision',
          severity: 'unknown',
          message: String(message),
          entityIds: [],
          sources: [],
        })
      if (report.proseConsistent === false || report.extractionComplete === false)
        findings.push({
          code: 'scene-inconsistent',
          severity: 'error',
          message: '正文一致性或提取完整性未通过，需先修正',
          entityIds: [],
          sources: [],
        })
    }
    if (
      change.operations.some(
        (o) =>
          o.type === 'document.put' &&
          !this.materials(db).some(
            (m) =>
              m.id === o.value.materialId &&
              Array.isArray(m.documentIds) &&
              m.documentIds.includes(o.value.id),
          ),
      ) &&
      evidence?.hash !== changeHash(change)
    )
      findings.push({
        code: 'coordination-required',
        severity: 'warning',
        message: '正文尚未提取和检查；接纳后必须协调才能继续写作',
        entityIds: [],
        sources: [],
      })
    if (change.taskId)
      findings.push(...(this.get<WorkflowRun>(db, 'tasks', change.taskId).critique ?? []))
    if (change.baseRevision !== snapshot.novel.revision)
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
      revision: snapshot.novel.revision,
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
      if (
        change.operations.some((op) => op.type.startsWith('creative.')) &&
        actor.kind !== 'policy' &&
        !(
          actor.kind === 'author' &&
          this.meta(db, `creative-undo:${change.id}`)?.hash === changeHash(change)
        )
      )
        throw new MythorError('host-only', '创作来源记录只能由宿主核验后接纳')
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
        if (
          change.operations.some(
            (op) =>
              op.type.startsWith('document.') ||
              op.type.startsWith('relation.') ||
              (op.type === 'entity.put' && op.value.informationStatus === 'fact'),
          ) &&
          this.meta(db, `coordination:${change.id}`)?.hash !== changeHash(change)
        )
          throw new MythorError(
            'coordination-required',
            '正式事实和正文需要宿主创作协调；任务授权不能替代提取与检查',
          )
        if (!task || task.stage !== 'review' || !task.artifacts.validate)
          throw new MythorError('review-required', '模型提交需要已完成校验的任务')
        const grant = this.maybe<{ entityIds: string[]; expiresAt: string }>(db, 'grants', task.id)
        const targets = change.operations.flatMap((op) =>
          op.type === 'relation.put'
            ? [op.value.from, op.value.to]
            : op.type === 'document.put'
              ? [op.value.entityId ?? op.value.id]
              : op.type === 'seed.put'
                ? []
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
      const novel = this.novel(db)
      const revision = novel.revision + 1
      if (
        actor.kind === 'policy' &&
        (actor.changeHash !== changeHash(change) ||
          this.meta(db, `coordination:${change.id}`)?.hash !== actor.changeHash)
      )
        throw new MythorError('policy-required', '缺少宿主协调检查证据')
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
        } else if (op.type === 'document.put' || op.type === 'document.delete') {
          const id = 'value' in op ? op.value.id : op.id
          const old = this.maybe<Document>(db, 'documents', id)
          inverse.unshift(
            old ? { type: 'document.put', value: old } : { type: 'document.delete', id },
          )
          if (op.type === 'document.put') {
            this.put(db, 'documents', id, op.value)
            this.put(db, 'revisions', op.value.revisionId, op.value)
            const receipt = this.meta(db, `coordination:${change.id}`)
            db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
              `document-state:${id}`,
              stringify({
                revisionId: op.value.revisionId,
                coordinated:
                  receipt?.hash === changeHash(change) && receipt.reason !== 'raw-material',
              }),
            )
          } else db.prepare('DELETE FROM documents WHERE id=?').run(id)
          if (old) changedDocuments.add(id)
        } else if (op.type === 'creative.put' || op.type === 'creative.delete') {
          const id = 'value' in op ? op.value.id : op.id
          const old = this.meta(db, `creative:${id}`)
          inverse.unshift(
            old
              ? { type: 'creative.put', value: CreativeRecordSchema.parse(old) }
              : { type: 'creative.delete', id },
          )
          if (op.type === 'creative.put')
            db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
              `creative:${id}`,
              stringify(op.value),
            )
          else if (old)
            db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
              `creative:${id}`,
              stringify({ ...old, status: 'superseded' }),
            )
        } else {
          inverse.unshift({ type: 'seed.put', value: novel.seed })
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
              changedDocuments.has(s.documentId) &&
              currentDocs.get(s.documentId) !== s.revisionId &&
              !entity.sources.some(
                (fresh) =>
                  fresh.documentId === s.documentId &&
                  fresh.revisionId === currentDocs.get(s.documentId),
              ),
          )
        ) {
          if (
            !change.operations.some((op) => op.type === 'entity.put' && op.value.id === entity.id)
          )
            inverse.unshift({ type: 'entity.put', value: entity })
          this.put(db, 'entities', entity.id, { ...entity, stale: true, revision })
          staleIds.add(entity.id)
        }
      for (const relation of this.all<Relation>(db, 'relations'))
        if (
          relation.sources.some(
            (s) =>
              changedDocuments.has(s.documentId) &&
              currentDocs.get(s.documentId) !== s.revisionId &&
              !relation.sources.some(
                (fresh) =>
                  fresh.documentId === s.documentId &&
                  fresh.revisionId === currentDocs.get(s.documentId),
              ),
          )
        ) {
          inverse.unshift({ type: 'relation.put', value: relation })
          this.put(db, 'relations', relation.id, { ...relation, stale: true, revision })
          staleIds.add(relation.from)
          staleIds.add(relation.to)
        }
      const commit: Commit = {
        id: uid(),
        revision,
        changeSetId: change.id,
        summary: change.summary,
        operations: change.operations,
        inverse,
        actor:
          actor.kind === 'author'
            ? 'author'
            : actor.kind === 'policy'
              ? `policy:${actor.reason}`
              : `agent:${actor.sessionId}`,
        createdAt: now(),
      }
      this.put(db, 'commits', commit.id, commit)
      this.put(db, 'changes', change.id, { ...change, status: 'committed', revision })
      const seed = change.operations.find((op) => op.type === 'seed.put')
      this.setNovel(db, {
        ...novel,
        revision,
        ...(seed?.type === 'seed.put' ? { seed: seed.value } : {}),
      })
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
      if (actor.kind === 'policy' && actor.reason === 'verified-author-idea') {
        const proof = this.meta(db, `coordination:${change.id}`)
        const report = proof?.report as Record<string, Json> | undefined
        if (typeof report?.sessionId === 'string' && Array.isArray(report.evidence)) {
          const key = `session:${report.sessionId}`
          const previous = this.meta(db, key) ?? {}
          const seqs = report.evidence.flatMap((ref) =>
            typeof ref === 'object' && ref && !Array.isArray(ref) && typeof ref.seq === 'number'
              ? [ref.seq]
              : [],
          )
          db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
            key,
            stringify({
              ...previous,
              intakeSeqs: [
                ...new Set([
                  ...(Array.isArray(previous.intakeSeqs) ? previous.intakeSeqs : []),
                  ...seqs,
                ]),
              ],
            }),
          )
        }
      }
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
      ops.map((op) =>
        op.type === 'seed.put'
          ? 'seed'
          : `${op.type.split('.')[0]}:${'value' in op ? op.value.id : op.id}`,
      )
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
    const compensation = this.propose(
      db,
      {
        baseRevision: this.novel(db).revision,
        summary: `撤销：${commit.summary}`,
        operations: safeJson(operations),
      },
      { kind: 'author' },
    )
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
      `creative-undo:${compensation.id}`,
      stringify({ hash: changeHash(compensation) }),
    )
    return compensation
  }
  private startTask(db: DatabaseSync, p: Record<string, Json>, actor: Actor): WorkflowRun {
    const input = z
      .object({
        kind: z.enum(['plan', 'write', 'revise', 'check', 'import']),
        intent: z.string().min(1),
        focus: z.array(Id).default([]),
        sessionId: Id.optional(),
        planId: Id.optional(),
      })
      .parse(p)
    const task: WorkflowRun = {
      ...input,
      id: uid(),
      novelId: this.novel(db).id,
      baseRevision: this.novel(db).revision,
      sessionId: actor.kind === 'agent' ? actor.sessionId : input.sessionId,
      stage: 'read',
      status: 'pending',
      artifacts: {},
      contractVersion: 3,
    }
    this.put(db, 'tasks', task.id, task)
    return task
  }
  private importText(db: DatabaseSync, p: Record<string, Json>, actor: Actor) {
    const input = z
      .object({
        title: z.string().min(1),
        text: z.string().min(1).max(this.limits.maxImportChars),
        materialKind: z
          .enum(['manuscript', 'outline', 'characters', 'world', 'notes'])
          .default('manuscript'),
        preview: z.boolean().default(false),
      })
      .parse(p)
    const normalized = input.text.replace(/^\uFEFF/, '')
    const materialId = uid()
    const parts =
      input.materialKind === 'manuscript'
        ? normalized
            .split(/(?=^#{1,3} .+$|^第[一二三四五六七八九十百千\d]+[章节卷].*$)/m)
            .filter((v) => v.trim())
        : [normalized]
    const documents = parts.map((part, index) => {
      const lines = part.trim().split('\n')
      const title =
        input.materialKind === 'manuscript' && /^(#{1,3} |第)/.test(lines[0])
          ? lines.shift()!.replace(/^#+\s*/, '')
          : input.materialKind === 'manuscript'
            ? `${input.title} ${index + 1}`
            : input.title
      return {
        id: uid(),
        revisionId: uid(),
        title,
        text: lines.join('\n').trim(),
        materialKind: input.materialKind,
        materialId,
      }
    })
    if (input.preview)
      return { chapters: documents.map((d) => ({ title: d.title, chars: d.text.length })) }
    db.exec('BEGIN IMMEDIATE')
    try {
      const batches = splitMaterial(input.text)
      const original: Document = {
        id: materialId,
        revisionId: uid(),
        title: `${input.title}（原始材料）`,
        text: input.text,
        materialKind: input.materialKind,
        materialId,
      }
      db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
        'materials',
        stringify([
          ...this.materials(db),
          {
            id: materialId,
            title: input.title,
            kind: input.materialKind,
            original: input.text,
            originalRevisionId: original.revisionId,
            documentIds: [materialId, ...documents.map((d) => d.id)],
            batches,
            nextBatch: 0,
          },
        ]),
      )
      const task = this.startTask(
        db,
        {
          kind: 'import',
          intent: `提取《${input.title}》的世界、人物与事件；材料 ${materialId}`,
          focus: [],
        },
        actor,
      )
      const operations: Operation[] = [{ type: 'document.put', value: original }]
      documents.forEach((doc, index) => {
        if (input.materialKind !== 'manuscript') {
          operations.push({ type: 'document.put', value: doc })
          return
        }
        const entity = EntitySchema.parse({
          id: uid(),
          kind: 'chapter',
          name: doc.title,
          narrativeOrder: index,
        })
        operations.push(
          { type: 'entity.put', value: entity },
          { type: 'document.put', value: { ...doc, entityId: entity.id } },
        )
      })
      const change = this.propose(
        db,
        {
          baseRevision: this.novel(db).revision,
          summary:
            input.materialKind === 'manuscript'
              ? `接纳 ${documents.length} 个正文片段：${input.title}`
              : `接纳原始创作材料：${input.title}`,
          operations: safeJson(operations),
        },
        actor,
      )
      const materialRecords = this.materials(db)
      const materialIndex = materialRecords.findIndex((m) => m.id === materialId)
      materialRecords[materialIndex] = {
        ...materialRecords[materialIndex],
        taskId: task.id,
        initialChangeId: change.id,
      }
      db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(
        'materials',
        stringify(materialRecords),
      )
      db.exec('COMMIT')
      return {
        change,
        task,
        materialId,
        chapters: input.materialKind === 'manuscript' ? documents.length : 0,
        materials: documents.length,
        materialKind: input.materialKind,
        note: '原文先经作者接受；世界事实需要独立提取与审阅。',
      }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
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
      const known = new Set(
        evidence
          .filter(
            (e) =>
              input.perspective === 'reader' ||
              ['known', 'knows', '已知', '知道'].includes(String(e.attributes.mode)),
          )
          .map((e) => String(e.attributes.assertion)),
      )
      const records = new Set(evidence.map((e) => e.id))
      allowed = valid.filter(
        (e) => known.has(e.id) || e.id === input.perspective || records.has(e.id),
      )
      gaps.push('受限视角：未明确获知的信息已排除；空结果不表示世界中不存在该事实。')
    }
    const focus = new Set(input.focus)
    const seeds = new Set(input.focus)
    for (const e of world.entities)
      if (
        e.kind === 'knowledge' &&
        typeof e.attributes.knower === 'string' &&
        seeds.has(e.attributes.knower)
      ) {
        focus.add(e.id)
        if (typeof e.attributes.assertion === 'string') focus.add(e.attributes.assertion)
      }
    for (const r of world.relations)
      if (seeds.has(r.from) || seeds.has(r.to)) {
        focus.add(r.from)
        focus.add(r.to)
      }
    for (let changed = true; changed; ) {
      changed = false
      for (const e of world.entities.filter((e) => focus.has(e.id) && e.kind === 'plan')) {
        const parent = e.attributes.parentId
        if (typeof parent === 'string' && !focus.has(parent)) {
          focus.add(parent)
          changed = true
        }
      }
    }
    const priority = (e: Entity) =>
      e.kind === 'rule'
        ? 10
        : focus.has(e.id)
          ? 9
          : e.kind === 'plan' && e.attributes.status === 'active'
            ? 8
            : e.kind === 'foreshadow' && !e.attributes.resolved
              ? 7
              : e.kind === 'event'
                ? 6
                : ['knowledge', 'storyline', 'arc'].includes(e.kind)
                  ? 5
                  : 1
    const insertion = new Map(world.entities.map((e, i) => [e.id, i]))
    allowed.sort((a, b) => priority(b) - priority(a) || insertion.get(b.id)! - insertion.get(a.id)!)
    if (input.text)
      allowed = allowed.filter(
        (e) =>
          e.kind === 'rule' || focus.has(e.id) || `${e.name} ${e.summary}`.includes(input.text),
      )
    if (world.entities.some((e) => e.stale)) gaps.push('存在来源失效的记录，已从上下文排除。')
    const pack: ContextPack = {
      novelId: world.novel.id,
      revision: world.novel.revision,
      seed:
        input.perspective === 'author'
          ? world.novel.seed
          : {
              worldRule: '',
              protagonist: '',
              desire: '',
              obstacle: '',
              stakes: '',
              centralQuestion: '',
              notes: '',
            },
      perspective: input.perspective,
      focus: input.focus,
      time: input.time,
      narrativeOrder: input.narrativeOrder,
      entities: [],
      relations: [],
      excerpts: [],
      gaps,
      pending: {
        changes: world.changes
          .filter((change) => change.status === 'pending')
          .map((change) => `${change.id}:${change.summary}`),
        tasks: world.tasks
          .filter((task) => !['completed', 'cancelled'].includes(task.status))
          .map((task) => `${task.id}:${task.kind}:${task.stage}:${task.intent}`),
      },
      truncated: false,
      coverage: { required: [...focus], missing: [] },
    }
    // Reserve envelope and truncation diagnostics, and count every serialized payload component.
    const budget = this.limits.contextChars - 180
    let size = stringify(pack).length
    if (size > budget)
      throw new MythorError('context-budget', '焦点和请求元数据已超过上下文预算，请减少焦点对象')
    const excerptReserve = Math.min(6000, Math.floor(budget * 0.3))
    for (const e of allowed) {
      const chars = stringify(e).length + 1
      if (size + chars > budget - excerptReserve) {
        pack.truncated = true
        continue
      }
      pack.entities.push(e)
      size += chars
    }
    const ids = new Set(pack.entities.map((e) => e.id))
    const requiredRelations = world.relations.filter(
      (r) =>
        !r.stale &&
        (seeds.has(r.from) || seeds.has(r.to)) &&
        (input.time === undefined ||
          ((r.time?.start ?? -Infinity) <= input.time && (r.time?.end ?? Infinity) >= input.time)),
    )
    for (const r of world.relations.filter((r) => !r.stale))
      if (
        ids.has(r.from) &&
        ids.has(r.to) &&
        (input.time === undefined ||
          ((r.time?.start ?? -Infinity) <= input.time && (r.time?.end ?? Infinity) >= input.time))
      ) {
        const chars = stringify(r).length + 1
        if (size + chars > budget - excerptReserve) {
          pack.truncated = true
          continue
        }
        pack.relations.push(r)
        size += chars
      }
    if (input.perspective === 'author')
      for (const d of world.documents
        .filter(
          (d) => d.id !== d.materialId && (!d.materialKind || d.materialKind === 'manuscript'),
        )
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
    pack.coverage!.missing = [...focus].filter((id) => !ids.has(id))
    if (input.perspective === 'author') {
      const selectedRelations = new Set(pack.relations.map((r) => r.id))
      pack.coverage!.required.push(...requiredRelations.map((r) => r.id))
      pack.coverage!.missing.push(
        ...requiredRelations.filter((r) => !selectedRelations.has(r.id)).map((r) => r.id),
      )
      const recent = valid.filter((e) => e.kind === 'event').slice(-3)
      pack.coverage!.required.push(...recent.map((e) => e.id))
      pack.coverage!.missing.push(...recent.filter((e) => !ids.has(e.id)).map((e) => e.id))
    }
    for (const e of allowed.filter(
      (e) =>
        e.kind === 'rule' ||
        (e.kind === 'plan' && (focus.has(e.id) || e.attributes.status === 'active')) ||
        (e.kind === 'foreshadow' && !e.attributes.resolved && e.attributes.status !== 'resolved'),
    ))
      if (!ids.has(e.id)) pack.coverage!.missing.push(e.id)
    const unsynced = world.documents.filter(
      (d) => this.meta(db, `document-state:${d.id}`)?.coordinated !== true,
    )
    if (unsynced.length) pack.gaps.push(`正文待协调：${unsynced.map((d) => d.id).join(',')}`)
    if (stringify(pack).length > this.limits.contextChars)
      throw new MythorError(
        'context-budget',
        '关键依据与缺口说明超过预算，暂停写作；请按任务拆分查询',
        { missingCount: pack.coverage!.missing.length },
      )
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
        version: 3,
        novel: this.novel(db),
        tables: Object.fromEntries(TABLES.map((t) => [t, this.all(db, t)])),
        creative: db.prepare("SELECT id,data FROM meta WHERE id<>'novel'").all(),
      }
      const json = stringify(data)
      return {
        name: `${this.novel(db).title}.mythor.json`,
        text: json,
        sha256: createHash('sha256').update(json).digest('hex'),
      }
    } finally {
      db.exec('COMMIT')
    }
  }
  private restore(p: Record<string, Json>): Json {
    const input = z.object({ text: z.string().max(100_000_000) }).parse(p)
    const raw = z
      .object({
        format: z.literal('mythor'),
        version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        project: z.record(z.string(), z.json()).optional(),
        novel: z.record(z.string(), z.json()).optional(),
        tables: z.record(z.string(), z.array(z.record(z.string(), z.json()))),
        creative: z.array(z.object({ id: z.string(), data: z.string() }).strict()).default([]),
      })
      .parse(JSON.parse(input.text))
    const sourceNovel = raw.version === 1 ? raw.project : raw.novel
    if (!sourceNovel) throw new MythorError('invalid-backup', '备份缺少小说信息')
    const existing = this.novel(this.db())
    if (existing.revision !== 0 || TABLES.some((table) => this.all(this.db(), table).length > 0))
      throw new MythorError('restore-target-not-empty', '当前 Harness 项目已有小说内容，不能覆盖')
    const novel: NovelState = {
      id: typeof sourceNovel.id === 'string' ? sourceNovel.id : existing.id,
      title: String(sourceNovel.title ?? sourceNovel.name ?? existing.title),
      revision: Number(sourceNovel.revision ?? 0),
      status:
        sourceNovel.status === 'paused' || sourceNovel.archived === true ? 'paused' : 'active',
      createdAt: String(sourceNovel.createdAt ?? existing.createdAt),
      seed: {
        worldRule: '',
        protagonist: '',
        desire: '',
        obstacle: '',
        stakes: '',
        centralQuestion: '',
        notes: '',
        ...(typeof sourceNovel.seed === 'object' && sourceNovel.seed ? sourceNovel.seed : {}),
      },
    }
    const convertOwner = (record: Record<string, Json>) => {
      const { projectId: _projectId, novelId: _novelId, ...value } = record
      return { ...value, novelId: novel.id }
    }
    const data = {
      novel,
      tables: {
        entities: z.array(EntitySchema).parse(raw.tables.entities ?? []),
        relations: z.array(RelationSchema).parse(raw.tables.relations ?? []),
        documents: z.array(DocumentSchema).parse(raw.tables.documents ?? []),
        revisions: z.array(DocumentSchema).parse(raw.tables.revisions ?? []),
        changes: z.array(ChangeSetSchema).parse((raw.tables.changes ?? []).map(convertOwner)),
        commits: z.array(CommitSchema).parse(raw.tables.commits ?? []),
        tasks: z.array(WorkflowSchema).parse((raw.tables.tasks ?? []).map(convertOwner)),
        grants: z.array(z.json()).parse(raw.tables.grants ?? []),
      },
    }
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
    const db = this.db()
    db.exec('BEGIN IMMEDIATE')
    try {
      this.setNovel(db, novel)
      for (const record of raw.creative) {
        if (
          !/^(materials$|session:|document-state:|coordination:|decision:|creative:|creative-undo:)/.test(
            record.id,
          )
        )
          throw new MythorError('invalid-backup', '备份包含未知元数据')
        z.json().parse(JSON.parse(record.data))
        if (record.id === 'materials') z.array(MaterialSchema).parse(JSON.parse(record.data))
        if (record.id.startsWith('creative:')) CreativeRecordSchema.parse(JSON.parse(record.data))
        db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(record.id, record.data)
      }
      for (const table of TABLES.filter((t) => t !== 'grants'))
        for (const record of data.tables[table]) {
          const value = {
            ...record,
            ...(table === 'tasks'
              ? {
                  sessionId: undefined,
                  needsRevalidation: raw.version < 3 || (record as WorkflowRun).needsRevalidation,
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
      throw error
    }
    return safeJson(novel)
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
