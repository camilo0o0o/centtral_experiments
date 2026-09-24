import GUI from 'lil-gui'
import { findByNumber, pad } from './experiments.js'
import { experimentHeader } from './components/header.js'
import { theme } from './theme.js'

export async function renderExperiment(app, exp) {
  document.title = `${pad(exp.number)} · ${exp.title}`
  const parent = exp.forkedFrom != null ? findByNumber(exp.forkedFrom) : null

  const page = document.createElement('div')
  page.className = 'experiment'
  page.innerHTML = `<main class="frame"><div class="stage"></div></main>`
  page.prepend(experimentHeader(exp, parent))
  app.replaceChildren(page)
  const container = page.querySelector('.stage')

  const gui = new GUI({ title: 'Controls', container: page.querySelector('.frame') })
  const { default: sketch } = await exp.load()
  await sketch({ container, gui, theme })

  // No controls registered → no panel.
  let guiVisible = gui.controllersRecursive().length > 0
  gui.show(guiVisible)

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return
    if (e.key === 'h') gui.show((guiVisible = !guiVisible))
    if (e.key === 's' && import.meta.env.DEV) saveThumbnail(exp, container)
  })
}

// Dev only: send the current canvas frame to the Vite plugin, which writes thumb.png.
// WebGL canvases need `preserveDrawingBuffer: true` or the capture comes out blank.
function saveThumbnail(exp, container) {
  const canvas = container.querySelector('canvas')
  if (!canvas) return toast('No canvas found')
  canvas.toBlob(async (blob) => {
    if (!blob) return toast('Canvas is empty, nothing to save')
    const res = await fetch(`/__thumb?id=${encodeURIComponent(exp.id)}`, { method: 'POST', body: blob })
    toast(res.ok ? 'Thumbnail saved' : 'Thumbnail failed')
  }, 'image/png')
}

function toast(message) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message })
  document.body.append(el)
  setTimeout(() => el.remove(), 1500)
}
