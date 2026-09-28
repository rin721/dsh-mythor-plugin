import type { Document, Entity, Finding, Operation, Relation } from '../shared/contracts.ts'

export interface World {
  entities: Entity[]
  relations: Relation[]
  documents: Document[]
}
export function applyOperations(world: World, operations: Operation[]): World {
  const entities = new Map(world.entities.map((v) => [v.id, v]))
  const relations = new Map(world.relations.map((v) => [v.id, v]))
  const documents = new Map(world.documents.map((v) => [v.id, v]))
  for (const op of operations) {
    switch (op.type) {
      case 'entity.put':
        entities.set(op.value.id, op.value)
        break
      case 'entity.delete':
        entities.delete(op.id)
        break
      case 'relation.put':
        relations.set(op.value.id, op.value)
        break
      case 'relation.delete':
        relations.delete(op.id)
        break
      case 'document.put':
        documents.set(op.value.id, op.value)
        break
      case 'document.delete':
        documents.delete(op.id)
        break
    }
  }
  return {
    entities: [...entities.values()],
    relations: [...relations.values()],
    documents: [...documents.values()],
  }
}
export function validate(world: World, revisions: Document[] = world.documents): Finding[] {
  const findings: Finding[] = []
  const entities = new Map(world.entities.map((v) => [v.id, v]))
  const sourceDocs = new Map(revisions.map((v) => [v.revisionId, v]))
  const add = (
    code: string,
    message: string,
    ids: string[],
    severity: Finding['severity'] = 'error',
  ) => findings.push({ code, message, entityIds: ids, severity, sources: [] })
  for (const record of [...world.entities, ...world.relations]) {
    if (
      record.time?.start !== undefined &&
      record.time.end !== undefined &&
      record.time.start > record.time.end
    )
      add('time-order', '世界时间区间起点晚于终点', [record.id])
    for (const source of record.sources) {
      const doc = sourceDocs.get(source.revisionId)
      if (
        !doc ||
        doc.id !== source.documentId ||
        source.start > source.end ||
        source.end > doc.text.length
      )
        add('invalid-source', '来源不属于有效的正文修订或文本区间', [record.id])
    }
  }
  for (const doc of world.documents)
    if (doc.entityId && !entities.has(doc.entityId))
      add('dangling-document', '正文关联对象不存在', [doc.entityId])
  for (const rel of world.relations) {
    if (!entities.has(rel.from) || !entities.has(rel.to))
      add('dangling-relation', '关系引用的对象不存在', [rel.from, rel.to])
    const from = entities.get(rel.from)?.kind
    const to = entities.get(rel.to)?.kind
    if (from && to) {
      const valid =
        rel.kind === 'located_at'
          ? to === 'location'
          : rel.kind === 'member_of'
            ? ['character', 'organization'].includes(from) && to === 'organization'
            : rel.kind === 'owns'
              ? ['character', 'organization'].includes(from) && to === 'item'
              : rel.kind === 'participates'
                ? (from === 'character' && ['event', 'scene'].includes(to)) ||
                  (to === 'character' && ['event', 'scene'].includes(from))
                : rel.kind === 'advances'
                  ? ['event', 'scene'].includes(from) &&
                    ['storyline', 'arc', 'conflict'].includes(to)
                  : true
      if (!valid) add('relation-kind', '关系类型与两端对象不匹配', [rel.from, rel.to])
    }
    if (['before', 'causes'].includes(rel.kind)) {
      const a = entities.get(rel.from)?.time
      const b = entities.get(rel.to)?.time
      if (a?.start !== undefined && b?.end !== undefined && a.start > b.end)
        add('temporal-conflict', '先后或因果关系与世界时间矛盾', [rel.from, rel.to])
    }
  }
  const edges = new Map<string, string[]>()
  for (const rel of world.relations.filter((r) => ['before', 'causes'].includes(r.kind)))
    edges.set(rel.from, [...(edges.get(rel.from) ?? []), rel.to])
  // Kahn's algorithm avoids exhausting the JS stack on long novel timelines.
  const indegree = new Map<string, number>()
  for (const [from, targets] of edges) {
    if (!indegree.has(from)) indegree.set(from, 0)
    for (const to of targets) indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }
  const queue = [...indegree].filter(([, n]) => !n).map(([id]) => id)
  for (let i = 0; i < queue.length; i++)
    for (const to of edges.get(queue[i]) ?? []) {
      const n = indegree.get(to)! - 1
      indegree.set(to, n)
      if (!n) queue.push(to)
    }
  if (queue.length < indegree.size)
    add(
      'causal-cycle',
      '因果或先后关系形成循环',
      [...indegree]
        .filter(([, n]) => n > 0)
        .slice(0, 20)
        .map(([id]) => id),
    )
  for (const entity of world.entities) {
    if (entity.stale)
      add('stale-source', '来源已修改，提取结果需要重新确认', [entity.id], 'warning')
    if (entity.kind === 'knowledge') {
      const knower = entity.attributes.knower
      const assertion = entity.attributes.assertion
      if (
        typeof knower !== 'string' ||
        entities.get(knower)?.kind !== 'character' ||
        typeof assertion !== 'string' ||
        entities.get(assertion)?.kind !== 'assertion'
      )
        add('knowledge-reference', '人物认知需要有效人物和断言', [entity.id])
    }
    if (
      entity.kind === 'revelation' &&
      (typeof entity.attributes.assertion !== 'string' ||
        entities.get(entity.attributes.assertion)?.kind !== 'assertion')
    )
      add('revelation-reference', '揭露需要有效断言', [entity.id])
    if (entity.kind !== 'rule' || entity.editorialStatus === 'retired') continue
    const a = entity.attributes
    const severity = a.strength === 'hard' ? 'error' : 'warning'
    const targets = world.entities.filter(
      (e) =>
        e.kind !== 'rule' &&
        (!a.targetKind || e.kind === a.targetKind) &&
        (!a.targetId || e.id === a.targetId),
    )
    if (
      ['required_attribute', 'attribute_equals'].includes(String(a.evaluator)) &&
      (typeof a.field !== 'string' || !a.field)
    ) {
      add('rule-definition', `${entity.name}：检查器缺少 field`, [entity.id])
      continue
    }
    if (
      a.evaluator === 'forbidden_relation' &&
      (typeof a.relationKind !== 'string' || !a.relationKind)
    ) {
      add('rule-definition', `${entity.name}：检查器缺少 relationKind`, [entity.id])
      continue
    }
    if (a.evaluator === 'required_attribute')
      for (const target of targets) {
        if (
          typeof a.field === 'string' &&
          (target.attributes[a.field] === undefined ||
            target.attributes[a.field] === null ||
            target.attributes[a.field] === '')
        )
          add(
            'rule-required',
            `${entity.name}：${target.name} 缺少 ${a.field}`,
            [entity.id, target.id],
            severity,
          )
      }
    else if (a.evaluator === 'attribute_equals')
      for (const target of targets) {
        if (
          typeof a.field === 'string' &&
          JSON.stringify(target.attributes[a.field]) !== JSON.stringify(a.value)
        )
          add(
            'rule-equals',
            `${entity.name}：${target.name} 不符合属性约束`,
            [entity.id, target.id],
            severity,
          )
      }
    else if (a.evaluator === 'forbidden_relation')
      for (const rel of world.relations) {
        if (rel.kind === a.relationKind && targets.some((t) => t.id === rel.from))
          add(
            'rule-relation',
            `${entity.name}：存在禁止的关系`,
            [entity.id, rel.from, rel.to],
            severity,
          )
      }
    else
      add(
        'semantic-review',
        `${entity.name}：自然语言规则需要人工或 Critic 检查`,
        [entity.id],
        'unknown',
      )
  }
  return findings
}

export function impacted(world: World, operations: Operation[]): string[] {
  const ids = new Set(
    operations.flatMap((op) =>
      op.type === 'entity.put' ? [op.value.id] : op.type === 'entity.delete' ? [op.id] : [],
    ),
  )
  const docs = new Set(
    operations.flatMap((op) =>
      op.type === 'document.put' ? [op.value.id] : op.type === 'document.delete' ? [op.id] : [],
    ),
  )
  for (const e of world.entities) if (e.sources.some((s) => docs.has(s.documentId))) ids.add(e.id)
  for (let changed = true; changed; ) {
    changed = false
    for (const r of world.relations)
      if (ids.has(r.from) && !ids.has(r.to)) {
        ids.add(r.to)
        changed = true
      }
  }
  return [...ids]
}
