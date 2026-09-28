// Stage 2: heightfield → tone. Every intermediate field is kept so the debug views can show it.
// Frame: x right, y down (grid rows), z up out of the screen.
import { boxBlur, clamp } from './field.js'

export function shade(shape, h, params) {
  const { W, H, cell, mask } = shape
  const N = W * H
  const az = (params.azimuth * Math.PI) / 180
  const el = (params.elevation * Math.PI) / 180
  // Unit vector pointing toward the light
  const lx = Math.cos(el) * Math.cos(az)
  const ly = Math.cos(el) * Math.sin(az)
  const lz = Math.sin(el)

  // Normals from central differences, and Lambert N·L
  const normals = new Float32Array(N * 3)
  const lambert = new Float32Array(N)
  let maxH = 0
  for (let y = 0; y < H; y++) {
    const yu = y > 0 ? y - 1 : y
    const yd = y < H - 1 ? y + 1 : y
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const xl = x > 0 ? x - 1 : x
      const xr = x < W - 1 ? x + 1 : x
      const dx = (h[y * W + xr] - h[y * W + xl]) / ((xr - xl) * cell)
      const dy = (h[yd * W + x] - h[yu * W + x]) / ((yd - yu) * cell)
      const m = Math.hypot(dx, dy, 1)
      const nx = -dx / m
      const ny = -dy / m
      const nz = 1 / m
      normals[i * 3] = nx
      normals[i * 3 + 1] = ny
      normals[i * 3 + 2] = nz
      lambert[i] = Math.max(0, nx * lx + ny * ly + nz * lz)
      if (h[i] > maxH) maxH = h[i]
    }
  }

  // Cavity AO: height minus its local average. Negative means a crevice, which gets darker.
  const blurred = boxBlur(h, W, H, params.aoRadius / cell / 1.7)
  const ao = new Float32Array(N)
  for (let i = 0; i < N; i++) ao[i] = clamp(1 + ((h[i] - blurred[i]) / params.aoRadius) * params.aoStrength, 0, 1)

  // Cast shadows of the rock onto itself: walk from each rock cell toward the light; if the terrain
  // rises above the ray, the cell is in shadow. `softness` fades cells whose ray only just clears
  // the terrain (penumbra).
  const lit = new Float32Array(N).fill(1)
  if (params.shadow && el > 0.01) {
    const stepX = Math.cos(az)
    const stepY = Math.sin(az)
    const rise = Math.tan(el) * cell
    const soft = params.softness * 0.5
    const bias = cell
    // Only the rock can block the light, so a ray that has left its bounding box toward the light is done
    let bx0 = W
    let bx1 = -1
    let by0 = H
    let by1 = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (h[y * W + x] <= 0) continue
        bx0 = Math.min(bx0, x)
        bx1 = Math.max(bx1, x)
        by0 = Math.min(by0, y)
        by1 = Math.max(by1, y)
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (mask[i] <= 0.01) continue
        let rayH = h[i] + bias
        let px = x
        let py = y
        let res = 1
        for (let t = 1; ; t++) {
          px += stepX
          py += stepY
          rayH += rise
          if (rayH >= maxH) break
          if ((stepX < 0 ? px < bx0 : px > bx1) || (stepY < 0 ? py < by0 : py > by1)) break
          const ix = Math.round(px)
          const iy = Math.round(py)
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) break
          const gap = rayH - h[iy * W + ix]
          if (gap < 0) {
            res = 0
            break
          }
          if (soft > 0) res = Math.min(res, gap / (t * cell) / soft)
        }
        lit[i] = res
      }
    }
  }

  // Tone = darkness 0..1, i.e. how likely a dot is. Only the rock gets tone; its antialiased
  // mask coverage fades the edge.
  const tone = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const m = mask[i]
    if (m <= 0) continue
    const d = params.lambert ? 1 - params.lambertWeight * (1 - lambert[i]) : 1
    const s = params.shadow ? 1 - params.shadowWeight * (1 - lit[i]) : 1
    const a = params.ao ? 1 - params.aoWeight * (1 - ao[i]) : 1
    const b = clamp((params.ambient + (1 - params.ambient) * d * s) * a * params.exposure, 0, 1)
    tone[i] = m * (params.baseTone + (1 - params.baseTone) * Math.pow(1 - b, params.gamma))
  }

  return { normals, lambert, ao, lit, tone, maxH }
}
