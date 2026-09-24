import p5 from 'p5'
import Matter from 'matter-js'

const { Engine, Composite, Bodies, Body, Sleeping } = Matter

// --- geometry helpers (convex polygons as arrays of {x, y}, centred on 0,0) ---

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

// Drop near-duplicate vertices; zero-length edges break matter's collision axes
function dedupe(poly, eps = 0.75) {
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

export default function ({ container, gui, theme }) {
  const bg = theme.bg
  const params = {
    algorithm: 'knapping',
    // voronoi
    neighbours: 7,
    jitter: 0.5,
    // knapping
    cuts: 7,
    depth: 0.5,
    // shape
    size: 45,
    sizeVariance: 0.4,
    elongation: 1.3,
    smoothing: 0,
    roughness: 0.3,
    color: '#000000',
    // physics
    gravity: 1,
    friction: 0.6,
    bounce: 0.05,
    maxRocks: 150,
    clear: () => clearRocks(),
  }

  let regen = () => {}
  const rebuild = () => regen()

  gui.add(params, 'algorithm', ['voronoi', 'knapping']).onChange(() => {
    updateFolders()
    rebuild()
  })
  const fVor = gui.addFolder('Voronoi')
  fVor.add(params, 'neighbours', 3, 16, 1).onChange(rebuild)
  fVor.add(params, 'jitter', 0, 1).onChange(rebuild)
  const fKnap = gui.addFolder('Knapping')
  fKnap.add(params, 'cuts', 1, 24, 1).onChange(rebuild)
  fKnap.add(params, 'depth', 0, 1).name('cut depth').onChange(rebuild)
  const fShape = gui.addFolder('Shape')
  fShape.add(params, 'size', 10, 150).onChange(rebuild)
  fShape.add(params, 'sizeVariance', 0, 0.9).name('size variance').onChange(rebuild)
  fShape.add(params, 'elongation', 1, 3).onChange(rebuild)
  fShape.add(params, 'smoothing', 0, 4, 1).onChange(rebuild)
  fShape.add(params, 'roughness', 0, 1).onChange(rebuild)
  fShape.addColor(params, 'color')
  const fPhys = gui.addFolder('Physics')
  fPhys.add(params, 'gravity', -1, 3).onChange(() => wakeAll())
  fPhys.add(params, 'friction', 0, 1).onChange(() => rocks.forEach((r) => (r.body.friction = params.friction)))
  fPhys.add(params, 'bounce', 0, 0.9).onChange(() => rocks.forEach((r) => (r.body.restitution = params.bounce)))
  fPhys.add(params, 'maxRocks', 10, 400, 1).name('max rocks')
  gui.add(params, 'clear').name('clear all')

  function updateFolders() {
    fVor.show(params.algorithm === 'voronoi')
    fKnap.show(params.algorithm === 'knapping')
  }
  updateFolders()

  // --- physics world ---

  const engine = Engine.create({ enableSleeping: true })
  const rocks = []
  let walls = []

  function buildWalls(w, h) {
    if (walls.length) Composite.remove(engine.world, walls)
    const t = 200
    const opts = { isStatic: true, friction: 0.8 }
    walls = [
      Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts),
      Bodies.rectangle(-t / 2, h / 2 - h * 2, t, h * 5, opts),
      Bodies.rectangle(w + t / 2, h / 2 - h * 2, t, h * 5, opts),
    ]
    Composite.add(engine.world, walls)
    wakeAll()
  }

  function wakeAll() {
    rocks.forEach((r) => Sleeping.set(r.body, false))
  }

  function clearRocks() {
    Composite.remove(engine.world, rocks.map((r) => r.body))
    rocks.length = 0
  }

  // --- rock generation ---

  function voronoiCell(p, r) {
    // The region closer to the origin than to any neighbour seed, bounded by a circle
    let poly = circlePoly(r * 1.4)
    const n = params.neighbours
    const offset = p.random(Math.PI * 2)
    for (let i = 0; i < n; i++) {
      const a = offset + ((i + p.random(-0.5, 0.5) * params.jitter) / n) * Math.PI * 2
      const d = 2 * r * p.random(1 - params.jitter * 0.6, 1 + params.jitter * 0.6)
      // Bisector between origin and seed (cos a, sin a) * d
      poly = clip(poly, Math.cos(a), Math.sin(a), d / 2)
    }
    return poly
  }

  function knapped(p, r) {
    // Start from a disc and chip flakes off with random straight cuts
    let poly = circlePoly(r * 1.15)
    const minD = r * (1 - params.depth * 0.6)
    for (let i = 0; i < params.cuts; i++) {
      const a = p.random(Math.PI * 2)
      poly = clip(poly, Math.cos(a), Math.sin(a), p.random(minD, r * 1.1))
    }
    return poly
  }

  function makeShape(p) {
    const r = params.size * p.random(1 - params.sizeVariance, 1 + params.sizeVariance)
    let poly = params.algorithm === 'voronoi' ? voronoiCell(p, r) : knapped(p, r)
    // Stretch along x (area-preserving); the body gets a random rotation on drop
    const sx = Math.sqrt(params.elongation)
    poly = poly.map((pt) => ({ x: pt.x * sx, y: pt.y / sx }))
    poly = dedupe(chaikin(dedupe(poly), params.smoothing))
    if (poly.length < 3) poly = circlePoly(r, 8)
    return { collider: poly, r, seed: p.random(1000) }
  }

  // The drawn outline: the collider with small noisy radial bumps (visual only)
  function outline(p, collider, r, seed) {
    if (params.roughness === 0) return collider
    const amp = params.roughness * r * 0.07
    const pts = []
    let s = 0
    for (let i = 0; i < collider.length; i++) {
      const a = collider[i]
      const b = collider[(i + 1) % collider.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const steps = Math.max(1, Math.ceil(len / 4))
      for (let k = 0; k < steps; k++) {
        const t = k / steps
        const x = a.x + (b.x - a.x) * t
        const y = a.y + (b.y - a.y) * t
        const off = (p.noise(seed, (s + len * t) * 0.12) - 0.5) * 2 * amp
        const m = Math.hypot(x, y) || 1
        pts.push({ x: x + (x / m) * off, y: y + (y / m) * off })
      }
      s += len
    }
    return pts
  }

  function dropRock(p, shape, x, y) {
    const body = Body.create({
      position: { x, y },
      vertices: shape.collider,
      friction: params.friction,
      frictionStatic: 0.9,
      restitution: params.bounce,
    })
    // Local-space outline relative to matter's centroid, captured before rotating
    const local = body.vertices.map((v) => ({ x: v.x - body.position.x, y: v.y - body.position.y }))
    Body.setAngle(body, p.random(Math.PI * 2))
    Composite.add(engine.world, body)
    rocks.push({ body, drawn: outline(p, local, shape.r, shape.seed) })

    while (rocks.length > params.maxRocks) {
      Composite.remove(engine.world, rocks.shift().body)
      wakeAll()
    }
  }

  new p5((p) => {
    let next = null
    let hovering = false
    let acc = 0
    const step = 1000 / 60

    regen = () => {
      next = makeShape(p)
      next.drawn = outline(p, next.collider, next.r, next.seed)
    }

    function drawPoly(pts) {
      p.beginShape()
      for (const pt of pts) p.vertex(pt.x, pt.y)
      p.endShape(p.CLOSE)
    }

    p.setup = () => {
      const cnv = p.createCanvas(container.clientWidth, container.clientHeight)
      buildWalls(p.width, p.height)
      regen()

      const toCanvas = (e) => {
        const rect = cnv.elt.getBoundingClientRect()
        return {
          x: ((e.clientX - rect.left) / rect.width) * p.width,
          y: ((e.clientY - rect.top) / rect.height) * p.height,
        }
      }
      // Hide the cursor over the canvas; the next-rock outline stands in for it
      cnv.elt.style.cursor = 'none'
      cnv.elt.addEventListener('pointerdown', (e) => {
        const { x, y } = toCanvas(e)
        dropRock(p, next, x, y)
        regen()
      })
      cnv.elt.addEventListener('pointerenter', () => (hovering = true))
      cnv.elt.addEventListener('pointerleave', () => (hovering = false))
    }

    p.draw = () => {
      engine.gravity.y = params.gravity
      acc = Math.min(acc + p.deltaTime, step * 5)
      while (acc >= step) {
        Engine.update(engine, step)
        acc -= step
      }

      p.background(bg)
      p.noStroke()
      p.fill(params.color)
      for (const { body, drawn } of rocks) {
        p.push()
        p.translate(body.position.x, body.position.y)
        p.rotate(body.angle)
        drawPoly(drawn)
        p.pop()
      }

      // Preview of the next rock under the cursor
      if (hovering && next) {
        p.push()
        p.translate(p.mouseX, p.mouseY)
        p.noFill()
        p.stroke(theme.muted)
        p.strokeWeight(1)
        drawPoly(next.drawn)
        p.pop()
      }
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      buildWalls(p.width, p.height)
    }
  }, container)
}
