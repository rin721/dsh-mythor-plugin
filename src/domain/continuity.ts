import { createHash } from 'node:crypto'
import type { ChangeSet, Finding, Operation } from '../shared/contracts.ts'
import type { World } from './validation.ts'
import { PlanAttributes } from '../shared/creative.ts'
export const changeHash = (change: Pick<ChangeSet, 'baseRevision' | 'operations'>) =>
  createHash('sha256')
    .update(JSON.stringify([change.baseRevision, change.operations]))
    .digest('hex')
export function continuity(world: World, operations: Operation[]): Finding[] {
  const findings: Finding[] = []
  const add = (
    code: string,
    message: string,
    ids: string[],
    severity: Finding['severity'] = 'warning',
  ) =>
    findings.push({
      code,
      message,
      entityIds: ids,
      severity,
      sources: world.entities.filter((e) => ids.includes(e.id)).flatMap((e) => e.sources),
    })
  for (const op of operations) {
    if (op.type === 'relation.put' && op.value.kind === 'participates') {
      const character = world.entities.find(
        (e) => e.kind === 'character' && [op.value.from, op.value.to].includes(e.id),
      )
      const event = [
        ...world.entities,
        ...operations.flatMap((o) => (o.type === 'entity.put' ? [o.value] : [])),
      ].find(
        (e) => ['event', 'scene'].includes(e.kind) && [op.value.from, op.value.to].includes(e.id),
      )
      if (
        character?.informationStatus === 'fact' &&
        (character.attributes.alive === false || character.attributes.status === 'dead')
      ) {
        const deathTime =
          typeof character.attributes.deathTime === 'number'
            ? character.attributes.deathTime
            : character.time?.end
        if (
          deathTime === undefined ||
          event?.time?.start === undefined ||
          event.time.start > deathTime
        )
          add(
            'retcon-dead-action',
            '已确认死亡人物参与新行动；需要死亡时间、误信解释或历史修订证据',
            [character.id, ...(event ? [event.id] : [])],
          )
      }
    }
    if (op.type !== 'entity.put') continue
    const next = op.value,
      old = world.entities.find((e) => e.id === next.id)
    if (next.kind === 'plan') {
      const plan = PlanAttributes.safeParse(next.attributes)
      if (!plan.success) add('plan-shape', '规划缺少层级、目标或约束', [next.id], 'error')
      else {
        const plans = new Map(
          [
            ...world.entities,
            ...operations.flatMap((o) => (o.type === 'entity.put' ? [o.value] : [])),
          ]
            .filter((e) => e.kind === 'plan')
            .map((e) => [e.id, e]),
        )
        const levels = ['intent', 'premise', 'plotline', 'part', 'arc', 'chapter', 'scene', 'beat']
        const seen = new Set([next.id])
        let parentId = plan.data.parentId
        let level = levels.indexOf(plan.data.level)
        while (parentId) {
          const parent = plans.get(parentId),
            parsed = parent && PlanAttributes.safeParse(parent.attributes)
          if (!parsed || !parsed.success) {
            add('plan-parent', '上层规划不存在或不完整', [next.id], 'error')
            break
          }
          if (seen.has(parentId) || levels.indexOf(parsed.data.level) >= level) {
            add('plan-cycle', '规划父层级必须向上，不能循环', [next.id, parentId], 'error')
            break
          }
          seen.add(parentId)
          level = levels.indexOf(parsed.data.level)
          parentId = parsed.data.parentId
        }
      }
    }
    if (!old || old.informationStatus !== 'fact') continue
    const a = old.attributes,
      b = next.attributes
    if ((a.alive === false || a.status === 'dead') && (b.alive === true || b.status === 'alive'))
      add('retcon-life', '已确认死亡的人物再次存活，需要解释或改写原有事实', [next.id])
    for (const field of ['coreBelief', 'identity', 'worldLaw'])
      if (a[field] !== undefined && JSON.stringify(a[field]) !== JSON.stringify(b[field]))
        add('core-change', `核心设定 ${field} 改变，需要作者决定`, [next.id])
    if (old.kind === 'assertion' && JSON.stringify(a.value) !== JSON.stringify(b.value))
      add('canon-change', '已确认断言改变，需分析历史证据与后续影响', [next.id])
  }
  return findings
}
export function acceptanceRisks(world: World, operations: Operation[]): string[] {
  const risks: string[] = []
  for (const op of operations) {
    if (
      op.type === 'relation.put' &&
      ['married_to', 'enemy_of', 'betrays', 'parent_of'].includes(op.value.kind)
    ) {
      const old = world.relations.find((r) => r.id === op.value.id)
      if (JSON.stringify(old) !== JSON.stringify(op.value)) risks.push('关键关系改变需要作者决定')
    }
    if (op.type.endsWith('.delete')) risks.push('删除已有创作记录需要作者决定')
    if (op.type === 'seed.put') risks.push('创作方向改变需要作者决定')
    if (op.type !== 'entity.put') continue
    const old = world.entities.find((e) => e.id === op.value.id),
      next = op.value
    if (
      (!old &&
        next.informationStatus === 'fact' &&
        ['rule', 'setting', 'character', 'storyline', 'arc'].includes(next.kind)) ||
      (old?.informationStatus === 'hypothesis' && next.informationStatus === 'fact')
    )
      risks.push(`确认重要设定或推断：${next.name}`)
    if (
      (next.attributes.alive === false && old?.attributes.alive !== false) ||
      (next.attributes.status === 'dead' && old?.attributes.status !== 'dead')
    )
      risks.push(`不可逆人物变化：${next.name}`)
    if (next.kind === 'plan') {
      const plan = PlanAttributes.safeParse(next.attributes)
      if (
        !plan.success ||
        (['intent', 'premise', 'plotline', 'part', 'arc'].includes(plan.data.level) &&
          JSON.stringify(old?.attributes) !== JSON.stringify(next.attributes))
      )
        risks.push(`重要规划方向：${next.name}`)
    }
  }
  return [...new Set(risks)]
}
