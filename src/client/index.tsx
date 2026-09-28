import React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiResult, Request } from '../shared/contracts.ts'
import { remoteContribution } from '../shared/remote.ts'
import { App } from './App.tsx'
import { en, zh, type Key } from './locales.ts'

// Structural public service faces: no runtime imports from internal Harness UI packages.
interface ClientContext {
  inject(names: string[], callback: (scope: ClientContext) => void): unknown
  effect(factory: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>): void
  slots: {
    inject(name: string, callback: () => unknown): void
    register(options: Record<string, unknown>, component: React.ComponentType): () => void
  }
  locale: {
    register(
      namespace: string,
      dictionaries: { zh: Record<string, string>; en: Record<string, string> },
    ): () => void
    bind(namespace: string): (key: string) => string
  }
  remote: {
    $mount(contribution: typeof remoteContribution): Promise<() => Promise<void>>
    mythor: { request(request: Request): Promise<RemoteResult<ApiResult>> }
  }
}
export const inject = ['slots', 'locale', 'remote']
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register('mythor', { zh, en }))
  ctx.effect(async () => {
    const unmount = await ctx.remote.$mount(remoteContribution)
    ctx.inject(['remote.mythor'], (scope) => {
      const translate = ctx.locale.bind('mythor')
      const t = (key: Key) => translate(key)
      const Workbench = () => (
        <App
          api={async (request) => {
            const result = await scope.remote.mythor.request(request)
            return result.ok
              ? result.value
              : { ok: false, error: { code: result.error.code, message: result.error.message } }
          }}
          t={t}
        />
      )
      scope.slots.inject('main', () =>
        scope.slots.register({ name: 'main', key: 'mythor', locale: 'mythor' }, Workbench),
      )
      scope.slots.inject('sidebar.panellist', () =>
        scope.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'mythor',
            order: 30,
            label: () => t('title'),
            locale: 'mythor',
          },
          () => (
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20V4l8 8 8-8v16" fill="none" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          ),
        ),
      )
    })
    return unmount
  })
}
