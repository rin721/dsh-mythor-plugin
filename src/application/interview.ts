import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { IntakeSchema } from '../shared/creative.ts'

export const InterviewSchema = z.object({
  intakes: z.array(IntakeSchema),
  decision: z.object({ id: z.string(), hash: z.string(), answer: z.unknown() }).nullable(),
})
type Interview = z.infer<typeof InterviewSchema>
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'mythor/interview': Interview
  }
}
declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'mythor:interview': Interview
  }
}
const definition: ProjectionDefinition<'mythor:interview'> = {
  key: 'mythor:interview',
  stateVersion: 1,
  stateSchema: InterviewSchema,
  init: () => ({ intakes: [], decision: null }),
  apply: (state, event) => {
    if (event.type === 'mythor/interview') return InterviewSchema.parse(event.data)
    // Compatibility with earlier persisted event logs.
    if (event.type === 'mythor/intake') return { ...state, intakes: [...state.intakes, event.data] }
    if (event.type === 'mythor/decision') return { ...state, decision: event.data }
    return state
  },
}
export function registerInterview(ctx: Context) {
  return ctx.sessionProjections.register(definition)
}
export function interviewState(ctx: Context, session: Session) {
  const registry = ctx.get('sessionProjections')
  if (!registry) throw new Error('harness-service: 缺少会话投影服务，创意仍保留在对话中')
  return registry.stateOf(session, 'mythor:interview') ?? { intakes: [], decision: null }
}
