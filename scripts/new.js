// npm run new -- <vanilla|p5|three> "Title"
// npm run fork -- <number> "Title"
import fs from 'node:fs'
import path from 'node:path'

const EXPERIMENTS = 'src/experiments'
const TEMPLATES = 'templates'
const [mode, source, title] = process.argv.slice(2)

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

if (!source || !title) {
  fail('Usage:\n  npm run new -- <vanilla|p5|three> "Title"\n  npm run fork -- <number> "Title"')
}

const existing = fs.readdirSync(EXPERIMENTS).filter((d) => /^\d+-/.test(d))
const next = Math.max(0, ...existing.map((d) => parseInt(d, 10))) + 1
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const id = `${String(next).padStart(3, '0')}-${slug}`
const dest = path.join(EXPERIMENTS, id)

const meta = { title, description: '', date: new Date().toLocaleDateString('sv') } // 'sv' locale = local YYYY-MM-DD

if (mode === 'new') {
  const template = path.join(TEMPLATES, source)
  if (!fs.existsSync(template)) {
    fail(`Unknown template "${source}". Available: ${fs.readdirSync(TEMPLATES).join(', ')}`)
  }
  fs.cpSync(template, dest, { recursive: true })
} else if (mode === 'fork') {
  const parent = existing.find((d) => parseInt(d, 10) === Number(source))
  if (!parent) fail(`No experiment with number ${source}`)
  // Copy everything except the thumbnail, so the grid shows the fork needs its own screenshot.
  fs.cpSync(path.join(EXPERIMENTS, parent), dest, {
    recursive: true,
    filter: (src) => !path.basename(src).startsWith('thumb.'),
  })
  const parentMeta = JSON.parse(fs.readFileSync(path.join(dest, 'meta.json'), 'utf8'))
  meta.description = parentMeta.description
  meta.forkedFrom = parseInt(parent, 10)
} else {
  fail(`Unknown mode "${mode}"`)
}

fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
console.log(`Created ${dest}\nOpen http://localhost:5173/${id}`)
