// An image with flat, folded-over corners. Each fold is set by two percentages: how far along the
// horizontal edge and how far along the vertical edge (from the corner) the crease meets them.
// The crease is the line through those two points. Everything on the corner's side of it is cut
// off the page and reflected across the line, which is exactly where a flat-folded flap lands;
// the reflected piece is filled with the back color.
// Folds are applied in order to what is left of the page, so overlapping folds never fold the
// same paper twice.

const CORNERS = {
  'bottom right': [1, 1],
  'top left': [0, 0],
  'top right': [1, 0],
  'bottom left': [0, 1],
}
const SLOTS = [
  { corner: 'bottom right', horizontal: 35, vertical: 25 },
  { corner: 'top left', horizontal: 20, vertical: 30 },
  { corner: 'top right', horizontal: 15, vertical: 15 },
  { corner: 'bottom left', horizontal: 25, vertical: 20 },
]

export default function ({ container, gui, theme }) {
  const params = {
    upload: () => input.click(),
    corners: 2,
    back: '#dcd6cc',
    bg: theme.bg,
    padding: 0.14,
    radius: 0,
    export: () => exportPng(),
  }

  // --- controls ---

  gui.add(params, 'upload').name('upload image')
  gui.add(params, 'corners', 0, SLOTS.length, 1).onChange(() => updateFolders())
  gui.addColor(params, 'back').name('back color').onChange(() => draw())
  gui.addColor(params, 'bg').name('background').onChange(() => draw())
  gui.add(params, 'padding', 0, 0.4, 0.01).onChange(() => draw())
  gui.add(params, 'radius', 0, 50, 1).name('radius %').onChange(() => draw())
  gui.add(params, 'export').name('export png')

  const folders = SLOTS.map((slot, i) => {
    const f = gui.addFolder(`corner ${i + 1}`)
    f.add(slot, 'corner', Object.keys(CORNERS)).onChange(() => draw())
    f.add(slot, 'horizontal', 0, 100, 1).name('horizontal %').onChange(() => draw())
    f.add(slot, 'vertical', 0, 100, 1).name('vertical %').onChange(() => draw())
    return f
  })
  function updateFolders() {
    folders.forEach((f, i) => f.show(i < params.corners))
    draw()
  }

  // --- image input: the button above, or drop a file on the canvas ---

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.hidden = true
  container.append(input)
  input.addEventListener('change', () => load(input.files[0]))
  container.addEventListener('dragover', (e) => e.preventDefault())
  container.addEventListener('drop', (e) => {
    e.preventDefault()
    load(e.dataTransfer.files[0])
  })

  let image = placeholder()
  let name = 'esquinas-dobladas'
  let colorSpace = 'srgb'
  async function load(file) {
    if (!file || !file.type.startsWith('image/')) return
    const img = new Image()
    img.src = URL.createObjectURL(file)
    const [space] = await Promise.all([detectColorSpace(file), img.decode()])
    image = img
    name = file.name.replace(/\.[^.]+$/, '')
    colorSpace = space
    draw()
  }

  // --- canvas ---

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  container.append(canvas)

  let width, height
  new ResizeObserver(() => {
    const dpr = Math.min(devicePixelRatio, 2)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }).observe(container)

  function draw() {
    if (!width) return
    ctx.fillStyle = params.bg
    ctx.fillRect(0, 0, width, height)

    // fit the image inside the padded area, centered
    const pad = params.padding * Math.min(width, height)
    const iw = image.naturalWidth ?? image.width
    const ih = image.naturalHeight ?? image.height
    const scale = Math.min((width - 2 * pad) / iw, (height - 2 * pad) / ih)
    if (scale <= 0) return
    const w = iw * scale
    const h = ih * scale
    const x = (width - w) / 2
    const y = (height - h) / 2

    paint(ctx, x, y, w, h)
  }

  // The image with its folds, at (x, y) and size w × h.
  function paint(ctx, x, y, w, h) {
    let page = roundedRect(x, y, w, h, (params.radius / 100) * Math.min(w, h))
    const flaps = []
    for (const slot of SLOTS.slice(0, params.corners)) {
      const u = slot.horizontal / 100
      const v = slot.vertical / 100
      if (u === 0 || v === 0) continue
      const [cx, cy] = CORNERS[slot.corner]
      const sx = cx ? -1 : 1 // from the corner towards the inside of the image
      const sy = cy ? -1 : 1
      const corner = [x + cx * w, y + cy * h]
      const a = [corner[0] + sx * u * w, corner[1]] // crease meets the horizontal edge
      const b = [corner[0], corner[1] + sy * v * h] // crease meets the vertical edge
      // unit normal of the crease, pointing towards the corner
      let n = [b[1] - a[1], a[0] - b[0]]
      const len = Math.hypot(n[0], n[1])
      n = [n[0] / len, n[1] / len]
      if (dist(corner, a, n) < 0) n = [-n[0], -n[1]]

      const [keep, flap] = split(page, a, n)
      page = keep
      if (flap.length) {
        flaps.push(flap.map((p) => {
          const d = dist(p, a, n)
          return [p[0] - 2 * d * n[0], p[1] - 2 * d * n[1]]
        }))
      }
    }

    ctx.save()
    trace(ctx, page)
    ctx.clip()
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, x, y, w, h)
    ctx.restore()

    ctx.fillStyle = params.back
    ctx.strokeStyle = params.back
    ctx.lineWidth = 0.5 // covers the antialiased seam along the crease (css px here, image px in exports)
    ctx.lineJoin = 'round'
    for (const flap of flaps) {
      trace(ctx, flap)
      ctx.fill()
      ctx.stroke()
    }
  }

  // Exports at the image's own size, in its own color space when it is Display P3. Where a corner
  // was folded away is transparent. Flaps that land outside the image are cropped.
  function exportPng() {
    const w = image.naturalWidth ?? image.width
    const h = image.naturalHeight ?? image.height
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const octx = out.getContext('2d', { colorSpace })
    paint(octx, 0, 0, w, h)
    out.toBlob((blob) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name}-doblada.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }, 'image/png')
  }

  // A stand-in until an image is uploaded.
  function placeholder() {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 1000
    const g = c.getContext('2d')
    g.fillStyle = '#d9532b'
    g.fillRect(0, 0, 800, 1000)
    g.fillStyle = '#f2e8d5'
    g.beginPath()
    g.arc(400, 430, 230, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1f1d1b'
    g.fillRect(0, 800, 800, 200)
    g.fillStyle = '#f2e8d5'
    g.font = `500 36px ${theme.font}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('sube una imagen', 400, 900)
    return c
  }

  updateFolders()
}

function trace(ctx, poly) {
  ctx.beginPath()
  poly.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
  ctx.closePath()
}

// Canvas only knows sRGB and Display P3. Look for a Display P3 ICC profile near the start of the
// file (its name is stored as UTF-16, hence dropping the zero bytes); anything else exports as sRGB.
async function detectColorSpace(file) {
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const text = new TextDecoder('latin1').decode(bytes.filter((b) => b !== 0))
  return /Display P3/.test(text) ? 'display-p3' : 'srgb'
}

// A rounded rectangle as a polygon, clockwise from the top left. Its arcs get folded along with the
// rest of the page, so a folded corner shows its rounding on the flap.
function roundedRect(x, y, w, h, r) {
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  const steps = Math.max(4, Math.ceil(r / 3))
  const centers = [[x + r, y + r], [x + w - r, y + r], [x + w - r, y + h - r], [x + r, y + h - r]]
  const poly = []
  centers.forEach(([cx, cy], k) => {
    const start = Math.PI * (1 + k / 2) // 180° at the top left, then a quarter turn per corner
    for (let i = 0; i <= steps; i++) {
      const t = start + (i / steps) * (Math.PI / 2)
      poly.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
    }
  })
  return poly
}

// signed distance from p to the line through a with unit normal n
function dist(p, a, n) {
  return (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]
}

// Cut a convex polygon (rounded or not, the page stays convex after every cut) by a line: the part with dist ≤ 0 (stays) and the part with dist > 0 (folds).
function split(poly, a, n) {
  const keep = []
  const flap = []
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]
    const dp = dist(p, a, n)
    const dq = dist(q, a, n)
    ;(dp <= 0 ? keep : flap).push(p)
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq)
      const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
      keep.push(m)
      flap.push(m)
    }
  })
  return [keep, flap]
}
