// Stage 1b: the eroded generator. A rounded dome, lumped up with domain-warped noise, then carved by
// simulated water droplets that pick up material going downhill and drop it where they slow down.
import { rngFor, createNoise } from './noise.js'
import { smoothstep } from './field.js'
import { dome, forInside } from './rock.js'

const DROPLET_PATHS = 150 // how many droplet paths are kept for the debug overlay

export function erodedHeight(shape, params, seed) {
  const { W, H, cell, mask, dIn } = shape
  const h = dome(shape, params)

  // Domain warp: noise sampled at coordinates that are themselves pushed around by noise,
  // which gives folded, flowing lumps instead of round blobs
  if (params.warp) {
    const n = createNoise(rngFor(seed, 'warp'))
    const s = params.warpScale
    const w = params.warpAmount
    forInside(shape, (i, wx, wy) => {
      const px = wx * s
      const py = wy * s
      const qx = n.fbm(px + 5.2, py + 1.3, 4)
      const qy = n.fbm(px + 1.7, py + 9.2, 4)
      const edge = smoothstep(0, 0.08, dIn[i] * cell)
      h[i] += params.warpAmp * n.fbm(px + w * qx, py + w * qy, 5) * edge
    })
  }

  let paths = []
  if (params.erosion) paths = erode(h, shape, params, seed)

  for (let i = 0; i < W * H; i++) h[i] = Math.max(0, h[i]) * mask[i]
  return { height: h, paths }
}

// Droplet hydraulic erosion (after Hans Theobald Beyer, "Implementation of a method for hydraulic
// erosion", 2015). Works in cell-index coordinates (cell centres at integers).
function erode(h, shape, params, seed) {
  const { W, H, cell, mask } = shape
  const rand = rngFor(seed, 'erosion')
  // Rescale heights so the per-cell slopes don't depend on the grid resolution
  const S = 1 / (cell * 100)
  for (let i = 0; i < W * H; i++) h[i] *= S

  // Erosion brush: cells within `radius`, weighted by closeness
  const radius = params.brush
  const brush = []
  let wsum = 0
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.hypot(x, y)
      if (d < radius) {
        brush.push({ dx: x, dy: y, w: radius - d })
        wsum += radius - d
      }
    }
  }
  for (const b of brush) b.w /= wsum

  const inertia = params.inertia
  const gravity = 4
  const minCapacity = 0.01
  const paths = []

  for (let n = 0; n < params.droplets; n++) {
    let x = rand() * (W - 3) + 1
    let y = rand() * (H - 3) + 1
    if (mask[Math.round(y) * W + Math.round(x)] < 0.9) continue
    let dirX = 0
    let dirY = 0
    let speed = 1
    let water = 1
    let sediment = 0
    const path = paths.length < DROPLET_PATHS ? [x + 0.5, y + 0.5] : null

    for (let life = 0; life < params.lifetime; life++) {
      const ix = x | 0
      const iy = y | 0
      const fx = x - ix
      const fy = y - iy
      const i = iy * W + ix
      const nw = h[i]
      const ne = h[i + 1]
      const sw = h[i + W]
      const se = h[i + W + 1]
      const gx = (ne - nw) * (1 - fy) + (se - sw) * fy
      const gy = (sw - nw) * (1 - fx) + (se - ne) * fx
      const height = nw * (1 - fx) * (1 - fy) + ne * fx * (1 - fy) + sw * (1 - fx) * fy + se * fx * fy

      // Turn downhill, keeping some of the previous direction
      dirX = dirX * inertia - gx * (1 - inertia)
      dirY = dirY * inertia - gy * (1 - inertia)
      const len = Math.hypot(dirX, dirY)
      if (len < 1e-9) break
      dirX /= len
      dirY /= len
      x += dirX
      y += dirY
      if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) break
      if (mask[Math.round(y) * W + Math.round(x)] < 0.5) break // ran off the rock
      if (path) path.push(x + 0.5, y + 0.5)

      const jx = x | 0
      const jy = y | 0
      const gxf = x - jx
      const gyf = y - jy
      const j = jy * W + jx
      const newHeight =
        h[j] * (1 - gxf) * (1 - gyf) + h[j + 1] * gxf * (1 - gyf) + h[j + W] * (1 - gxf) * gyf + h[j + W + 1] * gxf * gyf
      const dh = newHeight - height

      const capacity = Math.max(-dh * speed * water * params.capacity, minCapacity)
      if (sediment > capacity || dh > 0) {
        // Uphill: fill the dip behind. Otherwise drop what can't be carried.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * params.depositSpeed
        sediment -= amount
        h[i] += amount * (1 - fx) * (1 - fy)
        h[i + 1] += amount * fx * (1 - fy)
        h[i + W] += amount * (1 - fx) * fy
        h[i + W + 1] += amount * fx * fy
      } else {
        // Downhill: pick material up, never digging deeper than the drop itself
        const amount = Math.min((capacity - sediment) * params.erodeSpeed, -dh)
        for (const b of brush) {
          const bx = ix + b.dx
          const by = iy + b.dy
          if (bx < 0 || by < 0 || bx >= W || by >= H) continue
          const k = by * W + bx
          if (mask[k] < 0.5) continue
          const take = Math.min(h[k], amount * b.w)
          h[k] -= take
          sediment += take
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity))
      water *= 1 - params.evaporate
    }
    if (path && path.length > 4) paths.push(path)
  }

  for (let i = 0; i < W * H; i++) h[i] /= S
  return paths
}
