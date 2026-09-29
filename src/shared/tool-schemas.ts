import { z } from 'zod'
import { Id, OperationSchema, CritiqueSchema } from './contracts.ts'
import { StageArtifacts } from './creative.ts'
const id = z.object({ id: Id }).strict()
export const ToolPayloads = {
  query: z
    .object({
      text: z.string().max(1000).default(''),
      kind: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().nonnegative().default(0),
    })
    .strict(),
  context: z
    .object({
      focus: z.array(Id).max(20).default([]),
      perspective: z.string().default('author'),
      time: z.number().optional(),
      narrativeOrder: z.number().optional(),
      text: z.string().default(''),
    })
    .strict(),
  graph: z
    .object({
      focus: Id.optional(),
      depth: z.number().int().min(0).max(4).default(1),
      kinds: z.array(z.string()).default([]),
      time: z.number().optional(),
      limit: z.number().int().min(1).max(200).default(200),
    })
    .strict(),
  'document.read': z.union([id, z.object({ revisionId: Id }).strict()]),
  'changes.propose': z
    .object({
      baseRevision: z.number().int().nonnegative(),
      summary: z.string().min(1),
      taskId: Id.optional(),
      operations: z.array(OperationSchema).min(1).max(10000),
    })
    .strict(),
  'changes.validate': id,
  'world.validate': z.object({ taskId: Id.optional() }).strict(),
  'changes.commit': z.object({ id: Id, idempotencyKey: Id }).strict(),
  history: z.object({}).strict(),
  'material.list': z.object({}).strict(),
  'task.critique': z.object({ id: Id, findings: z.array(CritiqueSchema) }).strict(),
  'task.start': z
    .object({
      kind: z.enum(['plan', 'write', 'revise', 'check', 'import']),
      intent: z.string().min(1),
      focus: z.array(Id).default([]),
      planId: Id.optional(),
    })
    .strict(),
  'task.advance': z.union(
    Object.entries(StageArtifacts).map(([stage, artifact]) =>
      z.object({ id: Id, stage: z.literal(stage), artifact }).strict(),
    ),
  ),
  'task.resume': id,
  'task.cancel': id,
  'task.read': id,
  'task.list': z.object({}).strict(),
}
