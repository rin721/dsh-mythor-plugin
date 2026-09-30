import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type { CreativeRecord, Snapshot, Commit } from '../shared/contracts.ts'
import type { WorkspaceProgress } from '../shared/progress.ts'
import { IntakeSchema } from '../shared/creative.ts'
import { readCreativeSession } from './session-read.ts'
import { InterviewSchema } from './interview.ts'
import type { WorkspaceNovels } from './workspaces.ts'

const idFor = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class ProgressService {
  constructor(
    private readonly ctx: Context,
    private readonly novels: WorkspaceNovels,
  ) {}

  async exploration(agent: Agent) {
    const scope = await this.novels.resolve(agent)
    const sessions = await this.novels.memberSessions(agent)
    const records = new Map<string, CreativeRecord>()
    const checkpoints: WorkspaceProgress['checkpoints'] = []
    const answered = new Set<string>()
    const unavailableSessions: string[] = []
    for (const sessionId of sessions) {
      let log
      try {
        log = await readCreativeSession(
          this.ctx,
          sessionId,
          sessionId === agent.id ? agent.session : this.novels.activeSession(sessionId),
        )
      } catch (error) {
        if (sessionId === agent.id) throw error
        unavailableSessions.push(String(sessionId))
        continue
      }
      if (!log.session.cwd || !(await this.novels.matchesWorkspace(scope, log.session.cwd)))
        continue
      const own = log.events.slice(log.inheritedEventCount)
      checkpoints.push({ sessionId: String(sessionId), seq: Number(log.events.at(-1)?.seq ?? 0) })
      for (const event of own) {
        if (event.type !== 'mythor/interview' && event.type !== 'mythor/intake') continue
        const parsed =
          event.type === 'mythor/interview'
            ? InterviewSchema.safeParse(event.data)
            : IntakeSchema.safeParse(event.data)
        if (!parsed.success) continue
        const intakes = 'intakes' in parsed.data ? parsed.data.intakes : [parsed.data]
        for (const intake of intakes) {
          if (intake.phase === 'discussion') continue
          const sources = intake.evidence.flatMap((ref) => {
            const source = own.find((e) => Number(e.seq) === ref.seq)
            return source?.type === 'user/message' &&
              source.data.source.kind === 'user' &&
              source.data.content.some((b) => b.type === 'text' && b.text.includes(ref.quote))
              ? [{ sessionId: String(sessionId), seq: ref.seq, quote: ref.quote }]
              : []
          })
          if (!sources.length) continue
          intake.answeredQuestionIds.forEach((id) => answered.add(id))
          const add = (kind: CreativeRecord['kind'], text: string) => {
            const id = idFor([kind, text, sources])
            records.set(id, { id, kind, text, status: 'open', sources })
          }
          sources.forEach((s) => add('expression', s.quote))
          intake.fragments.forEach((f) =>
            add(f.nature === 'expressed' ? 'interpretation' : f.nature, f.text),
          )
          intake.questions.forEach((q) => add('question', q))
        }
      }
    }
    return {
      records: [...records.values()].map((r) =>
        answered.has(r.id) && r.kind === 'question' ? { ...r, status: 'resolved' as const } : r,
      ),
      checkpoints,
      unavailableSessions,
    }
  }

  async read(agent: Agent): Promise<WorkspaceProgress> {
    const scope = await this.novels.resolve(agent)
    const exploration = await this.exploration(agent)
    const status = await this.novels.request(
      agent,
      { action: 'novel.status', payload: {} },
      { kind: 'author' },
    )
    if (!status.ok) throw new Error(status.error.message)
    const enabled = (status.value as { enabled: boolean }).enabled
    let snapshot: Snapshot | undefined
    let history: Commit[] = []
    let decisions: WorkspaceProgress['decisions'] = []
    if (enabled) {
      const result = await this.novels.request(
        agent,
        { action: 'workspace.progress', payload: {} },
        { kind: 'author' },
      )
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as unknown as {
        snapshot: Snapshot
        history: Commit[]
        decisions: typeof decisions
      }
      snapshot = value.snapshot
      history = value.history
      decisions = value.decisions
    }
    const records = new Map(exploration.records.map((r) => [r.id, r]))
    snapshot?.creativeRecords?.forEach((r) => records.set(r.id, r))
    const all = [...records.values()]
    return {
      workspace: { id: scope.workspaceId, title: scope.workspaceTitle },
      enabled,
      revision: snapshot?.novel.revision ?? null,
      title: snapshot?.novel.title ?? null,
      records: all.slice(-80),
      totalRecords: all.length,
      truncated: all.length > 80,
      checkpoints: exploration.checkpoints,
      unavailableSessions: exploration.unavailableSessions,
      plans:
        snapshot?.entities.filter(
          (e) => e.kind === 'plan' && e.editorialStatus === 'accepted' && !e.stale,
        ) ?? [],
      tasks: snapshot?.tasks ?? [],
      pending:
        snapshot?.changes
          .filter((c) => c.status === 'pending')
          .map(({ id, summary, baseRevision }) => ({ id, summary, baseRevision })) ?? [],
      decisions,
      recent: history
        .slice(-8)
        .reverse()
        .map((c) => ({
          id: c.id,
          text: c.summary,
          revision: c.revision,
          kind: c.operations.some((o) => o.type === 'document.put')
            ? 'prose'
            : c.operations.some(
                  (o) => o.type === 'entity.put' && o.value.informationStatus === 'fact',
                )
              ? 'fact'
              : c.operations.some((o) => o.type === 'entity.put' && o.value.kind === 'plan')
                ? 'plan'
                : 'record',
        })),
      runtime: { sessionId: String(agent.id), status: agent.status },
    }
  }
}
