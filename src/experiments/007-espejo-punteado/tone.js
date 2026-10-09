// Luminance → tone, the amount of ink each spot wants (0 = paper, 1 = solid dots).
// Like the rocks' shading, it's a grid that the stipple stage only samples.
import { clamp } from './field.js'

// Black and white points from the 2nd and 98th percentiles, so a dim or washed-out camera still
// uses the full range of dots
export function percentiles(lum) {
  const BINS = 256
  const hist = new Uint32Array(BINS)
  for (let i = 0; i < lum.length; i++) hist[Math.min(BINS - 1, (lum[i] * BINS) | 0)]++
  const lo = lum.length * 0.02
  const hi = lum.length * 0.98
  let acc = 0
  let black = 0
  let white = 1
  for (let b = 0; b < BINS; b++) {
    const prev = acc
    acc += hist[b]
    if (prev < lo && acc >= lo) black = b / BINS
    if (prev < hi && acc >= hi) white = (b + 1) / BINS
  }
  return { black, white: Math.max(white, black + 0.05) }
}

export function toneField(lum, W, H, levels, params, out) {
  const { black, white } = levels
  const span = white - black
  for (let i = 0; i < lum.length; i++) {
    let t = 1 - clamp((lum[i] - black) / span, 0, 1)
    if (params.invert) t = 1 - t
    t = clamp((t - 0.5) * params.contrast + 0.5 - params.brightness, 0, 1)
    out[i] = t ** params.gamma
  }
  if (params.edges > 0) addEdges(lum, W, H, span, params.edges, out)
  return out
}

// Sobel gradient of the luminance. Strong edges get at least `amount` of tone, so outlines read
// even across flat, light areas (the rocks' "edge dots" did the same along the silhouette).
function addEdges(lum, W, H, span, amount, out) {
  const gain = 1.5 / span
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const a = lum[i - W - 1], b = lum[i - W], c = lum[i - W + 1]
      const d = lum[i - 1], f = lum[i + 1]
      const g = lum[i + W - 1], h = lum[i + W], k = lum[i + W + 1]
      const gx = c + 2 * f + k - a - 2 * d - g
      const gy = g + 2 * h + k - a - 2 * b - c
      const e = amount * Math.min(1, Math.hypot(gx, gy) * gain)
      if (e > out[i]) out[i] = e
    }
  }
}
