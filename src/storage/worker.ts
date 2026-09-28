import { parentPort, workerData } from 'node:worker_threads'
import { Store } from './store.ts'
import { MythorError } from '../domain/errors.ts'
import { ZodError } from 'zod'
import type { Actor, Request } from '../shared/contracts.ts'
const store = new Store(workerData.root, workerData.limits)
parentPort!.on(
  'message',
  (message: { id: number; request?: Request; actor?: Actor; close?: boolean }) => {
    try {
      if (message.close) {
        store.close()
        parentPort!.postMessage({ id: message.id, result: { ok: true, value: null } })
        parentPort!.close()
        return
      }
      const value = store.execute(message.request!, message.actor!)
      parentPort!.postMessage({ id: message.id, result: { ok: true, value } })
    } catch (error) {
      const sqliteCode =
        error && typeof error === 'object' && 'errcode' in error ? error.errcode : undefined
      const code =
        error instanceof MythorError
          ? error.code
          : error instanceof ZodError || error instanceof SyntaxError
            ? 'invalid-request'
            : sqliteCode === 5
              ? 'storage-busy'
              : sqliteCode !== undefined
                ? 'storage-failed'
                : 'internal-error'
      parentPort!.postMessage({
        id: message.id,
        result: {
          ok: false,
          error: {
            code,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof MythorError && error.details !== undefined
              ? { details: error.details }
              : {}),
          },
        },
      })
    }
  },
)
