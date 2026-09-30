import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import {
  EntitySchema,
  KINDS,
  type ApiResult,
  type Commit,
  type Document,
  type Entity,
  type Finding,
  type Json,
  type Operation,
  type Relation,
  type Request,
  type Snapshot,
} from '../shared/contracts.ts'
import { StoryGraph, TextEditor, findPath } from './components.tsx'
import type { Lane, Visit } from '../domain/projections.ts'
import { cx } from './layout.ts'
import { mountStyles } from './styles.ts'
import {
  Feedback,
  Menu,
  FeedbackScope,
  TextDiff,
  Tag,
  Button,
  Select,
  SelectOption,
  Field,
  FilePicker,
  Panel,
  LoadingState,
  Input,
  EmptyState,
  Disclosure,
  Pill,
  NumberField,
  Checkbox,
  JsonView,
  ErrorState,
  Modal,
  SourceText,
  FormActions,
  TextArea,
} from './ui/index.tsx'
import { zh, type Key, type Translate } from './locales.ts'
import { CreativeWorkspace } from './CreativeWorkspace.tsx'
import type { WorkspaceProgress } from '../shared/progress.ts'
import { userError } from './errors.ts'
export type Api = (request: Request) => Promise<ApiResult>
class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly diagnostic: string,
  ) {
    super(userError(code))
  }
}
const uid = () => crypto.randomUUID()
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json
const tabs: Key[] = [
  'overview',
  'world',
  'structure',
  'manuscript',
  'timeline',
  'graph',
  'checks',
  'review',
  'history',
  'tasks',
]
const worldKinds = ['character', 'location', 'organization', 'item', 'setting', 'rule']
const fields: Partial<Record<Entity['kind'], [string, Key][]>> = {
  character: [
    ['goal', 'field_character_goal'],
    ['need', 'field_character_need'],
    ['motivation', 'field_character_motivation'],
    ['fear', 'field_character_fear'],
    ['boundary', 'field_character_boundary'],
    ['values', 'field_character_values'],
  ],
  event: [
    ['goal', 'field_event_goal'],
    ['action', 'field_event_action'],
    ['choice', 'field_event_choice'],
    ['consequence', 'field_event_consequence'],
  ],
  scene: [
    ['goal', 'field_scene_goal'],
    ['obstacle', 'field_scene_obstacle'],
    ['choice', 'field_scene_choice'],
    ['before', 'field_scene_before'],
    ['after', 'field_scene_after'],
    ['viewpoint', 'field_scene_viewpoint'],
  ],
  storyline: [
    ['question', 'field_storyline_question'],
    ['stakes', 'field_storyline_stakes'],
    ['resolution', 'field_storyline_resolution'],
  ],
  arc: [
    ['character', 'field_arc_character'],
    ['initialBelief', 'field_arc_initialBelief'],
    ['turningPoint', 'field_arc_turningPoint'],
    ['endingBelief', 'field_arc_endingBelief'],
  ],
  conflict: [
    ['goal', 'field_conflict_goal'],
    ['obstacle', 'field_conflict_obstacle'],
    ['cost', 'field_conflict_cost'],
  ],
  setting: [
    ['principle', 'field_setting_principle'],
    ['cost', 'field_setting_cost'],
    ['limits', 'field_setting_limits'],
    ['consequences', 'field_setting_consequences'],
  ],
  item: [
    ['power', 'field_item_power'],
    ['cost', 'field_item_cost'],
  ],
  foreshadow: [
    ['setup', 'field_foreshadow_setup'],
    ['payoff', 'field_foreshadow_payoff'],
  ],
  assertion: [
    ['subject', 'field_assertion_subject'],
    ['predicate', 'field_assertion_predicate'],
    ['value', 'field_assertion_value'],
  ],
  knowledge: [
    ['knower', 'field_knowledge_knower'],
    ['assertion', 'field_knowledge_assertion'],
    ['mode', 'field_knowledge_mode'],
  ],
  revelation: [
    ['assertion', 'field_revelation_assertion'],
    ['mode', 'field_revelation_mode'],
  ],
  rule: [
    ['evaluator', 'field_rule_evaluator'],
    ['strength', 'field_rule_strength'],
    ['targetKind', 'field_rule_targetKind'],
    ['field', 'field_rule_field'],
    ['value', 'field_rule_value'],
    ['relationKind', 'field_rule_relationKind'],
  ],
}
export function App({
  api,
  t = (k: Key) => zh[k],
  startConversation,
  subscribe,
}: {
  api: Api
  t?: Translate
  startConversation?: (text: string) => boolean | void
  subscribe?: (listener: () => void) => () => void
}) {
  useLayoutEffect(mountStyles, [])
  const [enabled, setEnabled] = useState(false)
  const [progress, setProgress] = useState<WorkspaceProgress>()
  const [moreOpen, setMoreOpen] = useState(false)
  const [diagnostic, setDiagnostic] = useState('')
  const [insertion, setInsertion] = useState('')
  const discuss = startConversation
    ? (text: string) => {
        if (startConversation(text) === false) setInsertion(text)
        else setInsertion('')
      }
    : undefined
  const [workspaceAvailable, setWorkspaceAvailable] = useState(true)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [tab, setTab] = useState<Key>('overview')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const [modal, setModal] = useState<
    | 'maintenance'
    | 'legacy'
    | 'entity'
    | 'import'
    | 'relation'
    | 'task'
    | 'grant'
    | 'source'
    | undefined
  >()
  const [selected, setSelected] = useState('')
  const [evidence, setEvidence] = useState<{
    document: Document
    start: number
    end: number
  }>()
  const [editEntity, setEditEntity] = useState<Entity>()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [history, setHistory] = useState<Commit[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [checkDetails, setCheckDetails] = useState<
    Record<
      string,
      {
        findings: Finding[]
        affected: string[]
      }
    >
  >({})
  const [ack, setAck] = useState(false)
  const [documentId, setDocumentId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docText, setDocText] = useState('')
  const [docEntity, setDocEntity] = useState('')
  const [graphMode, setGraphMode] = useState<Key>('relationship')
  const [graphFocus, setGraphFocus] = useState('')
  const [graphDepth, setGraphDepth] = useState(1)
  const [graphTime, setGraphTime] = useState('')
  const [graphData, setGraphData] = useState<{
    nodes: Entity[]
    edges: Relation[]
    total: number
    truncated: boolean
    visits?: Visit[]
    lanes?: Lane[]
    intersections?: string[]
  }>({ nodes: [], edges: [], total: 0, truncated: false })
  const [routeTo, setRouteTo] = useState('')
  const [route, setRoute] = useState<string[]>()
  const [grantTask, setGrantTask] = useState('')
  const [legacyNovels, setLegacyNovels] = useState<
    { id: string; name: string; revision: number; archived: boolean }[]
  >([])
  const apiRef = useRef(api)
  apiRef.current = api
  const [draftReady, setDraftReady] = useState(false)
  const draftApi = useRef<typeof api>()
  useEffect(() => {
    let live = true
    setDraftReady(false)
    if (!enabled)
      return () => {
        live = false
      }
    void api({ action: 'session.state', payload: {} })
      .then((result) => {
        if (!live || api !== apiRef.current) return
        if (!result.ok) throw new Error(result.error.message)
        if (result.ok) {
          const saved = result.value as {
            editor?: { documentId: string; title: string; text: string; entityId: string }
            tab?: Key
            graphFocus?: string
          }
          if (saved.editor) {
            setDocumentId(saved.editor.documentId)
            setDocTitle(saved.editor.title)
            setDocText(saved.editor.text)
            setDocEntity(saved.editor.entityId)
          }
          if (saved.tab && tabs.includes(saved.tab)) setTab(saved.tab)
          if (saved.graphFocus) setGraphFocus(saved.graphFocus)
        }
        draftApi.current = api
        setDraftReady(true)
      })
      .catch(() => {
        if (live) setNotice(t('workspaceDraftReadFailed'))
      })
    return () => {
      live = false
    }
  }, [api, enabled])
  useEffect(() => {
    if (!enabled || !draftReady || draftApi.current !== api) return
    const value = {
      editor: { documentId, title: docTitle, text: docText, entityId: docEntity },
      tab,
      graphFocus,
    }
    const save = () => {
      void api({ action: 'session.save', payload: { value } })
        .then((result) => {
          if (!result.ok) throw new Error(result.error.message)
        })
        .catch(() => {
          if (api === apiRef.current) setNotice(t('workspaceDraftSaveFailed'))
        })
    }
    const timer = setTimeout(save, 400)
    return () => {
      clearTimeout(timer)
      save()
    }
  }, [api, enabled, draftReady, documentId, docTitle, docText, docEntity, tab, graphFocus])
  async function call<T>(
    action: Request['action'],
    payload: Record<string, Json> = {},
  ): Promise<T> {
    const result = await api({ action, payload })
    if (!result.ok)
      throw new ApiFailure(
        result.error.code,
        `${result.error.code}: ${result.error.message}${result.error.details ? '\n' + JSON.stringify(result.error.details, null, 2) : ''}`,
      )
    return result.value as T
  }
  async function refresh() {
    let status: { enabled: boolean }
    try {
      status = await call<{ enabled: boolean }>('novel.status')
    } catch (failure) {
      if (api !== apiRef.current) return
      if (failure instanceof ApiFailure && failure.code === 'workspace-unavailable') {
        setWorkspaceAvailable(false)
        setEnabled(false)
        setSnapshot(undefined)
        setHistory([])
        setProgress(undefined)
        return
      }
      throw failure
    }
    if (api !== apiRef.current) return
    setWorkspaceAvailable(true)
    const nextProgress = await call<WorkspaceProgress>('workspace.progress')
    if (api !== apiRef.current) return
    setProgress(nextProgress)
    setEnabled(status.enabled)
    if (!status.enabled) {
      setSnapshot(undefined)
      setHistory([])
      return
    }
    const [nextSnapshot, nextHistory] = await Promise.all([
      call<Snapshot>('snapshot'),
      call<Commit[]>('history'),
    ])
    if (api !== apiRef.current) return
    setSnapshot(nextSnapshot)
    setHistory(nextHistory)
  }
  async function act(work: () => Promise<void>, success = true, background = false) {
    const owner = api
    if (!background) {
      setBusy(true)
      setDiagnostic('')
      setNotice('')
      setError(false)
    }
    try {
      await work()
      if (success && owner === apiRef.current) setNotice(t('success'))
    } catch (e) {
      if (owner !== apiRef.current) return
      setError(true)
      setDiagnostic(e instanceof ApiFailure ? e.diagnostic : String(e))
      setNotice(e instanceof ApiFailure ? e.message : userError('unknown'))
    } finally {
      if (!background && owner === apiRef.current) setBusy(false)
    }
  }
  function closeModal() {
    setModal(undefined)
    setNotice('')
    setError(false)
  }
  useEffect(() => {
    setProgress(undefined)
    setSnapshot(undefined)
    setHistory([])
    setSelected('')
    setEnabled(false)
    setTab('overview')
    setDocumentId('')
    setDocTitle('')
    setDocText('')
    setDocEntity('')
    setModal(undefined)
    setInsertion('')
    void act(() => refresh(), false)
  }, [api])
  useEffect(() => {
    let disposed = false,
      running = false,
      queued = false
    const update = async () => {
      queued = true
      if (running) return
      running = true
      try {
        while (queued && !disposed) {
          queued = false
          await act(() => refresh(), false, true)
        }
      } finally {
        running = false
      }
    }
    const unsubscribe = subscribe?.(() => {
      void update()
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [subscribe, api])
  useEffect(() => {
    if (enabled && tab === 'graph') void loadGraph()
  }, [enabled, tab, graphMode, graphFocus, graphDepth, graphTime, snapshot?.novel.revision])
  async function propose(operations: Operation[], summary: string) {
    await call('changes.propose', {
      baseRevision: snapshot!.novel.revision,
      summary,
      operations: json(operations),
    })
    await refresh()
    setModal(undefined)
    setTab('review')
  }
  function download(value: { name: string; text: string }) {
    const url = URL.createObjectURL(new Blob([value.text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = value.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 500)
  }
  const entity = snapshot?.entities.find((e) => e.id === selected)
  const visible =
    snapshot?.entities.filter(
      (e) =>
        (tab === 'world' ? worldKinds.includes(e.kind) : !worldKinds.includes(e.kind)) &&
        (!kind || e.kind === kind) &&
        `${e.name} ${e.summary} ${e.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? []
  const pending = snapshot?.changes.filter((c) => c.status === 'pending') ?? []
  function chooseDoc(doc: Document) {
    setDocumentId(doc.id)
    setDocTitle(doc.title)
    setDocText(doc.text)
    setDocEntity(doc.entityId ?? '')
  }
  async function loadGraph() {
    const modes: Partial<Record<Key, string[]>> = {
      relationship: ['related', 'conflicts_with', 'trusts', 'loves', 'allied_with', 'family'],
      participation: ['participates'],
      locations: ['located_at', 'participates'],
      organizations: ['member_of', 'part_of', 'allied_with'],
      causality: ['causes', 'before', 'advances'],
      movement: ['located_at', 'participates', 'before'],
      crossings: ['advances', 'part_of'],
    }
    try {
      const graph = await call<typeof graphData>('graph', {
        ...(graphFocus ? { focus: graphFocus } : {}),
        depth: graphDepth,
        kinds: modes[graphMode] ?? [],
        ...(graphTime === '' ? {} : { time: Number(graphTime) }),
      })
      if (api !== apiRef.current) return
      setGraphData(graph)
      setRoute(undefined)
    } catch (e) {
      if (api !== apiRef.current) return
      setError(true)
      setDiagnostic(e instanceof ApiFailure ? e.diagnostic : String(e))
      setNotice(e instanceof ApiFailure ? e.message : userError('unknown'))
    }
  }
  function openEntity(value?: Entity) {
    setEditEntity(value)
    setModal('entity')
  }
  const detail = (
    <aside className={cx('detail')}>
      {entity ? (
        <>
          <Tag>{t(entity.kind)}</Tag>
          <h2 className={cx('heading2')}>{entity.name}</h2>
          <p>{entity.summary}</p>
          <div className={cx('row')}>
            <Tag>{t(entity.informationStatus)}</Tag>
            {entity.stale && <Tag tone="danger">{t('stale')}</Tag>}
          </div>
          {startConversation && (
            <Button
              variant="ghost"
              onClick={() => discuss?.(t('workspaceDiscussEntity').replace('{name}', entity.name))}
            >
              和 Mythor 讨论修改
            </Button>
          )}
          <Disclosure title={t('workspaceStructuredEditing')}>
            <Button onClick={() => openEntity(entity)}>{t('edit')}</Button>
          </Disclosure>
          <Disclosure title={t('workspaceExploreAndEditDetails')}>
            {Object.entries(entity.attributes).map(([key, value]) => (
              <p key={key}>
                <b>
                  {fields[entity.kind]?.find((f) => f[0] === key)
                    ? t(fields[entity.kind]!.find((f) => f[0] === key)![1])
                    : key}
                </b>
                <br />
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </p>
            ))}
          </Disclosure>
          <h3 className={cx('heading3')}>{t('sources')}</h3>
          {entity.sources.map((s, i) => (
            <Button
              className={cx('source')}
              key={i}
              onClick={() =>
                void act(async () => {
                  const document = await call<Document>('document.read', {
                    revisionId: s.revisionId,
                  })
                  setEvidence({ document, start: s.start, end: s.end })
                  setModal('source')
                }, false)
              }
            >
              {s.documentId} · {s.start}–{s.end}
              {snapshot?.documents.find((d) => d.id === s.documentId)?.revisionId !== s.revisionId
                ? ` · ${t('stale')}`
                : ''}
            </Button>
          ))}
        </>
      ) : (
        <p className={cx('muted')}>{t('noSelection')}</p>
      )}
    </aside>
  )
  return (
    <FeedbackScope error={error ? notice : ''} details={diagnostic}>
      <div className={cx('mythor')}>
        <header className={cx('workspaceHeader')}>
          <nav className={cx('row')} aria-label={t('workspaceNovelWorkspace')}>
            {(
              [
                ['overview', t('workspaceCreate')],
                ['manuscript', t('workspaceProse')],
                ['world', t('workspaceStoryReference')],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                variant={
                  (
                    key === 'world'
                      ? ['world', 'structure', 'timeline', 'graph'].includes(tab)
                      : tab === key
                  )
                    ? 'primary'
                    : 'ghost'
                }
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => {
                  setTab(key)
                  setKind('')
                }}
              >
                {label}
              </Button>
            ))}
          </nav>
          <div className={cx('row')}>
            <span className={cx('muted small')}>
              {snapshot?.novel.title ?? t('workspaceAStoryIsTakingShape')}
            </span>
            <Button variant="ghost" onClick={() => setModal('import')}>
              {t('workspaceImportWritingMaterials')}
            </Button>
            <Menu
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              anchor={
                <Button
                  variant="ghost"
                  onClick={() => setMoreOpen(!moreOpen)}
                  aria-expanded={moreOpen}
                >
                  {t('workspaceMore')}
                </Button>
              }
              items={[
                { id: 'checks', label: t('workspaceCheckStoryContinuity'), disabled: !enabled },
                { id: 'review', label: t('workspaceViewPendingChanges'), disabled: !enabled },
                { id: 'tasks', label: t('workspaceViewWritingTasks'), disabled: !enabled },
                { id: 'history', label: t('workspaceViewChangeHistory'), disabled: !enabled },
                { id: 'maintenance', label: t('workspaceExportBackupsAndCompatibility') },
                { id: 'refresh', label: t('workspaceReload') },
              ]}
              onSelect={(id) => {
                setMoreOpen(false)
                if (id === 'maintenance') setModal('maintenance')
                else if (id === 'refresh') void act(() => refresh(), false)
                else setTab(id as Key)
              }}
            />
          </div>
        </header>
        {insertion && (
          <Panel>
            <p>{t('workspaceTheComposerCouldNotInsertThis')}</p>
            <SourceText>{insertion}</SourceText>
            <Button onClick={() => discuss?.(insertion)}>
              {t('workspaceTryInsertingBelowAgain')}
            </Button>
            <Button variant="ghost" onClick={() => setInsertion('')}>
              {t('workspaceClose')}
            </Button>
          </Panel>
        )}
        {notice && !modal && (
          <Feedback
            text={notice}
            details={diagnostic}
            retry={() => void act(() => refresh(), false)}
            error={error}
            onClose={() => setNotice('')}
            closeLabel={t('close')}
          />
        )}
        {!workspaceAvailable ? (
          <main className={cx('main onboarding')}>
            <EmptyState>
              请先在 Harness 中选择或创建一个工作区。Mythor 不会在工作区之外创建小说数据。
            </EmptyState>
          </main>
        ) : busy && !progress && !snapshot ? (
          <main className={cx('main')}>
            <LoadingState>{t('loading')}</LoadingState>
          </main>
        ) : !enabled ? (
          <main className={cx('main')}>
            {tab === 'overview' ? (
              <CreativeWorkspace t={t} progress={progress} navigate={setTab} discuss={discuss} />
            ) : (
              <EmptyState>{t('workspaceYourStoryWillTakeShapeThrough')}</EmptyState>
            )}
          </main>
        ) : (
          <div className={cx('layout')}>
            <main className={cx('main')}>
              {!snapshot ? (
                <LoadingState>{t('loading')}</LoadingState>
              ) : (
                <>
                  {tab === 'overview' && (
                    <CreativeWorkspace
                      t={t}
                      progress={progress}
                      snapshot={snapshot}
                      navigate={setTab}
                      discuss={discuss}
                    />
                  )}
                  {['world', 'structure', 'timeline', 'graph'].includes(tab) && (
                    <div className={cx('toolbar')}>
                      {(['world', 'structure', 'timeline', 'graph'] as const).map((key) => (
                        <Button
                          key={key}
                          variant={tab === key ? 'primary' : 'ghost'}
                          onClick={() => {
                            setTab(key)
                            setKind('')
                          }}
                        >
                          {key === 'world'
                            ? t('workspacePeopleAndWorld')
                            : key === 'structure'
                              ? t('workspaceStoryDevelopment')
                              : key === 'timeline'
                                ? t('workspaceSequenceOfEvents')
                                : t('workspaceConnections')}
                        </Button>
                      ))}
                    </div>
                  )}
                  {(tab === 'world' || tab === 'structure') && (
                    <>
                      <div className={cx('toolbar')}>
                        <Input
                          aria-label={t('search')}
                          placeholder={t('search')}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <Select
                          aria-label={t('kind')}
                          value={kind}
                          onValueChange={(e) => setKind(e)}
                        >
                          <SelectOption value="">{t('all')}</SelectOption>
                          {KINDS.filter((k) =>
                            tab === 'world' ? worldKinds.includes(k) : !worldKinds.includes(k),
                          ).map((k) => (
                            <SelectOption key={k} value={k}>
                              {t(k)}
                            </SelectOption>
                          ))}
                        </Select>
                        <Button onClick={() => openEntity()} variant="primary">
                          {t('add')}
                        </Button>
                      </div>
                      <div className={cx('grid')}>
                        <div className={cx('list')}>
                          {visible.length ? (
                            visible.map((e) => (
                              <Button
                                className={cx('item')}
                                key={e.id}
                                onClick={() => setSelected(e.id)}
                              >
                                <span>
                                  <b>{e.name}</b>
                                  <br />
                                  <span className={cx('muted small')}>
                                    {e.summary.slice(0, 90)}
                                  </span>
                                </span>
                                <Tag>
                                  {t(e.kind)}
                                  {e.stale ? ' !' : ''}
                                </Tag>
                              </Button>
                            ))
                          ) : (
                            <EmptyState>{t('empty')}</EmptyState>
                          )}
                        </div>
                        {detail}
                      </div>
                    </>
                  )}
                  {tab === 'manuscript' && (
                    <>
                      <div className={cx('toolbar')}>
                        <Select
                          aria-label={t('manuscript')}
                          value={documentId}
                          onValueChange={(e) => {
                            const d = snapshot.documents.find((d) => d.id === e)
                            if (d) chooseDoc(d)
                          }}
                        >
                          <SelectOption value="">{t('newDocument')}</SelectOption>
                          {snapshot.documents
                            .filter((d) => d.materialId !== d.id)
                            .map((d) => (
                              <SelectOption key={d.id} value={d.id}>
                                {d.title}
                              </SelectOption>
                            ))}
                        </Select>
                        <Button
                          onClick={() => {
                            setDocumentId('')
                            setDocTitle('')
                            setDocText('')
                            setDocEntity('')
                          }}
                        >
                          {t('newDocument')}
                        </Button>
                        <Button onClick={() => setModal('import')}>{t('import')}</Button>
                      </div>
                      <div className={cx('form-grid')}>
                        <Field>
                          {t('titleField')}
                          <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                        </Field>
                        <Field>
                          {t('scene')}
                          <Select value={docEntity} onValueChange={(e) => setDocEntity(e)}>
                            <SelectOption value="">—</SelectOption>
                            {snapshot.entities
                              .filter((e) => ['chapter', 'scene'].includes(e.kind))
                              .map((e) => (
                                <SelectOption key={e.id} value={e.id}>
                                  {e.name}
                                </SelectOption>
                              ))}
                          </Select>
                        </Field>
                      </div>
                      <TextEditor
                        key={`${snapshot.novel.id}:${documentId}`}
                        value={docText}
                        onChange={setDocText}
                      />
                      <div className={cx('toolbar spaced')}>
                        <Button
                          disabled={busy || !docTitle.trim()}
                          onClick={() =>
                            void act(async () => {
                              const old = snapshot.documents.find((d) => d.id === documentId)
                              await propose(
                                [
                                  {
                                    type: 'document.put',
                                    value: {
                                      id: documentId || uid(),
                                      revisionId: uid(),
                                      ...(old ? { parentRevisionId: old.revisionId } : {}),
                                      ...(docEntity ? { entityId: docEntity } : {}),
                                      title: docTitle,
                                      text: docText,
                                    },
                                  },
                                ],
                                `${t('revise')}：${docTitle}`,
                              )
                            })
                          }
                          variant="primary"
                        >
                          {t('saveDraft')}
                        </Button>
                        <span className={cx('muted')}>{docText.length} 字符</span>
                      </div>
                      <Disclosure title={t('revisionHistory')}>
                        {history
                          .filter((c) =>
                            c.operations.some(
                              (op) => op.type === 'document.put' && op.value.id === documentId,
                            ),
                          )
                          .map((c) => (
                            <p key={c.id}>
                              v{c.revision} · {c.summary} · {c.createdAt}
                            </p>
                          ))}
                      </Disclosure>
                    </>
                  )}
                  {tab === 'timeline' && (
                    <div className={cx('two')}>
                      <section>
                        <h2 className={cx('heading2')}>{t('worldTime')}</h2>
                        {snapshot.entities
                          .filter((e) => ['event', 'scene'].includes(e.kind))
                          .sort((a, b) => (a.time?.start ?? Infinity) - (b.time?.start ?? Infinity))
                          .map((e) => (
                            <div className={cx('timeline-item')} key={e.id}>
                              <span className={cx('muted small')}>
                                {e.time?.label ?? e.time?.start ?? t('unknownTime')}
                              </span>
                              <p>
                                <b>{e.name}</b>
                              </p>
                              <p>{e.summary}</p>
                            </div>
                          ))}
                      </section>
                      <section>
                        <h2 className={cx('heading2')}>{t('narrativeTime')}</h2>
                        {snapshot.entities
                          .filter((e) => ['chapter', 'scene', 'revelation'].includes(e.kind))
                          .sort(
                            (a, b) =>
                              (a.narrativeOrder ?? Infinity) - (b.narrativeOrder ?? Infinity),
                          )
                          .map((e) => (
                            <div className={cx('timeline-item')} key={e.id}>
                              <span className={cx('muted small')}>
                                {e.narrativeOrder ?? '—'} · {t(e.kind)}
                              </span>
                              <p>
                                <b>{e.name}</b>
                              </p>
                              <p>{e.summary}</p>
                            </div>
                          ))}
                      </section>
                    </div>
                  )}
                  {tab === 'graph' && (
                    <>
                      <div className={cx('toolbar')}>
                        {(
                          [
                            'relationship',
                            'participation',
                            'locations',
                            'organizations',
                            'causality',
                            'movement',
                            'crossings',
                          ] as Key[]
                        ).map((mode) => (
                          <Pill
                            key={mode}
                            onClick={() => setGraphMode(mode)}
                            active={mode === graphMode}
                          >
                            {t(mode)}
                          </Pill>
                        ))}
                      </div>
                      <div className={cx('toolbar')}>
                        <Select
                          aria-label={t('focus')}
                          value={graphFocus}
                          onValueChange={(e) => setGraphFocus(e)}
                        >
                          <SelectOption value="">{t('reset')}</SelectOption>
                          {snapshot.entities.map((e) => (
                            <SelectOption key={e.id} value={e.id}>
                              {e.name}
                            </SelectOption>
                          ))}
                        </Select>
                        <Field>
                          {t('depth')}{' '}
                          <Select
                            value={graphDepth}
                            onValueChange={(e) => setGraphDepth(Number(e))}
                          >
                            {[1, 2, 3, 4].map((n) => (
                              <SelectOption key={n} value={n}>
                                {n}
                              </SelectOption>
                            ))}
                          </Select>
                        </Field>
                        <Button onClick={() => setModal('relation')}>{t('addRelation')}</Button>
                        <NumberField
                          aria-label={t('start')}
                          placeholder={t('start')}
                          value={graphTime}
                          onChange={(e) => setGraphTime(e.target.value)}
                        />
                      </div>
                      <div className={cx('grid')}>
                        <div>
                          <StoryGraph
                            nodes={graphData.nodes}
                            edges={graphData.edges}
                            select={(id) => setSelected(id)}
                            focus={selected}
                            route={route}
                          />
                          <p className={cx('muted small')}>
                            {graphData.nodes.length} / {graphData.total} {t('objects')}
                            {graphData.truncated && ` · ${t('truncated')}`}
                          </p>
                          {graphMode === 'movement' && (
                            <section aria-label={t('movement')}>
                              <h3 className={cx('heading3')}>{t('movement')}</h3>
                              <p className={cx('muted small')}>{t('movementHint')}</p>
                              {graphData.visits?.map((visit, i) => (
                                <div
                                  className={cx('timeline-item')}
                                  key={`${visit.characterId}-${visit.eventId}-${visit.locationId}-${i}`}
                                >
                                  <b>
                                    {
                                      snapshot.entities.find((e) => e.id === visit.characterId)
                                        ?.name
                                    }
                                  </b>{' '}
                                  · {visit.time ?? t('unknownTime')} →{' '}
                                  <Button onClick={() => setSelected(visit.locationId)}>
                                    {snapshot.entities.find((e) => e.id === visit.locationId)?.name}
                                  </Button>
                                  <p>
                                    <Button size="sm" onClick={() => setSelected(visit.eventId)}>
                                      {snapshot.entities.find((e) => e.id === visit.eventId)?.name}
                                    </Button>
                                  </p>
                                </div>
                              ))}
                            </section>
                          )}
                          {graphMode === 'crossings' && (
                            <section aria-label={t('crossings')}>
                              {graphData.lanes?.map((lane) => (
                                <Panel key={lane.storylineId}>
                                  <h3 className={cx('heading3')}>
                                    {snapshot.entities.find((e) => e.id === lane.storylineId)?.name}
                                  </h3>
                                  <div className={cx('row')}>
                                    {lane.eventIds.map((id) => (
                                      <Button key={id} onClick={() => setSelected(id)}>
                                        {graphData.intersections?.includes(id) ? '↔ ' : ''}
                                        {snapshot.entities.find((e) => e.id === id)?.name}
                                      </Button>
                                    ))}
                                  </div>
                                </Panel>
                              ))}
                            </section>
                          )}
                          <div className={cx('toolbar')}>
                            <Select
                              value={routeTo}
                              aria-label={t('to')}
                              onValueChange={(e) => setRouteTo(e)}
                            >
                              <SelectOption value="">{t('to')}</SelectOption>
                              {graphData.nodes.map((e) => (
                                <SelectOption key={e.id} value={e.id}>
                                  {e.name}
                                </SelectOption>
                              ))}
                            </Select>
                            <Button
                              disabled={!selected || !routeTo}
                              onClick={() => {
                                const path = findPath(selected, routeTo, graphData.edges)
                                setRoute(path)
                                if (!path.length) setNotice(t('noRoute'))
                              }}
                            >
                              {t('route')}
                            </Button>
                          </div>
                          <Disclosure open title={t('listView')}>
                            {graphData.edges.map((r) => (
                              <p key={r.id}>
                                <Button size="sm" onClick={() => setSelected(r.from)}>
                                  {snapshot.entities.find((e) => e.id === r.from)?.name}
                                </Button>{' '}
                                → {r.kind} →{' '}
                                <Button size="sm" onClick={() => setSelected(r.to)}>
                                  {snapshot.entities.find((e) => e.id === r.to)?.name}
                                </Button>
                                <Button
                                  size="sm"
                                  aria-label={`${t('reject')} ${r.id}`}
                                  onClick={() =>
                                    void act(() =>
                                      propose(
                                        [{ type: 'relation.delete', id: r.id }],
                                        `移除关系 ${r.kind}`,
                                      ),
                                    )
                                  }
                                >
                                  ×
                                </Button>
                              </p>
                            ))}
                          </Disclosure>
                        </div>
                        {detail}
                      </div>
                    </>
                  )}
                  {tab === 'review' && (
                    <>
                      <h2 className={cx('heading2')}>{t('review')}</h2>
                      <Checkbox checked={ack} onChange={setAck} label={t('acknowledge')} />
                      <div className={cx('list')}>
                        {pending.length ? (
                          pending.map((c) => (
                            <Panel key={c.id}>
                              <h3 className={cx('heading3')}>{c.summary}</h3>
                              <p className={cx('muted small')}>
                                v{c.baseRevision} → · {c.operations.length} {t('differences')} ·{' '}
                                {c.createdAt}
                              </p>
                              <Disclosure title={t('compare')}>
                                {c.operations.map((op, index) => {
                                  const previous =
                                    op.type === 'seed.put'
                                      ? snapshot.novel.seed
                                      : op.type.startsWith('entity.')
                                        ? snapshot.entities.find(
                                            (e) => e.id === ('value' in op ? op.value.id : op.id),
                                          )
                                        : op.type.startsWith('relation.')
                                          ? snapshot.relations.find(
                                              (e) => e.id === ('value' in op ? op.value.id : op.id),
                                            )
                                          : op.type.startsWith('document.')
                                            ? snapshot.documents.find(
                                                (e) =>
                                                  e.id === ('value' in op ? op.value.id : op.id),
                                              )
                                            : undefined
                                  return (
                                    <div key={index}>
                                      <b>{op.type}</b>
                                      {op.type.startsWith('document.') &&
                                      'value' in op &&
                                      'text' in op.value ? (
                                        <TextDiff
                                          before={
                                            previous && 'text' in previous ? previous.text : null
                                          }
                                          after={op.value.text}
                                          title={'title' in op.value ? op.value.title : op.type}
                                          t={t}
                                        />
                                      ) : (
                                        <div className={cx('two')}>
                                          <div>
                                            {t('old')}
                                            <JsonView
                                              data={previous ? previous : '—'}
                                              label={t('details')}
                                              t={t}
                                            />
                                          </div>
                                          <div>
                                            {t('next')}
                                            <JsonView
                                              data={'value' in op ? op.value : '—'}
                                              label={t('details')}
                                              t={t}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </Disclosure>
                              {checkDetails[c.id] && (
                                <>
                                  <FindingList findings={checkDetails[c.id].findings} />
                                  <p className={cx('small')}>
                                    {t('affected')}：
                                    {checkDetails[c.id].affected
                                      .map(
                                        (id) =>
                                          snapshot.entities.find((e) => e.id === id)?.name ?? id,
                                      )
                                      .join('、')}
                                  </p>
                                </>
                              )}
                              <div className={cx('row')}>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      const result = await call<{
                                        findings: Finding[]
                                        affected: string[]
                                      }>('changes.validate', { id: c.id })
                                      setCheckDetails((d) => ({
                                        ...d,
                                        [c.id]: result,
                                      }))
                                      await refresh()
                                    }, false)
                                  }
                                >
                                  {t('validate')}
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      await call('changes.commit', {
                                        id: c.id,
                                        idempotencyKey: `ui_${c.id}`,
                                        acknowledgeWarnings: ack,
                                      })
                                      await refresh()
                                      setAck(false)
                                    })
                                  }
                                  variant="primary"
                                >
                                  {t('commit')}
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      await call('changes.reject', { id: c.id })
                                      await refresh()
                                    })
                                  }
                                >
                                  {t('reject')}
                                </Button>
                              </div>
                            </Panel>
                          ))
                        ) : (
                          <EmptyState>{t('empty')}</EmptyState>
                        )}
                      </div>
                    </>
                  )}
                  {tab === 'checks' && (
                    <>
                      <h2 className={cx('heading2')}>{t('checks')}</h2>
                      <Button
                        onClick={() =>
                          void act(async () => {
                            const result = await call<{
                              findings: Finding[]
                            }>('world.validate')
                            setFindings(result.findings)
                            if (!result.findings.length) setNotice(t('noIssues'))
                          }, false)
                        }
                      >
                        {t('runChecks')}
                      </Button>
                      <FindingList findings={findings} />
                    </>
                  )}
                  {tab === 'history' && (
                    <>
                      <h2 className={cx('heading2')}>{t('history')}</h2>
                      <div className={cx('list')}>
                        {history.map((c) => (
                          <Panel key={c.id}>
                            <h3 className={cx('heading3')}>
                              v{c.revision} · {c.summary}
                            </h3>
                            <p className={cx('muted small')}>
                              {c.actor} · {c.createdAt}
                            </p>
                            <Disclosure title={t('differences')}>
                              <JsonView data={c.operations} label={t('details')} t={t} />
                            </Disclosure>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await call('history.undo', { id: c.id })
                                  await refresh()
                                  setTab('review')
                                })
                              }
                            >
                              {t('undo')}
                            </Button>
                          </Panel>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === 'tasks' && (
                    <>
                      <div className={cx('toolbar')}>
                        <h2 className={cx('heading2')}>{t('tasks')}</h2>
                        <Button onClick={() => setModal('task')} variant="primary">
                          {t('newTask')}
                        </Button>
                      </div>
                      <p className={cx('muted')}>{t('taskInstructions')}</p>
                      <div className={cx('list')}>
                        {snapshot.tasks.map((task) => (
                          <Panel key={task.id}>
                            <div className={cx('row')}>
                              <h3 className={cx('heading3')}>{task.intent}</h3>
                              <Tag>
                                {task.stage} / {task.status}
                              </Tag>
                            </div>
                            <p className={cx('small muted')}>
                              ID {task.id} · v{task.baseRevision}
                            </p>
                            {task.error && <ErrorState>{task.error}</ErrorState>}
                            <Disclosure title={t('details')}>
                              <JsonView data={task.artifacts} label={t('details')} t={t} />
                            </Disclosure>
                            <div className={cx('row')}>
                              <Button
                                disabled={busy || task.status === 'completed'}
                                onClick={() =>
                                  void act(async () => {
                                    try {
                                      await call('task.resume', { id: task.id })
                                    } finally {
                                      await refresh()
                                    }
                                  })
                                }
                              >
                                {t('resume')}
                              </Button>
                              <Button
                                disabled={busy || task.status === 'completed'}
                                onClick={() =>
                                  void act(async () => {
                                    await call('task.cancel', { id: task.id })
                                    await refresh()
                                  })
                                }
                              >
                                {t('cancel')}
                              </Button>
                              <Button
                                disabled={['completed', 'cancelled'].includes(task.status)}
                                onClick={() => {
                                  setGrantTask(task.id)
                                  setModal('grant')
                                }}
                              >
                                {t('grant')}
                              </Button>
                              {['plan', 'check'].includes(task.kind) &&
                                task.status === 'waiting_review' && (
                                  <Button
                                    disabled={busy}
                                    onClick={() =>
                                      void act(async () => {
                                        await call('task.finish', { id: task.id })
                                        await refresh()
                                      })
                                    }
                                  >
                                    {t('finishTask')}
                                  </Button>
                                )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </main>
          </div>
        )}
        {modal === 'maintenance' && (
          <Modal
            title={t('workspaceExportBackupsAndCompatibility')}
            close={closeModal}
            closeLabel={t('close')}
          >
            <div className={cx('list')}>
              {enabled && (
                <div className={cx('row')}>
                  <Button onClick={() => void act(async () => download(await call('export')))}>
                    导出作品
                  </Button>
                  <Button onClick={() => void act(async () => download(await call('backup')))}>
                    保存完整备份
                  </Button>
                  <Button
                    onClick={() =>
                      void act(async () => {
                        await call('novel.update', {
                          status: snapshot?.novel.status === 'active' ? 'paused' : 'active',
                        })
                        await refresh()
                      })
                    }
                  >
                    {snapshot?.novel.status === 'active'
                      ? t('workspacePauseWriting')
                      : t('workspaceContinueWriting')}
                  </Button>
                </div>
              )}
              <Button
                disabled={enabled}
                onClick={() =>
                  void act(async () => {
                    setLegacyNovels(await call('legacy.list'))
                    setModal('legacy')
                  }, false)
                }
              >
                {t('workspaceImportALegacyMythorNovel')}
              </Button>
              <FilePicker
                disabled={busy || enabled}
                accept=".json"
                label={t('workspaceRestoreBackup')}
                onFileSelect={(file) => {
                  if (file)
                    void act(async () => {
                      await call('restore', { text: await file.text() })
                      await refresh()
                      closeModal()
                    })
                }}
              />
              <p className={cx('muted small')}>{t('workspaceMigrateOnlyEmpty')}</p>
            </div>
          </Modal>
        )}
        {modal === 'legacy' && (
          <Modal
            title={t('workspaceImportALegacyMythorNovel')}
            close={closeModal}
            closeLabel={t('close')}
          >
            {legacyNovels.length === 0 ? (
              <EmptyState>{t('workspaceNoLegacy')}</EmptyState>
            ) : (
              <div className={cx('list')}>
                {legacyNovels.map((legacy) => (
                  <Panel key={legacy.id}>
                    <strong>{legacy.name}</strong>
                    <p className={cx('muted small')}>v{legacy.revision}</p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await call('legacy.migrate', { legacyId: legacy.id })
                          setModal(undefined)
                          await refresh()
                        })
                      }
                    >
                      迁入当前 Harness 项目
                    </Button>
                  </Panel>
                ))}
              </div>
            )}
          </Modal>
        )}
        {modal === 'source' && evidence && (
          <Modal
            title={`${t('sources')} · ${evidence.document.title}`}
            close={() => setModal(undefined)}
            closeLabel={t('close')}
          >
            <p className={cx('small muted')}>
              {evidence.document.revisionId} · {evidence.start}–{evidence.end}
            </p>
            <SourceText>
              {evidence.document.text.slice(0, evidence.start)}
              <mark>{evidence.document.text.slice(evidence.start, evidence.end)}</mark>
              {evidence.document.text.slice(evidence.end)}
            </SourceText>
            <Button onClick={() => setModal(undefined)}>{t('close')}</Button>
          </Modal>
        )}
        {modal === 'entity' && (
          <EntityEditor
            entity={editEntity}
            close={() => setModal(undefined)}
            busy={busy}
            t={t}
            save={(value) =>
              act(() =>
                propose(
                  [{ type: 'entity.put', value }],
                  `${editEntity ? t('edit') : t('add')}：${value.name}`,
                ),
              )
            }
          />
        )}
        {modal === 'import' && (
          <ImportForm
            t={t}
            close={() => setModal(undefined)}
            busy={busy}
            preview={async (p) => {
              if (!enabled) await call('novel.enable', { title: '未命名作品' })
              return call('import', { ...p, preview: true })
            }}
            save={(p) =>
              act(async () => {
                if (!enabled) await call('novel.enable', { title: '未命名作品' })
                await call('import', p)
                await refresh()
                setModal(undefined)
                setTab('review')
              })
            }
          />
        )}
        {modal === 'relation' && (
          <RelationForm
            t={t}
            entities={snapshot?.entities ?? []}
            close={() => setModal(undefined)}
            busy={busy}
            save={(r) =>
              act(() =>
                propose([{ type: 'relation.put', value: r }], `${t('addRelation')}：${r.kind}`),
              )
            }
          />
        )}
        {modal === 'task' && (
          <TaskForm
            t={t}
            close={() => setModal(undefined)}
            busy={busy}
            save={(p) =>
              act(async () => {
                try {
                  await call('task.start', p)
                } finally {
                  await refresh()
                  setModal(undefined)
                  setTab('tasks')
                }
              })
            }
          />
        )}
        {modal === 'grant' && (
          <SimpleForm
            title={t('grant')}
            fields={[['ids', t('grantHint')]]}
            t={t}
            close={() => setModal(undefined)}
            busy={busy}
            submit={(values) =>
              act(async () => {
                await call('grant', {
                  taskId: grantTask,
                  entityIds: values.ids
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  expiresAt: new Date(Date.now() + 86400000).toISOString(),
                })
                setModal(undefined)
                await refresh()
              })
            }
          />
        )}
      </div>
    </FeedbackScope>
  )
}
function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div className={cx('list findings')}>
      {findings.map((f, i) => (
        <Panel key={i}>
          <Tag tone={f.severity === 'error' ? 'danger' : 'warning'}>{f.severity}</Tag> {f.message}
          <div className={cx('small muted')}>
            {f.code} · {f.entityIds.join(', ')}
          </div>
          {f.suggestion && <p>{f.suggestion}</p>}
        </Panel>
      ))}
    </div>
  )
}
function SimpleForm({
  title,
  fields,
  submit,
  close,
  busy,
  t,
}: {
  title: string
  fields: [string, string][]
  submit: (values: Record<string, string>) => Promise<void>
  close: () => void
  busy: boolean
  t: Translate
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <Modal title={title} close={close} closeLabel={t('close')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(values)
        }}
      >
        {fields.map(([key, label]) => (
          <Field key={key}>
            {label}
            <Input
              data-modal-autofocus
              required
              className={cx('fullWidth')}
              value={values[key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          </Field>
        ))}
        <FormActions>
          <Button type="button" onClick={close}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} variant="primary" type="submit">
            {t('save')}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}
function EntityEditor({
  entity,
  save,
  close,
  busy,
  t,
}: {
  entity?: Entity
  save: (value: Entity) => Promise<void>
  close: () => void
  busy: boolean
  t: Translate
}) {
  const [value, setValue] = useState<Entity>(
    () =>
      entity ?? {
        ...EntitySchema.parse({ id: uid(), kind: 'character', name: '新人物' }),
        name: '',
      },
  )
  const [localError, setLocalError] = useState('')
  const update = (changes: Partial<Entity>) => setValue((v) => ({ ...v, ...changes }))
  return (
    <Modal title={entity ? t('edit') : t('add')} close={close} closeLabel={t('close')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const parsed = EntitySchema.safeParse(value)
          if (!parsed.success) {
            setLocalError(parsed.error.message)
            return
          }
          void save(parsed.data)
        }}
      >
        <div className={cx('form-grid')}>
          <Field>
            {t('name')}
            <Input
              data-modal-autofocus
              required
              value={value.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </Field>
          <Field>
            {t('kind')}
            <Select value={value.kind} onValueChange={(e) => update({ kind: e as Entity['kind'] })}>
              {KINDS.map((k) => (
                <SelectOption key={k} value={k}>
                  {t(k)}
                </SelectOption>
              ))}
            </Select>
          </Field>
        </div>
        <Field>
          {t('summary')}
          <TextArea value={value.summary} onChange={(e) => update({ summary: e.target.value })} />
        </Field>
        <Field>
          {t('aliases')}
          <Input
            className={cx('fullWidth')}
            value={value.aliases.join(', ')}
            onChange={(e) =>
              update({
                aliases: e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <div className={cx('form-grid')}>
          <Field>
            {t('info')}
            <Select
              value={value.informationStatus}
              onValueChange={(e) =>
                update({
                  informationStatus: e as Entity['informationStatus'],
                })
              }
            >
              {(['fact', 'plan', 'hypothesis'] as const).map((k) => (
                <SelectOption key={k} value={k}>
                  {t(k)}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Field>
            {t('order')}
            <NumberField
              value={value.narrativeOrder ?? ''}
              onChange={(e) =>
                update({
                  narrativeOrder: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </Field>
          <Field>
            {t('start')}
            <NumberField
              value={value.time?.start ?? ''}
              onChange={(e) =>
                update({
                  time: {
                    ...value.time,
                    start: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field>
            {t('end')}
            <NumberField
              value={value.time?.end ?? ''}
              onChange={(e) =>
                update({
                  time: {
                    ...value.time,
                    end: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
        <h3 className={cx('heading3 spaced')}>{t('attrs')}</h3>
        {fields[value.kind]?.map(([key, label]) => (
          <Field key={key}>
            {t(label)}
            <Input
              className={cx('fullWidth')}
              value={String(value.attributes[key] ?? '')}
              onChange={(e) =>
                update({
                  attributes: { ...value.attributes, [key]: e.target.value },
                })
              }
            />
          </Field>
        ))}
        {localError && <ErrorState>{localError}</ErrorState>}
        <FormActions>
          <Button type="button" onClick={close}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} variant="primary" type="submit">
            {t('save')}
          </Button>
        </FormActions>
      </form>
    </Modal>
  )
}
function ImportForm({
  t,
  close,
  busy,
  preview,
  save,
}: {
  t: Translate
  close: () => void
  busy: boolean
  preview: (p: Record<string, Json>) => Promise<Json>
  save: (p: Record<string, Json>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [materialKind, setMaterialKind] = useState('manuscript')
  const [result, setResult] = useState<Json>()
  const [error, setError] = useState('')
  return (
    <Modal title={t('import')} close={close} closeLabel={t('close')}>
      <Field>
        {t('importTitle')}
        <Input data-modal-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field>
        {t('importFile')}
        <FilePicker
          disabled={busy}
          accept=".md,.txt,text/plain,text/markdown"
          onFileSelect={(e) => {
            const file = e
            if (file) {
              setTitle(file.name.replace(/\.[^.]+$/, ''))
              return file
                .text()
                .then(setText)
                .catch((failure: unknown) => setError(String(failure)))
            }
          }}
          label={t('chooseFile')}
        />
      </Field>
      <Field>
        {t('importText')}
        <TextArea
          className={cx('importText')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Field>
        材料类型
        <Select value={materialKind} onValueChange={setMaterialKind}>
          <SelectOption value="manuscript">正文或章节</SelectOption>
          <SelectOption value="outline">大纲</SelectOption>
          <SelectOption value="characters">人物设定</SelectOption>
          <SelectOption value="world">世界观</SelectOption>
          <SelectOption value="notes">笔记</SelectOption>
        </Select>
      </Field>
      {result && <JsonView data={result} label={t('details')} t={t} />}
      {error && <ErrorState>{error}</ErrorState>}
      <FormActions>
        <Button onClick={close}>{t('cancel')}</Button>
        <Button
          disabled={busy || !title || !text}
          onClick={() =>
            void preview({ title, text, materialKind })
              .then(setResult)
              .catch((e) => setError(String(e)))
          }
        >
          {t('preview')}
        </Button>
        <Button
          disabled={busy || !title || !text}
          onClick={() => void save({ title, text, materialKind })}
          variant="primary"
        >
          {t('import')}
        </Button>
      </FormActions>
    </Modal>
  )
}
function RelationForm({
  t,
  close,
  busy,
  entities,
  save,
}: {
  t: Translate
  close: () => void
  busy: boolean
  entities: Entity[]
  save: (r: Relation) => Promise<void>
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('related')
  const [summary, setSummary] = useState('')
  return (
    <Modal title={t('addRelation')} close={close} closeLabel={t('close')}>
      <div className={cx('form-grid')}>
        {[
          [t('from'), from, setFrom],
          [t('to'), to, setTo],
        ].map(([label, value, setter], i) => (
          <Field key={i}>
            {label as string}
            <Select
              value={value as string}
              onValueChange={(e) => (setter as (v: string) => void)(e)}
            >
              <SelectOption value="">—</SelectOption>
              {entities.map((e) => (
                <SelectOption key={e.id} value={e.id}>
                  {e.name}
                </SelectOption>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <Field>
        {t('relationKind')}
        <Select data-modal-autofocus value={kind} onValueChange={(e) => setKind(e)}>
          {[
            'related',
            'participates',
            'located_at',
            'member_of',
            'owns',
            'causes',
            'before',
            'part_of',
            'advances',
            'knows',
            'reveals',
            'foreshadows',
            'conflicts_with',
            'trusts',
            'loves',
          ].map((k) => (
            <SelectOption key={k} value={k}>
              {k}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <Field>
        {t('summary')}
        <TextArea value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <FormActions>
        <Button onClick={close}>{t('cancel')}</Button>
        <Button
          disabled={busy || !from || !to}
          onClick={() =>
            void save({
              id: uid(),
              from,
              to,
              kind,
              summary,
              sources: [],
              revision: 0,
            })
          }
          variant="primary"
        >
          {t('save')}
        </Button>
      </FormActions>
    </Modal>
  )
}
function TaskForm({
  t,
  close,
  busy,
  save,
}: {
  t: Translate
  close: () => void
  busy: boolean
  save: (p: Record<string, Json>) => Promise<void>
}) {
  const [kind, setKind] = useState('write')
  const [intent, setIntent] = useState('')
  return (
    <Modal title={t('newTask')} close={close} closeLabel={t('close')}>
      <Field>
        {t('taskKind')}
        <Select value={kind} onValueChange={(e) => setKind(e)}>
          {(['plan', 'write', 'revise', 'check'] as const).map((k) => (
            <SelectOption key={k} value={k}>
              {t(k)}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <Field>
        {t('intent')}
        <TextArea value={intent} onChange={(e) => setIntent(e.target.value)} />
      </Field>
      <p className={cx('muted small')}>{t('taskInstructions')}</p>
      <FormActions>
        <Button onClick={close}>{t('cancel')}</Button>
        <Button
          disabled={busy || !intent.trim()}
          onClick={() => void save({ kind, intent })}
          variant="primary"
        >
          {t('newTask')}
        </Button>
      </FormActions>
    </Modal>
  )
}
