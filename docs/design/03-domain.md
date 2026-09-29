# 领域模型

## 对象与关系

公共对象具有 id、kind、name、summary、aliases、attributes、sources（SourceRef 数组）、有效世界时间和正式修订版本。attributes 只承载类型特有的字段；关键关系、来源和状态不藏在不可查询的文本里。

| kind | 核心属性与关联 |
| --- | --- |
| character | 外部目标、内部需求、动机、恐惧、底线、价值观；人物弧、组织、物品 |
| location | 环境、进入限制、上级地点；事件发生地、人物行动位置 |
| organization | 宗旨、资源、制度；成员、上下级、盟友与敌对组织 |
| item | 性质、能力、成本；持有者、转交事件 |
| setting | 世界规则、能力系统、社会后果及例外 |
| event | 目标、行动、选择、结果；参与者、地点、前置事件、状态变化 |
| chapter / scene | 层级、叙述顺序、视角；对应事件、正文和来源 |
| storyline | 核心问题、风险、阶段、推进事件和解决条件 |
| arc | 人物初始信念、转折、变化与终点 |
| foreshadow | 埋设、提示、预期兑现与实际揭露 |
| conflict | 主体、目标、阻碍、代价、选择和结果 |
| assertion | subject、predicate、value、信息性质与证据 |
| knowledge | knower、assertion、认知方式、获知事件；允许错误信念 |
| revelation | assertion、正文位置、揭露方式 |
| rule | 类型、强度、作用域、有效时间、确定性条件或自然语言建议 |

关系具有独立 ID、from、to、kind、说明、有效时间和来源。基础关系包含 participates、located_at、member_of、owns、causes、before、part_of、advances、knows、reveals、foreshadows、conflicts_with 和 related。因果与先后边不能含环；其余环由业务含义决定。多主体事件使用事件节点及参与边。

## 三种时间与信息边界

WorldTime 包含可选的起止序号和显示标签。未知时间保持未知，序号仅在同一小说时间轴可比较；相对先后使用 before 边。NarrativePosition 使用章节/场景次序和正文位置。Revision 使用递增小说版本。

作者视角允许查询全部已接受记录。人物视角只加载该人物已知断言及当时的认知；读者视角只加载叙述位置之前的揭露。Planner 可以使用作者视角规划后续；Writer 必须接收明确的可写信息边界，秘密可作为禁止提前揭露的约束单独提供。

## 正文与来源

DocumentRevision 保存正文、对象关联、revisionId 和 parentRevisionId；创建时间从写入该修订的 Commit 追溯。首版不额外存储每段正文的 hash，完整备份提供 SHA-256。SourceRef 指向 documentId + revisionId + UTF-16 start/end，引用文本从不可变修订读取；偏移必须在该修订内有效。重复导入是新的独立文档；更新既有文档必须指定原 ID 和父修订。导出不改变正文版本。

## 领域聚合

Harness Workspace 管理目录、项目名称和会话归属，不复制成 Mythor 领域聚合。NovelState 管理内部小说身份、作品标题、正式版本、StorySeed 与 active/paused 创作状态。StorySeed 的世界规则、主角、欲望、阻碍、失败代价和核心未知均可缺省；`seed.put` 与其他正式操作一样进入 ChangeSet、校验、审阅、提交和补偿历史。ChangeSet 包含对象、关系、正文或种子操作及预期基线。Commit 保存原操作、逆操作、来源变更集和作者。WorkflowRun 保存类型、阶段、输入、产物、状态及执行会话。Grant 由作者签发，限制任务和操作对象。

不把会话、模型凭据或 Harness Agent 状态复制成领域对象。Repository 提供事务和查询；实体详情、图谱、时间线与上下文都读取同一数据源。
