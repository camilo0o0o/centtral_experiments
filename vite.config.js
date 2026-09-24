import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// Dev-only: the experiment page POSTs a PNG here when you press "S",
// and we write it to src/experiments/<id>/thumb.webp.
function thumbnailPlugin() {
  return {
    name: 'save-thumbnail',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__thumb', (req, res) => {
        const id = new URL(req.url, 'http://x').searchParams.get('id') ?? ''
        const dir = path.resolve('src/experiments', id)
        if (req.method !== 'POST' || !/^\d+-[\w-]+$/.test(id) || !fs.existsSync(dir)) {
          res.statusCode = 400
          return res.end('bad request')
        }
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          fs.writeFileSync(path.join(dir, 'thumb.webp'), Buffer.concat(chunks))
          fs.rmSync(path.join(dir, 'thumb.png'), { force: true })
          res.end('ok')
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [thumbnailPlugin()],
  // p5 and three are big on their own; each loads only on the experiments that use it.
  build: { chunkSizeWarningLimit: 2000 },
})
