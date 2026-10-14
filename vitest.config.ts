import { defineConfig } from 'vitest/config'

process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' }
  }
})
