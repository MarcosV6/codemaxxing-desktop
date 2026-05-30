import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Standalone test config — intentionally does NOT extend vite.config.ts so the
// vite-plugin-electron main/preload builds never run during tests. Tests target
// pure logic only; nothing here loads Electron or the better-sqlite3 addon.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
