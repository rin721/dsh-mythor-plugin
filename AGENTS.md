# Mythor 工程约定

先读 docs/README.md 和相关设计。docs/goal.md 是核心认知依据，不改写为功能清单。领域概念以 docs/design/03-domain.md 为准。

UI、工具和命令必须共用应用服务。正式事实只经可审阅 ChangeSet 和版本校验提交；模型不能签发授权。复用 Harness 生命周期、模型、工具、会话和 Client slots，不改 Harness 内核。不得导入相邻 checkout 内部文件作为发布依赖。

业务实现同步文档与需求追溯。运行与改动相关的测试、类型检查和构建，docs/implementation/status.md 只记真实证据。保持用户内容、密钥和本地运行文件不入库。
