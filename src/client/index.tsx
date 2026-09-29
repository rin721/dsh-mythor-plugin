import React, { useEffect, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiResult, Request } from '../shared/contracts.ts'
import { remoteContribution } from '../shared/remote.ts'
import { App, type Api } from './App.tsx'
import { Button, ErrorState, Field, FormActions, Input, Modal } from './ui/index.tsx'
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
      let first = true
      try {
        for await (const _frame of remote.watch(controller.signal)) {
          if (first) first = false
          else listener()
        }
      } catch {
        if (!controller.signal.aborted) listener()
      }
    })()
    return () => controller.abort()
  }
  return { api, subscribe }
}

export function EnableControl({
  api,
  session,
  locked = false,
}: {
  api: Api
  session: { blank: boolean }
  locked?: boolean
}) {
  const [enabled, setEnabled] = useState<boolean>()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void api({ action: 'novel.status', payload: {} }).then((result) => {
      if (result.ok) {
        setEnabled(Boolean((result.value as { enabled?: boolean }).enabled))
        setError('')
      } else {
        setEnabled(undefined)
      }
    })
  }, [api])
  if (!session.blank || enabled !== false) return null
  return (
    <>
      <Button disabled={locked} onClick={() => setOpen(true)}>
        Mythor
      </Button>
      {open && (
        <Modal
          title="为当前 Harness 项目启用 Mythor"
          closeLabel="关闭"
          close={() => {
            setOpen(false)
            setError('')
          }}
        >
          {error && <ErrorState>{error}</ErrorState>}
          <Field>
            作品标题
            <Input
              data-modal-autofocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="作品标题"
            />
          </Field>
          <FormActions>
            <Button
              onClick={() => {
                setOpen(false)
                setError('')
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={() => {
                setError('')
                void api({ action: 'novel.enable', payload: { title: title.trim() } }).then(
                  (result) => {
                    if (result.ok) {
                      setEnabled(true)
                      setOpen(false)
                    } else setError(result.error.message)
                  },
                )
              }}
            >
              启用
            </Button>
          </FormActions>
        </Modal>
      )}
    </>
  )
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
            inputActions: { setDraft(text: string): void }
          }) => (
            <App
              api={api}
              subscribe={subscribe}
              t={t}
              startConversation={(text) => inputActions.setDraft(text)}
            />
          ),
        ),
      )
      scope.slots.inject('conversation.input.left', () =>
        scope.slots.register(
          {
            name: 'conversation.input.left',
            id: 'mythor-enable',
            order: 30,
            locale: 'mythor',
            inject: (sessionId: string) => ({ api: servicesFor(scope, sessionId).api }),
          },
          EnableControl,
        ),
      )
    })
    return unmount
  })
}
