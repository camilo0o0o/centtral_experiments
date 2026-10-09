import p5 from 'p5'
import { createCamera } from './camera.js'
import { boxBlur, sample } from './field.js'
import { percentiles, toneField } from './tone.js'
import { candidates } from './stipple.js'

// The rocks' dot pipeline with the camera in place of the rock:
//   camera frame → luminance (camera.js) → tone (tone.js) → dots (stipple.js)
// The blue-noise candidates are fixed to the canvas, so the dots don't crawl around as the picture
// moves; each one just switches on or off as the tone under it crosses its rank.

const VIEWS = ['dots', 'dots over tone', 'tone', 'luminance']
const STYLES = ['stipple', 'halftone']

// Small seeded PRNG, so the same spacing always gives the same dots
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function ({ container, gui, theme }) {
  const bg = theme.bg
  const params = {
    view: 'dots',
    freeze: false,
    mirror: true,
    // dots
    style: 'stipple',
    spacing: 3,
    dotSize: 2,
    color: '#000000',
    steadiness: 0.05,
    // tone
    detail: 4,
    autoLevels: true,
    contrast: 1.3,
    brightness: 0.05,
    gamma: 1.2,
    invert: false,
    edges: 0.35,
    blur: 1,
    smoothing: 0.5,
    // debug
    fps: false,
  }

  let width = 0
  let height = 0
  let W = 0 // tone grid size; one cell is `params.detail` px
  let H = 0
  let raw, lum, tone // W×H fields: latest frame, smoothed luminance, tone
  let levels = { black: 0, white: 1 }
  let haveFrame = false
  let cand = null // dot candidates, in canvas px
  let on = null // which candidates are showing

  function resizeGrid() {
    W = Math.max(3, Math.ceil(width / params.detail))
    H = Math.max(3, Math.ceil(height / params.detail))
    raw = new Float32Array(W * H)
    lum = new Float32Array(W * H)
    tone = new Float32Array(W * H)
    haveFrame = false
  }

  function rebuildDots() {
    cand = candidates(width, height, params.spacing, mulberry32(1))
    on = new Uint8Array(cand.n)
  }

  // --- controls ---

  gui.add(params, 'view', VIEWS)
  gui.add(params, 'freeze').name('freeze (click)').listen()
  gui.add(params, 'mirror')

  const fDots = gui.addFolder('Dots')
  fDots.add(params, 'style', STYLES)
  // Rebuilding the candidates takes a moment on a big screen, so only once the slider is let go
  fDots.add(params, 'spacing', 2, 12).onFinishChange(() => rebuildDots())
  fDots.add(params, 'dotSize', 0.5, 8).name('dot size (stipple)')
  fDots.addColor(params, 'color')
  fDots.add(params, 'steadiness', 0, 0.3).name('steadiness (less flicker)')

  const fTone = gui.addFolder('Tone')
  fTone.add(params, 'detail', 2, 12, 1).name('cell size (px)').onChange(() => resizeGrid())
  fTone.add(params, 'autoLevels').name('auto levels')
  fTone.add(params, 'contrast', 0.2, 4)
  fTone.add(params, 'brightness', -0.5, 0.5)
  fTone.add(params, 'gamma', 0.3, 3)
  fTone.add(params, 'invert')
  fTone.add(params, 'edges', 0, 1).name('edge dots')
  fTone.add(params, 'blur', 0, 4, 1)
  fTone.add(params, 'smoothing', 0, 0.95).name('smoothing (time)')

  const fDebug = gui.addFolder('Debug')
  fDebug.add(params, 'fps').name('fps + dot count')
  fDebug.close()

  // --- camera → luminance → tone ---

  const cam = createCamera()

  function update() {
    // A frozen picture still needs one frame after the grid is resized
    if (params.freeze && haveFrame) return
    if (!cam.read(raw, W, H, params.mirror)) return
    const src = params.blur > 0 ? boxBlur(raw, W, H, params.blur, 2) : raw
    // Average over time: the camera's grain makes dots near their threshold flicker
    const a = haveFrame ? 1 - params.smoothing : 1
    for (let i = 0; i < lum.length; i++) lum[i] += (src[i] - lum[i]) * a
    const l = params.autoLevels ? percentiles(lum) : { black: 0, white: 1 }
    const k = haveFrame ? 0.1 : 1 // ease the levels too, so the whole picture doesn't pump
    levels = { black: levels.black + (l.black - levels.black) * k, white: levels.white + (l.white - levels.white) * k }
    haveFrame = true
  }

  // --- drawing ---

  function drawDots(ctx) {
    const { xs, ys, rank, n } = cand
    const d = params.detail
    let count = 0
    ctx.fillStyle = params.color
    ctx.beginPath()
    if (params.style === 'stipple') {
      // Hysteresis: a dot turns on a little above its rank and off a little below it. The band
      // shrinks towards rank 0 and 1 so pure white and pure black still clear every dot.
      const h = params.steadiness
      const r = params.dotSize / 2
      for (let i = 0; i < n; i++) {
        const t = sample(tone, W, H, xs[i] / d, ys[i] / d)
        const q = rank[i]
        if (on[i]) {
          if (t < q - h * q) on[i] = 0
        } else if (t > q + h * (1 - q)) on[i] = 1
        if (!on[i]) continue
        ctx.moveTo(xs[i] + r, ys[i])
        ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2)
        count++
      }
    } else {
      // Every candidate is a dot, sized by tone; area follows tone, and full black just touches
      const rMax = params.spacing * 0.6
      for (let i = 0; i < n; i++) {
        const r = rMax * Math.sqrt(sample(tone, W, H, xs[i] / d, ys[i] / d))
        if (r < 0.3) continue
        ctx.moveTo(xs[i] + r, ys[i])
        ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2)
        count++
      }
    }
    ctx.fill()
    return count
  }

  // A W×H field drawn as grey, 1 = black, scaled up to the canvas
  const fieldCanvas = document.createElement('canvas')
  const fieldCtx = fieldCanvas.getContext('2d')
  function drawField(ctx, field, darkIsHigh) {
    if (fieldCanvas.width !== W || fieldCanvas.height !== H) {
      fieldCanvas.width = W
      fieldCanvas.height = H
    }
    const img = fieldCtx.createImageData(W, H)
    for (let i = 0, j = 0; i < field.length; i++, j += 4) {
      const v = 255 * (darkIsHigh ? 1 - field[i] : field[i])
      img.data[j] = img.data[j + 1] = img.data[j + 2] = v
      img.data[j + 3] = 255
    }
    fieldCtx.putImageData(img, 0, 0)
    ctx.drawImage(fieldCanvas, 0, 0, W * params.detail, H * params.detail)
  }

  new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(container.clientWidth, container.clientHeight)
      width = p.width
      height = p.height
      resizeGrid()
      rebuildDots()
      container.append(cam.video)
      cam.start()
      cnv.elt.addEventListener('pointerdown', () => (params.freeze = !params.freeze))
    }

    p.draw = () => {
      const ctx = p.drawingContext
      p.background(bg)
      update()

      if (!haveFrame) {
        p.noStroke()
        p.fill(theme.muted)
        p.textFont(theme.font)
        p.textSize(13)
        p.textAlign(p.CENTER, p.CENTER)
        p.text(cam.status ?? '', width / 2, height / 2)
        return
      }

      // Recomputed every frame, so the tone controls also work on a frozen picture
      toneField(lum, W, H, levels, params, tone)
      let count = 0
      const v = params.view
      if (v === 'luminance') drawField(ctx, lum, false)
      else if (v === 'tone') drawField(ctx, tone, true)
      else {
        if (v === 'dots over tone') {
          ctx.globalAlpha = 0.35
          drawField(ctx, tone, true)
          ctx.globalAlpha = 1
        }
        count = drawDots(ctx)
      }

      if (params.fps) {
        p.noStroke()
        p.fill(theme.ink)
        p.textFont(theme.font)
        p.textSize(11)
        p.textAlign(p.LEFT, p.BOTTOM)
        p.text(`${Math.round(p.frameRate())} fps · ${count} / ${cand.n} dots`, 12, height - 12)
      }
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      width = p.width
      height = p.height
      resizeGrid()
      rebuildDots()
    }
  }, container)
}
