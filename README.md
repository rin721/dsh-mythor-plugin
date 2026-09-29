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

维护者发布新版本时，先将 `package.json` 的版本号更新并提交，再创建匹配的版本标签并推送：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions 会检查标签与 package 版本一致，运行检查和测试，构建 `.tgz` 并将其附加到 GitHub Release。仓库需允许 Actions 使用 `GITHUB_TOKEN` 写入 Releases（Settings → Actions → General → Workflow permissions）。发布后，用户按 Release 页面给出的 tarball URL 运行：

```powershell
dsh plugin --profile web add https://github.com/<owner>/<repo>/releases/download/v0.2.0/dsh-mythor-plugin-0.2.0.tgz
dsh web
```

在 Harness 创建或选择一个工作区，开始会话后打开“对话 / 轨迹”旁的 **Mythor** 视图。每个 Harness 工作区承载一部小说；首次明确启用后，同工作区会话自动共享人物、正文、关系、规则、候选与历史。

## 创作与对话

在 Harness 对话中输入：

```text
/mythor enable 作品标题
/mythor focus <人物或场景 ID>
/mythor write 林烬在废弃车站取得地图，但顾清开始怀疑他的身份
/mythor review
/mythor commit <变更集 ID>
```

`plan`、`revise`、`check` 创建对应阶段任务；`resume <任务 ID>` 恢复，`cancel <任务 ID>` 停止领域任务；`history` 查看正式提交。小说作用域由当前 Harness 会话的工作目录与 WorkspaceRegistry 自动确定，不接受手输项目 ID 或数据库路径。

模型默认只能创建候选。作者可在「创作任务」页为指定对象授予 24 小时任务授权；范围以外或有未处理检查结果的修改仍需审阅。授权不替代 Harness 自身的工具审批。

## 数据与交换

小说数据保存在当前工作区的 `.mythor/novel.sqlite`；`.mythor/.gitignore` 默认避免数据库、临时文件和材料进入 Git。删除 Harness 的工作区登记不会删除小说数据，重新登记同一目录仍可读取。`dataDirectory` 仅用于发现并显式迁入 0.1.x 旧数据。

- 导入 Markdown/TXT 可标记为正文、大纲、人物设定、世界观或笔记；原始材料先生成候选，不自动认定小说世界事实。后续提取任务负责人物、事件和状态整理。
- 导出正文为 Markdown；v2 备份包含完整 JSON 数据及版本，恢复只允许进入没有创作内容的 Harness 工作区，并可读取 v1 备份。
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
