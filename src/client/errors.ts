export function userError(code: string) {
  if (code === 'workspace-unavailable') return '请先选择一个 Harness 项目。'
  if (code === 'revision-conflict' || code === 'decision-conflict')
    return '故事已经更新。你的输入仍保留，请重新读取并比较这次修改。'
  if (code === 'agent-busy') return '当前对话正在处理其他工作，这项任务已保留，可以稍后继续。'
  if (code === 'creative-unavailable')
    return '创作工作暂时无法继续。想法和已保存内容仍保留，请检查模型与宿主服务配置。'
  if (code === 'validation-failed' || code === 'review-required')
    return '这次修改还有需要处理的问题，请查看检查结果后继续。'
  if (code === 'restore-target-not-empty')
    return '当前项目已有故事内容，请在另一个空项目中恢复备份。'
  return 'Mythor 暂时无法完成这项操作。你的输入仍保留，可以重试或查看详细信息。'
}
