# 需求追溯与验收

| ID | goal.md 依据 | 作者行为 / 领域 | Agent / UI | 验收 |
| --- | --- | --- | --- | --- |
| M01 | 规则产生环境 | setting/rule 推演 | Planner / 世界 | 规则推演仅生成候选 |
| M02 | 外部目标与内部需求 | character/arc | Planner / 人物弧 | 目标冲突和人物变化可追踪 |
| M03 | 选择产生后果 | scene/event/conflict | Writer+Keeper / 场景 | 地图转交与关系变化原子提交 |
| M04 | Story 不同于 Plot | WorldTime/NarrativePosition | Context / 双时间线 | 倒叙不改变世界先后 |
| M05 | 信息控制 | knowledge/revelation | Writer / 秘密 | 人物误信不成为事实，提前揭露受检 |
| M06 | 故事线交叉 | storyline/advances | Planner / 泳道图 | 共享事件连接两条故事线 |
| M07 | 场景改变状态 | ChangeSet/Commit | Keeper / 审阅 | 未授权不提交；失败无半更新 |
| M08 | 连贯性 | SourceRef/rule | Critic / 检查 | 原文修改使旧提取失效 |
| M09 | 长期记忆 | 数据、上下文、任务 | ContextPack / 历史 | 重启能读取状态并恢复阶段 |
| M10 | 构思到正文 | WorkflowRun | Coordinator / 任务 | 阶段不能跳过，重试不重复提交 |
| M11 | Story Graph | typed relations | Graph / 关系页 | 七种投影共用对象和编辑服务 |
| M12 | 持续创作 | import/export/revise | 全流程 | 既有长篇可导入、审阅、续写、导出 |
| M13 | Harness 复用 | Plugin adapters | Tool/Command/Slot | 安装、卸载、会话恢复均有效 |
| M14 | 作者操作创作对象 | 全工作台及八类弹窗 | Harness UI 适配层 | 官方组件优先，补充组件跟随主题；键盘、输入、审阅与业务操作一致 |

覆盖状态及执行命令只记录在 implementation/status.md；本表描述必须成立的行为，不代表已验证。
