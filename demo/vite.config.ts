import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const assets = resolve(root, '../assets')

/**
 * Serves the package's assets/ (glyphs and sprites) at /basemap in dev, and
 * copies them into the build: they are the package's own files, not the
 * demo's, so they are not duplicated into demo/public.
 */
function basemapAssets(): Plugin {
  let outDir = resolve(root, 'dist')
  return {
    name: 'basemap-assets',
    configResolved(config) {
      // --outDir moves the build (the browser test builds into test-results/).
      outDir = resolve(root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/basemap', (req, res, next) => {
        const file = join(assets, decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!file.startsWith(assets) || !existsSync(file) || statSync(file).isDirectory()) return next()
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      cpSync(assets, resolve(outDir, 'basemap'), { recursive: true })
      // Publish the repository's llms.txt with the demo, from the one source.
      cpSync(resolve(root, '../llms.txt'), resolve(outDir, 'llms.txt'))
    },
  }
}

export default defineConfig({
  root,
  // GitHub Pages serves the demo under /<repo>/; the workflow sets DEMO_BASE.
  base: process.env.DEMO_BASE ?? '/',
  plugins: [react(), basemapAssets()],
  // Astryx themes ship as @scope rules, which esbuild's minifier drops.
  build: { cssMinify: 'lightningcss', cssTarget: ['chrome118', 'safari17', 'firefox128'] },
})
