# 实施与验证记录

记录日期：2026-09-29。当前开发版本：0.3.0。本文只记录已实现能力、本轮实际证据和未验证边界；`docs/goal.md` 保持原样。下方 0.2.0 内容为历史交付记录。

## 0.3.0 创作闭环实施

本轮接入渐进意图、普通语言结构翻译、分层规划、原生作者问答、受限写作、九类变化提取、独立检查和内部接纳策略。数据仍由工作区 SQLite Worker 维护，模型仍由 Harness Agent Loop 和官方 spawn Provider 执行。普通讨论/探索只写 Session 全量访谈事件及原生投影，不创建 `.mythor`；持续意图经核验后自动建立暂定标题。

已实现路径见 [创作闭环设计](../design/11-creative-loop.md)、`src/application/creative.ts`、`src/application/interview.ts` 与 `tests/creative-loop.spec.ts`。接口完整发布 Harness 支持的 JSON Schema，执行及结构化输出继续严格 Zod 校验。Host 策略凭据绑定候选基线和操作哈希；模型不能提供策略身份，旧授权不能绕过正文/事实协调。原生问答绑定具体候选，自由文本不自动批准。

### 本轮实际证据

- Windows / Node 24.11.1 / pnpm 10.22.0；依赖固定为 npm 发布的 Harness 0.1.7-rc.2，无相邻 checkout 源码作为发布依赖。
- `pnpm typecheck`、`pnpm test`（42 项 Node + 10 项 jsdom UI + UI 静态边界）、`pnpm check:docs`（20 个 Markdown）、`pnpm format:check`、生产构建通过。
- 真实 Harness Loop 可控模型用例：普通小说讨论不建库；单画面探索无需标题或专业字段；持续创作初始化；重要规划两次原生问答；十次低风险正文无需逐章批准；关闭 SQLite Worker，换同工作区新会话写第十一章。该章明确事件与正文共同提交，下一次 ContextPack 包含事件。
- 同一真实 Loop 用例：原始参考笔记多批（每批 ≤12,000 字符）提取与独立复核；批次检查点推进；重复执行不重复接纳；笔记不混入正文导出。此用例的材料提取结果为无领域变化，不代表复杂小说自动提取质量已验证。
- 存储/边界回归：同项目共享与跨项目隔离、版本冲突、哈希凭据拒绝、旧库一致备份升级、v1/v2 备份读取、历史修订、来源失效、任务恢复、草稿合并。人物误信不提供真实断言；死亡人物新行动和同时间物品持有冲突有证据化检查。
- 干净本地 clone 后覆盖本轮未提交源码，`pnpm install --frozen-lockfile` 和 `pnpm build` 成功。不是已发布 GitHub 分支的验收。
- `pnpm pack --pack-destination .test-output` 生成 0.3.0 本地包，Harness CLI 在独立 `mythor-verification` profile 安装成功。安装提示缺失宿主 peer 依赖；包安装成功不等于真实 Web 运行验收。
- 本地目录 add 实测失败：pnpm 生成 `profile\\D:\\...` 无效 junction，Harness 无法解析 bundle；README 改为 clone → install → build → pack → 本地 tgz add，未修改 Harness 内核。
- 一次与安装并行的测试运行出现 `ERR_IPC_CHANNEL_CLOSED`；随后独立重跑成功。官方 UI 发布包缺少 `index.js.map` 的 sourcemap 警告仍存在，不影响已通过测试。
- 50章正文和50项密集规则的存储压力夹具触发明确的 `context-budget` 暂停；这是预算失效防护证据，不能计为50章真实 Agent 连续创作验收。
- 从 tarball 切到错误目录 junction 后，再安装 tarball 曾报 `ERR_PNPM_EPERM`；隔离 profile 的坏链接影响包替换，不归因于领域事务，未修改用户现有 Web profile。
- 最终源码重新打包后，在全新 `mythor-030-package-check` profile 再次执行本地 tgz add 成功（退出码0）；依然有宿主 peer 提示，未将其描述为真实 Web smoke。

### 尚未完成的验收与边界

不能将可控模型响应计为文学理解、合理推演或长篇创作质量达标。当前没有完成真实 Harness Web 的 0.3.0 十页/主题/布局检查，完整关闭 Harness 进程后恢复访谈、50章密集资料的关键覆盖压力测试、全部九类状态变化的多场景连续创作、复杂 Retcon 后文逐章修复、混合已有小说的别名/矛盾问答，以及 Linux/macOS 验证。

Retcon 已提供影响证据和修复路线，后续修复由根 Agent 在作者决定后使用规划与协调工具推进，不是独立自动重写所有后文的执行器。关键上下文预算不足目前安全暂停并提示缩小范围；没有宣称自动多轮补检索已完成。翻译生成的新人物设定保守保持假设，需要后续作者决定/来源提取成为事实。完整计划仍需这些针对性验收，不标记“全部完成”。

## 0.2.0 交付状态

| 范围 | 状态 | 当前实现 |
| --- | --- | --- |
| 项目归属 | 已迁移 | Harness Workspace 是唯一项目空间；Host 由 Agent Session 的不可变 cwd 与 WorkspaceRegistry 解析当前小说 |
| 小说状态 | 已迁移 | Project 聚合改为 NovelState；正式版本、StorySeed、对象、规则、正文、候选、历史和任务由 Mythor 维护 |
| 存储 | 已迁移 | 每个工作区使用 `.mythor/novel.sqlite`；状态查询不创建目录，作者启用时才初始化并生成局部 `.gitignore` |
| UI 承载 | 已迁移 | 十个创作页面注册到公开 `conversation.view`；首条消息前使用 `conversation.input.left` 的紧凑控件打开官方启用 Modal |
| Agent 上下文 | 已迁移 | UI、命令、Tools、上下文和任务共用 WorkspaceNovelManager；每次 `system-prompt/assemble` 读取最新 ContextPack |
| 实时失效 | 已实现 | Agent-scoped Typert stream 发布工作区 generation，Client 重读快照并在卸载时取消订阅 |
| 初始化与导入 | 已实现基础闭环 | 支持空白新作、可缺省 StorySeed、文本/Markdown/TXT 与项目材料导入；材料先作为不可变来源和候选保存 |
| 旧数据 | 已实现显式迁移 | v1 catalog/数据库只读快照迁入空工作区；v2 备份可写，v1/v2 可读；不自动推断或覆盖已有小说 |
| 公共契约 | 已破坏性升级 | 请求不接受 projectId、novelId、Session ID 或数据库路径；移除项目 catalog、binding 和项目管理 Remote |

正式事实仍只通过已检查的 ChangeSet、作者审阅或有限授权及版本校验提交。模型工具不能启用项目、恢复备份、迁移旧库或签发授权。

## 本轮自动化验证

在 Windows、Node 24、pnpm 10 上实际运行：

- `pnpm typecheck`：通过。
- `pnpm test`：通过。主测试 30 项，独立 jsdom UI 测试 10 项；测试前完成生产构建并执行 UI 边界检查。
- `pnpm check:ui`：通过，业务页面没有绕过统一组件适配层。
- `pnpm check:docs`：通过，检查 16 个 Markdown 文件的相对链接。
- `pnpm pack --pack-destination .test-output`：通过，生成 `dsh-mythor-plugin-0.2.0.tgz`，包含 Host、Worker、Client、样式、类型、patch、locale、README 与设计文档。

自动化覆盖包括：未启用查询不创建文件、同工作区共享、不同工作区隔离、无效 Session 返回结构化状态、状态订阅、`system-prompt/assemble` 每次读取最新正式版本、显式旧库迁移、v1 `projectId` 到 `novelId` 转换、v1/v2 恢复、目标非空拒绝、种子 ChangeSet、候选与正式状态隔离、并发版本冲突、任务恢复和取消。旧库迁移使用含候选与未完成任务的合成夹具，不代表已经验证所有历史生产数据。

UI 测试覆盖适配组件的受控输入、文件选择、Select 键盘行为和 Modal 回焦、首条消息前的紧凑启用控件、无工作区的安静空状态，以及实体编辑发生版本冲突时保留输入。Host 测试覆盖 Agent 创建期间 WorkspaceRegistry 尚未登记新 Session ID 时的扩展安装判断；正式请求仍执行会话归属校验。官方 UI 发布包缺失声明的 `index.js.map`，Vite 会打印 sourcemap 警告；测试和构建仍通过。

## 真实 Harness 0.1.7-rc.2 验证

使用隔离的 `.test-output/harness` profile，通过官方 CLI 安装本轮 tgz 并启动 Web Host，没有修改用户正式 profile。实际确认：

- Mythor 出现在原生“对话 / 轨迹”工作区域中的第三个 Tab，没有独立顶层应用或第二套项目选择器。
- 未启用工作区能显示初始化说明、从想法开始、旧版迁移和备份恢复入口。
- Client 通过 Session scope 调用 `remote.mythor`，Agent lookup 使用 Harness 公共 `SessionId` 线路类型；刷新后状态请求与订阅建立成功，没有 Gateway provider mismatch。
- Host 直接持有 Typert 严格描述符注册；真实 Web 状态请求已接受 Client scope 自动注入的 `agentId`，不再回退到 SRC 推断并报 `unexpected "agentId"`。
- 已有对话只显示 Mythor 原生工作区；无有效工作区的真实 Web 页面显示选择工作区说明，没有红色错误反馈。首条消息前的紧凑启用控件及官方 Modal 已由浏览器组件测试验证，未在本轮真实 Web 中越过首次模型配置弹窗复验。
- 只读取未启用状态不会在当前工作区创建 `.mythor`。
- tgz 能由 Harness 插件命令安装。独立 pnpm profile 安装时会报告宿主 peer 依赖缺失警告，运行时由 Harness profile 提供这些共享模块。

本轮没有在仓库工作区点击“启用”，以免制造本地小说数据；启用后的存储、共享和迁移由自动化临时目录覆盖。

## 尚未验证

1. 当前隔离 profile 未配置可控模型，因此没有执行真实模型的渐进提问、文学质量、材料分批理解和 system prompt 内容质量验收。
2. 同工作区多真实会话、恢复会话、子 Agent 与移动目录后的端到端行为尚未在 Web 中逐项操作；自动化验证了作用域解析、共享、隔离和路径随目录存储的实现。
3. 十个页面和全部弹窗在 0.2.0 下没有重新执行完整人工回归；现有 UI 组件与版本冲突回归通过，0.1.x 的人工流程不能算作本版证据。
4. 深色主题、窄屏、Desktop、跨平台 CI、长时间运行和大规模浏览器性能未在本轮实测。
5. 旧授权失效、未完成任务转为 pending 和原库不变由迁移代码与合成测试覆盖，尚未使用真实 0.1.x 用户数据库复验。

后续验收应优先使用可控模型在独立 Harness 工作区走通“对话产生候选 → Mythor 审阅提交 → 下一轮对话读取新版本”，再补多会话、子 Agent、目录移动和十页完整回归。

## 2026-09-29 目标复核补充

基于 `8297597` 继续核验用户提出的小说创作能力目标，结论见 [目标核验](goal-validation.md)。本轮重跑原有主测试 30 项、UI 测试 10 项及 UI 边界检查，全部通过；新增宿主作用域闭环用例后，单独运行 `tests/harness.spec.ts` 的 8 项测试通过。闭环覆盖模型候选、无授权拒绝、作者接受及另一会话读取最新种子、正文和关系，使用真实 SQLite Worker 与公开 SystemPrompt 服务，未调用模型。

代码检查确认普通对话指导、已存在会话的即时启用、写作阶段信息边界、等待用户补充、跨会话任务接续和材料类别持久化仍有缺口；子 Agent 的作用域继承路径尚需实现与真实验证。此前“已迁移/基础闭环”的描述不能理解为新手长篇创作全流程已验收通过。

## 2026-09-30 持续创作工作台与状态边界

本轮修复 Host `agents` 依赖注入；在根 Agent 的既有创作指导和工具上，加入项目级创作来源回读。活动会话读取宿主 Session 事件快照，已关闭会话读取公开 SessionQuery；先前并行测试服务误共用 `DSH_HOME` 时出现的 `session/writer-held` 属于两个进程争用同一会话存储，隔离后真实 Web 工作台不再出现该错误。未建立小说时只读取有作者原文依据的结构化探索事件，不创建 `.mythor`。建立后以 `creative.put/delete`、来源、版本、哈希和补偿进入原项目库；提交的假设仍保持假设。

`workspace.progress` 是只读投影，正式领域数据在 SQLite 读取事务中组装，运行状态单列；读取不改变修订。创作页收敛为“创作 / 正文 / 故事资料”，检查、审阅、任务、历史和维护操作按需进入。启发入口仅使用宿主 Composer 的插入 API。新增中英文核心工作台文案，错误正文对普通用户隐藏底层细节，折叠诊断仍可查看；窄屏事项区域前置。

实际执行：`pnpm typecheck`、主测试 43 项、UI 测试 11 项、`pnpm format:check`、`pnpm check:docs`、`pnpm check:ui` 和 `pnpm build` 均通过；最后的本地 tgz 通过官方 `dsh plugin --profile web add <本地路径>` 安装进隔离 `.test-output/harness` profile。真实 Harness `0.1.7-rc.2` Web 中验证：原生“对话 / 轨迹 / Mythor”仍在，未建库时三个新入口及空状态正常，无业务错误；同一已有会话的启发文本插入唯一 Composer，原有草稿保留且不自动发送；切到故事资料仍提供自然的未建小说状态。未发送模型请求，没有触碰用户正式小说数据。

本轮已在真实 Harness Web 检查空状态的浅色、深色外观，以及 620px、390px 窄屏布局；检查后将宿主外观恢复为“跟随系统”。真实模型文学质量、全部原领域页面和弹窗的本轮人工回归尚未完成。先前十页或旧版弹窗截图不能算本轮证据；可控模型的真实 Harness Agent Loop 回归只证明接线、权限和事务行为，不证明模型创造力。

追加验证：历史成员会话不可读时，进展标记 `unavailableSessions`，不清空已读内容；正式迁入暂停，避免假装来源完整。该行为由真实 Harness Loop 集成测试的不可读成员会话用例覆盖。
