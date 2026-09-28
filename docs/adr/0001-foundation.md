# ADR 0001：Mythor 基础架构

状态：接受；实现及验证见实施记录。

1. **领域在先**：goal.md → 作者判断 → 领域 → 流程 → Agent → Harness → UI。采用统一契约，避免页面各自发明字段。
2. **单正式历史**：候选与草稿独立，正式历史追加提交；撤销为补偿提交。首版不承担分支合并。
3. **项目 SQLite**：Harness storage-domain 仅支持单记录原子写入，不提供小说跨对象事务；原有 workflow 引擎不保存重启检查点。为这两个明确缺口实现领域事务和业务阶段记录，其余使用 Harness。
4. **Node SQLite Worker**：使用运行时自带驱动，避免平台原生依赖安装；阻塞 SQL 留在 worker。本机 Node 24.11.1 / SQLite 3.50.4 的 FTS5 内存探针已成功，其他运行时仍需 CI 验证。
5. **关系表与全文**：有类型的边足够支持邻域、路径和关联查询；FTS5 加中文分词提供确定性检索。首版无需外部图或向量服务，语义检索后续作为派生索引扩展。
6. **宿主内工作台**：使用 Client slot、React、主题和 locale，工具与 UI 共享服务。不创建第二套宿主、认证、LLM 或会话框架。
7. **模型不持有提交身份**：author/agent 身份由入口决定；模型参数无法创建 grant 或声称作者接受。
8. **Host/Client 契约**：遵循公开 Typert/Remote 机制，若发布工具链存在树外限制，先以契约测试确认并记录适配，不修改 Harness 源码来迁就 Plugin。

实施补充：共享 Zod schema 构造一份 Typert descriptor，Host/Client 使用同一份。真实 Gateway 验证 wire schema，真实浏览器验证服务依赖注入与 RemoteResult 解包。项目目录和会话到小说的绑定同属插件业务数据，保存在 catalog.sqlite；不复制 Harness 会话日志。首版采用手动 UI 刷新，不自建事件总线。FTS5 使用汉字二元切分与词项检索，不声称具有语义相似度能力。

依据：本地 Harness docs/architecture.zh.md、docs/api-gateway.zh.md、storage-domain/src/domain.ts、workflow/README.zh.md 及源码内 cordis-plugin-development 指引；初始基线 21638c5631 / 0.1.7-rc.2。
