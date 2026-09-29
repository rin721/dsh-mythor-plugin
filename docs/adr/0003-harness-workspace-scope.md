# ADR 0003：Harness Workspace 是唯一项目边界

状态：采用。目标版本：0.2.0。Harness 基线：0.1.7-rc.2。

Harness Workspace 已管理项目目录、名称与会话归属。Mythor 不再在其内部维护独立 Project catalog、项目切换或会话绑定；一个规范化工作区承载一部小说，小说领域聚合命名为 NovelState。Host 从 Agent Session 的不可变 cwd 解析 WorkspaceRegistry 并验证成员，所有 UI、命令、Tools、上下文与任务复用这一解析器。

小说数据库固定为 `<workspace>/.mythor/novel.sqlite`。状态查询不创建文件，作者启用时初始化并写入局部 `.gitignore`。浏览器和模型不能传 novelId、projectId 或路径。删除 Harness 登记不删除目录数据，目录整体移动后重新登记即可继续使用。

客户端使用公开 `conversation.view` 与 `conversation.input.left`，不修改 Harness 内核。首条消息前只在输入工具栏显示紧凑 Mythor 入口，启用表单使用官方 Modal。Remote 使用 Agent scope；每次模型请求通过 `system-prompt/assemble` 读取最新 ContextPack；Typert `watch` 流只发布失效信号，客户端收到后重读快照。正式状态仍由 Mythor 的 ChangeSet、版本校验、作者授权和 SQLite 跨对象事务维护。

0.1.x 数据只能由作者显式选择并迁入空工作区。迁移只读旧 catalog 和数据库的一致快照，转换 projectId 为 novelId、归档为 paused、未完成任务为 pending，并清除旧授权与执行会话。备份格式升级为 v2，同时读取 v1；已有内容的目标拒绝覆盖。
