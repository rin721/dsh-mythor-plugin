import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
let checked = 0
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) walk(path)
    else if (path.endsWith('.md')) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (!/^(https?:|mailto:)/.test(match[1]) && !existsSync(resolve(dirname(path), match[1])))
          throw new Error(`${path}: broken link ${match[1]}`)
      }
      checked++
    }
  }
}
walk('docs')
console.log(`Checked links in ${checked} Markdown files`)
