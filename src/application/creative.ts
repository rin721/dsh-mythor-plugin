import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { WorkspaceNovels } from './workspaces.ts'
import { interviewState } from './interview.ts'
import { readCreativeSession } from './session-read.ts'
import { ProgressService } from './progress.ts'
import { changeHash } from '../domain/continuity.ts'
import { impacted } from '../domain/validation.ts'
import { harnessObjectSchema } from '../shared/harness-schema.ts'
import {
  IntakeSchema,
  IntakeInputSchema,
  AuthorEvidenceInput,
  PlanAttributes,
  SceneRequestSchema,
  WriterSchema,
  ExtractionSchema,
  ReviewSchema,
  TranslationSchema,
  DevelopSchema,
  RetconSchema,
  SimulationSchema,
  MaterialIntakeSchema,
  CREATIVE_GUIDANCE,
} from '../shared/creative.ts'
import type {
  Actor,
  ChangeSet,
  ContextPack,
  Document,
  Json,
  Operation,
  Request,
  Snapshot,
  SourceRef,
} from '../shared/contracts.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'mythor/intake': z.infer<typeof IntakeSchema>
    'mythor/decision': { id: string; hash: string; answer: Json }
    'mythor/decision-presentation': {
      id: string
      hash: string
      baseRevision: number
      summary: string
    }
  }
}
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json
export function verifyExtraction(
  extraction: z.infer<typeof ExtractionSchema>,
  document: Document,
  start = 0,
  end = document.text.length,
) {
  if (new Set(extraction.coverage.map((c) => c.category)).size !== 9)
    throw new Error('extraction-incomplete: 必须说明九类变化或无变化')
  const covered = new Set(
    extraction.coverage.filter((c) => !c.unchanged).flatMap((c) => c.operationIds),
  )
  const valid = (s: SourceRef) =>
    s.documentId === document.id &&
    s.revisionId === document.revisionId &&
    s.start >= start &&
    s.start < s.end &&
    s.end <= end
  for (const c of extraction.coverage) {
    if (!c.unchanged && (!c.sources.length || !c.operationIds.length))
      throw new Error('extraction-incomplete: 变化必须有来源和操作')
    if (c.sources.some((s) => !valid(s)))
      throw new Error('extraction-source: 变化来源不属于当前材料区间')
    if (c.nature === 'inference' || c.nature === 'proposal')
      for (const op of extraction.operations)
        if (
          op.type === 'entity.put' &&
          c.operationIds.includes(op.value.id) &&
          op.value.informationStatus === 'fact'
        )
          throw new Error('inference-as-fact: 推断不能升级为事实')
  }
  for (const op of extraction.operations) {
    if (op.type === 'relation.put') {
      const evidence = extraction.coverage.filter((c) => c.operationIds.includes(op.value.id))
      op.value.informationStatus = evidence.some(
        (c) => c.nature === 'inference' || c.nature === 'proposal',
      )
        ? 'hypothesis'
        : 'fact'
    }
    if (
      op.type === 'seed.put' ||
      op.type.startsWith('document.') ||
      op.type.startsWith('creative.')
    )
      throw new Error('extraction-scope: 提取不能另改创作方向或正文')
    const id = 'value' in op ? op.value.id : op.id
    if (!covered.has(id)) throw new Error('extraction-uncovered: 操作未包含在变化覆盖中')
    if ((op.type === 'entity.put' || op.type === 'relation.put') && !op.value.sources.some(valid))
      throw new Error('extraction-source: 操作必须引用当前正文')
  }
}
export class CreativeService {
  constructor(
    private readonly ctx: Context,
    private readonly novels: WorkspaceNovels,
  ) {}
  async call<T>(
    agent: Agent,
    action: Request['action'],
    payload: Json = {},
    actor: Actor = { kind: 'author' },
    signal?: AbortSignal,
  ): Promise<T> {
    const result = await this.novels.request(
      agent,
      { action, payload: z.record(z.string(), z.json()).parse(payload) },
      actor,
      signal,
    )
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value as T
  }
  async child<T>(
    agent: Agent,
    role: string,
    schema: z.ZodType<T>,
    input: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const service = this.ctx.get('subagents')
    if (!service?.getProvider('spawn'))
      throw new Error('creative-unavailable: Harness spawn 子 Agent 未配置；材料保留，可配置后恢复')
    const run = await service.start('spawn', {
      parent: agent,
      signal,
      label: `Mythor ${role}`,
      toolFilter: { allow: [] },
      persona: `${CREATIVE_GUIDANCE}\n你只执行 ${role}。不得增加输入之外的授权。只返回要求的结构化产物。`,
      prompt: [{ type: 'text', text: JSON.stringify(input) }],
      outputSchema: harnessObjectSchema(schema),
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed')
        throw new Error(`creative-interrupted: ${role} ${result.stopReason}`)
      return schema.parse(result.structured)
    } finally {
      await run.dispose()
    }
  }
  async history(agent: Agent) {
    return readCreativeSession(this.ctx, agent.id, agent.session)
  }
  async authorEvidence(agent: Agent, evidence: z.infer<typeof AuthorEvidenceInput>) {
    const log = await this.history(agent)
    const resolved = evidence.map((ref) => {
      const event =
        ref.seq === undefined
          ? log.events.findLast(
              (e) =>
                e.type === 'user/message' &&
                e.data.source.kind === 'user' &&
                agent.session.isOwnSeq(e.seq) &&
                e.data.content.some((b) => b.type === 'text' && b.text.includes(ref.quote)),
            )
          : log.events.find((e) => Number(e.seq) === ref.seq)
      if (
        !event ||
        event.type !== 'user/message' ||
        event.data.source.kind !== 'user' ||
        !agent.session.isOwnSeq(event.seq as SessionSeq) ||
        !event.data.content.some((b) => b.type === 'text' && b.text.includes(ref.quote))
      )
        throw new Error('author-evidence: 必须引用当前会话的真实作者输入')
      return { seq: Number(event.seq), quote: ref.quote }
    })
    return { log, evidence: resolved }
  }
  async develop(agent: Agent, payload: unknown, signal: AbortSignal) {
    const input = DevelopSchema.parse(payload)
    input.evidence = (await this.authorEvidence(agent, input.evidence)).evidence
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const context = await this.call<ContextPack>(agent, 'context')
    const translated = await this.child(
      agent,
      '创作理解与分层规划：将作者的普通语言翻译为动机、信念、处境、欲望、冲突、选择和后果。不得要求作者填专业字段。用 plan 实体表达层级，attributes 符合规划契约；远期粗、近期细。所有尚未由作者明确给出的事实保持 hypothesis，每轮至多两个普通语言问题。',
      TranslationSchema,
      { ...input, context, planContract: z.toJSONSchema(PlanAttributes) },
      signal,
    )
    const operations: Operation[] = translated.entities.map((entity) => ({
      type: 'entity.put',
      value: {
        ...entity,
        ...(entity.kind === 'plan'
          ? {
              attributes: {
                ...PlanAttributes.parse(entity.attributes),
                baseRevision: snapshot.novel.revision,
              },
            }
          : {}),
        informationStatus: entity.kind === 'plan' ? 'plan' : 'hypothesis',
        editorialStatus: 'accepted',
      },
    }))
    if (!operations.length)
      return { questions: translated.questions, proposals: translated.proposals }
    const change = await this.call<ChangeSet>(agent, 'changes.propose', {
      baseRevision: snapshot.novel.revision,
      summary: translated.seedNotes || input.intent,
      operations: json(operations),
    })
    const actor: Actor = {
      kind: 'policy',
      changeHash: changeHash(change),
      reason: 'creative-understanding',
    }
    const routine =
      !translated.proposals.length &&
      operations.every((op) => {
        if (op.type !== 'entity.put' || op.value.kind !== 'plan') return false
        const plan = PlanAttributes.parse(op.value.attributes)
        const parent = snapshot.entities.find(
          (e) => e.id === plan.parentId && e.kind === 'plan' && e.editorialStatus === 'accepted',
        )
        const prior = parent && PlanAttributes.safeParse(parent.attributes)
        return (
          ['chapter', 'scene', 'beat'].includes(plan.level) &&
          prior?.success &&
          prior.data.status === 'active' &&
          prior.data.constraints.every((c) => plan.constraints.includes(c))
        )
      })
    await this.call(
      agent,
      'scene.evidence',
      {
        id: change.id,
        report: json({
          majorDecisions: routine
            ? []
            : translated.proposals.length
              ? translated.proposals
              : ['请确定这些人物变化与故事方向是否符合你的想法'],
          evidence: input.evidence,
          questions: translated.questions,
        }),
      },
      actor,
    )
    if (routine) {
      const checked = await this.call<{ findings: unknown[] }>(agent, 'changes.validate', {
        id: change.id,
      })
      if (!checked.findings.length)
        return {
          accepted: change.id,
          questions: translated.questions,
          result: await this.call(
            agent,
            'changes.commit',
            { id: change.id, idempotencyKey: change.id },
            actor,
          ),
        }
    }
    return {
      pending: change.id,
      questions: translated.questions,
      proposals: translated.proposals,
      note: '方向经作者决定后，规划进入后续场景上下文；建议仍是假设',
    }
  }
  async retcon(agent: Agent, payload: unknown, signal: AbortSignal) {
    const input = RetconSchema.parse(payload)
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const ids = impacted(snapshot, [{ type: 'entity.delete', id: input.entityId }])
    const entities = snapshot.entities.filter((e) => ids.includes(e.id))
    const sources = entities.flatMap((e) => e.sources)
    const documents = snapshot.documents
      .filter(
        (d) =>
          (d.entityId && ids.includes(d.entityId)) || sources.some((s) => s.documentId === d.id),
      )
      .map((d) => ({ ...d, text: d.text.slice(0, 12000), truncated: d.text.length > 12000 }))
    if (JSON.stringify({ entities, sources, documents }).length > 24000)
      return {
        paused: true,
        affected: ids,
        note: '修订影响范围超过单批预算，请按章节或对象分批分析，不能忽略后文依赖',
      }
    const analysis = await this.child(
      agent,
      'Retcon 影响分析：引用现有证据。区分人物误以为如此、已有历史可合理解释、必须改写历史三条路线。列出需重写的正文和修订的规划，不直接变更事实。若证据被截断，明确未知。',
      z
        .object({
          alternatives: z
            .array(
              z
                .object({
                  direction: z.enum(['misbelief', 'explanation', 'rewrite']),
                  explanation: z.string().min(1),
                  repairSteps: z.array(z.string()),
                  evidenceIds: z.array(z.string()),
                })
                .strict(),
            )
            .min(1)
            .max(3),
          unknowns: z.array(z.string()),
        })
        .strict(),
      { input, revision: snapshot.novel.revision, entities, sources, documents },
      signal,
    )
    const task = await this.call<{ id: string }>(agent, 'task.start', {
      kind: 'revise',
      intent: input.intent,
      focus: ids,
    })
    await this.call(agent, 'task.advance', {
      id: task.id,
      stage: 'read',
      artifact: { revision: snapshot.novel.revision, evidenceIds: ids, missing: analysis.unknowns },
    })
    await this.call(agent, 'session.save', {
      value: {
        retcon: json({
          ...analysis,
          taskId: task.id,
          baseline: snapshot.novel.revision,
          affected: ids,
        }),
      },
    })
    return {
      ...analysis,
      taskId: task.id,
      affected: ids,
      note: '请作者选择修订方向，然后形成修复规划与正文候选；旧事实尚未改变',
    }
  }
  async intake(agent: Agent, payload: unknown, signal: AbortSignal) {
    const raw = IntakeInputSchema.parse(payload)
    const { log, evidence } = await this.authorEvidence(agent, raw.evidence)
    const input = IntakeSchema.parse({ ...raw, evidence })
    const progress = interviewState(this.ctx, agent.session)
    agent.session.append('mythor/interview', { ...progress, intakes: [...progress.intakes, input] })
    await this.novels.resolve(agent)
    await this.novels.invalidate(agent)
    if (input.phase !== 'creating') {
      const status = await this.call<{ enabled: boolean }>(agent, 'novel.status')
      if (status.enabled && input.phase !== 'discussion') await this.saveExploration(agent)
      return { phase: input.phase, questions: input.questions }
    }
    const classification = await this.child(
      agent,
      '判断是否正在持续创作：普通讨论不进入；明确创作推进或后续选案才进入',
      z.object({ creating: z.boolean(), reason: z.string() }).strict(),
      {
        history: (await new ProgressService(this.ctx, this.novels).exploration(agent)).records,
        authorEvidence: input.evidence,
        recentAuthorInputs: log.events
          .flatMap((e) =>
            e.type === 'user/message' &&
            e.data.source.kind === 'user' &&
            agent.session.isOwnSeq(e.seq)
              ? [
                  {
                    seq: Number(e.seq),
                    text: e.data.content
                      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
                      .join('\n')
                      .slice(0, 2000),
                  },
                ]
              : [],
          )
          .slice(-6),
      },
      signal,
    )
    if (!classification.creating) return { phase: 'exploring', reason: classification.reason }
    await this.call(agent, 'novel.enable', { title: '未命名作品' }, { kind: 'author' }, signal)
    await this.saveExploration(agent)
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const interview = await this.call<{ intakeSeqs?: number[] }>(agent, 'session.state')
    const references = [
      ...progress.intakes.flatMap((i) => (i.phase !== 'discussion' ? i.evidence : [])),
      ...input.evidence,
    ].filter(
      (e, index, all) =>
        all.findIndex((other) => other.seq === e.seq && other.quote === e.quote) === index &&
        !interview.intakeSeqs?.includes(e.seq),
    )
    if (!references.length)
      return { phase: 'creating', revision: snapshot.novel.revision, duplicate: true }
    await this.authorEvidence(agent, references)
    const notes = references.map((e) => e.quote).join('\n')
    const change = await this.call<ChangeSet>(agent, 'changes.propose', {
      baseRevision: snapshot.novel.revision,
      summary: '记录作者创作想法',
      operations: json([
        {
          type: 'seed.put',
          value: {
            ...snapshot.novel.seed,
            notes: [snapshot.novel.seed.notes, notes].filter(Boolean).join('\n'),
          },
        },
      ]),
    })
    const actor: Actor = {
      kind: 'policy',
      changeHash: changeHash(change),
      reason: 'verified-author-idea',
    }
    await this.call(
      agent,
      'scene.evidence',
      { id: change.id, report: json({ sessionId: agent.id, evidence: references }) },
      actor,
    )
    await this.call(agent, 'changes.commit', { id: change.id, idempotencyKey: change.id }, actor)
    return { phase: 'creating', questions: input.questions, revision: snapshot.novel.revision + 1 }
  }
  async saveExploration(agent: Agent) {
    const project = await new ProgressService(this.ctx, this.novels).exploration(agent)
    if (project.unavailableSessions.length)
      throw new Error(
        'creative-unavailable: 部分项目会话暂不可读取，探索记录未自动迁入；请恢复来源后重试',
      )
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const existing = new Map(snapshot.creativeRecords?.map((r) => [r.id, r]))
    const records = project.records.filter(
      (r) =>
        !existing.has(r.id) ||
        (existing.get(r.id)?.status !== 'superseded' && existing.get(r.id)?.status !== r.status),
    )
    if (!records.length) return
    const change = await this.call<ChangeSet>(agent, 'changes.propose', {
      baseRevision: snapshot.novel.revision,
      summary: '保存创作想法与待讨论问题',
      operations: json(records.map((value) => ({ type: 'creative.put', value }))),
    })
    const actor: Actor = {
      kind: 'policy',
      changeHash: changeHash(change),
      reason: 'verified-project-exploration',
    }
    await this.call(
      agent,
      'scene.evidence',
      { id: change.id, report: json({ sources: records.flatMap((r) => r.sources) }) },
      actor,
    )
    await this.call(agent, 'changes.commit', { id: change.id, idempotencyKey: change.id }, actor)
  }
  async decide(
    agent: Agent,
    id: string,
    signal: AbortSignal,
    evidence?: z.infer<typeof AuthorEvidenceInput>,
  ) {
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const change = snapshot.changes.find((c) => c.id === id && c.status === 'pending')
    if (!change) throw new Error('change-closed: 候选不存在或已处理')
    const checked = await this.call<{
      findings: { severity: string; message: string }[]
      affected: string[]
    }>(agent, 'changes.validate', { id })
    if (checked.findings.some((f) => f.severity === 'error'))
      return { pending: id, findings: checked.findings, note: '先修复结构错误，不能用确认绕过' }
    const hash = changeHash(change)
    if (evidence) {
      const verified = await this.authorEvidence(agent, evidence)
      const presentations = verified.log.events.filter(
        (e) => e.type === 'mythor/decision-presentation',
      )
      const presented = presentations.findLast(
        (e) => e.type === 'mythor/decision-presentation' && e.data.id === id,
      )
      const last = presentations.at(-1)
      const ambiguous = presentations
        .filter(
          (e) =>
            e.type === 'mythor/decision-presentation' &&
            snapshot.changes.some((c) => c.id === e.data.id && c.status === 'pending'),
        )
        .some((e) => e.type === 'mythor/decision-presentation' && e.data.id !== id)
      const explicit = verified.evidence.every((ref) =>
        /^(按这个方向继续|采用这个方案|就这么定了|确认采用|确认提交)[。！!\s]*$/.test(
          ref.quote.trim(),
        ),
      )
      if (
        !presented ||
        presented.type !== 'mythor/decision-presentation' ||
        last !== presented ||
        ambiguous ||
        !explicit ||
        presented.data.hash !== hash ||
        presented.data.baseRevision !== snapshot.novel.revision ||
        verified.evidence.some((ref) => ref.seq <= Number(presented.seq))
      )
        return {
          pending: id,
          note: '确认对象或范围不够明确，请通过原生问答选择；这句话没有批准修改',
        }
      // Inspect the whole message, rather than allowing the model to quote a short affirmative fragment.
      const whole = verified.evidence.every((ref) =>
        verified.log.events.some(
          (e) =>
            e.type === 'user/message' &&
            Number(e.seq) === ref.seq &&
            e.data.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
              .trim() === ref.quote.trim(),
        ),
      )
      if (!whole) return { pending: id, note: '需确认完整表达，不能截取肯定片段' }
      const latest = await this.call<Snapshot>(agent, 'snapshot')
      const candidate = latest.changes.find((c) => c.id === id)
      if (
        !candidate ||
        latest.novel.revision !== change.baseRevision ||
        changeHash(candidate) !== hash
      )
        throw new Error('decision-conflict: 作品已变化，请重新比较')
      const actor: Actor = { kind: 'policy', changeHash: hash, reason: 'verified-author-decision' }
      await this.call(
        agent,
        'decision.record',
        {
          id,
          revision: change.baseRevision,
          hash,
          answer: json({
            evidence: verified.evidence.map((r) => ({ ...r, sessionId: String(agent.id) })),
          }),
        },
        actor,
      )
      return this.call(
        agent,
        'changes.commit',
        { id, idempotencyKey: id, acknowledgeWarnings: true },
        { kind: 'author' },
      )
    }
    const questions = this.ctx.get('userQuestions')
    if (!questions)
      return { pending: id, note: 'Harness 原生问答不可用；候选保留，可在 Mythor 审阅' }
    agent.session.append('mythor/decision-presentation', {
      id,
      hash,
      baseRevision: change.baseRevision,
      summary: change.summary,
    })
    await this.novels.invalidate(agent)
    const answer = await questions.ask({
      agent,
      signal,
      questions: [
        {
          id,
          question: '这些变化是否符合你想写的故事？',
          detail: `${change.summary}\n${checked.findings.map((f) => f.message).join('\n')}\n涉及 ${checked.affected.length} 个对象。`,
          options: [{ label: '按这个方向继续' }, { label: '保留草稿' }],
          intent: { kind: 'plan-review', approve: '按这个方向继续' },
        },
      ],
    })
    const selection = answer.answers.find((a) => a.id === id)
    agent.session.append('mythor/interview', {
      ...interviewState(this.ctx, agent.session),
      decision: { id, hash, answer: json(answer) },
    })
    if (selection?.custom) {
      agent.followup(
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: selection.custom }],
        }),
      )
      return {
        pending: id,
        authorInput: selection.custom,
        note: '新输入需要重新整理为候选，不代表批准',
      }
    }
    if (!selection?.selected.includes('按这个方向继续')) return { pending: id }
    const latest = await this.call<Snapshot>(agent, 'snapshot')
    const candidate = latest.changes.find((c) => c.id === id)
    if (
      latest.novel.revision !== change.baseRevision ||
      !candidate ||
      changeHash(candidate) !== hash
    )
      throw new Error('decision-conflict: 回答期间作品已变化，需要重新比较')
    const actor: Actor = { kind: 'policy', changeHash: hash, reason: 'native-author-decision' }
    await this.call(
      agent,
      'decision.record',
      { id, revision: change.baseRevision, hash, answer: json(answer) },
      actor,
    )
    return this.call(
      agent,
      'changes.commit',
      { id, idempotencyKey: id, acknowledgeWarnings: true },
      { kind: 'author' },
    )
  }
  async material(agent: Agent, id: string, signal: AbortSignal) {
    const material = await this.call<Record<string, Json>>(agent, 'material.read', { id })
    if (!material) throw new Error('material-missing: 材料不存在')
    const batches = z.array(z.string()).parse(material.batches)
    const index = z.number().int().nonnegative().parse(material.nextBatch)
    if (index >= batches.length) return { completed: true, materialId: id }
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    if (typeof material.pendingChangeId === 'string') {
      const prior = snapshot.changes.find((c) => c.id === material.pendingChangeId)
      if (prior?.status === 'committed') {
        await this.call(
          agent,
          'material.advance',
          { id, nextBatch: index + 1, changeId: prior.id },
          { kind: 'policy', changeHash: changeHash(prior), reason: 'accepted-material-batch' },
        )
        return { materialId: id, nextBatch: index + 1, completed: index + 1 === batches.length }
      }
      if (prior?.status === 'pending')
        return { pending: prior.id, materialId: id, nextBatch: index }
    }
    if (
      typeof material.taskId === 'string' &&
      snapshot.tasks.some(
        (t) => t.id === material.taskId && ['cancelled', 'failed'].includes(t.status),
      )
    )
      return {
        paused: true,
        materialId: id,
        note: '材料任务已取消或失败；已有材料保留，请恢复任务后继续',
      }
    const original = snapshot.documents.find((d) => d.id === id)
    if (!original)
      return {
        pending: snapshot.changes.find(
          (c) =>
            c.status === 'pending' &&
            c.operations.some((o) => o.type === 'document.put' && o.value.id === id),
        )?.id,
        note: '先接纳原始材料，再理解材料中的事实',
      }
    try {
      const context = await this.call<ContextPack>(agent, 'context')
      const offset = batches.slice(0, index).reduce((sum, text) => sum + text.length, 0)
      const extraction = await this.child(
        agent,
        '分批理解已有材料：识别别名、事件、关系、世界规则、知识、伏笔；笔记/设定不是正文。明确陈述与推断分开，来源偏移必须换算到原始修订',
        ExtractionSchema,
        {
          text: batches[index],
          offset,
          documentId: id,
          revisionId: original.revisionId,
          kind: material.kind,
          context,
        },
        signal,
      )
      verifyExtraction(extraction, original, offset, offset + batches[index].length)
      const operations = extraction.operations.filter((o) => !o.type.startsWith('document.'))
      for (const op of operations)
        if (op.type === 'entity.put' || op.type === 'relation.put') {
          if (
            !op.value.sources.length ||
            op.value.sources.some(
              (s) =>
                s.documentId !== id ||
                s.revisionId !== original.revisionId ||
                s.start < offset ||
                s.end > offset + batches[index].length,
            )
          )
            throw new Error('material-source: 提取必须引用当前批次原文')
        }
      const review = await this.child(
        agent,
        '材料提取复核：明示事实可维护，推断不得升级；对别名、歧义、矛盾和已有 Canon 冲突给出证据及作者决定项',
        ReviewSchema,
        { context, materialKind: material.kind, text: batches[index], extraction },
        signal,
      )
      if (!operations.length) {
        if (
          extraction.uncertainties.length ||
          review.findings.length ||
          review.majorDecisions.length ||
          !review.proseConsistent ||
          !review.extractionComplete
        )
          return { paused: true, materialId: id, review, uncertainties: extraction.uncertainties }
        const actor: Actor = {
          kind: 'policy',
          changeHash: '',
          reason: 'reviewed-empty-material-batch',
        }
        await this.call(
          agent,
          'material.advance',
          { id, nextBatch: index + 1, changeId: '' },
          actor,
        )
        return { materialId: id, nextBatch: index + 1, completed: index + 1 === batches.length }
      }
      const change = await this.call<ChangeSet>(agent, 'changes.propose', {
        baseRevision: snapshot.novel.revision,
        summary: `理解《${material.title}》第 ${index + 1} 批`,
        operations: json(operations),
      })
      const actor: Actor = {
        kind: 'policy',
        changeHash: changeHash(change),
        reason: `material:${id}:${index}`,
      }
      await this.call(
        agent,
        'scene.evidence',
        {
          id: change.id,
          report: json({
            ...review,
            uncertainties: [
              ...extraction.uncertainties,
              ...extraction.coverage
                .filter((c) => c.nature === 'inference' || c.nature === 'proposal')
                .map((c) => c.after),
            ],
          }),
        },
        actor,
      )
      const checked = await this.call<{ findings: unknown[] }>(agent, 'changes.validate', {
        id: change.id,
      })
      await this.call(
        agent,
        'material.advance',
        { id, nextBatch: index, changeId: change.id, pendingChangeId: change.id },
        actor,
      )
      if (checked.findings.length) {
        return { pending: change.id, materialId: id, nextBatch: index, review }
      }
      await this.call(agent, 'changes.commit', { id: change.id, idempotencyKey: change.id }, actor)
      await this.call(
        agent,
        'material.advance',
        { id, nextBatch: index + 1, changeId: change.id },
        actor,
      )
      return { materialId: id, nextBatch: index + 1, completed: index + 1 === batches.length }
    } catch (error) {
      if (typeof material.taskId === 'string')
        await this.call(agent, signal.aborted ? 'task.cancel' : 'task.fail', {
          id: material.taskId,
          ...(signal.aborted
            ? {}
            : { error: error instanceof Error ? error.message : String(error) }),
        }).catch(() => {})
      throw error
    }
  }
  async importMaterial(agent: Agent, payload: unknown, signal: AbortSignal) {
    signal.throwIfAborted()
    const input = MaterialIntakeSchema.parse(payload)
    input.evidence = (await this.authorEvidence(agent, input.evidence)).evidence
    if (!input.evidence.some((ref) => ref.quote.includes(input.text)))
      throw new Error(
        'material-evidence: 对话粘贴材料需原文来源；文件请从工作台上传，避免模型改写原始材料',
      )
    await this.call(agent, 'novel.enable', { title: '未命名作品' })
    const result = await this.call<{ change: ChangeSet; materialId?: string }>(agent, 'import', {
      title: input.title,
      text: input.text,
      materialKind: input.materialKind,
    })
    const change = result.change
    const actor: Actor = { kind: 'policy', changeHash: changeHash(change), reason: 'raw-material' }
    await this.call(
      agent,
      'scene.evidence',
      { id: change.id, report: { evidence: json(input.evidence), rawMaterialOnly: true } },
      actor,
    )
    await this.call(agent, 'changes.commit', { id: change.id, idempotencyKey: change.id }, actor)
    return {
      accepted: change.id,
      materialId:
        result.materialId ??
        change.operations.flatMap((o) =>
          o.type === 'document.put' && o.value.id === o.value.materialId ? [o.value.id] : [],
        )[0],
      note: '只接纳不可变原始材料；调用 mythor_material 逐批理解，提取完成前状态待协调',
    }
  }
  async scene(agent: Agent, payload: unknown, signal: AbortSignal) {
    const request = SceneRequestSchema.parse(payload)
    const snapshot = await this.call<Snapshot>(agent, 'snapshot')
    const planEntity = snapshot.entities.find(
      (e) => e.id === request.planId && e.kind === 'plan' && e.editorialStatus === 'accepted',
    )
    if (!planEntity) throw new Error('plan-required: 请先整理本场景的方向与约束')
    const plan = PlanAttributes.parse(planEntity.attributes)
    if (plan.status !== 'active' && !request.documentId)
      throw new Error('plan-inactive: 规划需要重新确定')
    const focus = [request.planId, ...plan.entityIds]
    const authorContext = await this.call<ContextPack>(
      agent,
      'context',
      json({ focus, time: request.time, narrativeOrder: request.narrativeOrder }),
    )
    const missing =
      authorContext.coverage?.missing.filter(
        (id) =>
          !(
            request.documentId &&
            (id === planEntity.id ||
              snapshot.entities.some(
                (e) =>
                  e.id === id &&
                  e.stale &&
                  e.sources.some((s) => s.documentId === request.documentId),
              ))
          ),
      ) ?? []
    if (missing.length)
      return { paused: true, missing, note: '关键依据未装入，请缩小场景范围或拆分任务' }
    if (request.documentId) {
      const dependencies = snapshot.entities.filter(
        (e) => e.stale && e.sources.some((s) => s.documentId === request.documentId),
      )
      if (JSON.stringify({ authorContext, dependencies }).length > 24000)
        return {
          paused: true,
          note: '改写影响范围超出单场景预算，先进行 Retcon 影响分析并拆分修复任务',
        }
      authorContext.entities.push(
        ...dependencies.filter((e) => !authorContext.entities.some((other) => other.id === e.id)),
      )
    }
    const otherUnsynced = snapshot.documents.filter(
      (d) =>
        d.id !== request.documentId &&
        authorContext.gaps.some(
          (g) => g.startsWith('正文待协调：') && g.slice(6).split(',').includes(d.id),
        ),
    )
    if (otherUnsynced.length)
      return {
        paused: true,
        documents: otherUnsynced.map((d) => d.id),
        note: '先协调既有正文，避免沿用过期状态',
      }
    const simulation = await this.child(
      agent,
      '场景前因果推演：检查行动前置、人物目标、资源、关系、知识和时间，预测状态后果。无法满足规划或依据未知时明确阻碍，不自行改变方向。',
      SimulationSchema,
      { plan, context: authorContext, intent: request.intent },
      signal,
    )
    if (simulation.blockers.length || simulation.unknowns.length)
      return { paused: true, simulation, note: '先解决场景前置问题；正文未开始生成' }
    let document: Document
    if (request.documentId) {
      const old =
        snapshot.documents.find((d) => d.id === request.documentId) ??
        snapshot.changes
          .filter((c) => c.status === 'pending')
          .flatMap((c) => c.operations)
          .find(
            (o): o is Extract<Operation, { type: 'document.put' }> =>
              o.type === 'document.put' && o.value.id === request.documentId,
          )?.value
      if (!old) throw new Error('document-missing: 正文不存在')
      const head = snapshot.documents.find((d) => d.id === old.id)
      document = {
        ...old,
        revisionId: randomUUID(),
        ...(head ? { parentRevisionId: head.revisionId } : {}),
      }
    } else {
      const limited = await this.call<ContextPack>(
        agent,
        'context',
        json({
          focus,
          perspective: request.perspective,
          time: request.time,
          narrativeOrder: request.narrativeOrder,
        }),
      )
      if (request.perspective === 'author')
        throw new Error('writer-perspective: 写作需明确人物或 reader 视角')
      const written = await this.child(
        agent,
        '受限视角场景写作：遵守规划，人物不得使用未获知真相；若需要重要新设定请返回草稿，不自行改变方向',
        WriterSchema,
        {
          goal: plan.goal,
          constraints: plan.constraints,
          intent: request.intent,
          context: { ...limited, pending: { changes: [], tasks: [] } },
        },
        signal,
      )
      document = {
        ...written.document,
        id: randomUUID(),
        revisionId: randomUUID(),
        materialKind: 'manuscript',
      }
    }
    return this.reconcile(
      agent,
      snapshot,
      document,
      planEntity.id,
      authorContext,
      signal,
      simulation,
    )
  }
  async reconcile(
    agent: Agent,
    snapshot: Snapshot,
    document: Document,
    planId: string,
    context: ContextPack,
    signal: AbortSignal,
    simulation: z.infer<typeof SimulationSchema>,
  ) {
    const task = await this.call<{ id: string }>(agent, 'task.start', {
      kind: 'revise',
      intent: `协调 ${document.title}`,
      planId,
      focus: [planId],
    })
    try {
      const draft = await this.call<ChangeSet>(agent, 'changes.propose', {
        baseRevision: snapshot.novel.revision,
        summary: `保留场景草稿：${document.title}`,
        operations: json([{ type: 'document.put', value: document }]),
      })
      const stage = (stage: string, artifact: unknown) =>
        this.call(agent, 'task.advance', { id: task.id, stage, artifact: json(artifact) })
      await stage('read', {
        revision: snapshot.novel.revision,
        evidenceIds: context.entities.map((e) => e.id),
        missing: context.coverage?.missing ?? [],
      })
      const plan = PlanAttributes.parse(snapshot.entities.find((e) => e.id === planId)!.attributes)
      await stage('goals', {
        direction: plan.goal,
        goal: plan.goal,
        obstacle: plan.constraints.join('；') || '遵守已有故事状态',
      })
      await stage('plan', { planId, choices: [plan.goal], expectedConsequences: plan.consequences })
      await stage('simulate', {
        changes: simulation.expectedChanges,
        unknowns: simulation.unknowns,
      })
      await stage('write', {
        documentId: document.id,
        revisionId: document.revisionId,
        planId,
        perspective: context.perspective,
      })
      const extraction = await this.child(
        agent,
        '提取正文明确变化：九类覆盖分别说明变化或无变化；对白/误信/猜测不是事实，每条变化必须引用该正文修订，避免把已经发生的事件当作未来计划',
        ExtractionSchema,
        { document, context, planId },
        signal,
      )
      verifyExtraction(extraction, document)
      const categories = new Set(extraction.coverage.map((c) => c.category))
      if (
        categories.size !== 9 ||
        extraction.coverage.some(
          (c) => !c.unchanged && (!c.sources.length || !c.operationIds.length),
        )
      )
        throw new Error('extraction-incomplete: 变化覆盖或来源不足，正文草稿未丢失')
      for (const c of extraction.coverage)
        for (const s of c.sources)
          if (
            s.documentId !== document.id ||
            s.revisionId !== document.revisionId ||
            s.start > s.end ||
            s.end > document.text.length
          )
            throw new Error('extraction-source: 提取来源不属于当前正文')
      const operations: Operation[] = [
        { type: 'document.put', value: document },
        ...extraction.operations.filter((o) => !o.type.startsWith('document.')),
      ]
      await stage('extract', {
        documentRevisionIds: [document.revisionId],
        changes: extraction.coverage.filter((c) => !c.unchanged).map((c) => c.after),
        unchanged: extraction.coverage.filter((c) => c.unchanged).map((c) => c.category),
        uncertainties: extraction.uncertainties,
      })
      const review = await this.child(
        agent,
        '独立一致性检查：比较历史事实、规划与正文，检查死亡复活、人物动机、知识泄漏、时间线、物品转交、主线偏离和重大不可逆新增；列来源，不确定就是 unknown',
        ReviewSchema,
        { context, document, extraction, planId },
        signal,
      )
      const previousPlan = snapshot.entities.find((e) => e.id === planId)!
      operations.push({
        type: 'entity.put',
        value: {
          ...previousPlan,
          attributes: {
            ...plan,
            status:
              review.planOutcome === 'fulfilled'
                ? 'fulfilled'
                : review.planOutcome === 'deviated'
                  ? 'needs_revision'
                  : 'active',
            consequences: extraction.coverage.filter((c) => !c.unchanged).map((c) => c.after),
          },
          sources: [
            ...previousPlan.sources,
            {
              documentId: document.id,
              revisionId: document.revisionId,
              start: 0,
              end: document.text.length,
            },
          ],
        },
      })
      const change = await this.call<ChangeSet>(agent, 'changes.propose', {
        baseRevision: snapshot.novel.revision,
        taskId: task.id,
        summary: `推进故事：${document.title}`,
        operations: json(operations),
      })
      if (review.planOutcome === 'deviated')
        review.majorDecisions.push('正文偏离已有规划，需要重新确定方向')
      const actor: Actor = {
        kind: 'policy',
        changeHash: changeHash(change),
        reason: 'scene-reconciliation',
      }
      const report = {
        ...review,
        coverage: extraction.coverage,
        uncertainties: [
          ...extraction.uncertainties,
          ...extraction.coverage
            .filter((c) => c.nature === 'inference' || c.nature === 'proposal')
            .map((c) => c.after),
        ],
        taskId: task.id,
      }
      await this.call(agent, 'scene.evidence', { id: change.id, report: json(report) }, actor)
      const checked = await this.call<{ findings: unknown[] }>(agent, 'changes.validate', {
        id: change.id,
      })
      if (
        !review.proseConsistent ||
        !review.extractionComplete ||
        review.findings.length ||
        review.majorDecisions.length ||
        extraction.uncertainties.length ||
        checked.findings.length
      )
        return {
          pending: change.id,
          review: report,
          checked,
          affected: impacted(snapshot, operations),
        }
      const committed = await this.call(
        agent,
        'changes.commit',
        { id: change.id, idempotencyKey: change.id },
        actor,
      )
      await this.call(agent, 'changes.reject', { id: draft.id })
      return committed
    } catch (error) {
      await this.call(agent, signal.aborted ? 'task.cancel' : 'task.fail', {
        id: task.id,
        error: String(error).slice(0, 2000),
      })
      throw error
    }
  }
}
