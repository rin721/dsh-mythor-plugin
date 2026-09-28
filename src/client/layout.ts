import clsx from 'clsx'
import css from './layout.module.css'

/** Resolve layout roles to module-scoped classes; no control appearance lives here. */
export function cx(...values: Parameters<typeof clsx>) {
  return clsx(values)
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => css[name])
    .filter(Boolean)
    .join(' ')
}
