import { z } from 'zod'
import {
  Id,
  OperationSchema,
  Source,
  EntitySchema,
  DocumentSchema,
  CritiqueSchema,
} from './contracts.ts'

export const PlanAttributes = z
  .object({
    level: z.enum(['intent', 'premise', 'plotline', 'part', 'arc', 'chapter', 'scene', 'beat']),
    parentId: Id.optional(),
    goal: z.string().min(1),
    constraints: z.array(z.string()),
    status: z.enum(['proposed', 'active', 'fulfilled', 'needs_revision']),
    entityIds: z.array(Id),
    baseRevision: z.number().int().nonnegative(),
    consequences: z.array(z.string()).default([]),
  })
  .strict()
export const IntakeSchema = z
  .object({
    phase: z.enum(['discussion', 'exploring', 'creating']),
    evidence: z
      .array(z.object({ seq: z.number().int().nonnegative(), quote: z.string().min(1) }).strict())
      .min(1),
    fragments: z.array(
      z
        .object({
          text: z.string().min(1),
          nature: z.enum(['expressed', 'preference', 'proposal', 'hypothesis']),
        })
        .strict(),
    ),
    questions: z.array(z.string().min(1)).max(2),
    answeredQuestionIds: z.array(Id).max(2).default([]),
    reason: z.string().min(1),
  })
  .strict()
export const StageArtifacts = {
  read: z
    .object({
      revision: z.number().int().nonnegative(),
      evidenceIds: z.array(Id),
      missing: z.array(z.string()),
    })
    .strict(),
  goals: z
    .object({ direction: z.string().min(1), goal: z.string().min(1), obstacle: z.string().min(1) })
    .strict(),
  plan: z
    .object({
      planId: Id,
      choices: z.array(z.string()).min(1),
      expectedConsequences: z.array(z.string()),
    })
    .strict(),
  simulate: z.object({ changes: z.array(z.string()), unknowns: z.array(z.string()) }).strict(),
  write: z
    .object({ documentId: Id, revisionId: Id, planId: Id, perspective: z.string().min(1) })
    .strict(),
  extract: z
    .object({
      documentRevisionIds: z.array(Id).min(1),
      changes: z.array(z.string()),
      unchanged: z.array(z.string()),
      uncertainties: z.array(z.string()),
    })
    .strict(),
}
export const AuthorEvidenceInput = z
  .array(
    z.object({ seq: z.number().int().nonnegative().optional(), quote: z.string().min(1) }).strict(),
  )
  .min(1)
export const IntakeInputSchema = IntakeSchema.extend({ evidence: AuthorEvidenceInput })
export const CoverageSchema = z
  .object({
    category: z.enum([
      'world',
      'character',
      'relationship',
      'knowledge',
      'item',
      'plotline',
      'secret',
      'foreshadow',
      'timeline',
    ]),
    before: z.string(),
    after: z.string(),
    operationIds: z.array(Id),
    sources: z.array(Source),
    unchanged: z.boolean(),
    nature: z.enum(['explicit', 'inference', 'proposal', 'unchanged']),
  })
  .strict()
export const ExtractionSchema = z
  .object({
    operations: z.array(OperationSchema),
    coverage: z.array(CoverageSchema),
    uncertainties: z.array(z.string()),
  })
  .strict()
export const ReviewSchema = z
  .object({
    findings: z.array(CritiqueSchema),
    majorDecisions: z.array(z.string()),
    proseConsistent: z.boolean(),
    extractionComplete: z.boolean(),
    planOutcome: z.enum(['fulfilled', 'progressed', 'deviated']),
  })
  .strict()
export const WriterSchema = z
  .object({
    document: DocumentSchema.extend({ text: z.string().min(1).max(5_000_000) }),
    summary: z.string().min(1),
  })
  .strict()
export const SimulationSchema = z
  .object({
    expectedChanges: z.array(z.string()),
    blockers: z.array(z.string()),
    unknowns: z.array(z.string()),
  })
  .strict()
export const SceneRequestSchema = z
  .object({
    planId: Id,
    perspective: z.string().min(1),
    time: z.number().optional(),
    narrativeOrder: z.number().optional(),
    documentId: Id.optional(),
    intent: z.string().min(1),
  })
  .strict()
export const TranslationSchema = z
  .object({
    seedNotes: z.string(),
    entities: z.array(EntitySchema),
    proposals: z.array(z.string()),
    questions: z.array(z.string()).max(2),
  })
  .strict()
export const DevelopSchema = z
  .object({ intent: z.string().min(1), evidence: AuthorEvidenceInput })
  .strict()
export const DecisionInputSchema = z
  .object({ id: Id, evidence: AuthorEvidenceInput.optional() })
  .strict()
export const RetconSchema = z.object({ entityId: Id, intent: z.string().min(1) }).strict()
export const MaterialIntakeSchema = z
  .object({
    title: z.string().min(1).default('创作材料'),
    text: z.string().min(1).max(5_000_000),
    materialKind: z
      .enum(['manuscript', 'outline', 'characters', 'world', 'notes'])
      .default('notes'),
    evidence: AuthorEvidenceInput,
  })
  .strict()
export const MaterialSchema = z
  .object({
    id: Id,
    title: z.string().min(1),
    kind: z.enum(['manuscript', 'outline', 'characters', 'world', 'notes']),
    original: z.string().max(5_000_000),
    originalRevisionId: Id,
    documentIds: z.array(Id),
    batches: z.array(z.string().max(12000)),
    nextBatch: z.number().int().nonnegative(),
    pendingChangeId: Id.nullable().optional(),
    changeId: z.string().optional(),
    taskId: Id.optional(),
    initialChangeId: Id.optional(),
  })
  .strict()
  .refine(
    (m) => m.nextBatch <= m.batches.length && m.batches.join('') === m.original,
    '材料批次与原始来源不一致',
  )
export const CREATIVE_GUIDANCE = `Mythor 为当前 Harness 项目提供持续小说创作能力。用户无需懂小说理论、启用命令或填写标题。
能力不依赖 Mythor Tab；对话和工作台共享同一项目。跨会话的理解、问题和建议见项目创作进展上下文；回复已有问题时用 answeredQuestionIds 引用其真实 ID。提交假设、偏好或规划不使其成为 Canon。
普通小说讨论不要建库。模糊创意先用 mythor_intake 保存来源与探索进度，每轮最多两个普通语言问题；不要要求完整设定。
先理解画面/想法，再推演规则后果、人物处境、欲望、阻碍、选择。建议和猜测保持候选。作者明确要求推进创作或继续选案后再进入 creating。
将用户的话翻译成内部人物动机、信念变化与故事问题；专业词汇不作为输入门槛。
持续创作先读取 mythor_tasks 和 mythor_context，用 mythor_develop 翻译作者语言并形成分层 plan 对象。近期场景细化，远期粗略。已有事实的重要改变用 mythor_retcon 分析证据和后文依赖，不直接覆盖属性。
用 mythor_scene 写作/协调正文，不以 document.put 单独宣称状态已同步。该工具执行受限写作、提取、检查和接纳。
来源 evidence 引用作者原话；不知道消息序号时仅提供 quote，Host 从真实用户消息解析，禁止引用模型自己的建议。
用户带来已有资料时用 mythor_import 保存原始文本及类别，再用 mythor_material 逐批理解，直到 completed 或出现 pending/paused。每批不超过 12000 字符；有 pending 时先 mythor_decide，再继续同一材料，不能跳过检查点。
符合已定方向的低风险正文无需逐章批准。重大设定、不可逆变化、知识越界或历史冲突由 mythor_decide 聚合询问。
“可能”“如果”保持探索，“我喜欢”仅是偏好。自然语言确认仅针对已呈现的唯一候选且版本未变；含糊回答继续追问，不能自行标记作者已确认。模型不能签发授权、伪造作者决定或声明未成功的提交生效。世界时间、叙述顺序、人物误信与世界真相分离。
若服务或模型不可用，保留材料和候选并说明恢复，不输出假完成。`
