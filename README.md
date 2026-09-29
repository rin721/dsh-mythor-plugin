# Mythor · DeepSeek Harness 小说创作工作台

基于 [docs/goal.md](docs/goal.md)：规则塑造人物处境，欲望遭遇阻碍，选择产生后果，后果改变状态。Mythor 将这些创作活动组织为可持续维护的领域数据、阶段任务与可审阅变更。

## 安装

要求 Node.js 24+，DeepSeek Harness **0.1.7-rc.2**。其他 Harness 版本需要先运行兼容验证。

从 Harness 仓库根目录执行以下 PowerShell 命令。先 clone、安装依赖并构建，再打包成**本地文件**安装；修改代码后重新打包安装并重启 Host。

```powershell
git clone https://github.com/rin721/dsh-mythor-plugin.git ..\dsh-mythor-plugin
Push-Location ..\dsh-mythor-plugin
pnpm install --frozen-lockfile
pnpm build
pnpm pack
Pop-Location
pnpm dsh plugin --profile web add ..\dsh-mythor-plugin\dsh-mythor-plugin-0.3.0.tgz
pnpm dsh web
```

不要把 GitHub Release 的 `.tgz` 直链传给 `dsh plugin add`。pnpm 10.22 对这类外部 tarball URL 生成的锁文件记录缺少 `integrity`，Harness 会拒绝安装。GitHub Release 中的 `.tgz` 仍可用于手动下载和归档。Desktop 使用自身插件管理器安装同一个 bundle，不通过 CLI 修改 Desktop profile。

维护者发布新版本时，先将 `package.json` 的版本号更新并提交，再创建匹配的版本标签并推送：

```powershell
git tag v0.3.0
git push origin v0.3.0
```

GitHub Actions 会检查标签与 package 版本一致，运行检查和测试，构建 `.tgz` 并将其附加到 GitHub Release。仓库需允许 Actions 使用 `GITHUB_TOKEN` 写入 Releases（Settings → Actions → General → Workflow permissions）。发布后，用户按上面的源码安装步骤 clone 对应版本并安装本地构建的包；不要将 Release tarball URL 作为 pnpm 依赖。Windows 的 pnpm 目录 link 可能生成无效盘符 junction，因此安装示例使用本地 `.tgz`。

在 Harness 创建或选择一个工作区，直接在对话里表达想法即可。普通讨论和探索不建小说库；明确继续创作后自动建立最小状态，无需作品标题或启用命令。同工作区会话共享小说；“对话 / 轨迹”旁的 **Mythor** 用于查看和修订。

## 创作与对话

在 Harness 对话中输入：

```text
我只想到天空中有一座倒悬的城市，其他还没想好。
我希望主角起初不相信别人，后来慢慢愿意相信。
沿这个方向继续，先写他第一次进入城市。
```

`plan`、`revise`、`check` 创建对应阶段任务；`resume <任务 ID>` 恢复，`cancel <任务 ID>` 停止领域任务；`history` 查看正式提交。小说作用域由当前 Harness 会话的工作目录与 WorkspaceRegistry 自动确定，不接受手输项目 ID 或数据库路径。

模型只能提交候选与证据。符合已定方向的正文及明确变化经 Host 提取、检查、版本校验后一起自动接纳；重要方向、推断升级及历史矛盾通过 Harness 原生问答聚合确认。工作台的旧任务授权保留兼容用途，不能替代事实/正文协调，也不替代 Harness 工具审批。CLI enable/focus/review 等是高级兼容入口，不是新手前置步骤。

## 数据与交换

小说数据保存在当前工作区的 `.mythor/novel.sqlite`；`.mythor/.gitignore` 默认避免数据库、临时文件和材料进入 Git。删除 Harness 的工作区登记不会删除小说数据，重新登记同一目录仍可读取。`dataDirectory` 仅用于发现并显式迁入 0.1.x 旧数据。

- 导入 Markdown/TXT 可标记为正文、大纲、人物设定、世界观或笔记；原始材料先生成候选，不自动认定小说世界事实。后续提取任务负责人物、事件和状态整理。
- 导出正文为 Markdown，原始材料与参考笔记不会混入；v3 备份包含来源、批次及会话草稿元数据，恢复只允许进入没有创作内容的 Harness 工作区，并可读取 v1/v2 备份。v2 数据库升级前保留一致备份。
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
