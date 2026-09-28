import type { Json } from '../shared/contracts.ts'
export class MythorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Json,
  ) {
    super(message)
    this.name = 'MythorError'
  }
}
export function requireValue<T>(
  value: T | undefined | null,
  code = 'not-found',
  message = '记录不存在',
): T {
  if (value === undefined || value === null) throw new MythorError(code, message)
  return value
}
