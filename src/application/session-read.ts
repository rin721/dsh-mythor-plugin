import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'

/** A live writer cannot be reopened through a second persistence handle. */
export async function readCreativeSession(
  ctx: Context,
  id: SessionId,
  live?: Session,
): Promise<SessionLogSnapshot> {
  if (live && live.id === id)
    return {
      session: structuredClone(live.header),
      inheritedEventCount: live.inheritedEventCount,
      events: structuredClone([...live.snapshotEvents()]),
    }
  const query = ctx.get('sessionQuery')
  if (!query) throw new Error('creative-unavailable: 需要 Harness SessionQuery 以恢复已关闭会话')
  return query.readSession(id)
}
