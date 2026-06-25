import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { transformSync } from 'esbuild'
import { builtinModules } from 'module'
import pkg from './package.json'

// vite builds the preload as ESM (it ignores output.format and the package is
// `type: "module"`). A sandboxed Electron preload is loaded as CommonJS, so any
// `import`/`export` makes it crash → `window.electron` undefined → the renderer
// silently falls back to the dev-mock. This plugin rewrites the emitted file to
// real CommonJS after the bundle is written, which is what actually fixes it.
const preloadToCjs = {
  name: 'preload-esm-to-cjs',
  closeBundle() {
    const file = resolve(__dirname, 'dist-electron/preload.cjs')
    if (!existsSync(file)) return
    const src = readFileSync(file, 'utf8')
    if (!/^\s*(import|export)\b/m.test(src)) return // already CJS
    const out = transformSync(src, { format: 'cjs', platform: 'node', loader: 'js' })
    writeFileSync(file, out.code)
  },
}

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
            // No `lib` mode: with `type: "module"` in package.json, vite's lib
            // build was emitting `export default …` (ESM) into the .cjs file,
            // which a sandboxed preload (loaded as CommonJS) can't parse — so it
            // crashed and `window.electron` was undefined. Plain rollupOptions
            // with format:'cjs' produces real CommonJS.
            rollupOptions: {
              input: resolve(__dirname, 'electron/preload.ts'),
              external: ['electron'],
              output: {
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
              },
            },
          },
          plugins: [preloadToCjs],
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
