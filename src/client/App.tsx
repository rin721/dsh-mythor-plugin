import { useEffect, useRef, useState } from 'react'
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
  type Project,
  type Relation,
  type Request,
  type Snapshot,
} from '../shared/contracts.ts'
import { Modal, StoryGraph, TextEditor, findPath } from './components.tsx'
import type { Lane, Visit } from '../domain/projections.ts'
import { style } from './style.ts'
import { zh, type Key, type Translate } from './locales.ts'

export type Api = (request: Request) => Promise<ApiResult>
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

export function App({ api, t = (k: Key) => zh[k] }: { api: Api; t?: Translate }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const currentProject = useRef(projectId)
  currentProject.current = projectId
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [tab, setTab] = useState<Key>('overview')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const [modal, setModal] = useState<
    | 'project'
    | 'entity'
    | 'import'
    | 'relation'
    | 'task'
    | 'grant'
    | 'binding'
    | 'source'
    | undefined
  >()
  const [selected, setSelected] = useState('')
  const [evidence, setEvidence] = useState<{ document: Document; start: number; end: number }>()
  const [editEntity, setEditEntity] = useState<Entity>()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [history, setHistory] = useState<Commit[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [checkDetails, setCheckDetails] = useState<
    Record<string, { findings: Finding[]; affected: string[] }>
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
  async function call<T>(
    action: Request['action'],
    payload: Record<string, Json> = {},
    id = projectId,
  ): Promise<T> {
    const result = await api({
      action,
      ...(id ? { projectId: id } : {}),
      payload,
    })
    if (!result.ok)
      throw new Error(
        `${result.error.code}: ${result.error.message}${result.error.details ? '\n' + JSON.stringify(result.error.details, null, 2) : ''}`,
      )
    return result.value as T
  }
  async function refresh(id = projectId) {
    setProjects(await call<Project[]>('project.list', {}, ''))
    if (id) {
      const [nextSnapshot, nextHistory] = await Promise.all([
        call<Snapshot>('snapshot', {}, id),
        call<Commit[]>('history', {}, id),
      ])
      if (currentProject.current === id) {
        setSnapshot(nextSnapshot)
        setHistory(nextHistory)
      }
    }
  }
  async function act(work: () => Promise<void>, success = true) {
    setBusy(true)
    setNotice('')
    setError(false)
    try {
      await work()
      if (success) setNotice(t('success'))
    } catch (e) {
      setError(true)
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void act(() => refresh(), false)
  }, [])
  useEffect(() => {
    if (projectId) {
      setSnapshot(undefined)
      setSelected('')
      setDocumentId('')
      setDocTitle('')
      setDocText('')
      setDocEntity('')
      setGraphFocus('')
      setGraphTime('')
      setRouteTo('')
      setRoute(undefined)
      setHistory([])
      setModal(undefined)
      setCheckDetails({})
      setFindings([])
      void act(() => refresh(projectId), false)
    }
  }, [projectId])
  useEffect(() => {
    if (projectId && tab === 'graph') void loadGraph()
  }, [projectId, tab, graphMode, graphFocus, graphDepth, graphTime, snapshot?.project.revision])
  async function propose(operations: Operation[], summary: string) {
    await call('changes.propose', {
      baseRevision: snapshot!.project.revision,
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
      setGraphData(
        await call('graph', {
          ...(graphFocus ? { focus: graphFocus } : {}),
          depth: graphDepth,
          kinds: modes[graphMode] ?? [],
          ...(graphTime === '' ? {} : { time: Number(graphTime) }),
        }),
      )
      setRoute(undefined)
    } catch (e) {
      setError(true)
      setNotice(String(e))
    }
  }
  function openEntity(value?: Entity) {
    setEditEntity(value)
    setModal('entity')
  }
  const detail = (
    <aside className="detail">
      {entity ? (
        <>
          <span className="badge">{t(entity.kind)}</span>
          <h2>{entity.name}</h2>
          <p>{entity.summary}</p>
          <div className="row">
            <span className="badge">{t(entity.informationStatus)}</span>
            {entity.stale && <span className="badge danger">{t('stale')}</span>}
          </div>
          <button onClick={() => openEntity(entity)}>{t('edit')}</button>
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
          <h3>{t('sources')}</h3>
          {entity.sources.map((s, i) => (
            <button
              className="source"
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
            </button>
          ))}
          <p className="muted small">ID {entity.id}</p>
        </>
      ) : (
        <p className="muted">{t('noSelection')}</p>
      )}
    </aside>
  )

  return (
    <div className="mythor">
      <style>{style}</style>
      <header>
        <div>
          <h1>
            {t('title')}{' '}
            <span className="muted small">/ {snapshot?.project.name ?? t('projects')}</span>
          </h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
        <div className="row">
          <select
            aria-label={t('projects')}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t('projects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ` · ${t('archived')}` : ''}
              </option>
            ))}
          </select>
          <button onClick={() => setModal('project')}>{t('createProject')}</button>
          <button disabled={busy} onClick={() => void act(() => refresh(), false)}>
            {t('refresh')}
          </button>
        </div>
      </header>
      {notice && (
        <div className="notice" role={error ? 'alert' : 'status'}>
          {notice}
          <button style={{ float: 'right' }} onClick={() => setNotice('')}>
            {t('close')}
          </button>
        </div>
      )}
      {!projectId ? (
        <main>
          <div className="hero">
            <h2>{t('help')}</h2>
            <p>{t('helpText')}</p>
            <div className="row">
              <button className="primary" onClick={() => setModal('project')}>
                {t('createProject')}
              </button>
              <label>
                {t('restore')}{' '}
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file)
                      void act(async () => {
                        const project = await call<Project>(
                          'restore',
                          { text: await file.text() },
                          '',
                        )
                        await refresh('')
                        setProjectId(project.id)
                      })
                  }}
                />
              </label>
            </div>
          </div>
          <div className="cards">
            {projects.map((p) => (
              <article key={p.id} className="card project-card">
                <h3>{p.name}</h3>
                <p className="muted">
                  {t('revision')} {p.revision}
                </p>
                <button onClick={() => setProjectId(p.id)}>{t('open')} →</button>
              </article>
            ))}
          </div>
        </main>
      ) : (
        <div className="layout">
          <nav aria-label="Mythor navigation">
            {tabs.map((key) => (
              <button
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => {
                  setTab(key)
                  setKind('')
                }}
              >
                {t(key)}
                {key === 'review' && pending.length ? ` (${pending.length})` : ''}
              </button>
            ))}
          </nav>
          <main>
            {!snapshot ? (
              <p role="status">{t('loading')}</p>
            ) : (
              <>
                {tab === 'overview' && (
                  <>
                    <div className="hero">
                      <span className="badge">
                        {t('revision')} {snapshot.project.revision}
                      </span>
                      <h2>{snapshot.project.name}</h2>
                      <p>{t('helpText')}</p>
                      <div className="row">
                        <button className="primary" onClick={() => setModal('task')}>
                          {t('newTask')}
                        </button>
                        <button onClick={() => setModal('import')}>{t('import')}</button>
                        <button onClick={() => setModal('binding')}>{t('binding')}</button>
                      </div>
                    </div>
                    <div className="cards">
                      {[
                        ['objects', snapshot.entities.length],
                        ['scenes', snapshot.entities.filter((e) => e.kind === 'scene').length],
                        ['pending', pending.length],
                        [
                          'tasks',
                          snapshot.tasks.filter(
                            (task) => !['completed', 'cancelled'].includes(task.status),
                          ).length,
                        ],
                      ].map(([key, value]) => (
                        <div className="card" key={key}>
                          <div className="muted">{t(key as Key)}</div>
                          <div className="stat">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="toolbar" style={{ marginTop: 22 }}>
                      <button onClick={() => void act(async () => download(await call('export')))}>
                        {t('export')}
                      </button>
                      <button onClick={() => void act(async () => download(await call('backup')))}>
                        {t('backup')}
                      </button>
                      <button
                        onClick={() =>
                          void act(async () => {
                            await call('project.archive', {
                              archived: !snapshot.project.archived,
                            })
                            await refresh()
                          })
                        }
                      >
                        {t(snapshot.project.archived ? 'unarchive' : 'archive')}
                      </button>
                    </div>
                    <p className="muted small">ID {projectId}</p>
                  </>
                )}
                {(tab === 'world' || tab === 'structure') && (
                  <>
                    <div className="toolbar">
                      <input
                        aria-label={t('search')}
                        placeholder={t('search')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <select
                        aria-label={t('kind')}
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        <option value="">{t('all')}</option>
                        {KINDS.filter((k) =>
                          tab === 'world' ? worldKinds.includes(k) : !worldKinds.includes(k),
                        ).map((k) => (
                          <option key={k} value={k}>
                            {t(k)}
                          </option>
                        ))}
                      </select>
                      <button className="primary" onClick={() => openEntity()}>
                        {t('add')}
                      </button>
                    </div>
                    <div className="grid">
                      <div className="list">
                        {visible.length ? (
                          visible.map((e) => (
                            <button className="item" key={e.id} onClick={() => setSelected(e.id)}>
                              <span>
                                <b>{e.name}</b>
                                <br />
                                <span className="muted small">{e.summary.slice(0, 90)}</span>
                              </span>
                              <span className="badge">
                                {t(e.kind)}
                                {e.stale ? ' !' : ''}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="empty">{t('empty')}</div>
                        )}
                      </div>
                      {detail}
                    </div>
                  </>
                )}
                {tab === 'manuscript' && (
                  <>
                    <div className="toolbar">
                      <select
                        aria-label={t('manuscript')}
                        value={documentId}
                        onChange={(e) => {
                          const d = snapshot.documents.find((d) => d.id === e.target.value)
                          if (d) chooseDoc(d)
                        }}
                      >
                        <option value="">{t('newDocument')}</option>
                        {snapshot.documents.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          setDocumentId('')
                          setDocTitle('')
                          setDocText('')
                          setDocEntity('')
                        }}
                      >
                        {t('newDocument')}
                      </button>
                      <button onClick={() => setModal('import')}>{t('import')}</button>
                    </div>
                    <div className="form-grid">
                      <label>
                        {t('titleField')}
                        <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                      </label>
                      <label>
                        {t('scene')}
                        <select value={docEntity} onChange={(e) => setDocEntity(e.target.value)}>
                          <option value="">—</option>
                          {snapshot.entities
                            .filter((e) => ['chapter', 'scene'].includes(e.kind))
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <TextEditor
                      key={`${projectId}:${documentId}`}
                      value={docText}
                      onChange={setDocText}
                    />
                    <div className="toolbar" style={{ marginTop: 12 }}>
                      <button
                        className="primary"
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
                      >
                        {t('saveDraft')}
                      </button>
                      <span className="muted">{docText.length} 字符</span>
                    </div>
                    <details>
                      <summary>{t('revisionHistory')}</summary>
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
                    </details>
                  </>
                )}
                {tab === 'timeline' && (
                  <div className="two">
                    <section>
                      <h2>{t('worldTime')}</h2>
                      {snapshot.entities
                        .filter((e) => ['event', 'scene'].includes(e.kind))
                        .sort((a, b) => (a.time?.start ?? Infinity) - (b.time?.start ?? Infinity))
                        .map((e) => (
                          <div className="timeline-item" key={e.id}>
                            <span className="muted small">
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
                      <h2>{t('narrativeTime')}</h2>
                      {snapshot.entities
                        .filter((e) => ['chapter', 'scene', 'revelation'].includes(e.kind))
                        .sort(
                          (a, b) => (a.narrativeOrder ?? Infinity) - (b.narrativeOrder ?? Infinity),
                        )
                        .map((e) => (
                          <div className="timeline-item" key={e.id}>
                            <span className="muted small">
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
                    <div className="toolbar">
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
                        <button
                          key={mode}
                          className={`chip ${mode === graphMode ? 'active' : ''}`}
                          onClick={() => setGraphMode(mode)}
                        >
                          {t(mode)}
                        </button>
                      ))}
                    </div>
                    <div className="toolbar">
                      <select
                        aria-label={t('focus')}
                        value={graphFocus}
                        onChange={(e) => setGraphFocus(e.target.value)}
                      >
                        <option value="">{t('reset')}</option>
                        {snapshot.entities.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                      <label>
                        {t('depth')}{' '}
                        <select
                          value={graphDepth}
                          onChange={(e) => setGraphDepth(Number(e.target.value))}
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <button onClick={() => setModal('relation')}>{t('addRelation')}</button>
                      <input
                        type="number"
                        aria-label={t('start')}
                        placeholder={t('start')}
                        value={graphTime}
                        onChange={(e) => setGraphTime(e.target.value)}
                      />
                    </div>
                    <div className="grid">
                      <div>
                        <StoryGraph
                          nodes={graphData.nodes}
                          edges={graphData.edges}
                          select={(id) => setSelected(id)}
                          focus={selected}
                          route={route}
                        />
                        <p className="muted small">
                          {graphData.nodes.length} / {graphData.total} {t('objects')}
                          {graphData.truncated && ` · ${t('truncated')}`}
                        </p>
                        {graphMode === 'movement' && (
                          <section aria-label={t('movement')}>
                            <h3>{t('movement')}</h3>
                            <p className="muted small">{t('movementHint')}</p>
                            {graphData.visits?.map((visit, i) => (
                              <div
                                className="timeline-item"
                                key={`${visit.characterId}-${visit.eventId}-${visit.locationId}-${i}`}
                              >
                                <b>
                                  {snapshot.entities.find((e) => e.id === visit.characterId)?.name}
                                </b>{' '}
                                · {visit.time ?? t('unknownTime')} →{' '}
                                <button onClick={() => setSelected(visit.locationId)}>
                                  {snapshot.entities.find((e) => e.id === visit.locationId)?.name}
                                </button>
                                <p>
                                  <button
                                    className="chip"
                                    onClick={() => setSelected(visit.eventId)}
                                  >
                                    {snapshot.entities.find((e) => e.id === visit.eventId)?.name}
                                  </button>
                                </p>
                              </div>
                            ))}
                          </section>
                        )}
                        {graphMode === 'crossings' && (
                          <section aria-label={t('crossings')}>
                            {graphData.lanes?.map((lane) => (
                              <article className="card" key={lane.storylineId}>
                                <h3>
                                  {snapshot.entities.find((e) => e.id === lane.storylineId)?.name}
                                </h3>
                                <div className="row">
                                  {lane.eventIds.map((id) => (
                                    <button key={id} onClick={() => setSelected(id)}>
                                      {graphData.intersections?.includes(id) ? '↔ ' : ''}
                                      {snapshot.entities.find((e) => e.id === id)?.name}
                                    </button>
                                  ))}
                                </div>
                              </article>
                            ))}
                          </section>
                        )}
                        <div className="toolbar">
                          <select
                            value={routeTo}
                            aria-label={t('to')}
                            onChange={(e) => setRouteTo(e.target.value)}
                          >
                            <option value="">{t('to')}</option>
                            {graphData.nodes.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!selected || !routeTo}
                            onClick={() => {
                              const path = findPath(selected, routeTo, graphData.edges)
                              setRoute(path)
                              if (!path.length) setNotice(t('noRoute'))
                            }}
                          >
                            {t('route')}
                          </button>
                        </div>
                        <details open>
                          <summary>{t('listView')}</summary>
                          {graphData.edges.map((r) => (
                            <p key={r.id}>
                              <button className="chip" onClick={() => setSelected(r.from)}>
                                {snapshot.entities.find((e) => e.id === r.from)?.name}
                              </button>{' '}
                              → {r.kind} →{' '}
                              <button className="chip" onClick={() => setSelected(r.to)}>
                                {snapshot.entities.find((e) => e.id === r.to)?.name}
                              </button>
                              <button
                                className="chip"
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
                              </button>
                            </p>
                          ))}
                        </details>
                      </div>
                      {detail}
                    </div>
                  </>
                )}
                {tab === 'review' && (
                  <>
                    <h2>{t('review')}</h2>
                    <label>
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                      />{' '}
                      {t('acknowledge')}
                    </label>
                    <div className="list">
                      {pending.length ? (
                        pending.map((c) => (
                          <article className="card" key={c.id}>
                            <h3>{c.summary}</h3>
                            <p className="muted small">
                              v{c.baseRevision} → · {c.operations.length} {t('differences')} ·{' '}
                              {c.createdAt}
                            </p>
                            <details>
                              <summary>{t('compare')}</summary>
                              {c.operations.map((op, index) => {
                                const previous = op.type.startsWith('entity.')
                                  ? snapshot.entities.find(
                                      (e) => e.id === ('value' in op ? op.value.id : op.id),
                                    )
                                  : op.type.startsWith('relation.')
                                    ? snapshot.relations.find(
                                        (e) => e.id === ('value' in op ? op.value.id : op.id),
                                      )
                                    : snapshot.documents.find(
                                        (e) => e.id === ('value' in op ? op.value.id : op.id),
                                      )
                                return (
                                  <div key={index}>
                                    <b>{op.type}</b>
                                    <div className="two">
                                      <div>
                                        {t('old')}
                                        <pre>
                                          {previous ? JSON.stringify(previous, null, 2) : '—'}
                                        </pre>
                                      </div>
                                      <div>
                                        {t('next')}
                                        <pre>
                                          {'value' in op ? JSON.stringify(op.value, null, 2) : '—'}
                                        </pre>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </details>
                            {checkDetails[c.id] && (
                              <>
                                <FindingList findings={checkDetails[c.id].findings} />
                                <p className="small">
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
                            <div className="row">
                              <button
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
                              </button>
                              <button
                                className="primary"
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
                              >
                                {t('commit')}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await call('changes.reject', { id: c.id })
                                    await refresh()
                                  })
                                }
                              >
                                {t('reject')}
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="empty">{t('empty')}</div>
                      )}
                    </div>
                  </>
                )}
                {tab === 'checks' && (
                  <>
                    <h2>{t('checks')}</h2>
                    <button
                      onClick={() =>
                        void act(async () => {
                          const result = await call<{ findings: Finding[] }>('world.validate')
                          setFindings(result.findings)
                          if (!result.findings.length) setNotice(t('noIssues'))
                        }, false)
                      }
                    >
                      {t('runChecks')}
                    </button>
                    <FindingList findings={findings} />
                  </>
                )}
                {tab === 'history' && (
                  <>
                    <h2>{t('history')}</h2>
                    <div className="list">
                      {history.map((c) => (
                        <article className="card" key={c.id}>
                          <h3>
                            v{c.revision} · {c.summary}
                          </h3>
                          <p className="muted small">
                            {c.actor} · {c.createdAt}
                          </p>
                          <details>
                            <summary>{t('differences')}</summary>
                            <pre>{JSON.stringify(c.operations, null, 2)}</pre>
                          </details>
                          <button
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
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {tab === 'tasks' && (
                  <>
                    <div className="toolbar">
                      <h2>{t('tasks')}</h2>
                      <button className="primary" onClick={() => setModal('task')}>
                        {t('newTask')}
                      </button>
                    </div>
                    <p className="muted">{t('taskInstructions')}</p>
                    <div className="list">
                      {snapshot.tasks.map((task) => (
                        <article className="card" key={task.id}>
                          <div className="row">
                            <h3>{task.intent}</h3>
                            <span className="badge">
                              {task.stage} / {task.status}
                            </span>
                          </div>
                          <p className="small muted">
                            ID {task.id} · v{task.baseRevision}
                          </p>
                          {task.error && <p role="alert">{task.error}</p>}
                          <details>
                            <summary>{t('details')}</summary>
                            <pre>{JSON.stringify(task.artifacts, null, 2)}</pre>
                          </details>
                          <div className="row">
                            <button
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
                            </button>
                            <button
                              disabled={busy || task.status === 'completed'}
                              onClick={() =>
                                void act(async () => {
                                  await call('task.cancel', { id: task.id })
                                  await refresh()
                                })
                              }
                            >
                              {t('cancel')}
                            </button>
                            <button
                              disabled={['completed', 'cancelled'].includes(task.status)}
                              onClick={() => {
                                setGrantTask(task.id)
                                setModal('grant')
                              }}
                            >
                              {t('grant')}
                            </button>
                            {['plan', 'check'].includes(task.kind) &&
                              task.status === 'waiting_review' && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      await call('task.finish', { id: task.id })
                                      await refresh()
                                    })
                                  }
                                >
                                  {t('finishTask')}
                                </button>
                              )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </main>
        </div>
      )}
      {modal === 'project' && (
        <SimpleForm
          title={t('createProject')}
          close={() => setModal(undefined)}
          fields={[['name', t('projectName')]]}
          busy={busy}
          submit={(values) =>
            act(async () => {
              const p = await call<Project>('project.create', values, '')
              setModal(undefined)
              await refresh('')
              setProjectId(p.id)
            })
          }
          t={t}
        />
      )}
      {modal === 'source' && evidence && (
        <Modal
          title={`${t('sources')} · ${evidence.document.title}`}
          close={() => setModal(undefined)}
        >
          <p className="small muted">
            {evidence.document.revisionId} · {evidence.start}–{evidence.end}
          </p>
          <pre>
            {evidence.document.text.slice(0, evidence.start)}
            <mark>{evidence.document.text.slice(evidence.start, evidence.end)}</mark>
            {evidence.document.text.slice(evidence.end)}
          </pre>
          <button onClick={() => setModal(undefined)}>{t('close')}</button>
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
          preview={(p) => call('import', { ...p, preview: true })}
          save={(p) =>
            act(async () => {
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
                expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              })
              setModal(undefined)
              await refresh()
            })
          }
        />
      )}
      {modal === 'binding' && (
        <SimpleForm
          title={t('binding')}
          fields={[['sessionId', t('sessionId')]]}
          t={t}
          close={() => setModal(undefined)}
          busy={busy}
          submit={(values) =>
            act(async () => {
              await call('binding.set', values)
              setModal(undefined)
            })
          }
        />
      )}
    </div>
  )
}
function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div className="list" style={{ margin: '15px 0' }}>
      {findings.map((f, i) => (
        <div className="card" key={i}>
          <span className={`badge ${f.severity === 'error' ? 'danger' : ''}`}>{f.severity}</span>{' '}
          {f.message}
          <div className="small muted">
            {f.code} · {f.entityIds.join(', ')}
          </div>
          {f.suggestion && <p>{f.suggestion}</p>}
        </div>
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
    <Modal title={title} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(values)
        }}
      >
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              required
              style={{ width: '100%' }}
              value={values[key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          </label>
        ))}
        <footer>
          <button type="button" onClick={close}>
            {t('cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('save')}
          </button>
        </footer>
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
    <Modal title={entity ? t('edit') : t('add')} close={close}>
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
        <div className="form-grid">
          <label>
            {t('name')}
            <input required value={value.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label>
            {t('kind')}
            <select
              value={value.kind}
              onChange={(e) => update({ kind: e.target.value as Entity['kind'] })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t('summary')}
          <textarea value={value.summary} onChange={(e) => update({ summary: e.target.value })} />
        </label>
        <label>
          {t('aliases')}
          <input
            style={{ width: '100%' }}
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
        </label>
        <div className="form-grid">
          <label>
            {t('info')}
            <select
              value={value.informationStatus}
              onChange={(e) =>
                update({
                  informationStatus: e.target.value as Entity['informationStatus'],
                })
              }
            >
              {(['fact', 'plan', 'hypothesis'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('order')}
            <input
              type="number"
              value={value.narrativeOrder ?? ''}
              onChange={(e) =>
                update({
                  narrativeOrder: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            {t('start')}
            <input
              type="number"
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
          </label>
          <label>
            {t('end')}
            <input
              type="number"
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
          </label>
        </div>
        <h3 style={{ marginTop: 18 }}>{t('attrs')}</h3>
        {fields[value.kind]?.map(([key, label]) => (
          <label key={key}>
            {t(label)}
            <input
              style={{ width: '100%' }}
              value={String(value.attributes[key] ?? '')}
              onChange={(e) =>
                update({
                  attributes: { ...value.attributes, [key]: e.target.value },
                })
              }
            />
          </label>
        ))}
        {localError && <p role="alert">{localError}</p>}
        <footer>
          <button type="button" onClick={close}>
            {t('cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('save')}
          </button>
        </footer>
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
  const [result, setResult] = useState<Json>()
  const [error, setError] = useState('')
  return (
    <Modal title={t('import')} close={close}>
      <label>
        {t('importTitle')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t('importFile')}
        <input
          type="file"
          accept=".md,.txt,text/plain,text/markdown"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              setTitle(file.name.replace(/\.[^.]+$/, ''))
              void file.text().then(setText)
            }
          }}
        />
      </label>
      <label>
        {t('importText')}
        <textarea
          style={{ minHeight: 200 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button onClick={close}>{t('cancel')}</button>
        <button
          disabled={busy || !title || !text}
          onClick={() =>
            void preview({ title, text })
              .then(setResult)
              .catch((e) => setError(String(e)))
          }
        >
          {t('preview')}
        </button>
        <button
          className="primary"
          disabled={busy || !title || !text}
          onClick={() => void save({ title, text })}
        >
          {t('import')}
        </button>
      </footer>
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
    <Modal title={t('addRelation')} close={close}>
      <div className="form-grid">
        {[
          [t('from'), from, setFrom],
          [t('to'), to, setTo],
        ].map(([label, value, setter], i) => (
          <label key={i}>
            {label as string}
            <select
              value={value as string}
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
            >
              <option value="">—</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label>
        {t('relationKind')}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
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
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        {t('summary')}
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <footer>
        <button onClick={close}>{t('cancel')}</button>
        <button
          className="primary"
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
        >
          {t('save')}
        </button>
      </footer>
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
  const [sessionId, setSessionId] = useState('')
  return (
    <Modal title={t('newTask')} close={close}>
      <label>
        {t('taskKind')}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {(['plan', 'write', 'revise', 'check'] as const).map((k) => (
            <option key={k} value={k}>
              {t(k)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('intent')}
        <textarea value={intent} onChange={(e) => setIntent(e.target.value)} />
      </label>
      <label>
        {t('sessionId')}
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
      </label>
      <p className="muted small">{t('taskInstructions')}</p>
      <footer>
        <button onClick={close}>{t('cancel')}</button>
        <button
          className="primary"
          disabled={busy || !intent.trim()}
          onClick={() => void save({ kind, intent, ...(sessionId ? { sessionId } : {}) })}
        >
          {t('newTask')}
        </button>
      </footer>
    </Modal>
  )
}
