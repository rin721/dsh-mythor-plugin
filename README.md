# Mythor · DeepSeek Harness 小说创作工作台

基于 [docs/goal.md](docs/goal.md)：规则塑造人物处境，欲望遭遇阻碍，选择产生后果，后果改变状态。Mythor 将这些创作活动组织为可持续维护的领域数据、阶段任务与可审阅变更。

## 安装

要求 Node.js 24+，DeepSeek Harness **0.1.7-rc.2**。其他 Harness 版本需要先运行兼容验证。

```powershell
pnpm install
pnpm build
dsh plugin --profile web add .
dsh web
```

安装可复制的发布包：`pnpm pack`，然后 `dsh plugin --profile web add <包路径.tgz>`。现有 Host 更换插件代码后需要重启。Desktop 使用自身插件管理器安装同一个 bundle，不通过 CLI 修改 Desktop profile。

打开侧边栏 **Mythor**：新建项目 → 添加人物/设定或导入正文 → 审阅候选 → 接受提交。正文、人物、事件、关系、知识与规则共享一个领域模型。

## 创作与对话

在 Harness 对话中输入：

```text
/mythor project list
/mythor project use <项目 ID>
/mythor focus <人物或场景 ID>
/mythor write 林烬在废弃车站取得地图，但顾清开始怀疑他的身份
/mythor review
/mythor commit <变更集 ID>
```

`plan`、`revise`、`check` 创建对应阶段任务；`resume <任务 ID>` 恢复，`cancel <任务 ID>` 停止领域任务；`history` 查看正式提交。任务阶段产物保留在数据库，可在工作台查看。自然语言可直接调用已绑定项目的 `mythor_*` 工具。

模型默认只能创建候选。作者可在「创作任务」页为指定对象授予 24 小时任务授权；范围以外或有未处理检查结果的修改仍需审阅。授权不替代 Harness 自身的工具审批。

## 数据与交换

默认目录为 `$DSH_HOME/mythor`（未设置 DSH_HOME 时为 `~/.dsh/mythor`）。每个项目独立 SQLite 文件，catalog 保存项目及会话绑定。正文不可变修订、提交历史、来源和任务一并保存。不要在运行中手动改数据库。

- 导入 Markdown/TXT 先生成原文候选，不自动认定小说世界事实。后续提取任务负责人物、事件和状态整理。
- 导出正文为 Markdown；「项目备份」包含完整 JSON 数据及版本，恢复到新的项目，保留对象 ID 并撤销旧授权。
- 草稿、计划、假设与已接受事实分开；人物知识、读者揭露与世界时间独立。
- 图谱提供局部展开、聚焦、路径追踪及关系编辑；编辑进入同一审阅流程。

## 配置

通过用户自己的 Harness patch 覆盖 `mythor` 行：

```yaml
- id: mythor
  config:
    dataDirectory: D:/novels/mythor-data
    maxImportChars: 5000000
    maxGraphNodes: 200
    contextChars: 24000
```

配置覆盖遵循 Harness 的完整 config 替换语义。缺省字段由 Plugin Config 填充。

## 开发与验证

```text
pnpm typecheck
pnpm build
pnpm test
pnpm check:docs
pnpm benchmark
```

Harness 集成测试消费构建产物，`pnpm test` 的 pretest 自动执行 build。领域测试使用真实 SQLite，Gateway 测试使用公开 Cordis/Typert 服务。浏览器和真实模型验证证据见 [实施记录](docs/implementation/status.md)，未执行的验证不会标为通过。

设计入口：[文档导航](docs/README.md)。公共契约在 `src/shared`，领域在 `src/domain`，SQLite 在 `src/storage`，宿主适配在 `src/index.ts`，工作台在 `src/client`。

首版不包含多人协作、独立故事分支合并、外部 Markdown 双向同步或向量服务。文学质量检查是带证据的建议，不作为模型已经证明作品合理的保证。
