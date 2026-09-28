import type { Entity, Relation } from '../shared/contracts.ts'

export interface Visit {
  characterId: string
  eventId: string
  locationId: string
  time?: number
}
export interface Lane {
  storylineId: string
  eventIds: string[]
}

/** Views reference Canon IDs; they never create a second set of world facts. */
export function movement(entities: Entity[], relations: Relation[], characterId?: string): Visit[] {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const locations = new Map<string, string[]>()
  for (const r of relations)
    if (r.kind === 'located_at' && byId.get(r.to)?.kind === 'location')
      locations.set(r.from, [...(locations.get(r.from) ?? []), r.to])
  const visits: Visit[] = []
  for (const r of relations)
    if (r.kind === 'participates') {
      const character = byId.get(r.from)?.kind === 'character' ? r.from : r.to
      const event = character === r.from ? r.to : r.from
      if (
        byId.get(character)?.kind !== 'character' ||
        !['event', 'scene'].includes(byId.get(event)?.kind ?? '') ||
        (characterId && character !== characterId)
      )
        continue
      for (const location of locations.get(event) ?? [])
        visits.push({
          characterId: character,
          eventId: event,
          locationId: location,
          time: byId.get(event)?.time?.start,
        })
    }
  return visits.sort(
    (a, b) =>
      a.characterId.localeCompare(b.characterId) ||
      (a.time ?? Infinity) - (b.time ?? Infinity) ||
      a.eventId.localeCompare(b.eventId),
  )
}

export function crossings(
  entities: Entity[],
  relations: Relation[],
): { lanes: Lane[]; intersections: string[] } {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const counts = new Map<string, number>()
  const lanes = entities
    .filter((e) => e.kind === 'storyline')
    .map((storyline) => {
      const eventIds = [
        ...new Set(
          relations
            .filter(
              (r) =>
                ['advances', 'part_of'].includes(r.kind) &&
                r.to === storyline.id &&
                ['event', 'scene'].includes(byId.get(r.from)?.kind ?? ''),
            )
            .map((r) => r.from),
        ),
      ]
      eventIds.sort(
        (a, b) =>
          (byId.get(a)?.time?.start ?? Infinity) - (byId.get(b)?.time?.start ?? Infinity) ||
          a.localeCompare(b),
      )
      for (const id of eventIds) counts.set(id, (counts.get(id) ?? 0) + 1)
      return { storylineId: storyline.id, eventIds }
    })
  return { lanes, intersections: [...counts].filter(([, count]) => count > 1).map(([id]) => id) }
}
