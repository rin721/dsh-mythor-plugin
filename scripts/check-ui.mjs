import { readdir, readFile } from 'node:fs/promises'
import ts from 'typescript'
const failures = []
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name !== 'ui') await inspect(path)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    const text = await readFile(path, 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function walk(node) {
      if (ts.isImportDeclaration(node)) {
        const specifier = node.moduleSpecifier.text
        if (
          specifier.startsWith('@radix-ui/') ||
          specifier === '@deepseek-ai/dsh-client-ui-primitives'
        )
          failures.push(`${path}: shared controls must be imported through client/ui`)
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source)
        if (
          [
            'button',
            'input',
            'select',
            'option',
            'textarea',
            'label',
            'details',
            'summary',
            'dialog',
          ].includes(tag)
        )
          failures.push(`${path}: unadapted <${tag}>`)
        if (
          node.attributes.properties.some(
            (property) => ts.isJsxAttribute(property) && property.name.text === 'style',
          )
        )
          failures.push(`${path}: presentation belongs in CSS Modules`)
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
}
await inspect('src/client')
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log('UI boundaries passed: business views use the component adapter layer.')
