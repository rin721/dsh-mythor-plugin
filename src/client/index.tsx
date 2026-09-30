import React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiResult, Request } from '../shared/contracts.ts'
import { remoteContribution } from '../shared/remote.ts'
import { App, type Api } from './App.tsx'
import { en, zh, type Key } from './locales.ts'

interface ScopedClientContext {
  get(name: 'remote.mythor'): ScopedClientContext['remote']['mythor'] | undefined
  remote: {
    mythor: {
      request(request: Request): Promise<RemoteResult<ApiResult>>
      watch(signal?: AbortSignal): AsyncIterable<{ generation: number }>
    }
  }
}
interface ClientContext extends ScopedClientContext {
  inject(names: string[], callback: (scope: ClientContext) => void): unknown
  effect(factory: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>): void
  slots: {
    inject(name: string, callback: () => unknown): void
    register(options: Record<string, unknown>, component: React.ComponentType<any>): () => void
  }
  sessions: { scope(sessionId: string): ScopedClientContext | undefined }
  locale: {
    register(
      namespace: string,
      dictionaries: { zh: Record<string, string>; en: Record<string, string> },
    ): () => void
    bind(namespace: string): (key: string) => string
  }
  remote: ScopedClientContext['remote'] & {
    $mount(contribution: typeof remoteContribution): Promise<() => Promise<void>>
  }
}

function servicesFor(ctx: ClientContext, sessionId: string) {
  const scoped = ctx.sessions.scope(sessionId)
  if (!scoped) throw new Error(`Mythor 无法解析会话 ${sessionId}`)
  const remote = scoped.get('remote.mythor')
  if (!remote) throw new Error(`Mythor Remote 尚未进入会话 ${sessionId}`)
  const api: Api = async (request) => {
    const result = await remote.request(request)
    return result.ok
      ? result.value
      : { ok: false, error: { code: result.error.code, message: result.error.message } }
  }
  const subscribe = (listener: () => void) => {
    const controller = new AbortController()
    void (async () => {
      let delay = 500
      while (!controller.signal.aborted) {
        try {
          listener()
          for await (const _frame of remote.watch(controller.signal)) {
            listener()
            delay = 500
          }
        } catch {
          if (!controller.signal.aborted) listener()
        }
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay)
            function done() {
              clearTimeout(timer)
              controller.signal.removeEventListener('abort', done)
              resolve()
            }
            controller.signal.addEventListener('abort', done, { once: true })
          })
        delay = Math.min(delay * 2, 10000)
      }
    })()
    return () => controller.abort()
  }
  return { api, subscribe }
}

export const inject = ['slots', 'locale', 'remote', 'sessions']
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register('mythor', { zh, en }))
  ctx.effect(async () => {
    const unmount = await ctx.remote.$mount(remoteContribution)
    ctx.inject(['remote.mythor'], (scope) => {
      const translate = ctx.locale.bind('mythor')
      const t = (key: Key) => translate(key)
      scope.slots.inject('conversation.view', () =>
        scope.slots.register(
          {
            name: 'conversation.view',
            id: 'mythor',
            order: 20,
            label: () => t('title'),
            locale: 'mythor',
            inject: (sessionId: string) => servicesFor(scope, sessionId),
          },
          ({
            api,
            subscribe,
            inputActions,
          }: {
            api: Api
            subscribe: (listener: () => void) => () => void
            inputActions: {
              captureInsertion(): unknown
              insertText(text: string, span: unknown): boolean
            }
          }) => (
            <App
              api={api}
              subscribe={subscribe}
              t={t}
              startConversation={(text) =>
                inputActions.insertText(text, inputActions.captureInsertion())
              }
            />
          ),
        ),
      )
    })
    return unmount
  })
}
