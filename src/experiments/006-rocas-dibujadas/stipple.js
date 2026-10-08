// Stage 3: tone → dots. Positions are in grid coordinates, so any view can draw them at any scale.
import { sample } from './field.js'

// Blue-noise candidates (Bridson Poisson-disc) covering the whole grid, each with a fixed random
// rank. They depend only on the seed and the spacing, so re-lighting a rock keeps its dots in place:
// a dot appears when the tone at its spot rises above its rank.
export function candidates(W, H, r, rand) {
  const k = 20
  const cs = r / Math.SQRT2
  const gw = Math.ceil(W / cs)
  const gh = Math.ceil(H / cs)
  const grid = new Int32Array(gw * gh).fill(-1)
  const xs = []
  const ys = []
  const active = []
  const r2 = r * r

  const add = (x, y) => {
    grid[((y / cs) | 0) * gw + ((x / cs) | 0)] = xs.length
    active.push(xs.length)
    xs.push(x)
    ys.push(y)
  }
  const fits = (x, y) => {
    const gx = (x / cs) | 0
    const gy = (y / cs) | 0
    for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const q = grid[j * gw + i]
        if (q >= 0 && (xs[q] - x) ** 2 + (ys[q] - y) ** 2 < r2) return false
      }
    }
    return true
  }

  add(rand() * W, rand() * H)
  while (active.length) {
    const ai = Math.floor(rand() * active.length)
    const p = active[ai]
    let found = false
    for (let t = 0; t < k; t++) {
      const a = rand() * Math.PI * 2
      const d = r * (1 + rand())
      const x = xs[p] + Math.cos(a) * d
      const y = ys[p] + Math.sin(a) * d
      if (x < 0 || y < 0 || x >= W || y >= H || !fits(x, y)) continue
      add(x, y)
      found = true
      break
    }
    if (!found) {
      active[ai] = active[active.length - 1]
      active.pop()
    }
  }

  const n = xs.length
  const rank = new Float32Array(n)
  for (let i = 0; i < n; i++) rank[i] = rand()
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), rank, n }
}

export function stipple(shape, tone, cand, params, spacing) {
  const { W, H, mask, dIn } = shape
  const edgeWidth = spacing * 1.5 // cells
  const toneAt = (x, y) => {
    let t = sample(tone, W, H, x, y)
    // Extra dots right along the outline, so the silhouette reads crisply
    if (params.edge > 0 && sample(mask, W, H, x, y) >= 0.5) {
      const d = sample(dIn, W, H, x, y)
      if (d < edgeWidth) t = Math.max(t, params.edge * (1 - d / edgeWidth))
    }
    return t
  }

  const xs = []
  const ys = []
  for (let i = 0; i < cand.n; i++) {
    const x = cand.xs[i]
    const y = cand.ys[i]
    if (cand.rank[i] < toneAt(x, y)) {
      xs.push(x)
      ys.push(y)
    }
  }
  const dots = { xs: Float32Array.from(xs), ys: Float32Array.from(ys), n: xs.length }
  if (params.relax > 0) relax(dots, W, H, toneAt, spacing, params.relax)
  return dots
}

// Weighted Lloyd relaxation (Secord 2002, "Weighted Voronoi Stippling"): move each dot to the
// tone-weighted centroid of the area closest to it. Evens out clumps; dark areas pull dots in.
function relax(dots, W, H, toneAt, spacing, iterations) {
  const { xs, ys, n } = dots
  if (!n) return
  const step = Math.max(0.5, spacing / 2.5) // sampling step, in cells
  const b = spacing * 2 // bucket size, in cells
  const bw = Math.ceil(W / b)
  const bh = Math.ceil(H / b)
  const head = new Int32Array(bw * bh)
  const next = new Int32Array(n)
  const sx = new Float64Array(n)
  const sy = new Float64Array(n)
  const sw = new Float64Array(n)

  // Tone at every sample point doesn't change between iterations
  const cols = Math.ceil(W / step)
  const rows = Math.ceil(H / step)
  const weights = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) weights[r * cols + c] = toneAt((c + 0.5) * step, (r + 0.5) * step)

  for (let it = 0; it < iterations; it++) {
    head.fill(-1)
    for (let i = 0; i < n; i++) {
      const k = Math.min(bh - 1, (ys[i] / b) | 0) * bw + Math.min(bw - 1, (xs[i] / b) | 0)
      next[i] = head[k]
      head[k] = i
    }
    sx.fill(0)
    sy.fill(0)
    sw.fill(0)
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * step
      const by = Math.min(bh - 1, (y / b) | 0)
      for (let c = 0; c < cols; c++) {
        const w = weights[r * cols + c]
        if (w < 0.001) continue
        const x = (c + 0.5) * step
        const bx = Math.min(bw - 1, (x / b) | 0)
        // Nearest dot: search rings of buckets outward until nothing closer can exist
        let best = -1
        let bestD = Infinity
        for (let ring = 0; ring < 6; ring++) {
          for (let j = by - ring; j <= by + ring; j++) {
            if (j < 0 || j >= bh) continue
            const edgeRow = j === by - ring || j === by + ring
            for (let i = bx - ring; i <= bx + ring; i += edgeRow ? 1 : 2 * ring) {
              if (i < 0 || i >= bw) continue
              for (let q = head[j * bw + i]; q >= 0; q = next[q]) {
                const d = (xs[q] - x) ** 2 + (ys[q] - y) ** 2
                if (d < bestD) {
                  bestD = d
                  best = q
                }
              }
            }
          }
          if (best >= 0 && bestD <= (ring * b) ** 2) break
        }
        if (best < 0) continue
        sx[best] += x * w
        sy[best] += y * w
        sw[best] += w
      }
    }
    for (let i = 0; i < n; i++) {
      if (sw[i] > 0) {
        xs[i] = sx[i] / sw[i]
        ys[i] = sy[i] / sw[i]
      }
    }
  }
}
