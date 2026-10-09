// Runs the stages in order, caching each result. Invalidating a stage re-runs it and everything
// downstream on the next `run`, and nothing upstream (a lighting change never re-runs erosion).
import { buildShapeFromStrokes, facetedHeight } from './rock.js'
import { erodedHeight } from './erode.js'
import { shade } from './shade.js'
import { candidates, stipple } from './stipple.js'
import { rngFor } from './noise.js'

const ORDER = ['shape', 'height', 'candidates', 'shade', 'dots']
const DOWNSTREAM = {
  shape: ['height'],
  height: ['shade'],
  candidates: ['dots'],
  shade: ['dots'],
  dots: [],
}

// Fit a W×H grid into a rectangle: screen = o + grid · s
export function fit(W, H, x, y, w, h, pad = 0) {
  const s = Math.max(0.01, Math.min((w - 2 * pad) / W, (h - 2 * pad) / H))
  return { ox: x + (w - W * s) / 2, oy: y + (h - H * s) / 2, s }
}

// `strokes` is the sketch's array, changed in place; invalidate 'shape' after changing it
export function createPipeline(params, strokes) {
  const data = { empty: true }
  const timings = {}
  const version = Object.fromEntries(ORDER.map((s) => [s, 0]))
  const dirty = new Set(ORDER)
  let size = { w: 0, h: 0 }
  let candKey = '' // what the current candidates were made for

  function invalidate(stage) {
    dirty.add(stage)
    DOWNSTREAM[stage].forEach(invalidate)
  }

  const stages = {
    shape: () => (data.shape = buildShapeFromStrokes(strokes, params, params.seed, size.w, size.h)),
    height: () =>
      (data.height =
        params.generator === 'faceted'
          ? facetedHeight(data.shape, params, params.seed)
          : erodedHeight(data.shape, params, params.seed)),
    candidates: () => {
      const { W, H } = data.shape
      data.candidates = candidates(W, H, data.spacing, rngFor(params.seed, 'dots'))
    },
    shade: () => (data.shade = shade(data.shape, data.height.height, params)),
    dots: () => (data.dots = stipple(data.shape, data.shade.tone, data.candidates, params, data.spacing)),
  }

  // The grid covers the whole canvas 1:1, so the rock lands exactly where it was drawn.
  // `canvas` is the canvas size in px: { w, h }.
  function run(canvas) {
    if (canvas.w !== size.w || canvas.h !== size.h) {
      size = { w: canvas.w, h: canvas.h }
      invalidate('shape')
    }
    data.tf = { ox: 0, oy: 0, s: params.cellPx }
    data.empty = strokes.length === 0
    if (data.empty) return
    for (const stage of ORDER) {
      if (stage === 'candidates') {
        // Dot candidates cover the whole grid and depend only on its size, the spacing and the
        // seed, so dots away from a new stroke stay exactly where they were
        data.spacing = params.spacing / params.cellPx
        const key = `${data.shape.W}x${data.shape.H}:${data.spacing}:${params.seed}`
        if (key !== candKey) invalidate('candidates')
        candKey = key
      }
      if (!dirty.has(stage)) continue
      const t0 = performance.now()
      stages[stage]()
      timings[stage] = performance.now() - t0
      version[stage]++
      dirty.delete(stage)
    }
  }

  return { data, timings, version, invalidate, run }
}
