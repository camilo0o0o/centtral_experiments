// Seeded randomness and noise. Everything derives from the rock's seed, so a rock can be rebuilt exactly.

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// One stream per layer, so changing one layer's settings never reshuffles another layer
export function rngFor(seed, name) {
  let h = (seed ^ 0x811c9dc5) >>> 0
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return mulberry32(h)
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t

function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y
    case 1: return -x + y
    case 2: return x - y
    case 3: return -x - y
    case 4: return x
    case 5: return -x
    case 6: return y
    default: return -y
  }
}

// 2D Perlin noise, roughly in [-1, 1], plus fBm built on it
export function createNoise(rand) {
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  function noise(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const X = xi & 255
    const Y = yi & 255
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[perm[X] + Y]
    const ab = perm[perm[X] + Y + 1]
    const ba = perm[perm[X + 1] + Y]
    const bb = perm[perm[X + 1] + Y + 1]
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
    return lerp(x1, x2, v)
  }

  // Ridged fBm folds each octave around zero, which turns smooth bumps into sharp creases
  function fbm(x, y, octaves = 4, ridged = false) {
    let sum = 0
    let amp = 0.5
    let freq = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      let n = noise(x * freq + o * 17.3, y * freq + o * 9.1)
      if (ridged) {
        n = 1 - Math.abs(n) * 1.4
        n = n * Math.abs(n) - 0.4 // sharpen the ridge, then roughly re-centre on 0
      }
      sum += n * amp
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }

  return { noise, fbm }
}

// Worley (cellular) noise: returns F2 − F1, which is 0 on the borders between cells, so thin
// bands where it is small trace a network of cracks
export function createWorley(seed) {
  const s = seed | 0
  const hash = (ix, iy, k) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s + k, 1442695041)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  return function edge(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let f1 = 1e9
    let f2 = 1e9
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i
        const cy = yi + j
        const dx = cx + hash(cx, cy, 0) - x
        const dy = cy + hash(cx, cy, 1) - y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < f1) {
          f2 = f1
          f1 = d
        } else if (d < f2) f2 = d
      }
    }
    return f2 - f1
  }
}
