# Mythor 文档导航

核心依据是 [goal.md](goal.md)。它建立小说运行的认知基础，不是功能清单；实现必须经过下面的推导。

| 顺序 | 文档 | 权威范围 |
| --- | --- | --- |
| 1 | [设计推导与术语](design/01-foundations.md) | 小说机制、作者行为与术语 |
| 2 | [产品与交互](design/02-product.md) | 场景、边界、用户路径与命令 |
| 3 | [领域模型](design/03-domain.md) | 唯一领域词汇及关联 |
| 4 | [状态与规则](design/04-state-rules.md) | 正式事实、版本、事务、校验 |
| 5 | [流程与 Agent](design/05-workflows.md) | 阶段、职责、上下文和恢复 |
| 6 | [架构与契约](design/06-architecture.md) | Harness 边界、模块和接口 |
| 7 | [工作台与可视化](design/07-ui.md) | 页面、操作与视图投影 |
| 8 | [工程规范](design/08-engineering.md) | 构建、验证、维护、扩展 |
| 9 | [需求追溯](design/09-traceability.md) | 认知依据到验收的对应 |
| 10 | [技术决策](adr/0001-foundation.md) | 已选择方案和原因 |
| 11 | [实施与验证](implementation/status.md) | 交付状态和实际证据 |
| 12 | [公共操作与扩展](design/10-tool-contracts.md) | Tool payload、调用流程、错误及扩展步骤 |
| 13 | [Harness UI 技术决策](adr/0002-harness-ui.md) | 公开组件、Radix 补充、共享模块与样式生命周期 |
| 14 | [Harness Workspace 作用域](adr/0003-harness-workspace-scope.md) | 唯一项目边界、原生视图、存储与旧数据迁移 |

文档使用「设计」「实现」「验证」三种独立状态：设计内容不代表功能已经交付。每次改变领域语义、公共契约或流程，同步修改负责该概念的文档及追溯项；其他文档引用它，不复制另一份定义。原始 goal.md 保持不变。
