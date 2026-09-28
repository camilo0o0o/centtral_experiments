// Grid helpers shared by the stages. A field is a Float32Array of W×H values stored row by row.
// Grid coordinates: cell i covers [i, i + 1], so its centre is at i + 0.5.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// Bilinear sample at grid coordinates
export function sample(f, W, H, x, y) {
  x = clamp(x - 0.5, 0, W - 1)
  y = clamp(y - 0.5, 0, H - 1)
  const ix = Math.min(x | 0, W - 2)
  const iy = Math.min(y | 0, H - 2)
  const fx = x - ix
  const fy = y - iy
  const i = iy * W + ix
  return (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + W] * (1 - fx) + f[i + W + 1] * fx) * fy
}

// Repeated box blur, which approaches a Gaussian. Returns a new field.
export function boxBlur(src, W, H, radius, passes = 3) {
  const r = Math.round(radius)
  const a = Float32Array.from(src)
  if (r < 1) return a
  const b = new Float32Array(W * H)
  for (let p = 0; p < passes; p++) {
    blurPass(a, b, W, H, r, W, 1) // rows
    blurPass(b, a, H, W, r, 1, W) // columns
  }
  return a
}

// Blur `lines` lines of length `len`; `step` walks along a line, `stride` jumps between lines
function blurPass(src, dst, len, lines, r, stride, step) {
  const norm = 1 / (2 * r + 1)
  const last = len - 1
  for (let l = 0; l < lines; l++) {
    const base = l * stride
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, last) * step]
    for (let k = 0; k < len; k++) {
      dst[base + k * step] = sum * norm
      sum += src[base + Math.min(k + r + 1, last) * step] - src[base + Math.max(k - r, 0) * step]
    }
  }
}

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
// Returns, for every cell, the distance in cells to the nearest cell where `isFeature(i)` is true.
export function distanceTransform(W, H, isFeature) {
  const INF = 1e20
  const grid = new Float64Array(W * H)
  for (let i = 0; i < W * H; i++) grid[i] = isFeature(i) ? 0 : INF
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x]
    edt1d(f, H, d, v, z, INF)
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x]
    edt1d(f, W, d, v, z, INF)
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x]
  }
  const out = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) out[i] = Math.sqrt(grid[i])
  return out
}

function edt1d(f, n, d, v, z, INF) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}
