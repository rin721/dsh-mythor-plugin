import { MythorError } from './errors.ts'
import { STAGES, type Json, type WorkflowRun, type Stage } from '../shared/contracts.ts'
import { StageArtifacts } from '../shared/creative.ts'
export function stages(kind: WorkflowRun['kind']): Stage[] {
  if (kind === 'check') return ['read', 'validate', 'review']
  if (kind === 'plan') return ['read', 'goals', 'plan', 'simulate', 'review']
  if (kind === 'import') return ['read', 'extract', 'validate', 'review', 'commit']
  return [...STAGES]
}
export function advance(task: WorkflowRun, stage: Stage, artifact: Json): WorkflowRun {
  if (['cancelled', 'completed', 'failed'].includes(task.status))
    throw new MythorError('task-closed', '任务已结束或失败，请先恢复任务')
  if (stage !== task.stage) {
    if (JSON.stringify(task.artifacts[stage]) === JSON.stringify(artifact)) return task
    throw new MythorError('stage-order', `当前需要完成 ${task.stage} 阶段`)
  }
  if (['validate', 'review', 'commit'].includes(stage))
    throw new MythorError('stage-owned', '校验、审阅和提交由领域服务推进')
  const sequence = stages(task.kind)
  if ((task.contractVersion ?? 2) >= 3)
    StageArtifacts[stage as keyof typeof StageArtifacts].parse(artifact)
  const next = sequence[sequence.indexOf(stage) + 1]
  return {
    ...task,
    artifacts: { ...task.artifacts, [stage]: artifact },
    stage: next ?? stage,
    status: next === 'review' ? 'waiting_review' : next ? 'running' : 'completed',
  }
}
export const ROLE_GUIDANCE: Record<Stage, string> = {
  read: '检索当前版本、焦点、世界规则、人物知识和正文来源。不要混淆世界时间与叙述顺序。',
  goals: '明确作者意图、人物外部目标和内部需求、阻碍、风险与取舍。',
  plan: '提出候选行动，解释选择与后果的因果，保留待确认事项。',
  simulate: '推演资源、关系、知识和长期故事线的变化，不将推演当作正式事实。',
  write: '依据选定规划撰写场景正文，遵守视角与揭露范围，提交草稿而非直接修改正式历史。',
  extract:
    '从草稿提取有来源的变化；人物误信、对白和假设不能作为世界真相。调用 mythor_propose 形成变更集。',
  validate:
    '作为 Critic 检查动机、因果、视角与信息泄漏；用 mythor_critique 保存带证据的 warning/unknown 建议，再调用 mythor_validate（检查任务调用 mythor_check）执行确定性检查。未知不是通过。',
  review: '展示差异和来源，等待作者接受或使用现有任务授权，不得自行签发授权。',
  commit: '只能提交通过检查且拥有有效授权的变更集，成功后报告新版本。',
}
