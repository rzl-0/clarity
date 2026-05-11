import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/helpers/db.ts'],
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
