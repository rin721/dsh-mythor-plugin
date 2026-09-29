import { expect, it } from 'vitest'
import { z } from 'zod'
import { verifyExtraction } from '../src/application/creative.ts'
import { ExtractionSchema } from '../src/shared/creative.ts'
import { EntitySchema } from '../src/shared/contracts.ts'
import { harnessSchema, harnessObjectSchema } from '../src/shared/harness-schema.ts'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { ToolPayloads } from '../src/shared/tool-schemas.ts'
import { continuity, acceptanceRisks } from '../src/domain/continuity.ts'
import { validate } from '../src/domain/validation.ts'
import { RelationSchema } from '../src/shared/contracts.ts'

it('blocks dead-character actions and overlapping item ownership with persisted evidence', () => {
  const dead = EntitySchema.parse({
    id: 'dead',
    kind: 'character',
    name: '哥哥',
    informationStatus: 'fact',
    attributes: { alive: false, deathTime: 3 },
    sources: [source],
  })
  const living = EntitySchema.parse({ id: 'living', kind: 'character', name: '妹妹' })
  const item = EntitySchema.parse({ id: 'map', kind: 'item', name: '地图' })
  const event = EntitySchema.parse({
    id: 'event',
    kind: 'event',
    name: '五日后的行动',
    time: { start: 5, end: 5 },
  })
  const world = { entities: [dead, living, item, event], relations: [], documents: [document] }
  const participation = RelationSchema.parse({
    id: 'action',
    kind: 'participates',
    from: 'dead',
    to: 'event',
  })
  const findings = continuity(world, [{ type: 'relation.put', value: participation }])
  expect(findings[0].code).toBe('retcon-dead-action')
  expect(findings[0].sources).toContainEqual(source)
  const owns = (id: string, from: string) =>
    RelationSchema.parse({ id, kind: 'owns', from, to: 'map', time: { start: 5, end: 6 } })
  expect(
    validate({ ...world, relations: [owns('a', 'dead'), owns('b', 'living')] }).some(
      (f) => f.code === 'item-ownership',
    ),
  ).toBe(true)
  expect(
    acceptanceRisks(world, [
      { type: 'relation.put', value: { ...participation, kind: 'betrays' } },
    ]),
  ).toHaveLength(1)
})

const document = { id: 'scene', revisionId: 'rev', title: '交换', text: '他将地图交给她。' }
const source = { documentId: 'scene', revisionId: 'rev', start: 0, end: 8 }
function extraction() {
  return ExtractionSchema.parse({
    operations: [
      {
        type: 'entity.put',
        value: EntitySchema.parse({
          id: 'map',
          kind: 'item',
          name: '地图',
          informationStatus: 'fact',
          attributes: { owner: '她' },
          sources: [source],
        }),
      },
    ],
    coverage: [
      'world',
      'character',
      'relationship',
      'knowledge',
      'item',
      'plotline',
      'secret',
      'foreshadow',
      'timeline',
    ].map((category) => ({
      category,
      before: category === 'item' ? '他持有地图' : '',
      after: category === 'item' ? '她持有地图' : '',
      operationIds: category === 'item' ? ['map'] : [],
      sources: category === 'item' ? [source] : [],
      nature: category === 'item' ? 'explicit' : 'unchanged',
      unchanged: category !== 'item',
    })),
    uncertainties: [],
  })
}
it('requires complete coverage and ties every extracted operation to the actual document revision', () => {
  expect(() => verifyExtraction(extraction(), document)).not.toThrow()
  const missing = extraction()
  missing.coverage.pop()
  expect(() => verifyExtraction(missing, document)).toThrow(/九类/)
  const orphan = extraction()
  orphan.operations.push({ type: 'entity.delete', id: 'unrelated' })
  expect(() => verifyExtraction(orphan, document)).toThrow(/覆盖/)
  const wrong = extraction()
  wrong.coverage[4].sources[0].revisionId = 'other'
  expect(() => verifyExtraction(wrong, document)).toThrow(/来源/)
})
it('rejects upgrading an inference to a fact and cross-batch source offsets', () => {
  const guessed = extraction()
  guessed.coverage[4].nature = 'inference'
  expect(() => verifyExtraction(guessed, document)).toThrow(/升级/)
  expect(() => verifyExtraction(extraction(), document, 4, 8)).toThrow(/区间/)
})
it('publishes schemas accepted by the official Harness validator, including recursive JSON attributes', () => {
  for (const schema of Object.values(ToolPayloads))
    expect(() => assertSupportedJsonSchema(harnessSchema(schema))).not.toThrow()
  expect(() => harnessObjectSchema(ExtractionSchema)).not.toThrow()
  expect(() => harnessObjectSchema(z.object({ bounded: z.string().min(3) }).strict())).not.toThrow()
  expect(() =>
    ToolPayloads['changes.commit'].parse({ id: 'x', idempotencyKey: 'k', actor: 'policy' }),
  ).toThrow()
})
