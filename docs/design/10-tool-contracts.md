# 公共操作与扩展指南

协议的可执行定义在 `src/shared/contracts.ts`。Host 工具、用户命令和 Client Remote 进入同一应用服务；以下是调用说明，不是另一套领域定义。所有调用返回 `{ok:true,value}` 或 `{ok:false,error:{code,message,details?}}`。

## 调用结构

Remote 接收 `{action,payload}`，通过 Typert Agent scope 自动携带当前 Session 身份。模型工具固定 action，只接受 `{payload}`；`mythor_task` 另外接受 task.start / task.advance / task.resume / task.cancel。novelId、projectId、Session ID 与数据库路径都不能作为业务参数提交。Client 从当前 Session scope 调用 Remote，并先解包 Harness RemoteResult 传输外层。

| 工具 | payload 主要字段 | 结果 |
| --- | --- | --- |
| mythor_query | text、kind、limit、offset | items、total、nextOffset |
| mythor_context | focus[]、perspective、time、narrativeOrder、text | 带版本、来源、缺口和截断的 ContextPack |
| mythor_graph | focus、depth、kinds[]、time、limit | nodes、edges、visits、lanes、intersections |
| mythor_document | id 或 revisionId | 当前正文或不可变旧修订 |
| mythor_intake | phase、evidence(seq/quote)、fragments、questions≤2、reason | 探索事件或渐进初始化 |
| mythor_develop | intent、evidence | 人物变化及正式分层规划候选/安全近期规划 |
| mythor_scene | planId、perspective、intent、documentId?、time?、narrativeOrder? | 推演、隔离写作、提取、检查及联合接纳/待决定 |
| mythor_decide | id（候选） | 与基线及操作绑定的原生问答 |
| mythor_retcon | entityId、intent | 来源、影响对象及修复路线；不覆盖事实 |
| mythor_import | title?、text、materialKind?、evidence | 对话原文迁入；文件走工作台上传 |
| mythor_material / mythor_materials | id / 空 payload | 分批理解/精简材料索引 |
| mythor_tasks / mythor_task_read | 空 payload / id | 恢复任务索引及阶段产物 |
| mythor_task | start: kind/intent/focus；advance: id/stage/artifact；resume/cancel: id | WorkflowRun 与下一阶段提示 |
| mythor_propose | baseRevision、summary、operations[]、taskId? | 待审阅 ChangeSet |
| mythor_critique | id（任务）、findings[] | 保存语义建议的 WorkflowRun |
| mythor_validate | id（变更集） | findings、affected、revision |
| mythor_check | taskId? | 当前世界确定性诊断；推进 check 任务 |
| mythor_commit | id、idempotencyKey | Commit；必须已有有效作者授权 |
| mythor_history | 无 | 最新在前的提交历史 |

仅作者入口：当前工作区启用/暂停、旧版迁移、任务授权、接受规划/检查产物、拒绝候选、撤销、备份恢复。运行失败由 Host 的 agent/error 事件记录为 task.fail。工具没有 task.fail、grant、enable、legacy.migrate 或 restore 的入口。

## 最小创作事务

1. 作者使用 Harness 创建或选择工作区，并以 `/mythor enable <作品标题>` 启用一次。
2. `/mythor write <意图>` 建立任务；Agent 查询上下文，逐一保存 read/goals/plan/simulate/write 产物。
3. extract 阶段构造一个 ChangeSet，包括正文新修订、事件结果、对象和关系变化。新正文和对象可以在同一批相互引用。
4. 保存 extract 产物后进入 validate。Critic 记录证据与未知事项，确定性服务检查引用、时间、因果、来源和规则。
5. 作者在工作台查看差异后接受；有任务授权的 Agent 仅在范围内、无 warning/unknown 时可提交。幂等键重复请求返回原 Commit。

```json
{
  "baseRevision": 4,
  "taskId": "task_1",
  "summary": "林烬交出地图，顾清产生怀疑",
  "operations": [
    {"type":"document.put","value":{"id":"scene_text","revisionId":"text_v2","parentRevisionId":"text_v1","entityId":"station_scene","title":"废弃车站","text":"顾清接过地图，怀疑林烬用了假名。"}},
    {"type":"entity.put","value":{"id":"doubt","kind":"assertion","name":"林烬的身份可能是假的","informationStatus":"hypothesis","sources":[{"documentId":"scene_text","revisionId":"text_v2","start":0,"end":16}]}},
    {"type":"entity.put","value":{"id":"gu_doubt","kind":"knowledge","name":"顾清的怀疑","attributes":{"knower":"gu","assertion":"doubt","mode":"推测"},"time":{"start":8}}}
  ]
}
```

示例要求已有 gu、station_scene、scene_text/text_v1，实际调用必须使用当前项目修订和任务 ID。断言是 hypothesis；接受这条人物认知不等于确认身份为假。Source 偏移是 JavaScript UTF-16 索引，不能用 UTF-8 字节数。

## 版本与错误

revision-conflict / document-conflict：保留候选，重新读取并基于当前版本构造新候选。禁止无条件覆盖。

validation-failed：查看 details 中的 findings；修复 error 后重试。review-required：warning/unknown 需要作者判断，模型不能自动确认。

novel-not-enabled / workspace-scope：使用 Harness 工作区选择器并由作者启用；浏览器和模型不能改变归属。task-scope：检查当前会话与任务归属。grant-required：请作者在工作台限定对象授权或直接接受候选。

agent-unavailable：任务已保存，修复宿主模型配置后恢复。storage-busy / storage-failed / storage-unavailable：显示失败并保留输入；不要将失败响应解释为事务成功。恢复后通过幂等键确认写入结果。

## 添加能力

新增对象先更新领域文档和 EntitySchema；新增关系先定义两端语义、时间和来源，再扩展校验与投影。新增工具只做适配，不再写一套提交逻辑。新增规则采用有界 evaluator，配套正常、冲突、未知测试。新增阶段需同步 stages、ROLE_GUIDANCE、WorkflowSchema、恢复测试和任务 UI。新索引必须能从 Canon 重建。

SQLite schema 1 是首个发布格式；当前拒绝更高版本，尚无历史发布版本迁移承诺。将来每次迁移必须增加前版本备份 fixture 与中断恢复验证，不可仅提高 PRAGMA user_version。

## 工作台与创作记录新增契约

`{action:'workspace.progress',payload:{}}` 由 Remote 的 Host 作用域解析，返回 workspace、enabled、revision、records、checkpoints、plans、tasks、pending、decisions、recent、runtime、totalRecords、truncated、unavailableSessions。每个记录保留完整来源和性质。最多展示最近 80 条；truncated 明示不完整，不能把展示截断当作完整记忆。原始来源继续可按公开 SessionQuery 查询。

`mythor_intake` 增加 answeredQuestionIds（最多两个）以关闭当前问题；只有真实用户来源的 intake 能改变探索。`mythor_decide` 可附 evidence，但模糊自然语言确认不能签发授权；否则继续使用原生问答。`creative.put/delete` 是内部来源记录操作，不开放任意作者/模型提交。所有请求仍拒绝外部 projectId、路径和伪造策略身份。
