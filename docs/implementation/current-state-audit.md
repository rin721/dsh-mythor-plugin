# Mythor 当前实现审计

日期：2026-09-29。仓库 HEAD：`8297597`，包版本 0.2.0。审计对象包含工作区已有、尚未提交的核验文档和 `tests/harness.spec.ts` 补充测试。本轮没有修改实现代码、测试代码或 `goal.md`；本文件是审计交付。

依据：[goal.md](../goal.md)、[领域设计](../design/03-domain.md)及当前实际调用路径。这里的“已实现”限定为具体能力，不代表整项产品目标已完成。代码静态分析、确定性数据探针、宿主服务测试、真实模型行为分别计证。

**总体判定：目前主要是基础架构，尚未形成小说创作闭环。**

已经形成的是“结构化候选 → 校验/作者确认 → 原子持久化 → 下一次上下文读取”的领域事务闭环。尚未形成的是“新手自然语言 → 创作理解/少量追问 → 作者决定 → 长期规划 → 场景正文 → 完整变化提取 → 语义一致性 → 下一次创作”的可靠产品闭环。不能把前者作为后者的完成证据。

## 1. 当前实际架构

```text
用户选择 Harness Workspace / Session
├─ 对话 → Harness Agent / 原生模型请求和工具循环
│  ├─ agent/created → Mythor installFor（已启用目录才注册）
│  ├─ system-prompt/assemble → context（每次读最新正式版本，固定 author）
│  └─ mythor_* 工具 → WorkspaceNovels.request（Actor=agent）
├─ /mythor 命令 → WorkspaceNovels.request（Actor=author）
└─ conversation.view / input.left → Session-scoped Typert Remote
   → MythorRemote.request（Actor=author）
   → WorkspaceNovels.resolve：cwd + WorkspaceRegistry.sessionIds
   → 每个规范化工作区一个 MythorApplication Worker
   → Store.execute → 领域校验 / 阶段状态机 / SQLite 事务
   → <workspace>/.mythor/novel.sqlite
   → entities / relations / documents / revisions / changes / commits / tasks / grants / FTS
   → mutation 通知 → Typert watch → UI 重读 snapshot
   → 下一次已注册 Agent 的模型请求 → 新 ContextPack

UI/命令 task.start 或 task.resume
→ 持久化 WorkflowRun → agent.followup(taskMessage)
→ 仍由 Harness Agent 执行，不是 Mythor 的模型循环
```

证据：`src/index.ts` 的 `MythorRemote.request/dispatch`（51–110）、`registerTools`（176）、`installNovelContext`（228）、`apply/installFor`（251）；`src/application/workspaces.ts` 的 `resolve/open/request`（29/74/87）；`src/application/service.ts` 的 Worker RPC；`src/storage/worker.ts` 的消息处理；`src/storage/store.ts` 的 `execute/check/commit/context`（139/428/469/797）。Client 注册见 `src/client/index.tsx`（159 起）。

边界判断：正常路径已没有独立 Mythor Project catalog、项目切换、手动会话绑定、模型客户端或 Agent Runtime。内部 novelId 是持久记录身份，不是第二个用户项目；旧 catalog 只用于明确的旧版迁移。SQLite Worker 和小说任务状态机属于领域设施，不能仅因存在它们就判定重复实现 Harness。

仍有集成缺口：启用只为当前 Agent 安装，另一个已经存活的同项目 Agent 不会因此自动补装；新建/重新实例化 Agent 会走安装钩子。子 Agent 的实际请求还要求自身 ID 在 registry 中；没有显式父会话继承路径，不能宣称所有子 Agent 都可用。公开会话 fork 有宿主 attachSession 路径，但不等于所有委派实现。`watch` 失败后只刷新一次，Client 没有显式重订阅循环。

## 2. 当前实际用户工作流

1. 用户在 Harness 创建或选择工作区。无有效工作区时，App 捕获 `workspace-unavailable`，展示宿主选择引导；未启用时查询状态不创建小说数据库。
2. 首条消息前，输入工具栏显示 Mythor 按钮，弹窗要求作品标题；已有对话可进入 Mythor Tab 启用。启用只建立 NovelState，不自动建立创作访谈任务。
3. “从一个想法开始”只把一段追问提示写入 Harness 输入草稿，**不发送、不启用、不保存用户想法、不建立初始化任务**。未启用直接发送时普通 Agent 尚无小说工具和上下文。
4. 可填写可选 StorySeed。种子进入候选，作者审阅后才成为正式版本；没有待问问题/已答问题/等待用户补充的持久引导状态。
5. 启用后，普通对话由 Harness Agent 响应。插件提供最新状态 JSON 和宽泛的工具定义；普通请求没有任务消息中的 `GENERIC_HELP`，也没有可靠的新手追问与结构翻译策略。
6. 作者可通过命令或任务页创建 plan/write/revise/check 任务。Remote 用当前 Agent 的 followup 执行。模型需要自己找到正确 payload、逐段保存产物、构造候选；阶段提示不会自动完成这些动作。
7. 作者在审阅页查看差异、校验、接受或拒绝。提交重验版本和规则，原子写入正文/对象/关系，随后 UI 和已装钩子的 Agent 读取新版本。
8. 正文编辑器“保存草稿”只提出 `document.put`，可单独接受。新正文不会强制启动事实提取；旧正文只在已有实体 SourceRef 失效时生成 check 任务。
9. 导入先预览/拆正文章节或保存参考文档，再接纳来源；同时建立独立 import 任务。作者需要恢复任务，之后由 Agent 尝试提取。文件导入本身不是 Agent-assisted migration 的完成。

证据：`src/client/App.tsx` 的 onboarding（424–445）、EnableForm 提交（1205–1224）、正文保存（674–697）、ImportForm（1665 起）、任务 UI（1119 起）；`src/client/index.tsx` 的 `EnableControl/servicesFor`；`src/index.ts` 的 `taskMessage/GENERIC_HELP`；`Store.importText/startTask`。

## 3. 目标能力审计矩阵

| 能力 | 状态 | 实际证据和边界 |
| --- | --- | --- |
| 一 Harness 工作区一小说 | 已实现 | `WorkspaceNovels.resolve/open`；同目录共用 Worker，不同目录隔离；普通路径没有第二层项目 |
| 复用 Harness Runtime | 已实现 | `MythorRemote.dispatch → Agent.followup`、`registerTools`、`agent/created`、`system-prompt/assemble`；没有自建模型调用循环 |
| 原生工作区承载 | 已实现 | `client/index.tsx apply → conversation.view/input.left`；十页用同一 API，不另建顶层应用 |
| 模糊想法的新手引导 | 部分实现 | 不完整 seed 可存；onboarding 仅 setDraft；没有初始化任务、问题队列、少量追问策略和已答进度 |
| 用户语言 → 创作模型翻译 | 未实现 | `ROLE_GUIDANCE` 只有原则；人物弧表单暴露 initialBelief/turningPoint/endingBelief；没有可验证的翻译协议、决策记录及恢复路径。通用模型可能临场做到，不等于插件实现 |
| 长期领域存储 | 已实现 | `Store` 的 SQLite 实体/关系/修订/候选/历史/任务；重开测试和 50 章探针通过。证明存得住，不证明用得正确 |
| 领域对象参与创作决策 | 部分实现 | `context` 能返回对象与关系；具体 kind 无行为策略，属性大多任意 JSON；规划、提取、写作是否使用取决于 Agent |
| Scene Before/After | 部分实现 | ChangeSet 可原子保存正文和变化；没有变化集覆盖检查或前后状态模型；正文可单独提交 |
| 正文 → 自动变化提取 | 部分实现 | 有 extract 阶段提示和 propose；没有执行中的专用提取能力或强制数据依赖；探针正文提交后关系/知识均未变化 |
| 形式化阶段推进 | 已实现 | `domain/workflows.ts advance` 禁跳阶段；`Store` 校验/审阅推进及持久化恢复是真的 |
| 阶段语义与核心创作循环 | 仅存在结构 / Mock | 不是整个流程 Mock，但“完成了 read/plan/extract 的内容”只有任意 JSON 产物与提示；没有产物契约保证实际读、规划、提取。现有测试用字符串“extract产物”即可推进 |
| 分层长篇规划 | 未实现 | 有 storyline/arc/chapter/scene、任意 part_of 边和 plan 任务；没有卷/篇章/beat 规划契约、上下层约束、计划消费与下层反馈机制 |
| 作者接受后的计划继续生效 | 部分实现 | `task.finish` 保存 accepted；不自动转领域规划。`context.pending` 排除 completed，且不载入已接受 plan 产物；需模型另行创建领域对象 |
| 候选/假设/正式记录分离 | 已实现 | informationStatus fact/plan/hypothesis 与 editorialStatus 分轴；模型候选不立即写头状态；`commit` 要作者或有效 grant |
| 用户阶段性创作决定 | 部分实现 | 最终审阅有效；缺少可恢复的 Ask/Propose/Decide 产物，simulate→write 没有独立作者选案检查点；seed/关系也没有逐项决策性质 |
| 版本及结构冲突保护 | 已实现 | `check/commit` 检查旧基线、正文父修订、引用、因果环、来源和确定性规则；事务回滚、幂等真实有效 |
| Canon 语义/剧情漂移防护 | 部分实现 | 仅三类属性/关系 rule evaluator；自然语言规则 unknown。没有自动对比历史事实、OOC、死亡复活、物品瞬移、知识泄漏检查 |
| Critic 参与提交 | 部分实现 | task.critique 真正并入检查；warning/unknown 会阻止模型自动提交、需作者确认。但 Critic 调用非必需，不能宣称每次内容受检 |
| 视角与知识隔离 | 实现方向与目标冲突 | `context` 的人物/读者查询有过滤；`installNovelContext` 每次固定 author，秘密已经注入 Writer。额外受限查询无法撤回全知信息 |
| 长期检索与 Memory | 部分实现 | FTS 中文检索、规则优先、焦点一跳、末三个文档、字符预算；没有角色/阶段检索计划、最近事件/未回收伏笔优先或不足后的补检索保障 |
| 连续创作和跨会话恢复 | 部分实现 | DB 重开/任务检查点真实；pending 仅无 ID 字符串，模型没有任务 list/detail 工具，恢复依赖 UI ID；未完成任务版本变化清空阶段产物重新读 |
| 创作经验 Reflection | 未实现 | 没有独立经验记录、适用条件、案例关联、失效或消费路径；不能把任意任务 JSON 当经验系统 |
| Agent 辅助已有作品迁入 | 部分实现 | `importText` 保存材料+import 任务；没有批次/来源 ID/类别检查点、歧义解决工作流和稳定自主提取证据 |
| 旧数据库迁移/备份 | 已实现 | `workspaces.ts` 只读一致快照、空目标原子安装；v1→v2 转换与清授权测试。此能力与阅读小说并理解其结构不同 |
| 图谱与双时间线 | 已实现 | `Store.graph`、`projections.movement/crossings`、App 投影共用数据；可查看结构，不自动建立和维护故事机制 |

### 长期 Story Model 逐类检查

统一证据入口为 `shared/contracts.ts EntitySchema/RelationSchema`、`Store.context`、`domain/validation.ts validate`、`App.tsx fields`；没有任何对象仅靠文件名判定有效。

| 对象 | 已接入内容 | 未闭合部分 |
| --- | --- | --- |
| 世界 World | setting/rule 可存、查询、注入；三类规则能硬校验 | 规则→社会后果→人物处境的推演只有指导文本 |
| 人物 Character | 档案、目标/需求等表单、状态 JSON、关系 | 动机行为生成、OOC 与人物弧演变不受服务检查 |
| Relationship | 独立 ID、时段、来源、原子更新、图谱 | 缺少前后关系转变及剧情解释检查；没有信息性质字段 |
| Faction | organization + member_of 等边 | 利益、资源、势力行为仍任意属性 |
| Location | 地点实体、located_at、行动路线投影 | 移动可达性/旅行时间/同刻多地无检查 |
| Item | 物品、owns 关系 | 多人同时唯一持有、转交完整性及资源守恒无检查 |
| Event | 事件、参与/地点/因果、时段 | 事实事件与计划区分依靠信息性质；行动后果不自动提取 |
| World Timeline | time/start/end、before/causes、部分冲突/环检查 | 未维护自动世界时钟、相对时间推导、完整历史状态重建 |
| Narrative Timeline | narrativeOrder、revelation、读者查询 | 写作主钩子未按叙述位置消费 |
| Plotline | storyline + advances/part_of、交叉投影 | 问题提出/升级/解决与未来章规划没有控制契约 |
| Character Arc | arc 的信念/转折/终点表单 | 没有普通语言翻译和各场景推进程度检查 |
| Secret | assertion 加揭露关系表达，没有独立 secret kind | 真相、误信和待揭示信息的写作约束不可靠 |
| Knowledge State | knower/assertion 引用校验、人物查询 | 误信 mode 可存但未形成推理行为；全知注入泄漏 |
| Foreshadow | setup/payoff 属性、foreshadows 关系 | 埋设/兑现进度与逾期回收不主动维护 |
| Scene | 目标/冲突/行动/结果属性、正文关联 | 不强制 Before/After、视角、变化与正文互相印证 |
| Canon | accepted 正式对象、informationStatus、Commit 修订 | 正式接受的计划仍是 plan，不能一律叫事实；语义矛盾不会自动被历史比较检出 |

长篇状态不是完全依赖聊天，数据库确实存在。但字段能持久化与字段能约束 Agent 是两回事。多数领域语义止于“可表达、可查看、可作为上下文”，尚未到“必须参与决策与一致性维护”。

## 4. 五个场景的实际验证

验证方法：在临时目录直接调用真实 `Store.execute`，使用合成小说和确定性候选，重开真实 SQLite；探针放在被忽略的 `.test-output/current-audit.ts`。没有调用模型，没有冒充五个真实自然语言 Agent 端到端验收。A/B 只测下游不完整种子保存，创作理解必须另做真实 Agent 验证。

| 场景 | 能否完成目标 | 当前路径与实测 | 中断/缺少 |
| --- | --- | --- | --- |
| A 魔法世界、看见他人看不见之物 | 不能证明；插件尚无可靠完整路径 | 普通 Harness 对话；启用后能读取状态/用工具。合成 notes-only seed 候选成功，正式 seed 仍为空，自动任务数 0 | 未启用对话无领域能力；无持续访谈与决定翻译；正确 payload 要靠模型临场推断 |
| B 倒悬天空的城市 | 同 A | 单画面可保存不完整 seed，不要求专业字段全填 | 从画面到规则后果、人物处境、欲望和冲突只有通用模型临场发挥，没有可恢复过程 |
| C 数十章后关闭重开继续 | 持久化可；连续创作不达标 | 50 章+53 实体重开全保留。较短摘要探针包含最新事件、伏笔、48–50章正文；每章约600字符摘要的默认24000字符预算探针 truncated=true、漏未回收伏笔、excerpts=[]；最新事件仍在，不能夸大为全部历史丢失 | 没有下一章目标驱动的检索计划；作者视角与知识边界未接写作；completed plan 不进入常规上下文；无不足后主动补检索 |
| D 第30章后哥哥其实未死 | 能保存修改；不能可靠 Retcon | 已提交 fact 人物 alive=false，再提出 alive=true；changes.validate findings=[]，作者 commit 成功，alive=true | 版本校验只挡旧基线，不挡新版语义推翻；没有自动定位早期死亡证据、后文依赖、区分误报死亡/真复活/改历史和修复计划 |
| E Markdown/设定迁入 | 材料接纳可；自主理解闭环不足 | world 材料接纳只有 document.put；正式文档无 materialKind；import task 在 read、artifacts={}、focus=[]；无自动组织提取。任务可人工恢复给 Harness Agent | 无批次、文档身份与类别检查点；仅泛化提取意图；别名/歧义/冲突修正无完整工作流；模型实际自主提取未验证 |

额外反例：提交“把地图交给同伴并获知哥哥还活着”的新正文，提交成功；新增提取任务数 0、关系数 0、knowledge 数 0。系统不会因为正文中发生变化就自动维护结构状态。此探针证明可绕过领域变化更新，并不证明所有 Agent 都不会自行提取。

对于 OOC、物品瞬移、未铺垫信息：没有内置语义检查器，除非作者或模型主动提出针对性规则/critique，否则服务不能保证发现。时间区间倒置、先后因果冲突/环、认知引用不存在则有确定性拦截。错误范围不能混为一谈。

## 5. 看起来有能力，但实际未闭环

1. **有 read/goals/plan/simulate/write/extract 枚举，却没有对应产物语义契约。** `task.advance.artifact` 为任意 JSON；测试中的字符串也算完成。保证阶段顺序，不保证执行了那项创作判断。
2. **有 Planner 角色提示，却没有长期规划消费链。** plan 任务完成保存在 tasks，`task.finish` 只加 accepted；没有上层规划版本→场景任务→变化反馈。不能说完全未存计划，也不能说以后自动使用。
3. **有 Canon 事务，却没有一般的 Canon 语义比较。** 同 ID upsert 可以修改已确认人物；当前 `validate(next)` 主要检查修改后的结构，不分析历史事实差异的叙事意义。
4. **有 Critic 且结果真的阻挡提交，但 Critic 不保证运行。** 自然语言规则可 unknown 并要求作者确认，未建规则/未记录 critique 时不会凭空产生问题。
5. **有 extract，但正文可单独提交。** 状态变化不是正文章节提交的必需产物，下一章可能读取旧领域状态与新正文。
6. **有知识过滤，但 Writer 一直得到 author 上下文。** 容易让人物行为使用世界真相；不能将查询过滤测试当成写作信息控制测试。
7. **有恢复检查点，但新会话不知道任务 ID/已接受计划。** pending 是摘要字符串；任务模型工具无 list/detail；恢复更像作者在工作台挑任务。
8. **有材料类型选择，但没有长期材料类型。** 重开后的 Document 不记正文/设定/笔记类别，提取任务没记 source IDs；泛化任务不是分批阅读器。
9. **有 UI 图谱，但它是状态投影。** 路线和交叉来自已建立的边，不负责从正文构建或持续纠正它们。
10. **有“每轮只问少量问题”的入口文案，但没有引导系统。** setDraft 既不发送也不持久化创作访谈；GENERIC_HELP 只在任务 followup 中出现。

Memory 具体生命周期：正式实体/关系为长期状态，documents/revisions/commits为证据和编辑历史，tasks.artifacts为短期任务检查点，ContextPack为每轮临时投影，Host focus为内存 Map；没有独立事件记忆整合、经验 Reflection 或语义向量记忆。FTS 是词项检索，不是向量相似度；缺少向量库本身不是阻断问题，缺少正确的领域检索策略才是。

来源与恢复附加问题：修改正文只标 stale 实体，没有同等标记关系；affected 只从实体/文档种子沿出边扩散，单独关系变化不提供完整影响种子；焦点/编辑草稿多为 React/Host 内存，不能据设计文案声称跨关闭持久保留；watch 失败后未显式重订阅。这些需专项验证，不将未发生的 UI 丢失写成已复现。

## 6. 总体距离判断

**目前主要是基础架构，尚未形成小说创作闭环。**

架构边界基本正确，也比“资料+Prompt+续写”多了真实领域状态、事务、工具和审阅。但当前更接近“为熟悉操作的作者或遵循协议的模型提供小说数据库与任务工作台”。尚不能把创作理解、长期规划、状态提取和语义校验交给系统，让新手只负责想象、偏好和决定。

判断不依据代码量；依据上述反例：入口无初始化过程、产物无语义保证、规划不被稳定消费、正文无需更新领域状态、死亡复活无语义冲突、长篇预算会排掉关键材料。事务闭环有，产品核心闭环没有。

## 7. 缺口分级

### 阻断核心目标

- 普通对话缺少可执行创作方法、完整模型工具契约和可恢复的新手访谈/决定翻译。新手的模糊想法无法被可靠推进。
- 长期规划与场景任务没有上下层依赖和反馈链；已接受计划不稳定约束写作。
- 正文与变化提取没有强制关联、覆盖/证据检查，长期 Story State 会落后于正文。
- 语义 Canon/人物行为/资源/知识冲突缺少必须执行的检查；Retcon 没有证据与影响修复流程。
- 写作上下文固定全知；长篇检索不按任务、人物、未解决问题组织，也不强制补齐截断的关键依据。
- 当前已存活同项目会话可能未获工具、任务恢复缺少可查询身份/产物。目标中的跨会话持续创作不能只靠旧聊天。
- 已有作品的材料身份/类别、分批理解、歧义确认与 Canon 初始化不完整。此项阻断已有作品用户，未必阻断从零用户。

### 重要但不阻断

- 关系来源失效、单独关系修改影响范围不完整。
- UI/Host 草稿焦点生命周期、watch 重连、插件热启用和子 Agent 归属需要真实宿主验收。
- 审阅主要面向 JSON/差异；新手更需要用普通语言解释变更与后果，不必理解内部属性键。
- 文档漂移：04 称订阅尚未实现，10 仍有 `mythor_projects`；05 声称的检索顺序比代码强，06 子 Agent 继承没有完整实现路径。应按实际状态修正文档，而不是保留完成错觉。

### 后续增强

- 创作经验/Reflection、有条件撤销的经验建议。
- 更丰富语义检索、更多材料格式、长篇性能优化。
- 规划分支比较、审美/节奏质量评估、发布适配。向量库、多 Agent 角色并行和更多 UI 页面都不是当前第一优先级。

## 8. 下一阶段推荐顺序

1. **先建立真实 Harness Agent Loop 的可控验收基线与工具契约。** 从 A/B 验证模型获得哪些指导、怎样提问、怎样保存候选、怎样等作者决定；避免把手工 API 测试当创作测试。保持 Harness Runtime。
2. **补普通语言的引导和决定翻译。** 保存少量问题、回答、偏好、候选方向和等待用户状态；不完整片段可恢复。这一步解锁新手从零创作。
3. **建立可消费的长篇→场景规划及角色上下文。** 计划正式化并与下层任务关联；区分作者规划与可写信息；按任务取规则/人物/知识/近期后果/未解决线索，预算不足继续检索。解锁有方向且有记忆的正文创作。
4. **闭合场景正文→变化提取→检查→作者提交。** 有结构化 Before/After、来源证据及提取完成/待确认状态；不以任意 JSON 代替产物。解锁第 N 章影响第 N+1 章。
5. **补语义防漂移与 Retcon。** 查历史证据、比较新旧事实、列受影响正文/知识/规划、让作者选择解释或改写，再提出修复候选。解锁中后期可靠维护。
6. **在同一闭环上实现分批迁入及长期恢复。** 材料分类、source IDs、提取批次、歧义/别名决策和检查点复用前面机制；验证关闭重开、同项目多会话及恢复任务。
7. **最后做长篇场景与真实模型验收。** 不只看一章生成：连续十章、关闭后第十一章、50章冲突、重启迁入；文学质量与确定性协议正确性分别评价。

## 本轮证据范围

- `pnpm test`：构建成功；Node/SQLite 31 测试通过；jsdom 10 测试通过；UI 静态边界通过。
- `pnpm typecheck`：通过。
- 隔离 API 探针：不完整种子、50章重开/预算、死亡→存活、材料接纳、正文单独提交按第4节记录真实结果。数据位于临时目录，不是用户小说。
- UI 测试出现官方包缺失 source map 的提示，不影响结果；不把它当作运行时布局验证。
- 未运行：真实模型自然语言五场景、真实 Harness Web 全流程、跨平台、全量长篇性能。现有 `tests/harness.spec.ts` 使用简化 Agent/Registry、真实 Worker 和公开 SystemPrompt 服务，**不是真实 Agent Loop 或完整 Gateway/模型端到端测试**。
- 没有修改实现代码或本轮新增测试；没有提交或推送。已有未提交工作保持原样。
