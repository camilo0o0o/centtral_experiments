import p5 from 'p5'
import Matter from 'matter-js'
import ml5 from 'ml5'

const { Engine, Composite, Bodies, Body, Sleeping, Vertices } = Matter

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

const scalePoly = (poly, s) => poly.map((pt) => ({ x: pt.x * s, y: pt.y * s }))

// --- eyes ---

// MediaPipe face mesh indices: two eye corners and three upper/lower lid pairs per eye
const EYES = [
  { corners: [33, 133], lids: [[159, 145], [158, 153], [160, 144]] },
  { corners: [263, 362], lids: [[386, 374], [385, 380], [387, 373]] },
]

// Eye aspect ratio: lid gap over eye width, so it doesn't depend on distance to the camera
function eyeOpenness(kp) {
  const d = (i, j) => Math.hypot(kp[i].x - kp[j].x, kp[i].y - kp[j].y)
  let sum = 0
  for (const eye of EYES) {
    const gap = eye.lids.reduce((acc, [a, b]) => acc + d(a, b), 0) / eye.lids.length
    sum += gap / (d(...eye.corners) || 1)
  }
  return sum / EYES.length
}

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// --- sound: a synthesized singing bowl ---

function createAudio() {
  const ac = new AudioContext()
  const master = ac.createGain()
  const comp = ac.createDynamicsCompressor()
  const verb = ac.createConvolver()
  const wet = ac.createGain()
  wet.gain.value = 0.35

  // Reverb impulse: stereo noise with a long exponential tail
  const len = Math.floor(ac.sampleRate * 4.5)
  const ir = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  }
  verb.buffer = ir

  master.connect(comp)
  master.connect(verb)
  verb.connect(wet)
  wet.connect(comp)
  comp.connect(ac.destination)

  // Inharmonic partials of a bowl: [frequency ratio, amplitude, share of the full decay]
  const PARTIALS = [
    [1, 1, 1],
    [2.71, 0.45, 0.7],
    [5.15, 0.22, 0.45],
    [8.43, 0.1, 0.3],
    [12.7, 0.05, 0.2],
  ]

  function bowl(freq, { gain = 0.3, length = 9 } = {}) {
    const t0 = ac.currentTime + 0.02
    const out = ac.createGain()
    out.gain.value = gain
    out.connect(master)

    for (const [ratio, amp, life] of PARTIALS) {
      const f = freq * ratio
      const end = t0 + length * life
      const env = ac.createGain()
      env.gain.setValueAtTime(0.0001, t0)
      env.gain.exponentialRampToValueAtTime(amp, t0 + 0.006)
      env.gain.exponentialRampToValueAtTime(0.0001, end)
      env.connect(out)
      // Two slightly detuned oscillators per partial give the slow wah-wah beating of a real bowl
      const beat = 0.5 + ratio * 0.35
      for (const side of [-0.5, 0.5]) {
        const osc = ac.createOscillator()
        osc.frequency.value = f + side * beat
        const half = ac.createGain()
        half.gain.value = 0.5
        osc.connect(half)
        half.connect(env)
        osc.start(t0)
        osc.stop(end + 0.05)
      }
    }

    // The mallet: a short, soft, low-passed noise thump
    const noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.08), ac.sampleRate)
    const nd = noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 4)
    const src = ac.createBufferSource()
    src.buffer = noise
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = freq * 3
    const ng = ac.createGain()
    ng.gain.value = 0.25
    src.connect(lp)
    lp.connect(ng)
    ng.connect(out)
    src.start(t0)
  }

  return { ac, master, bowl }
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
    elongation: 1.3,
    smoothing: 0,
    roughness: 0.3,
    color: '#000000',
    // growth
    startSize: 8,
    growthSpeed: 1,
    // eyes
    blinkMs: 400,
    eyeSmoothing: 0.4,
    recalibrate: () => recalibrate(),
    // sound
    volume: 0.7,
    pitch: 196,
    // physics
    gravity: 1,
    friction: 0.6,
    bounce: 0.05,
    maxRocks: 150,
    clear: () => clearRocks(),
    // debug
    showCamera: false,
  }

  let recalibrate = () => {}
  let audio = null

  const fShape = gui.addFolder('Forma')
  fShape.add(params, 'algorithm', ['voronoi', 'knapping']).onChange(() => updateFolders())
  const fVor = fShape.addFolder('Voronoi')
  fVor.add(params, 'neighbours', 3, 16, 1)
  fVor.add(params, 'jitter', 0, 1)
  const fKnap = fShape.addFolder('Knapping')
  fKnap.add(params, 'cuts', 1, 24, 1)
  fKnap.add(params, 'depth', 0, 1).name('cut depth')
  fShape.add(params, 'elongation', 1, 3)
  fShape.add(params, 'smoothing', 0, 4, 1)
  fShape.add(params, 'roughness', 0, 1)
  fShape.addColor(params, 'color')
  const fGrow = gui.addFolder('Crecimiento')
  fGrow.add(params, 'startSize', 2, 40).name('start size')
  fGrow.add(params, 'growthSpeed', 0.1, 5).name('growth speed')
  const fEyes = gui.addFolder('Ojos')
  fEyes.add(params, 'blinkMs', 0, 1500, 10).name('ignore blinks (ms)')
  fEyes.add(params, 'eyeSmoothing', 0, 0.9).name('smoothing')
  fEyes.add(params, 'recalibrate').name('recalibrar')
  const fSound = gui.addFolder('Sonido')
  fSound.add(params, 'volume', 0, 1).onChange(() => audio && (audio.master.gain.value = params.volume))
  fSound.add(params, 'pitch', 80, 400).name('pitch (Hz)')
  const fPhys = gui.addFolder('Física')
  fPhys.add(params, 'gravity', -1, 3).onChange(() => wakeAll())
  fPhys.add(params, 'friction', 0, 1).onChange(() => rocks.forEach((r) => (r.body.friction = params.friction)))
  fPhys.add(params, 'bounce', 0, 0.9).onChange(() => rocks.forEach((r) => (r.body.restitution = params.bounce)))
  fPhys.add(params, 'maxRocks', 10, 400, 1).name('max rocks')
  fPhys.add(params, 'clear').name('clear all')
  const fDebug = gui.addFolder('Debug')
  fDebug.add(params, 'showCamera').name('show camera')
  fDebug.close()

  function updateFolders() {
    fVor.show(params.algorithm === 'voronoi')
    fKnap.show(params.algorithm === 'knapping')
  }
  updateFolders()

  // --- messages (DOM, so they never end up in the thumbnail) ---

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    textAlign: 'center',
    font: `16px/1.5 ${theme.font}`,
    whiteSpace: 'pre-line',
    color: theme.ink,
    cursor: 'pointer',
    transition: 'opacity 0.8s',
  })
  const hint = document.createElement('div')
  Object.assign(hint.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '24px',
    textAlign: 'center',
    font: `13px/1.5 ${theme.font}`,
    color: theme.muted,
    pointerEvents: 'none',
    transition: 'opacity 0.8s',
    opacity: '0',
  })
  const say = (text) => {
    overlay.textContent = text
    overlay.style.opacity = text ? '1' : '0'
  }
  const whisper = (text) => {
    if (text) hint.textContent = text
    hint.style.opacity = text ? '1' : '0'
  }

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

  // Shapes are built at this radius and then scaled while the rock grows
  const REF = 50

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
    const r = REF
    let poly = params.algorithm === 'voronoi' ? voronoiCell(p, r) : knapped(p, r)
    // Stretch along x (area-preserving); the rock also turns slowly while it grows
    const sx = Math.sqrt(params.elongation)
    poly = poly.map((pt) => ({ x: pt.x * sx, y: pt.y / sx }))
    poly = dedupe(chaikin(dedupe(poly), params.smoothing))
    if (poly.length < 3) poly = circlePoly(r, 8)
    // Centre on the centroid, which is where matter puts the body's position
    const c = Vertices.centre(poly)
    const collider = poly.map((pt) => ({ x: pt.x - c.x, y: pt.y - c.y }))
    return { collider, drawn: outline(p, collider, r, p.random(1000)) }
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

  function dropRock(shape, x, y, radius, angle) {
    const s = radius / REF
    let vertices = dedupe(scalePoly(shape.collider, s))
    if (vertices.length < 3) vertices = circlePoly(radius, 8)
    const body = Body.create({
      position: { x, y },
      vertices,
      friction: params.friction,
      frictionStatic: 0.9,
      restitution: params.bounce,
    })
    Body.setAngle(body, angle)
    Composite.add(engine.world, body)
    rocks.push({ body, drawn: scalePoly(shape.drawn, s) })

    while (rocks.length > params.maxRocks) {
      Composite.remove(engine.world, rocks.shift().body)
      wakeAll()
    }
  }

  // --- camera + face tracking ---

  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.style.display = 'none'

  let face = null // latest keypoints, or null when no face is visible
  let lastFaceAt = 0
  let openness = null // smoothed eye openness

  async function startTracking() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      video.srcObject = stream
      await video.play()
    } catch (err) {
      console.error(err)
      throw new Error('No se pudo usar la cámara. Revisa los permisos y recarga la página.')
    }
    let faceMesh
    try {
      // Without p5 1.x around, ml5 returns a promise that resolves once the model has loaded
      faceMesh = await ml5.faceMesh({ maxFaces: 1, refineLandmarks: false })
    } catch (err) {
      console.error(err)
      throw new Error('No se pudo cargar el modelo de la cara. Revisa tu conexión y recarga la página.')
    }
    faceMesh.detectStart(video, (faces) => {
      if (!faces.length) {
        face = null
        return
      }
      face = faces[0].keypoints
      lastFaceAt = performance.now()
      const raw = eyeOpenness(face)
      openness = openness == null ? raw : openness + (raw - openness) * (1 - params.eyeSmoothing)
    })
  }

  // --- the experience: calibrate, then grow on closed eyes and drop on open eyes ---

  // intro → loading → calibOpen → calibClosed → ready
  let state = 'intro'
  let stateAt = 0
  let samples = []
  let openBase = 0
  let closedBase = 0
  let closeT = 0
  let openT = 0
  let armed = false // eyes have been seen open since calibration, so the next closing counts
  let closedSince = null
  let growing = null // { shape, radius, angle }
  let dropped = 0

  const setState = (s) => {
    state = s
    stateAt = performance.now()
    samples = []
  }

  recalibrate = () => {
    if (state === 'intro' || state === 'loading') return
    growing = null
    startCalibration()
  }

  function startCalibration() {
    whisper('')
    say('Mira la pantalla con los ojos abiertos')
    setState('calibOpen')
  }

  overlay.addEventListener('click', async () => {
    if (state !== 'intro') return
    setState('loading')
    say('Cargando…')
    audio = createAudio()
    audio.ac.resume()
    audio.master.gain.value = params.volume
    overlay.style.cursor = 'default'
    overlay.style.pointerEvents = 'none'
    try {
      await startTracking()
      startCalibration()
    } catch (err) {
      say(err.message)
    }
  })

  function updateExperience(now) {
    const seen = face && now - lastFaceAt < 500
    if (state === 'calibOpen' || state === 'calibClosed' || state === 'ready') {
      if (!seen && now - lastFaceAt > 1000) whisper('No veo tu cara')
      else if (state === 'ready' && !dropped && !growing) whisper('Cierra los ojos para crear una piedra')
      else whisper('')
    }
    if (!seen) return

    if (state === 'calibOpen') {
      // Give the user a moment to read, then sample open eyes for about two seconds
      if (now - stateAt > 1500) samples.push(openness)
      if (now - stateAt > 3500 && samples.length >= 20) {
        openBase = median(samples)
        say('Ahora cierra los ojos.\nÁbrelos cuando escuches la campanita.')
        setState('calibClosed')
      }
    } else if (state === 'calibClosed') {
      // Wait until the eyes are clearly closing, let them settle, then sample for two seconds
      if (openness < openBase * 0.7) {
        if (closedSince == null) closedSince = now
        if (now - closedSince > 500) samples.push(openness)
      } else {
        closedSince = null
        samples = []
      }
      if (samples.length && now - closedSince > 2500) {
        closedBase = median(samples)
        closedSince = null
        audio.bowl(1046, { gain: 0.08, length: 2.5 })
        if (openBase - closedBase < 0.03) {
          say('No pudimos medir bien, intentemos otra vez')
          setTimeout(startCalibration, 2500)
          setState('retry')
          return
        }
        closeT = closedBase + 0.35 * (openBase - closedBase)
        openT = closedBase + 0.6 * (openBase - closedBase)
        armed = false
        say('')
        setState('ready')
      }
    } else if (state === 'ready') {
      if (!growing) {
        if (openness > openT) armed = true
        if (armed && openness < closeT) {
          if (closedSince == null) closedSince = now
          if (now - closedSince >= params.blinkMs) startGrowing()
        } else {
          closedSince = null
        }
      } else if (openness > openT) {
        release()
      }
    }
  }

  let p5ref = null
  let width = 0
  let height = 0

  function startGrowing() {
    closedSince = null
    audio.bowl(params.pitch)
    growing = { shape: makeShape(p5ref), radius: params.startSize, angle: p5ref.random(Math.PI * 2) }
  }

  function release() {
    audio.bowl(params.pitch * 1.5)
    dropRock(growing.shape, width / 2, height / 2, growing.radius, growing.angle)
    growing = null
    dropped++
  }

  // --- drawing ---

  new p5((p) => {
    let acc = 0
    const step = 1000 / 60
    p5ref = p

    function drawPoly(pts) {
      p.beginShape()
      for (const pt of pts) p.vertex(pt.x, pt.y)
      p.endShape(p.CLOSE)
    }

    function drawCamera() {
      if (!video.videoWidth) return
      const w = Math.min(240, p.width * 0.35)
      const h = (w * video.videoHeight) / video.videoWidth
      const x = 16
      const y = 16
      const sx = w / video.videoWidth
      p.push()
      // Mirrored, like looking in a mirror
      p.translate(x + w, y)
      p.scale(-1, 1)
      p.drawingContext.drawImage(video, 0, 0, w, h)
      if (face) {
        p.noStroke()
        p.fill('#ff3b30')
        for (const eye of EYES) {
          for (const i of [...eye.corners, ...eye.lids.flat()]) p.circle(face[i].x * sx, face[i].y * sx, 3)
        }
      }
      p.pop()

      // Openness meter with the two thresholds
      const my = y + h + 8
      const toX = (v) => x + Math.min(1, v / Math.max(0.05, openBase * 1.3)) * w
      p.noStroke()
      p.fill(theme.muted)
      p.rect(x, my, w, 6)
      if (openness != null) {
        p.fill(growing ? '#ff3b30' : theme.ink)
        p.rect(x, my, toX(openness) - x, 6)
      }
      if (state === 'ready') {
        p.stroke(theme.ink)
        p.strokeWeight(1)
        p.line(toX(closeT), my - 3, toX(closeT), my + 9)
        p.line(toX(openT), my - 3, toX(openT), my + 9)
      }
      p.noStroke()
      p.fill(theme.ink)
      p.textFont(theme.font)
      p.textSize(11)
      p.text(`${state}  ${openness == null ? '–' : openness.toFixed(3)}`, x, my + 22)
    }

    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight)
      width = p.width
      height = p.height
      buildWalls(p.width, p.height)
      container.append(video, overlay, hint)
      say('Toca para empezar')
    }

    p.draw = () => {
      const now = performance.now()
      updateExperience(now)

      // Area grows at a constant rate, so the radius slows down on its own but never stops
      if (growing && face && now - lastFaceAt < 500) {
        const rate = 650 * params.growthSpeed
        growing.radius = Math.sqrt(growing.radius ** 2 + rate * (p.deltaTime / 1000))
        growing.angle += 0.1 * (p.deltaTime / 1000)
      }

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

      if (growing) {
        p.push()
        p.translate(p.width / 2, p.height / 2)
        p.rotate(growing.angle)
        p.scale(growing.radius / REF)
        drawPoly(growing.shape.drawn)
        p.pop()
      }

      // Debug camera: only when asked for and while the controls panel is showing
      if (params.showCamera && !gui._hidden && !gui._closed) drawCamera()
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      width = p.width
      height = p.height
      buildWalls(p.width, p.height)
    }
  }, container)
}
