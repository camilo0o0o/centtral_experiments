// Runs the stages in order, caching each result. Invalidating a stage re-runs it and everything
// downstream on the next `run`, and nothing upstream (a lighting change never re-runs erosion).
import { buildShape, facetedHeight } from './rock.js'
import { erodedHeight } from './erode.js'
import { shade } from './shade.js'
import { candidates, stipple } from './stipple.js'
import { rngFor } from './noise.js'

const ORDER = ['shape', 'height', 'candidates', 'shade', 'dots']
const DOWNSTREAM = {
  shape: ['height', 'candidates'],
  height: ['shade'],
  candidates: ['dots'],
  shade: ['dots'],
  dots: [],
}

const PAD = 24 // px around the grid in the main view

// Fit a W×H grid into a rectangle: screen = o + grid · s
export function fit(W, H, x, y, w, h, pad = 0) {
  const s = Math.max(0.01, Math.min((w - 2 * pad) / W, (h - 2 * pad) / H))
  return { ox: x + (w - W * s) / 2, oy: y + (h - H * s) / 2, s }
}

export function createPipeline(params) {
  const data = {}
  const timings = {}
  const version = Object.fromEntries(ORDER.map((s) => [s, 0]))
  const dirty = new Set(ORDER)
  let spacing = 0 // dot spacing in cells, used by the current candidates

  function invalidate(stage) {
    dirty.add(stage)
    DOWNSTREAM[stage].forEach(invalidate)
  }

  const stages = {
    shape: () => (data.shape = buildShape(params, params.seed)),
    height: () =>
      (data.height =
        params.generator === 'faceted'
          ? facetedHeight(data.shape, params, params.seed)
          : erodedHeight(data.shape, params, params.seed)),
    candidates: () => {
      spacing = params.spacing / data.tf.s
      const { W, H } = data.shape
      data.candidates = candidates(W, H, spacing, rngFor(params.seed, 'dots'))
    },
    shade: () => (data.shade = shade(data.shape, data.height.height, params)),
    dots: () => (data.dots = stipple(data.shape, data.shade.tone, data.candidates, params, spacing)),
  }

  // `area` is the part of the canvas the main view may use: { x, y, w, h }
  function run(area) {
    for (const stage of ORDER) {
      if (stage === 'candidates') {
        // The main view's scale converts the px spacing into cells, so a resize re-samples the dots
        data.tf = fit(data.shape.W, data.shape.H, area.x, area.y, area.w, area.h, PAD)
        if (Math.abs(params.spacing / data.tf.s - spacing) > 1e-6) invalidate('candidates')
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
