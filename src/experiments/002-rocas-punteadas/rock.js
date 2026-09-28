// Stage 1a: the silhouette, rasterised into a grid with distance fields, the shared dome and the
// faceted generator. Units: the rock has radius ~1 before elongation; heights use the same units.
import { rngFor, createNoise, createWorley } from './noise.js'
import { boxBlur, distanceTransform, smoothstep } from './field.js'

// --- silhouette geometry, from 001 (convex polygons as arrays of {x, y}, centred on 0,0) ---

function circlePoly(r, n = 24) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return pts
}

// Keep the side of the line where dot(p, n) <= c (Sutherland-Hodgman, one plane)
function clip(poly, nx, ny, c) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = a.x * nx + a.y * ny - c
    const db = b.x * nx + b.y * ny - c
    if (da <= 0) out.push(a)
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

function dedupe(poly, eps = 0.01) {
  const out = []
  for (const pt of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > eps) out.push(pt)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps) {
    out.pop()
  }
  return out
}

function chaikin(poly, passes) {
  let pts = poly
  for (let k = 0; k < passes; k++) {
    const next = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    pts = next
  }
  return pts
}

// Chip flakes off a disc with straight cuts. The cuts are kept: each becomes a facet plane later.
function knapped(rand, cuts, depth) {
  let poly = circlePoly(1.15)
  const lines = []
  const minD = 1 - depth * 0.6
  for (let i = 0; i < cuts; i++) {
    const a = rand() * Math.PI * 2
    const c = minD + rand() * (1.1 - minD)
    poly = clip(poly, Math.cos(a), Math.sin(a), c)
    lines.push({ nx: Math.cos(a), ny: Math.sin(a), c })
  }
  return { poly, lines }
}

// The region closer to the origin than to any neighbour seed, bounded by a circle
function voronoiCell(rand, neighbours, jitter) {
  let poly = circlePoly(1.4)
  const offset = rand() * Math.PI * 2
  for (let i = 0; i < neighbours; i++) {
    const a = offset + ((i + (rand() - 0.5) * jitter) / neighbours) * Math.PI * 2
    const d = 2 * (1 + (rand() * 2 - 1) * jitter * 0.6)
    poly = clip(poly, Math.cos(a), Math.sin(a), d / 2)
  }
  return poly
}

// Small noisy radial bumps along the outline
function roughen(poly, noise, roughness) {
  if (roughness === 0) return poly
  const amp = roughness * 0.07
  const pts = []
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(len / 0.015))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      const off = noise.fbm((s + len * t) * 5.4, 3.7, 4) * 2 * amp
      const m = Math.hypot(x, y) || 1
      pts.push({ x: x + (x / m) * off, y: y + (y / m) * off })
    }
    s += len
  }
  return pts
}

// Furthest the polygon reaches along direction n
function extent(poly, nx, ny) {
  let m = -Infinity
  for (const pt of poly) m = Math.max(m, pt.x * nx + pt.y * ny)
  return m
}

// --- shape: outline + grid + distance fields ---

const MARGIN = 0.5 // world units of empty ground around the rock, room for its cast shadow

export function buildShape(params, seed) {
  const rand = rngFor(seed, 'shape')
  let poly
  let lines = []
  if (params.generator === 'faceted') ({ poly, lines } = knapped(rand, params.cuts, params.depth))
  else poly = voronoiCell(rand, params.neighbours, params.jitter)

  // Stretch along x (area-preserving). Cut lines n·p = c map to (nx/sx, ny·sx)·p' = c.
  const sx = Math.sqrt(params.elongation)
  poly = poly.map((pt) => ({ x: pt.x * sx, y: pt.y / sx }))
  lines = lines.map(({ nx, ny, c }) => {
    const mx = nx / sx
    const my = ny * sx
    const m = Math.hypot(mx, my)
    return { nx: mx / m, ny: my / m, c: c / m }
  })
  const smoothing = params.generator === 'eroded' ? params.smoothing : 0
  poly = dedupe(chaikin(dedupe(poly), smoothing))
  poly = roughen(poly, createNoise(rngFor(seed, 'outline')), params.roughness)

  // Grid covering the outline's bounding box plus margin
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pt of poly) {
    minX = Math.min(minX, pt.x)
    minY = Math.min(minY, pt.y)
    maxX = Math.max(maxX, pt.x)
    maxY = Math.max(maxY, pt.y)
  }
  const x0 = minX - MARGIN
  const y0 = minY - MARGIN
  const spanX = maxX - minX + 2 * MARGIN
  const spanY = maxY - minY + 2 * MARGIN
  const cell = Math.max(spanX, spanY) / params.resolution
  const W = Math.ceil(spanX / cell)
  const H = Math.ceil(spanY / cell)

  // Rasterise with canvas: antialiased coverage becomes a 0..1 mask
  const cnv = document.createElement('canvas')
  cnv.width = W
  cnv.height = H
  const ctx = cnv.getContext('2d', { willReadFrequently: true })
  ctx.beginPath()
  poly.forEach((pt, i) => {
    const gx = (pt.x - x0) / cell
    const gy = (pt.y - y0) / cell
    if (i === 0) ctx.moveTo(gx, gy)
    else ctx.lineTo(gx, gy)
  })
  ctx.closePath()
  ctx.fill()
  const rgba = ctx.getImageData(0, 0, W, H).data
  const mask = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = rgba[i * 4 + 3] / 255

  // Distances in cells: inside → to the edge, outside → to the rock
  const dIn = distanceTransform(W, H, (i) => mask[i] < 0.5)
  const dOut = distanceTransform(W, H, (i) => mask[i] >= 0.5)
  let maxD = 0
  for (let i = 0; i < W * H; i++) if (dIn[i] > maxD) maxD = dIn[i]

  return { poly, lines, W, H, cell, x0, y0, mask, dIn, dOut, maxD }
}

// --- height: shared dome ---

// Height grows with distance from the edge along a quarter circle, so the edge is steep and the top
// is flat past `roundness`. Blurring the distance first softens the crease along the medial axis.
export function dome(shape, params) {
  const { W, H, dIn, maxD } = shape
  const out = new Float32Array(W * H)
  const top = params.domeHeight
  if (!params.dome) {
    for (let i = 0; i < W * H; i++) out[i] = dIn[i] > 0 ? top : 0
    return out
  }
  const d = params.domeSoft > 0 ? boxBlur(dIn, W, H, params.domeSoft * maxD * 0.2) : dIn
  const R = Math.max(1, params.domeRound * maxD)
  for (let i = 0; i < W * H; i++) {
    if (dIn[i] <= 0) continue
    const t = Math.min(Math.max(d[i] - 0.5, 0) / R, 1)
    out[i] = top * Math.sqrt(1 - (1 - t) * (1 - t))
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
  const { W, H, cell, x0, y0, mask, dIn } = shape
  const h = dome(shape, params)
  const top = params.domeHeight
  const inside = (i) => dIn[i] > 0

  // Facets: every silhouette cut becomes a flake scar, plus extra scars that don't touch the outline
  const planes = []
  if (params.facets) {
    const rand = rngFor(seed, 'facets')
    for (const l of shape.lines) planes.push(facetPlane(l.nx, l.ny, l.c, top * 0.04, params.facetSlope, rand, true))
    for (let k = 0; k < params.extraFacets; k++) {
      const a = rand() * Math.PI * 2
      const nx = Math.cos(a)
      const ny = Math.sin(a)
      const c = extent(shape.poly, nx, ny) * (0.3 + rand() * 0.55)
      planes.push(facetPlane(nx, ny, c, top * (0.35 + rand() * 0.45), params.facetSlope, rand, false))
    }
    for (let y = 0; y < H; y++) {
      const wy = y0 + (y + 0.5) * cell
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (!inside(i)) continue
        const wx = x0 + (x + 0.5) * cell
        let z = h[i]
        for (const pl of planes) z = Math.min(z, planeZ(pl, wx, wy))
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
