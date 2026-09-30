import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import type { CreativeService } from './creative.ts'
import {
  DevelopSchema,
  RetconSchema,
  IntakeInputSchema,
  SceneRequestSchema,
  MaterialIntakeSchema,
  DecisionInputSchema,
} from '../shared/creative.ts'
import { harnessObjectSchema } from '../shared/harness-schema.ts'

export function registerCreativeTools(agent: Agent, creative: CreativeService) {
  const id = z.object({ id: z.string().min(1) }).strict()
  const entries = [
    {
      name: 'mythor_import',
      schema: MaterialIntakeSchema,
      description:
        '接纳有真实作者原文来源的粘贴材料；区分正文、设定、大纲和笔记，不自动认定其中世界事实。',
      execute: (p: unknown, s: AbortSignal) => creative.importMaterial(agent, p, s),
    },
    {
      name: 'mythor_intake',
      schema: IntakeInputSchema,
      description: '理解用户创意来源；普通讨论不建库，持续创作自动初始化。',
      execute: (p: unknown, s: AbortSignal) => creative.intake(agent, p, s),
    },
    {
      name: 'mythor_develop',
      schema: DevelopSchema,
      description: '把普通语言整理为人物变化与分层规划；无需专业表单。',
      execute: (p: unknown, s: AbortSignal) => creative.develop(agent, p, s),
    },
    {
      name: 'mythor_scene',
      schema: SceneRequestSchema,
      description: '按已确定规划执行受限写作、变化提取、检查和接纳，或重新协调正文。',
      execute: (p: unknown, s: AbortSignal) => creative.scene(agent, p, s),
    },
    {
      name: 'mythor_retcon',
      schema: RetconSchema,
      description: '重要历史修订前分析证据、正文和规划依赖，提出修复路线。',
      execute: (p: unknown, s: AbortSignal) => creative.retcon(agent, p, s),
    },
    {
      name: 'mythor_decide',
      schema: DecisionInputSchema,
      description: '对具体候选、基线及影响取得作者决定；可提供完整真实确认原话，歧义仍需原生问答。',
      execute: (p: unknown, s: AbortSignal) => {
        const value = DecisionInputSchema.parse(p)
        return creative.decide(agent, value.id, s, value.evidence)
      },
    },
    {
      name: 'mythor_material',
      schema: id,
      description: '按检查点理解一批既有材料，保留分类、来源和歧义。',
      execute: (p: unknown, s: AbortSignal) => creative.material(agent, id.parse(p).id, s),
    },
  ]
  return entries.map((entry) =>
    agent.ctx.tools.register({
      name: entry.name,
      description: entry.description,
      parameters: harnessObjectSchema(entry.schema),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, exec) => entry.execute(args, exec.signal),
    }),
  )
}
