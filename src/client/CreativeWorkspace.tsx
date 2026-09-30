import type { WorkspaceProgress } from '../shared/progress.ts'
import type { Snapshot } from '../shared/contracts.ts'
import { Button, Panel, Tag, Disclosure } from './ui/index.tsx'
import { zh, type Key, type Translate } from './locales.ts'
import { cx } from './layout.ts'

const nature: Record<string, Key> = {
  expression: 'workspaceYourIdea',
  preference: 'workspaceYourPreference',
  interpretation: 'workspaceCurrentUnderstanding',
  proposal: 'workspaceSuggestion',
  hypothesis: 'workspaceUnconfirmed',
  question: 'workspaceToDiscuss',
  decision: 'workspaceDecisionMade',
}
const stages: Record<string, Key> = {
  read: 'workspaceUnderstandingTheStory',
  goals: 'workspaceClarifyingThisWritingGoal',
  plan: 'workspacePlanningWhatHappensNext',
  simulate: 'workspaceConsideringConsequences',
  write: 'workspaceWritingProse',
  extract: 'workspaceRecordingStoryChanges',
  validate: 'workspaceCheckingContinuity',
  review: 'workspaceWaitingForYourInput',
  commit: 'workspaceSaved',
}
export function CreativeWorkspace({
  progress,
  snapshot,
  navigate,
  discuss,
  t = (key: Key) => zh[key],
}: {
  t?: Translate
  progress?: WorkspaceProgress
  snapshot?: Snapshot
  navigate: (view: 'review' | 'tasks' | 'history' | 'manuscript') => void
  discuss?: (text: string) => void
}) {
  const records = progress?.records.filter((r) => r.status === 'open') ?? []
  const questions = records.filter((r) => r.kind === 'question')
  const working =
    progress?.tasks.filter((t) => !['completed', 'cancelled'].includes(t.status)) ?? []
  const empty = !progress?.enabled && !records.length
  return (
    <div className={cx('creativeGrid')}>
      <section className={cx('list')} aria-label={t('workspaceCreativeProgress')}>
        <Panel>
          <h2 className={cx('heading2')}>
            {empty
              ? t('workspaceTellMeTheStoryYouHave')
              : working.length
                ? t('workspaceTheStoryWeAreDeveloping')
                : t('workspaceLetSDevelopThisStoryTogether')}
          </h2>
          {empty ? (
            <>
              <p>{t('workspaceYouDoNotNeedAComplete')}</p>
              <p className={cx('muted')}>{t('workspaceShareYourIdeaBelowMythorWill')}</p>
              {discuss && (
                <div className={cx('row')}>
                  {[t('workspaceIHaveAnImageInMind'), t('workspaceIWantToWriteAboutSomeone')].map(
                    (text) => (
                      <Button key={text} variant="ghost" onClick={() => discuss(text)}>
                        {text}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {working.length ? (
                working.slice(0, 3).map((task) => (
                  <div key={task.id}>
                    <strong>{task.intent}</strong>
                    <p className={cx('muted')}>
                      {task.status === 'failed'
                        ? t('workspaceThisWorkIsPausedCompletedWork')
                        : task.status === 'pending'
                          ? t('workspaceWaitingToContinue')
                          : task.status === 'waiting_review'
                            ? t('workspaceSomethingNeedsYourInput')
                            : ((stages[task.stage] ? t(stages[task.stage]) : undefined) ??
                              t('workspaceWorking'))}
                    </p>
                    <Button variant="ghost" onClick={() => navigate('tasks')}>
                      {t('workspaceViewThisWork')}
                    </Button>
                  </div>
                ))
              ) : (
                <p>{t('workspaceAddAnIdeaTellMeWhat')}</p>
              )}
              {progress?.plans
                .filter((p) => p.attributes.status === 'active')
                .slice(-2)
                .map((plan) => (
                  <p key={plan.id}>
                    <strong>{t('workspaceNext')}</strong>
                    {String(plan.attributes.goal ?? plan.name)}
                  </p>
                ))}
              <p className={cx('muted small')}>
                {t('workspaceContinueBelowAllConversationsInThis')}
              </p>
            </>
          )}
        </Panel>
        <Panel>
          <h3 className={cx('heading3')}>{t('workspaceMythorSCurrentUnderstanding')}</h3>
          {records
            .filter((r) => !['question', 'decision'].includes(r.kind))
            .slice(-8)
            .map((r) => (
              <div key={r.id}>
                <Tag>{t(nature[r.kind])}</Tag>
                <p>{r.text}</p>
                <Disclosure title={t('workspaceViewTheSourceExpression')}>
                  {r.sources.map((s, i) => (
                    <p key={i}>{s.quote}</p>
                  ))}
                </Disclosure>
              </div>
            ))}
          {snapshot?.entities
            .filter(
              (e) => e.informationStatus === 'fact' && e.editorialStatus === 'accepted' && !e.stale,
            )
            .slice(-4)
            .map((e) => (
              <p key={e.id}>
                <Tag>{t('workspaceConfirmedStoryInformation')}</Tag> {e.name}：{e.summary}
              </p>
            ))}
          {!records.length && !snapshot?.entities.length && (
            <p className={cx('muted')}>{t('workspaceYourIdeasAndAgreedDirectionsWill')}</p>
          )}
          {!!progress?.unavailableSessions?.length && (
            <p className={cx('muted')}>{t('workspaceSomePastDiscussionsMissing')}</p>
          )}
          {progress?.truncated && (
            <p className={cx('muted')}>{t('workspaceRecentIdeasAreShownHereFull')}</p>
          )}
        </Panel>
        {!!progress?.recent.length && (
          <Panel>
            <h3 className={cx('heading3')}>{t('workspaceRecentStoryProgress')}</h3>
            {progress.recent.map((item) => (
              <p key={item.id}>
                <Tag>
                  {item.kind === 'fact'
                    ? t('workspaceConfirmed')
                    : item.kind === 'prose'
                      ? t('workspaceProse')
                      : item.kind === 'plan'
                        ? t('workspaceUpcomingPlans')
                        : t('workspaceCreativeRecord')}
                </Tag>{' '}
                {item.text}
              </p>
            ))}
            <Button variant="ghost" onClick={() => navigate('history')}>
              {t('workspaceViewChangeHistory')}
            </Button>
          </Panel>
        )}
      </section>
      <aside className={cx('list')} aria-label={t('workspaceYourInput')}>
        {!!questions.length && (
          <Panel>
            <h3 className={cx('heading3')}>{t('workspaceLetSDiscussNext')}</h3>
            {questions.slice(-2).map((q) => (
              <div key={q.id}>
                <p>{q.text}</p>
                {discuss && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      discuss(t('workspaceQuestionReply').replace('{question}', q.text))
                    }
                  >
                    {t('workspaceDiscussBelow')}
                  </Button>
                )}
              </div>
            ))}
          </Panel>
        )}
        {!!progress?.decisions.length && (
          <Panel>
            <h3 className={cx('heading3')}>{t('workspaceYourDecisionIsNeeded')}</h3>
            {progress.decisions.slice(0, 3).map((d, i) => (
              <p key={`${d.id}:${i}`}>{d.text}</p>
            ))}
            <Button onClick={() => navigate('review')}>{t('workspaceReviewTheOptions')}</Button>
          </Panel>
        )}
        {!!progress?.pending.length && (
          <Panel>
            <h3 className={cx('heading3')}>{t('workspaceChangesToLookOver')}</h3>
            <p>
              {t('workspacePendingChanges').replace('{count}', String(progress.pending.length))}
            </p>
            <Button variant="ghost" onClick={() => navigate('review')}>
              {t('workspaceViewChangesAndEvidence')}
            </Button>
          </Panel>
        )}
      </aside>
    </div>
  )
}
