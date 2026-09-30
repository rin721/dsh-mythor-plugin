import { z } from 'zod'

export const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
export const KINDS = [
  'character',
  'location',
  'organization',
  'item',
  'setting',
  'event',
  'chapter',
  'scene',
  'storyline',
  'arc',
  'foreshadow',
  'conflict',
  'assertion',
  'knowledge',
  'revelation',
  'rule',
  'plan',
] as const
export const Source = z
  .object({
    documentId: Id,
    revisionId: Id,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict()
export const WorldTime = z
  .object({
    start: z.number().optional(),
    end: z.number().optional(),
    label: z.string().optional(),
  })
  .strict()
export const EntitySchema = z
  .object({
    id: Id,
    kind: z.enum(KINDS),
    name: z.string().min(1).max(300),
    summary: z.string().max(30_000).default(''),
    aliases: z.array(z.string()).max(100).default([]),
    attributes: z.record(z.string(), z.json()).default({}),
    informationStatus: z.enum(['fact', 'plan', 'hypothesis']).default('plan'),
    editorialStatus: z.enum(['draft', 'pending', 'accepted', 'retired']).default('pending'),
    time: WorldTime.optional(),
    narrativeOrder: z.number().optional(),
    sources: z.array(Source).default([]),
    stale: z.boolean().default(false),
    revision: z.number().int().nonnegative().default(0),
  })
  .strict()
export const RelationSchema = z
  .object({
    id: Id,
    from: Id,
    to: Id,
    kind: z.string().min(1).max(80),
    summary: z.string().default(''),
    time: WorldTime.optional(),
    sources: z.array(Source).default([]),
    revision: z.number().int().nonnegative().default(0),
    informationStatus: z.enum(['fact', 'plan', 'hypothesis']).optional(),
    stale: z.boolean().optional(),
  })
  .strict()
export const DocumentSchema = z
  .object({
    id: Id,
    entityId: Id.optional(),
    title: z.string().min(1),
    text: z.string().max(5_000_000),
    revisionId: Id,
    parentRevisionId: Id.optional(),
    materialKind: z.enum(['manuscript', 'outline', 'characters', 'world', 'notes']).optional(),
    materialId: Id.optional(),
  })
  .strict()
export const StorySeedSchema = z
  .object({
    worldRule: z.string().max(30_000).default(''),
    protagonist: z.string().max(30_000).default(''),
    desire: z.string().max(30_000).default(''),
    obstacle: z.string().max(30_000).default(''),
    stakes: z.string().max(30_000).default(''),
    centralQuestion: z.string().max(30_000).default(''),
    notes: z.string().max(100_000).default(''),
  })
  .strict()
export const AuthorMessageRefSchema = z
  .object({
    sessionId: Id,
    seq: z.number().int().nonnegative(),
    quote: z.string().min(1),
  })
  .strict()
export const CreativeRecordSchema = z
  .object({
    id: Id,
    kind: z.enum([
      'expression',
      'preference',
      'interpretation',
      'proposal',
      'hypothesis',
      'question',
      'decision',
    ]),
    text: z.string().min(1),
    status: z.enum(['open', 'resolved', 'superseded']).default('open'),
    sources: z.array(AuthorMessageRefSchema).min(1),
  })
  .strict()
export type CreativeRecord = z.infer<typeof CreativeRecordSchema>
export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('creative.put'), value: CreativeRecordSchema }).strict(),
  z.object({ type: z.literal('creative.delete'), id: Id }).strict(),
  z.object({ type: z.literal('entity.put'), value: EntitySchema }).strict(),
  z.object({ type: z.literal('entity.delete'), id: Id }).strict(),
  z.object({ type: z.literal('relation.put'), value: RelationSchema }).strict(),
  z.object({ type: z.literal('relation.delete'), id: Id }).strict(),
  z.object({ type: z.literal('document.put'), value: DocumentSchema }).strict(),
  z.object({ type: z.literal('document.delete'), id: Id }).strict(),
  z.object({ type: z.literal('seed.put'), value: StorySeedSchema }).strict(),
])
export type Entity = z.infer<typeof EntitySchema>
export type Relation = z.infer<typeof RelationSchema>
export type Document = z.infer<typeof DocumentSchema>
export type Operation = z.infer<typeof OperationSchema>
export type SourceRef = z.infer<typeof Source>
export type StorySeed = z.infer<typeof StorySeedSchema>
export type Json = z.infer<ReturnType<typeof z.json>>
export interface NovelState {
  id: string
  title: string
  revision: number
  status: 'active' | 'paused'
  createdAt: string
  seed: StorySeed
}
export interface Finding {
  code: string
  severity: 'error' | 'warning' | 'unknown'
  message: string
  entityIds: string[]
  sources: SourceRef[]
  suggestion?: string
}
export const CritiqueSchema = z
  .object({
    code: z.string().min(1).max(100),
    severity: z.enum(['warning', 'unknown']),
    message: z.string().min(1).max(3000),
    entityIds: z.array(Id),
    sources: z.array(Source),
    suggestion: z.string().max(3000).optional(),
  })
  .strict()
export interface ChangeSet {
  id: string
  novelId: string
  baseRevision: number
  taskId?: string
  summary: string
  operations: Operation[]
  status: 'pending' | 'committed' | 'rejected'
  createdAt: string
  revision?: number
}
export const STAGES = [
  'read',
  'goals',
  'plan',
  'simulate',
  'write',
  'extract',
  'validate',
  'review',
  'commit',
] as const
export type Stage = (typeof STAGES)[number]
export interface WorkflowRun {
  id: string
  novelId: string
  sessionId?: string
  kind: 'plan' | 'write' | 'revise' | 'check' | 'import'
  intent: string
  focus: string[]
  baseRevision: number
  stage: Stage
  status: 'pending' | 'running' | 'waiting_review' | 'completed' | 'cancelled' | 'failed'
  artifacts: Partial<Record<Stage, Json>>
  contractVersion?: number
  needsRevalidation?: boolean
  planId?: string
  critique?: z.infer<typeof CritiqueSchema>[]
  error?: string
}
export const WorkflowSchema = z
  .object({
    id: Id,
    novelId: Id,
    sessionId: Id.optional(),
    kind: z.enum(['plan', 'write', 'revise', 'check', 'import']),
    intent: z.string(),
    focus: z.array(Id),
    baseRevision: z.number().int().nonnegative(),
    stage: z.enum(STAGES),
    status: z.enum(['pending', 'running', 'waiting_review', 'completed', 'cancelled', 'failed']),
    artifacts: z.partialRecord(z.enum(STAGES), z.json()),
    contractVersion: z.number().int().optional(),
    needsRevalidation: z.boolean().optional(),
    planId: Id.optional(),
    critique: z.array(CritiqueSchema).optional(),
    error: z.string().optional(),
  })
  .strict()
export const ChangeSetSchema = z
  .object({
    id: Id,
    novelId: Id,
    baseRevision: z.number().int().nonnegative(),
    taskId: Id.optional(),
    summary: z.string(),
    operations: z.array(OperationSchema),
    status: z.enum(['pending', 'committed', 'rejected']),
    createdAt: z.string(),
    revision: z.number().int().nonnegative().optional(),
  })
  .strict()
export const CommitSchema = z
  .object({
    id: Id,
    revision: z.number().int().positive(),
    changeSetId: Id,
    summary: z.string(),
    operations: z.array(OperationSchema),
    inverse: z.array(OperationSchema),
    actor: z.string(),
    createdAt: z.string(),
  })
  .strict()
export interface Snapshot {
  creativeRecords?: CreativeRecord[]
  novel: NovelState
  entities: Entity[]
  relations: Relation[]
  documents: Document[]
  changes: ChangeSet[]
  tasks: WorkflowRun[]
}
export interface Commit {
  id: string
  revision: number
  changeSetId: string
  summary: string
  operations: Operation[]
  inverse: Operation[]
  actor: string
  createdAt: string
}
export type Actor =
  | { kind: 'author' }
  | { kind: 'agent'; sessionId: string }
  | { kind: 'policy'; changeHash: string; reason: string }
export const ACTIONS = [
  'workspace.progress',
  'novel.status',
  'novel.enable',
  'novel.update',
  'legacy.list',
  'legacy.migrate',
  'snapshot',
  'query',
  'context',
  'graph',
  'world.validate',
  'document.read',
  'changes.propose',
  'changes.validate',
  'changes.commit',
  'changes.reject',
  'history',
  'history.undo',
  'task.start',
  'task.advance',
  'task.resume',
  'task.cancel',
  'task.finish',
  'task.fail',
  'task.critique',
  'grant',
  'import',
  'export',
  'backup',
  'restore',
  'task.list',
  'task.read',
  'session.state',
  'session.save',
  'material.list',
  'material.read',
  'material.advance',
  'scene.evidence',
  'decision.record',
] as const
export const RequestSchema = z
  .object({
    action: z.enum(ACTIONS),
    payload: z.record(z.string(), z.json()).default({}),
  })
  .strict()
export type Request = z.infer<typeof RequestSchema>
export type ApiResult =
  | { ok: true; value: Json }
  | { ok: false; error: { code: string; message: string; details?: Json } }
export interface ContextPack {
  novelId: string
  revision: number
  seed: StorySeed
  perspective: string
  focus: string[]
  time?: number
  narrativeOrder?: number
  entities: Entity[]
  relations: Relation[]
  excerpts: { documentId: string; revisionId: string; text: string }[]
  gaps: string[]
  pending: { changes: string[]; tasks: string[] }
  truncated: boolean
  coverage?: { required: string[]; missing: string[] }
}
export interface Limits {
  maxImportChars: number
  maxGraphNodes: number
  contextChars: number
}
export const DEFAULT_LIMITS: Limits = {
  maxImportChars: 5_000_000,
  maxGraphNodes: 200,
  contextChars: 24_000,
}
