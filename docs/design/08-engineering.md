# 工程与维护规范

TypeScript strict、ESM、pnpm；Host 和 Client 独立构建。Node 范围跟随验证过的 Harness 基线；启动时检测 SQLite 能力。发布为 dsh bundle，附编译产物、patch、图标、locale、README 和契约类型。

## 规则

- 公共边界 schema 驱动，错误使用稳定 code；禁止吞掉数据库或模型失败。
- 业务变更只走应用服务，UI 不写 SQL，模型工具不获得任意 SQL/文件权限。
- 限制可配置：导入字数、查询数量、图展开深度、上下文预算；超限明确报错或返回 truncation。
- 内部数据不使用通用 any；持久/模型/网络输入先验证。
- 不提交凭据、用户小说数据库、node_modules 或构建临时文件。
- 新存储格式有 schemaVersion；新迁移必须提供前一版本 fixture 和失败恢复测试。
- 依赖版本和 Harness 基线记录在锁文件及 ADR；不得直接导入旁边 checkout 的内部源码作为发布依赖。
- UI 通用控件统一经过 client/ui，官方组件优先，缺失能力按 ADR 0002 适配；业务页面不得直接导入 Radix 或使用未经适配的表单控件。样式使用 CSS Modules，避免宽泛元素选择器影响官方组件。

## 测试层级

领域单元：时间、认知、规则、候选状态、逆操作、阶段推进。
存储集成：真实 SQLite、重开持久化、原子提交、幂等、冲突、来源失效、迁移和备份恢复。
Harness 契约：真实 Cordis tools/commands、Agent-scoped Remote、Workspace 作用域、conversation slots、生命周期卸载、模型不得签发授权。
UI：真实浏览器中的表单、审阅、图谱和取消；深浅主题及无障碍基本语义。

组件测试：`pnpm test:ui` 使用独立 jsdom 配置，覆盖空选择、未知数值、中文受控输入、文件重复选择、表单提交及官方 Modal 内 Select 的 Escape/回焦。`pnpm check:ui` 检查导入与 JSX 边界；`pnpm test` 包含领域测试、组件测试和边界检查。jsdom 不验证真实几何布局，不能代替宿主 smoke。
模型流程：固定重放响应，覆盖无凭据、无效输出、取消和恢复；真实模型 smoke 单独标记，不将 fixture 当成真实模型。

## 性能与诊断

基准输入为 300 万汉字、3,000 场景、10,000 对象、50,000 关系。记录运行环境、索引耗时、检索耗时和内存；图谱默认局部展开。性能目标为常用局部查询 500ms 内、首屏 2s 内（本机、预热索引），首次索引单独报告。未经运行不得标记达标。

诊断应关联 workspaceId/novelId/taskId/changeSetId 和错误码，默认不输出整段用户正文或凭据。数据库版本保存在存储元数据，Harness 基线记录在实施文档。备份在一致快照上执行；恢复只进入尚无创作内容的目标，旧版迁移使用只读一致快照且不改变原库。

## 完成定义

0.3 的 `tests/creative-loop.spec.ts` 使用 npm 发布的 Harness Agent Loop、SessionQuery、官方 spawn 和原生问答配合可控 LlmAdapter，不导入相邻 checkout 的测试辅助或内部源码。Schema 必须通过官方子集验证，业务执行仍用 Zod 严格校验。

设计、实现、验证分别列出。发布前运行 typecheck、单元/集成测试、build、打包安装检查与真实 Harness UI smoke。缺少运行环境或凭据时报告具体未验证项，不写「全部通过」。
