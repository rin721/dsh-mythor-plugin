import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/ui/**/*.spec.tsx'],
    environment: 'jsdom',
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
    setupFiles: ['tests/ui/setup.ts'],
    testTimeout: 15_000,
  },
})
