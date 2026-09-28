import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
await mkdir('lib', { recursive: true })
await rm('lib/types/client/style.d.ts', { force: true })
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
})
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
})
await build({
  entryPoints: ['src/storage/worker.ts'],
  outfile: 'lib/worker.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
})
const client = await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'local-css' },
  write: false,
  banner: {
    js: "window.__ModuleLoader__.load({id:'dsh-mythor-plugin',factory(require){const module={exports:{}};const exports=module.exports;const __MYTHOR_CSS__=__MYTHOR_STYLE_PAYLOAD__;",
  },
  footer: { js: 'return module.exports;}});' },
  sourcemap: true,
})
const css = client.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
for (const file of client.outputFiles) {
  await writeFile(
    file.path,
    file.path.endsWith('.js')
      ? file.text.replace('__MYTHOR_STYLE_PAYLOAD__', () => JSON.stringify(css))
      : file.contents,
  )
}
