import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
await build({
  entryPoints: ['src/storage/store.ts'],
  outfile: '.test-output/benchmark-store.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
})
const { Store } = await import(pathToFileURL(resolve('.test-output/benchmark-store.mjs')).href)
const root = mkdtempSync(join(tmpdir(), 'mythor-bench-'))
const store = new Store(root)
const actor = { kind: 'author' }
const project = store.execute(
  { action: 'project.create', payload: { name: '长篇性能基准' } },
  actor,
)
const call = (action, payload = {}) =>
  store.execute({ action, projectId: project.id, payload }, actor)
const entities = Array.from({ length: 10_000 }, (_, i) => ({
  type: 'entity.put',
  value: {
    id: `e${i}`,
    kind: i < 3000 ? 'scene' : 'character',
    name: `人物场景${i}`,
    summary: `寻找地图第${i}段`,
    attributes: {},
    aliases: [],
    informationStatus: 'fact',
    editorialStatus: 'accepted',
    sources: [],
    revision: 0,
    stale: false,
  },
}))
const documents = Array.from({ length: 3000 }, (_, i) => ({
  type: 'document.put',
  value: {
    id: `d${i}`,
    revisionId: `v${i}`,
    entityId: `e${i}`,
    title: `场景 ${i}`,
    text: '林烬走进车站，顾清等待着地图的归属。'.repeat(60).slice(0, 1000),
  },
}))
const relations = Array.from({ length: 50_000 }, (_, i) => ({
  type: 'relation.put',
  value: {
    id: `r${i}`,
    from: `e${i % 10000}`,
    to: `e${(i * 7 + 1) % 10000}`,
    kind: 'related',
    summary: '',
    sources: [],
    revision: 0,
  },
}))
const measures = {}
function measure(label, fn) {
  const start = performance.now()
  const result = fn()
  measures[label] = Math.round(performance.now() - start)
  return result
}
try {
  measure('seedAndIndexMs', () => {
    const operations = [...entities, ...documents, ...relations]
    for (let i = 0; i < operations.length; i += 9000) {
      const change = call('changes.propose', {
        baseRevision: call('snapshot').project.revision,
        summary: `基准 ${i}`,
        operations: operations.slice(i, i + 9000),
      })
      call('changes.commit', { id: change.id, idempotencyKey: `bench_${i}` })
    }
  })
  measure('chineseQueryMs', () => call('query', { text: '地图', limit: 100 }))
  measure('graphNeighborhoodMs', () => call('graph', { focus: 'e42', depth: 1 }))
  measure('contextMs', () => call('context', { focus: ['e42'] }))
  measure('snapshotMs', () => call('snapshot'))
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cpu: cpus()[0].model,
        entities: entities.length,
        relations: relations.length,
        scenes: documents.length,
        characters: documents.reduce((n, op) => n + op.value.text.length, 0),
        measures,
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      null,
      2,
    ),
  )
} finally {
  store.close()
  if (dirname(resolve(root)) !== resolve(tmpdir()))
    throw new Error('Unsafe benchmark cleanup target')
  rmSync(root, { recursive: true, force: true })
}
