import { Worker } from 'node:worker_threads'
import type { Actor, ApiResult, Limits, Request } from '../shared/contracts.ts'
export class MythorApplication {
  private seq = 0
  private closed = false
  private closing?: Promise<void>
  private readonly pending = new Map<number, (result: ApiResult) => void>()
  private readonly worker: Worker
  constructor(
    readonly root: string,
    limits?: Partial<Limits>,
    workerUrl: URL = new URL('./worker.js', import.meta.url),
  ) {
    this.worker = new Worker(workerUrl, { workerData: { root, limits } })
    this.worker.on('message', ({ id, result }: { id: number; result: ApiResult }) => {
      this.pending.get(id)?.(result)
      this.pending.delete(id)
    })
    this.worker.on('error', (error) => this.fail(error.message))
    this.worker.on('exit', (code) => {
      if (!this.closed || this.pending.size) this.fail(`数据库 Worker 退出 (${code})`)
    })
  }
  private fail(message: string) {
    this.closed = true
    for (const resolve of this.pending.values())
      resolve({ ok: false, error: { code: 'storage-unavailable', message } })
    this.pending.clear()
  }
  async request(
    request: Request,
    actor: Actor = { kind: 'author' },
    signal?: AbortSignal,
  ): Promise<ApiResult> {
    if (this.closed) return { ok: false, error: { code: 'closed', message: 'Mythor 已停止' } }
    signal?.throwIfAborted()
    // Once dispatched, await its durable outcome even if caller cancels; never report a committed write as rolled back.
    return new Promise((resolve) => {
      const id = ++this.seq
      this.pending.set(id, resolve)
      this.worker.postMessage({ id, request, actor })
    })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    if (this.closed) return this.worker.terminate().then(() => undefined)
    this.closed = true
    this.closing = new Promise<void>((resolve) => {
      const id = ++this.seq
      this.pending.set(id, () => resolve())
      this.worker.postMessage({ id, close: true })
    }).then(async () => {
      await this.worker.terminate()
    })
    return this.closing
  }
}
