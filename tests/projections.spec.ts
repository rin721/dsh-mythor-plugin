import { expect, it } from 'vitest'
import { EntitySchema, type Relation } from '../src/shared/contracts.ts'
import { crossings, movement } from '../src/domain/projections.ts'

it('derives movement from participation and locations, with unknown dates last', () => {
  const entities = [
    { id: 'lin', kind: 'character' },
    { id: 'station', kind: 'location' },
    { id: 'harbor', kind: 'location' },
    { id: 'late', kind: 'event', time: { start: 8 } },
    { id: 'early', kind: 'event', time: { start: 2 } },
    { id: 'unknown', kind: 'event' },
  ].map((value) => EntitySchema.parse({ ...value, name: value.id }))
  const edge = (from: string, to: string, kind: string): Relation => ({
    id: `${from}_${to}`,
    from,
    to,
    kind,
    summary: '',
    sources: [],
    revision: 1,
  })
  const relations = [
    edge('lin', 'late', 'participates'),
    edge('early', 'lin', 'participates'),
    edge('lin', 'unknown', 'participates'),
    edge('late', 'harbor', 'located_at'),
    edge('early', 'station', 'located_at'),
    edge('unknown', 'harbor', 'located_at'),
  ]
  expect(movement(entities, relations).map((v) => [v.eventId, v.locationId, v.time])).toEqual([
    ['early', 'station', 2],
    ['late', 'harbor', 8],
    ['unknown', 'harbor', undefined],
  ])
  const lines = ['trust', 'map'].map((id) =>
    EntitySchema.parse({ id, kind: 'storyline', name: id }),
  )
  const projected = crossings(
    [...entities, ...lines],
    [
      edge('early', 'map', 'advances'),
      edge('late', 'map', 'advances'),
      edge('late', 'trust', 'advances'),
    ],
  )
  expect(projected.intersections).toEqual(['late'])
  expect(projected.lanes.find((l) => l.storylineId === 'map')?.eventIds).toEqual(['early', 'late'])
})
