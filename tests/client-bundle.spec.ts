import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('loads official UI and React from Harness and includes its scoped styles', () => {
  const client = readFileSync('lib/client.js', 'utf8')
  const map = JSON.parse(readFileSync('lib/client.js.map', 'utf8')) as { sources: string[] }
  expect(client).toContain('require("@deepseek-ai/dsh-client-ui-primitives")')
  expect(client).toContain('require("react")')
  expect(client).toContain('const __MYTHOR_CSS__=')
  expect(client).not.toContain('__MYTHOR_STYLE_PAYLOAD__')
  expect(
    map.sources.some((source) =>
      /dsh-client-ui-primitives|node_modules\/(react|react-dom)\//.test(source),
    ),
  ).toBe(false)
  expect(map.sources.some((source) => source.includes('@radix-ui'))).toBe(true)
  const css = readFileSync('lib/client.css', 'utf8')
  expect(css).toContain('--dsw-alias-label-primary')
  expect(css).not.toContain('.mythor button')
})
