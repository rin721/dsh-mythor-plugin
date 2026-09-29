# 实施与验证记录

记录日期：2026-09-29。当前交付版本：0.2.0。本文只记录已实现能力、本轮实际证据和未验证边界；`docs/goal.md` 保持原样。

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
