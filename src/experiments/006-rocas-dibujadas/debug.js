// Debug drawing: pipeline buffers as images, overlays, the hover probe and stage timings.
// Everything is drawn with the canvas 2D context, mapped through a transform { ox, oy, s }.
import { drawOutline } from './strokes.js'

// Which stage produces each view (used to cache images until that stage re-runs)
export const SOURCE = {
  silhouette: 'shape',
  height: 'height',
  'height contours': 'height',
  normals: 'shade',
  lambert: 'shade',
  'cavity AO': 'shade',
  shadow: 'shade',
  tone: 'shade',
}

const OVERLAY = { cut: '#e4572e', facet: '#f2a541', droplet: 'rgba(40, 110, 230, 0.55)', light: '#e4572e' }

// A W×H canvas showing one buffer
export function fieldImage(kind, data, params) {
  const { shape, height, shade } = data
  const { W, H, mask, dIn, maxD } = shape
  const cnv = document.createElement('canvas')
  cnv.width = W
  cnv.height = H
  const ctx = cnv.getContext('2d')
  const img = ctx.createImageData(W, H)
  const px = img.data
  const put = (i, r, g, b, a) => {
    px[i * 4] = r
    px[i * 4 + 1] = g
    px[i * 4 + 2] = b
    px[i * 4 + 3] = a
  }
  const gray = (i, v, a) => put(i, v * 255, v * 255, v * 255, a * 255)
  const h = height.height
  const maxH = shade.maxH || 1

  for (let i = 0; i < W * H; i++) {
    const m = mask[i]
    switch (kind) {
      case 'silhouette': // distance to the edge: what the dome is built from
        gray(i, 0.85 - 0.75 * (dIn[i] / maxD), m)
        break
      case 'height':
        gray(i, h[i] / maxH, m)
        break
      case 'height contours': {
        const levels = params.contours
        const lv = Math.floor((h[i] / maxH) * levels)
        const x = i % W
        const right = x < W - 1 ? Math.floor((h[i + 1] / maxH) * levels) : lv
        const down = i + W < W * H ? Math.floor((h[i + W] / maxH) * levels) : lv
        if (m > 0.5 && (lv !== right || lv !== down)) gray(i, 0, 1)
        else gray(i, 0.35 + 0.6 * (h[i] / maxH), m)
        break
      }
      case 'normals': {
        const n = shade.normals
        put(i, (n[i * 3] * 0.5 + 0.5) * 255, (n[i * 3 + 1] * 0.5 + 0.5) * 255, n[i * 3 + 2] * 255, m * 255)
        break
      }
      case 'lambert':
        gray(i, shade.lambert[i], m)
        break
      case 'cavity AO':
        gray(i, shade.ao[i], m)
        break
      case 'shadow':
        gray(i, shade.lit[i], m)
        break
      case 'tone':
        gray(i, 1 - shade.tone[i] / Math.max(m, 1e-6), m)
        break
    }
  }
  ctx.putImageData(img, 0, 0)
  return cnv
}

export function drawField(ctx, img, tf) {
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, tf.ox, tf.oy, img.width * tf.s, img.height * tf.s)
}

export function drawDots(ctx, dots, tf, radius, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < dots.n; i++) {
    const x = tf.ox + dots.xs[i] * tf.s
    const y = tf.oy + dots.ys[i] * tf.s
    ctx.moveTo(x + radius, y)
    ctx.arc(x, y, radius, 0, Math.PI * 2)
  }
  ctx.fill()
}

const toScreen = (shape, tf, wx, wy) => [tf.ox + ((wx - shape.x0) / shape.cell) * tf.s, tf.oy + ((wy - shape.y0) / shape.cell) * tf.s]

export function drawOverlays(ctx, data, tf, params, theme) {
  const { shape } = data
  ctx.save()
  ctx.lineWidth = 1

  if (params.overlayCuts && data.height.planes) {
    // Each facet plane's line: z rises inward from it (dashed: every scar is an extra scar here)
    ctx.beginPath()
    ctx.rect(tf.ox, tf.oy, shape.W * tf.s, shape.H * tf.s)
    ctx.clip()
    for (const pl of data.height.planes) {
      const [ax, ay] = toScreen(shape, tf, pl.nx * pl.c - pl.ny * 10, pl.ny * pl.c + pl.nx * 10)
      const [bx, by] = toScreen(shape, tf, pl.nx * pl.c + pl.ny * 10, pl.ny * pl.c - pl.nx * 10)
      ctx.strokeStyle = pl.silhouette ? OVERLAY.cut : OVERLAY.facet
      ctx.setLineDash(pl.silhouette ? [] : [5, 4])
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  if (params.overlayDroplets && data.height.paths) {
    ctx.strokeStyle = OVERLAY.droplet
    ctx.beginPath()
    for (const path of data.height.paths) {
      ctx.moveTo(tf.ox + path[0] * tf.s, tf.oy + path[1] * tf.s)
      for (let k = 2; k < path.length; k += 2) ctx.lineTo(tf.ox + path[k] * tf.s, tf.oy + path[k + 1] * tf.s)
    }
    ctx.stroke()
  }

  if (params.overlayOutline) {
    // The strokes the rock was built from, at the scale of this view
    ctx.save()
    ctx.translate(tf.ox, tf.oy)
    ctx.scale(tf.s / params.cellPx, tf.s / params.cellPx)
    drawOutline(ctx, shape.strokes, params.width, theme.ink, (1.5 * params.cellPx) / tf.s)
    ctx.restore()
  }

  if (params.overlayLight) {
    // A sun on the side the light comes from, with a ray pointing at the rock
    const [cx, cy] = toScreen(shape, tf, shape.cx, shape.cy)
    const az = (params.azimuth * Math.PI) / 180
    const reach = Math.max(60, (shape.span / shape.cell) * tf.s * 0.6)
    const sx = cx + Math.cos(az) * reach
    const sy = cy + Math.sin(az) * reach
    const ex = cx + Math.cos(az) * reach * 0.55
    const ey = cy + Math.sin(az) * reach * 0.55
    ctx.strokeStyle = ctx.fillStyle = OVERLAY.light
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(sx, sy, 7, 0, Math.PI * 2)
    ctx.moveTo(sx - Math.cos(az) * 7, sy - Math.sin(az) * 7)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    const back = az + Math.PI
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex + Math.cos(back + 0.45) * -9, ey + Math.sin(back + 0.45) * -9)
    ctx.lineTo(ex + Math.cos(back - 0.45) * -9, ey + Math.sin(back - 0.45) * -9)
    ctx.fill()
    ctx.font = `11px ${theme.font}`
    ctx.fillText(`az ${params.azimuth}° · el ${params.elevation}°`, sx + 11, sy + 4)
  }
  ctx.restore()
}

export function drawLabel(ctx, text, x, y, theme) {
  ctx.font = `11px ${theme.font}`
  ctx.fillStyle = theme.muted
  ctx.textBaseline = 'top'
  ctx.fillText(text, x, y)
  ctx.textBaseline = 'alphabetic'
}

// Grid cell under a screen point, or null outside the grid
export function cellAt(shape, tf, mx, my) {
  const x = Math.floor((mx - tf.ox) / tf.s)
  const y = Math.floor((my - tf.oy) / tf.s)
  if (x < 0 || y < 0 || x >= shape.W || y >= shape.H) return null
  return { x, y, i: y * shape.W + x }
}

export function drawCrosshair(ctx, shape, tf, cell, color) {
  const x = tf.ox + (cell.x + 0.5) * tf.s
  const y = tf.oy + (cell.y + 0.5) * tf.s
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 6, y)
  ctx.lineTo(x + 6, y)
  ctx.moveTo(x, y - 6)
  ctx.lineTo(x, y + 6)
  ctx.stroke()
}

// The values under the cursor, in a box next to it
export function drawProbe(ctx, data, cell, mx, my, width, height, theme) {
  const { shape, height: hd, shade } = data
  const i = cell.i
  const n = shade.normals
  const lines = [
    `cell    ${cell.x}, ${cell.y}`,
    `mask    ${shape.mask[i].toFixed(2)}`,
    `edge d  ${(shape.dIn[i] * shape.cell).toFixed(3)}`,
    `height  ${hd.height[i].toFixed(3)}`,
    `normal  ${n[i * 3].toFixed(2)} ${n[i * 3 + 1].toFixed(2)} ${n[i * 3 + 2].toFixed(2)}`,
    `N·L     ${shade.lambert[i].toFixed(2)}`,
    `AO      ${shade.ao[i].toFixed(2)}`,
    `shadow  ${shade.lit[i].toFixed(2)} lit`,
    `tone    ${shade.tone[i].toFixed(2)}`,
  ]
  ctx.font = `11px ${theme.font}`
  const lh = 15
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
  const h = lines.length * lh + 10
  let x = mx + 16
  let y = my + 16
  if (x + w > width) x = mx - 16 - w
  if (y + h > height) y = my - 16 - h
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.strokeStyle = theme.muted
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = theme.ink
  ctx.textBaseline = 'top'
  lines.forEach((l, k) => ctx.fillText(l, x + 8, y + 6 + k * lh))
  ctx.textBaseline = 'alphabetic'
}

export function drawTimings(ctx, pipeline, x, y, theme) {
  const t = pipeline.timings
  const ms = (s) => `${s} ${Math.round(t[s] ?? 0)}`
  const text = `${['shape', 'height', 'shade', 'candidates', 'dots'].map(ms).join(' · ')} ms · ${pipeline.data.dots.n.toLocaleString()} dots`
  ctx.font = `11px ${theme.font}`
  ctx.fillStyle = theme.muted
  ctx.fillText(text, x, y)
}

// Columns × rows for n panels that makes each panel as large as possible
export function stripLayout(n, W, H, width, height, gap, label) {
  let best = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const pw = (width - gap * (cols + 1)) / cols
    const ph = (height - gap * (rows + 1)) / rows - label
    const s = Math.min(pw / W, ph / H)
    if (!best || s > best.s) best = { cols, rows, pw, ph, s }
  }
  const panels = []
  for (let k = 0; k < n; k++) {
    const c = k % best.cols
    const r = Math.floor(k / best.cols)
    const x = gap + c * (best.pw + gap)
    const y = gap + r * (best.ph + label + gap)
    panels.push({ x, y, w: best.pw, h: best.ph + label, label })
  }
  return panels
}
