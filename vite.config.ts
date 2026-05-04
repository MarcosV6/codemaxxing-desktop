import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { builtinModules } from 'module'
import pkg from './package.json'

// Main-process deps we must NOT bundle (native addons or node-only modules)
const mainExternals = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  ...Object.keys((pkg as any).dependencies ?? {}),
]

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainExternals,
              output: { format: 'es' },
            },
          },
        },
      },
      {
        // Preload script — MUST be CommonJS. With package.json `type: "module"`
        // + sandbox: true on the BrowserWindow, an ESM preload silently fails
        // to load and `window.electron` ends up undefined in the renderer
        // (which then falls into the dev-mock fallback). Forcing CJS here +
        // the `.cjs` extension makes Node parse it as CommonJS regardless of
        // the surrounding package's `type` field.
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
