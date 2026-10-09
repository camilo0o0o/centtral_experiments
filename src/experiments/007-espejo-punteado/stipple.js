// Blue-noise candidates (Bridson Poisson-disc) covering the whole grid, each with a fixed random
// rank. They depend only on the seed, the spacing and the canvas size, so the dots stay put while
// the picture moves: a dot appears when the tone at its spot rises above its rank.
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
