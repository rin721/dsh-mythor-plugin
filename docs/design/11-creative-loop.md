# 0.3 创作闭环契约

本设计从 goal.md 的“规则塑造处境、欲望遭遇阻碍、选择产生后果、后果改变状态”推导，不将认知章节映射为按钮。领域词汇仍以 [03-domain.md](03-domain.md) 为准。

## 进入与作者语言

普通讨论、创意探索、持续创作分别处理。所有有效工作区的根 Agent 获得轻量指导及意图工具；普通讨论和探索仅追加公开、已声明的 `mythor/interview` Session 全量状态事件，不建立小说库。Host-only `mythor:interview` 原生投影维护进度，每轮提示读取投影；兼容旧 intake/decision 事件。Host 使用 SessionQuery 核验用户消息身份、所属序号及原文引用；模型可仅提供真实原话，由 Host 解析序号，不能把插件任务消息当成作者消息。持续意图经独立子 Agent 判断后建立最小 NovelState，标题默认为“未命名作品”。探索记录按真实消息来源迁入种子，迁入去重与正式提交同事务，专业字段不是输入门槛。

`mythor_develop` 通过受约束子 Agent 翻译普通语言，形成动机、信念变化、冲突及分层规划。模型扩展的事实保持假设；关键方向聚合确认。每轮最多两个问题。已接受上层规划下、不增加新方向、继承全部约束的近期章节/场景/节拍规划可由 Host 接纳，避免逐章审批。

## 可消费的规划

`plan` 是共享 Entity kind，attributes 使用 PlanAttributes：level、parentId、goal、constraints、status、entityIds、baseRevision、consequences。层级为 intent/premise/plotline/part/arc/chapter/scene/beat；父级必须更高，禁止循环。近期细化、远期保留方向。规划通过正常 ChangeSet 进入实体库，查询、上下文、工作台及后续任务消费同一记录。

场景检查给出 fulfilled/progressed/deviated。正文、明确变化及规划进展一起提交；偏离方向进入作者决定。完成任务 JSON 不替代正式规划。

## 场景管线

读取带版本及覆盖情况的上下文 → 前置因果推演 → 受限写作 → 先保存正文候选 → 提取九类 Before/After → 独立语义检查 → 确定性校验 → 接纳或聚合决定。

read/goals/plan/simulate/write/extract 使用严格类型产物。提取覆盖 world/character/relationship/knowledge/item/plotline/secret/foreshadow/timeline，可声明无变化。每个操作必须属于覆盖项，并引用当前正文的有效 UTF-16 区间；推断不得升格为事实。文本为空、仅“完成”、来源错误或未覆盖操作不能代表阶段完成。

写作、推演、提取、复核使用官方 spawn Provider 的全新子 Agent、结构化输出和 `toolFilter.allow=[]`。Writer 不继承父对话、不拥有小说或任意文件工具，只获得受限视角资料和场景目标/约束。Planner/Extractor/Critic 可获得作者视角；不存在 Mythor 模型请求或 Agent Loop。

直接编辑保留文本候选；未协调正文会阻止后续正常写作。改写使旧来源失效；新提取可替换记录，保留原修订、候选、提交及逆操作。失败或取消保留已保存产物。补偿仍创建新的 ChangeSet。

## 策略与决定

模型仅提交候选、来源和检查产物。Host 的 policy 身份不能从 Remote 或模型参数产生；协调凭据绑定 SHA-256(基线、操作)，写入与 Commit 均核验。确定性错误阻止提交，warning/unknown 阻止自动接纳。Host 自行识别删除、核心设定、主线规划、推断升格和人物死亡等风险，不信任模型的风险标签。

原生 userQuestions 问答绑定具体 ChangeSet、基线和操作摘要。回答后版本或内容改变必须重新确认；自由文本成为新的作者输入，不自动接受。决定记录保留原生答案及候选摘要/哈希。旧范围授权保留兼容用途；正常低风险场景通过内部协调策略提交，不要求逐章签 grant。

Retcon 先返回旧来源、关系/正文/规划影响及“误信、合理解释、改写历史”路线，作者选定后形成修复规划和替代候选，不直接覆盖属性。语义检查为可失败、可未知的模型产物，不承诺识别一切文学冲突。

## 检索、来源与恢复

保留 SQLite/FTS，以焦点关系邻域、规划祖先、世界规则、人物知识、近期事件、未解决伏笔排序；为正文预留预算。ContextPack 明示 missing；关键资料缺失时暂停场景，过大的缺口说明也返回 context-budget，不静默视作足够。

Session 存放访谈/决定和 Agent 交互；小说库存放正式事实、任务、领域阶段产物与来源；工作台按 Session 保存编辑草稿/焦点。只读查询不发布失效，避免订阅回读循环。断线重连重新读快照；卸载取消订阅并关闭 Worker。

材料记录独立保存类别、原文身份、不可变原始内容、批次及检查点。每批不超过 12,000 字符，偏移定位到原始修订；设定/笔记不作为正文导出。材料列表仅返回索引，Host 按需读取原文。批次候选先记录检查点再提交，重试识别已提交候选，避免重复提取接纳。取消/失败等待恢复。

## v3 与验证边界

升级 v2 前 VACUUM 一致备份；保留 ID、历史、逆操作和产物，旧任务标记需重验证。v3 备份增加领域元数据，仍读取 v1/v2；未知新版拒绝写入。旧提交不宣称已通过新增语义检查。

可控模型的真实 Harness Agent Loop 用于验证执行、子 Agent、原生决定和事务路径；实际文学质量、跨平台行为及真实 Web 几何布局必须另行实测。所有执行证据只记在 [实施记录](../implementation/status.md)。
