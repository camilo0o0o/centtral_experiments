// Stage 1a: the silhouette, built from brush strokes and rasterised into a grid with distance
// fields, plus the shared dome and the faceted generator. The grid covers the whole canvas, so a
// cell is always the same spot on screen and adding a stroke only changes the area around it.
// Units: UNIT canvas px make one world unit, the scale 002's parameters were tuned at (a rock
// of radius ~1); heights use the same units.
import { rngFor, createNoise, createWorley } from './noise.js'
import { boxBlur, distanceTransform, smoothstep, clamp } from './field.js'
import { groupStrokes, traceStroke } from './strokes.js'

export const UNIT = 250
const ROUGH_PX = 14 // how far the outline moves in and out at roughness 1
const ROUGH_SCALE = 6 // outline noise frequency, per world unit

// --- shape: strokes → rocks → grid + distance fields ---

export function buildShapeFromStrokes(strokes, params, seed, canvasW, canvasH) {
  const cp = params.cellPx
  const W = Math.max(2, Math.ceil(canvasW / cp))
  const H = Math.max(2, Math.ceil(canvasH / cp))
  const cell = cp / UNIT
  const mask = new Float32Array(W * H)
  const label = new Int32Array(W * H).fill(-1) // which rock each cell belongs to
  const depth = new Float32Array(W * H).fill(-Infinity) // how deep inside that rock, for overlaps
  const noise = createNoise(rngFor(seed, 'outline'))
  const amp = (params.roughness * ROUGH_PX) / cp // in cells
  const width = params.width

  // Strokes that touch are one rock. Each rock is rasterised on its own, inside its box.
  const groups = groupStrokes(strokes, width)
  const rocks = groups.map((g, k) => {
    const rand = rngFor(seed, 'rock' + g.id)
    const cx = (g.box.x0 + g.box.x1) / 2 / UNIT
    const cy = (g.box.y0 + g.box.y1) / 2 / UNIT
    const rock = { id: g.id, cx, cy, lift: 0.8 + 0.4 * rand(), extent: (nx, ny) => rockExtent(g, width, cx, cy, nx, ny) }

    const pad = Math.ceil(amp) + 3
    const gx0 = clamp(Math.floor(g.box.x0 / cp) - pad, 0, W)
    const gy0 = clamp(Math.floor(g.box.y0 / cp) - pad, 0, H)
    const w = clamp(Math.ceil(g.box.x1 / cp) + pad, 0, W) - gx0
    const h = clamp(Math.ceil(g.box.y1 / cp) + pad, 0, H) - gy0
    if (w < 2 || h < 2) return rock

    const cnv = document.createElement('canvas')
    cnv.width = w
    cnv.height = h
    const ctx = cnv.getContext('2d', { willReadFrequently: true })
    ctx.setTransform(1 / cp, 0, 0, 1 / cp, -gx0, -gy0) // canvas px → this box's cells
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of g.strokes) {
      traceStroke(ctx, s)
      ctx.lineWidth = 2 * s.r * width
      ctx.stroke()
    }
    const rgba = ctx.getImageData(0, 0, w, h).data
    const m = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) m[i] = rgba[i * 4 + 3] / 255

    // Signed distance to the outline in cells (negative inside), pushed in and out by noise.
    // Noise is sampled in world space, so the same spot keeps its bumps when strokes are added.
    const dIn = distanceTransform(w, h, (i) => m[i] < 0.5)
    const dOut = distanceTransform(w, h, (i) => m[i] >= 0.5)
    for (let y = 0; y < h; y++) {
      const wy = (gy0 + y + 0.5) * cell
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const wx = (gx0 + x + 0.5) * cell
        let sd = dOut[i] - dIn[i]
        if (amp > 0) sd += noise.fbm(wx * ROUGH_SCALE, wy * ROUGH_SCALE, 4) * 2 * amp
        const c = clamp(0.5 - sd / 2, 0, 1) // antialiased over ~2 cells
        if (c <= 0) continue
        const gi = (gy0 + y) * W + gx0 + x
        // Two rocks that overlap after roughening: the cell goes to the one it's deeper inside
        if (label[gi] >= 0 && -sd <= depth[gi]) continue
        label[gi] = k
        depth[gi] = -sd
        mask[gi] = c
      }
    }
    return rock
  })

  // Distance to the edge. Where two rocks meet, the border counts as an edge too, so each rock
  // gets its own dome and they meet at a crease instead of fusing.
  const border = (i) => {
    const l = label[i]
    const x = i % W
    return (
      (x > 0 && label[i - 1] >= 0 && label[i - 1] !== l) ||
      (x < W - 1 && label[i + 1] >= 0 && label[i + 1] !== l) ||
      (i >= W && label[i - W] >= 0 && label[i - W] !== l) ||
      (i < W * (H - 1) && label[i + W] >= 0 && label[i + W] !== l)
    )
  }
  const dIn = distanceTransform(W, H, (i) => mask[i] < 0.5 || border(i))
  let maxD = 0
  for (let i = 0; i < W * H; i++) if (dIn[i] > maxD) maxD = dIn[i]

  // All strokes' box, in world units (the light overlay points at its centre)
  let bx0 = Infinity
  let by0 = Infinity
  let bx1 = -Infinity
  let by1 = -Infinity
  for (const g of groups) {
    bx0 = Math.min(bx0, g.box.x0)
    by0 = Math.min(by0, g.box.y0)
    bx1 = Math.max(bx1, g.box.x1)
    by1 = Math.max(by1, g.box.y1)
  }
  const cx = (bx0 + bx1) / 2 / UNIT
  const cy = (by0 + by1) / 2 / UNIT
  const span = Math.max(bx1 - bx0, by1 - by0) / UNIT

  return { poly: [], lines: [], W, H, cell, x0: 0, y0: 0, mask, dIn, maxD, label, rocks, strokes: strokes.slice(), cx, cy, span }
}

// Furthest a rock reaches from (cx, cy) along direction n, in world units
function rockExtent(group, width, cx, cy, nx, ny) {
  let m = -Infinity
  for (const s of group.strokes) {
    const r = (s.r * width) / UNIT
    for (let k = 0; k < s.pts.length; k += 2) m = Math.max(m, (s.pts[k] / UNIT - cx) * nx + (s.pts[k + 1] / UNIT - cy) * ny + r)
  }
  return m
}

// --- height: shared dome ---

// Height grows with distance from the edge along a quarter circle, so the edge is steep and the top
// is flat further in than `domeRadius`. The radius is fixed in world units (not a fraction of the
// widest part), so a new fat stroke doesn't reshape the thin ones, and thin strokes stay lower.
// Blurring the distance first softens the crease along the medial axis. Each rock gets its own
// height (`lift`), so separate rocks don't look cloned.
export function dome(shape, params) {
  const { W, H, dIn, cell, label, rocks } = shape
  const out = new Float32Array(W * H)
  const top = params.domeHeight
  const lift = (i) => rocks[label[i]]?.lift ?? 1
  if (!params.dome) {
    for (let i = 0; i < W * H; i++) out[i] = dIn[i] > 0 ? top * lift(i) : 0
    return out
  }
  const R = Math.max(1, params.domeRadius / cell)
  const d = params.domeSoft > 0 ? boxBlur(dIn, W, H, params.domeSoft * R * 0.2) : dIn
  for (let i = 0; i < W * H; i++) {
    if (dIn[i] <= 0) continue
    const t = Math.min(Math.max(d[i] - 0.5, 0) / R, 1)
    out[i] = top * lift(i) * Math.sqrt(1 - (1 - t) * (1 - t))
  }
  return out
}

// --- height: faceted generator ---

// z = b + k·(c − n·p) + t·(tangent·p): a plane that rises inward from its line with slope k
function facetPlane(nx, ny, c, b, slope, rand, silhouette) {
  return { nx, ny, c, b, k: slope * (0.7 + 0.6 * rand()), t: slope * 0.3 * (rand() - 0.5), silhouette }
}

const planeZ = (pl, x, y) => pl.b + pl.k * (pl.c - (pl.nx * x + pl.ny * y)) + pl.t * (pl.nx * y - pl.ny * x)

export function facetedHeight(shape, params, seed) {
  const { W, H, cell, x0, y0, mask, dIn, label } = shape
  const h = dome(shape, params)
  const top = params.domeHeight
  const inside = (i) => dIn[i] > 0

  // Facets: flake scars, each rock with its own set from its own seed (its oldest stroke), placed
  // between the rock's centre and its edge and applied only to that rock's cells
  const planes = []
  if (params.facets) {
    const byRock = shape.rocks.map((rock) => {
      const rand = rngFor(seed, 'facets' + rock.id)
      const list = []
      for (let k = 0; k < params.extraFacets; k++) {
        const a = rand() * Math.PI * 2
        const nx = Math.cos(a)
        const ny = Math.sin(a)
        const c = nx * rock.cx + ny * rock.cy + rock.extent(nx, ny) * (0.3 + rand() * 0.55)
        list.push(facetPlane(nx, ny, c, top * rock.lift * (0.35 + rand() * 0.45), params.facetSlope, rand, false))
      }
      planes.push(...list)
      return list
    })
    for (let y = 0; y < H; y++) {
      const wy = y0 + (y + 0.5) * cell
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (!inside(i)) continue
        const list = byRock[label[i]]
        if (!list) continue
        const wx = x0 + (x + 0.5) * cell
        let z = h[i]
        for (const pl of list) z = Math.min(z, planeZ(pl, wx, wy))
        h[i] = Math.max(0, z)
      }
    }
  }

  // Surface detail, faded out right at the edge so the outline stays clean
  if (params.noise) {
    const n = createNoise(rngFor(seed, 'noise'))
    const s = params.noiseScale
    forInside(shape, (i, wx, wy) => {
      const edge = smoothstep(0, 0.05, dIn[i] * cell)
      h[i] += params.noiseAmp * n.fbm(wx * s, wy * s, 5, params.ridged) * edge
    })
  }

  // Cracks: thin bands along Worley cell borders, domain-warped so they wander, and masked by
  // low-frequency noise so only some areas are cracked
  if (params.cracks) {
    const n = createNoise(rngFor(seed, 'cracks'))
    const worley = createWorley(rngFor(seed, 'worley')() * 1e6)
    const s = params.crackScale
    const thr = 0.8 - params.crackCoverage * 0.6
    forInside(shape, (i, wx, wy) => {
      const u = wx * s + 0.5 * n.noise(wx * s * 0.6, wy * s * 0.6)
      const v = wy * s + 0.5 * n.noise(wx * s * 0.6 + 31.7, wy * s * 0.6 + 17.1)
      const e = worley(u, v)
      if (e >= params.crackWidth) return
      const cover = smoothstep(thr - 0.1, thr + 0.1, n.noise(wx * 1.3 + 5.1, wy * 1.3 + 9.4) * 0.5 + 0.5)
      const g = 1 - e / params.crackWidth
      h[i] -= params.crackDepth * g * g * cover
    })
  }

  // Pits: spherical bowls, many small and few large. Three draws per pit keep them stable
  // when the count or size changes.
  if (params.pits) {
    const rand = rngFor(seed, 'pits')
    for (let k = 0; k < params.pitCount; k++) {
      const px = rand() * W
      const py = rand() * H
      const r = params.pitSize * (0.2 + 0.8 * rand() * rand())
      const rc = r / cell
      if (dIn[(py | 0) * W + (px | 0)] < Math.max(2, rc * 0.5)) continue
      const xa = Math.max(0, Math.floor(px - rc))
      const xb = Math.min(W - 1, Math.ceil(px + rc))
      const ya = Math.max(0, Math.floor(py - rc))
      const yb = Math.min(H - 1, Math.ceil(py + rc))
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const dd = Math.hypot(x + 0.5 - px, y + 0.5 - py) / rc
          if (dd < 1) h[y * W + x] -= params.pitDepth * r * Math.sqrt(1 - dd * dd)
        }
      }
    }
  }

  for (let i = 0; i < W * H; i++) h[i] = Math.max(0, h[i]) * mask[i]
  return { height: h, planes }
}

// Visit every cell inside the rock with its world position
export function forInside(shape, fn) {
  const { W, H, cell, x0, y0, dIn } = shape
  for (let y = 0; y < H; y++) {
    const wy = y0 + (y + 0.5) * cell
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (dIn[i] > 0) fn(i, x0 + (x + 0.5) * cell, wy)
    }
  }
}
