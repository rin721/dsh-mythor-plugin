import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
await mkdir('lib', { recursive: true })
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
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: {
    js: "window.__ModuleLoader__.load({id:'dsh-mythor-plugin',factory(require){const module={exports:{}};const exports=module.exports;",
  },
  footer: { js: 'return module.exports;}});' },
  sourcemap: true,
})
