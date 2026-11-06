// Four frames placed at random on a grainy beige background: a 4:3 close-up of each eye, a tall
// 3:4 crop of the nose and a wider 4:3 crop of the mouth. All of them follow the face seen by the camera, loosely: the feature
// can wander inside a slack zone before the frame moves after it.
// Face tracking is the same ml5 faceMesh setup as 003 Piedras con los ojos cerrados.
//
// Each frame goes through: camera crop → time effect → step-printing → blur + colour grade → grain
// Time effects:
// - estela (decay): each frame is mixed over the previous image, so movement leaves ghosts that fade
// - eco: copies from a moment ago are layered over the live image, as separate delayed repeats
// Step-printing shows the result only a few times a second and holds it, for a slow-motion feel.
import ml5 from 'ml5'

// MediaPipe face mesh indices
const EYE_A = { corners: [33, 133], points: [33, 133, 159, 145, 158, 153, 160, 144] }
const EYE_B = { corners: [263, 362], points: [263, 362, 386, 374, 385, 380, 387, 373] }
const EYE_OUTER = [33, 263] // outer corners, used for the tilt of the face
const MOUTH = { corners: [61, 291], points: [61, 291, 0, 17, 13, 14, 37, 267, 84, 314] }
// The nose crop is sized by its length (between the eyes → base of the nose) instead of its width
const NOSE = { length: [168, 2], points: [168, 6, 197, 195, 5, 4, 1, 2, 98, 327] }

const LANDSCAPE = 4 / 3
const PORTRAIT = 3 / 4

// Echo history: small snapshots of each frame, taken every CAPTURE_MS
const CAPTURE_MS = 66
const HISTORY = 40 // covers the longest echo: 4 copies × 0.6 s

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export default function ({ container, gui, theme }) {
  const params = {
    background: '#e6d9c2',
    grain: 0.55,
    grainSize: 1.5,
    animateGrain: true,

    eyeSize: 0.28, // frame width as a share of the shorter side of the page
    mouthSize: 0.48,
    noseSize: 0.22,
    eyeZoom: 1.8, // crop width relative to the feature's width; bigger shows more around it
    mouthZoom: 2.4,
    noseZoom: 1.5,
    slack: 0.2, // how far the feature can wander from the centre, as a share of the crop
    smoothing: 0.85,
    followTilt: true,
    shuffle: () => placeFrames(),

    contrast: 1.25,
    brightness: 0.05,
    saturation: 1.2,
    blur: 1.5,
    colorMap: 0.65,
    shadows: '#2b3812',
    mids: '#d0461c',
    lights: '#ffe9a8',
    videoGrain: 0.6,
    videoGrainSize: 2,
    colorGrain: true,

    effect: 'estela',
    trail: 0.85,
    echoes: 3,
    echoDelay: 0.25,
    echoStrength: 0.8,
    fps: 12,
  }

  const fLook = gui.addFolder('Fondo')
  fLook.addColor(params, 'background').name('color')
  fLook.add(params, 'grain', 0, 1, 0.01).name('grano')
  fLook.add(params, 'grainSize', 1, 4, 0.5).name('tamaño del grano').onChange(() => buildGrain())
  fLook.add(params, 'animateGrain').name('grano animado')

  const fFrames = gui.addFolder('Recuadros')
  fFrames.add(params, 'eyeSize', 0.1, 0.6, 0.01).name('tamaño ojos').onChange(() => placeFrames())
  fFrames.add(params, 'mouthSize', 0.15, 0.7, 0.01).name('tamaño boca').onChange(() => placeFrames())
  fFrames.add(params, 'noseSize', 0.1, 0.5, 0.01).name('tamaño nariz').onChange(() => placeFrames())
  fFrames.add(params, 'eyeZoom', 1, 4, 0.05).name('encuadre ojos')
  fFrames.add(params, 'mouthZoom', 1, 5, 0.05).name('encuadre boca')
  fFrames.add(params, 'noseZoom', 1, 4, 0.05).name('encuadre nariz')
  fFrames.add(params, 'slack', 0, 0.45, 0.01).name('holgura')
  fFrames.add(params, 'smoothing', 0, 0.97, 0.01).name('suavizado')
  fFrames.add(params, 'followTilt').name('seguir inclinación')
  fFrames.add(params, 'shuffle').name('mover recuadros')

  const fColor = gui.addFolder('Imagen')
  fColor.add(params, 'contrast', 0.3, 3, 0.01).name('contraste')
  fColor.add(params, 'brightness', -0.5, 0.5, 0.01).name('brillo')
  fColor.add(params, 'saturation', 0, 3, 0.01).name('saturación')
  fColor.add(params, 'blur', 0, 8, 0.1).name('desenfoque')
  fColor.add(params, 'colorMap', 0, 1, 0.01).name('mapa de color')
  fColor.addColor(params, 'shadows').name('sombras')
  fColor.addColor(params, 'mids').name('medios')
  fColor.addColor(params, 'lights').name('luces')
  fColor.add(params, 'videoGrain', 0, 1, 0.01).name('grano')
  fColor.add(params, 'videoGrainSize', 1, 4, 0.5).name('tamaño del grano').onChange(() => buildGrain())
  fColor.add(params, 'colorGrain').name('grano en color').onChange(() => buildGrain())

  const fTime = gui.addFolder('Tiempo')
  fTime.add(params, 'effect', ['ninguno', 'estela', 'eco']).name('efecto').onChange(() => {
    showTimeControls()
    // The trail starts from a clean image instead of whatever the last effect left behind
    for (const f of frames) f.fresh = true
  })
  const cTrail = fTime.add(params, 'trail', 0, 0.97, 0.01).name('estela')
  const cEchoes = fTime.add(params, 'echoes', 1, 4, 1).name('ecos')
  const cEchoDelay = fTime.add(params, 'echoDelay', 0.07, 0.6, 0.01).name('separación (s)')
  const cEchoStrength = fTime.add(params, 'echoStrength', 0.1, 1, 0.01).name('fuerza del eco')
  fTime.add(params, 'fps', 2, 60, 1).name('fotogramas/s')

  function showTimeControls() {
    cTrail.show(params.effect === 'estela')
    for (const c of [cEchoes, cEchoDelay, cEchoStrength]) c.show(params.effect === 'eco')
  }
  showTimeControls()

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  container.append(canvas)

  let width = 0
  let height = 0
  let dpr = 1
  new ResizeObserver(() => {
    dpr = Math.min(devicePixelRatio, 2)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    placeFrames()
  }).observe(container)

  // --- grain: a few noise tiles in device pixels, drawn as a pattern at a random offset ---

  const TILE = 256
  const TILES = 6
  let bgTiles = []
  let videoTiles = []

  // Roughly gaussian noise in -1..1; a few values land far out and read as specks
  const noise = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5

  function makeTiles(grainSize, fill) {
    const size = Math.ceil(TILE / grainSize)
    const tiles = []
    for (let k = 0; k < TILES; k++) {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g = c.getContext('2d')
      const img = g.createImageData(size, size)
      for (let i = 0; i < img.data.length; i += 4) fill(img.data, i)
      g.putImageData(img, 0, 0)
      tiles.push(c)
    }
    return tiles
  }

  function buildGrain() {
    // Background: white and black specks with alpha, drawn on top of the flat colour
    bgTiles = makeTiles(params.grainSize, (d, i) => {
      const v = noise()
      d[i] = d[i + 1] = d[i + 2] = v > 0 ? 255 : 0
      d[i + 3] = Math.min(255, Math.abs(v) ** 0.8 * 255)
    })
    // Video: noise around mid grey, blended with 'overlay' so grey leaves the image untouched.
    // In colour, each channel gets its own noise, like the dye clouds of film
    videoTiles = makeTiles(params.videoGrainSize, (d, i) => {
      const v = noise()
      d[i] = 128 + v * 127
      d[i + 1] = 128 + (params.colorGrain ? noise() : v) * 127
      d[i + 2] = 128 + (params.colorGrain ? noise() : v) * 127
      d[i + 3] = 255
    })
  }
  buildGrain()

  // Fill the current clip with a grain layer. Called with the identity transform (device pixels)
  function drawGrain(tiles, grainSize, amount, mode) {
    if (amount <= 0) return
    const index = params.animateGrain ? Math.floor(Math.random() * TILES) : 0
    const ox = params.animateGrain ? Math.random() * TILE : 0
    const oy = params.animateGrain ? Math.random() * TILE : 0
    const pattern = ctx.createPattern(tiles[index], 'repeat')
    pattern.setTransform(new DOMMatrix().translate(ox, oy).scale(grainSize))
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.globalCompositeOperation = mode
    ctx.globalAlpha = amount
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  // --- frames: rectangles at random places that don't overlap ---

  const makeFrame = (feature, size, zoom, aspect = LANDSCAPE) => ({
    feature,
    aspect, // width / height
    size: () => params[size],
    zoom: () => params[zoom],
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    crop: null, // smoothed crop in video pixels
    cur: document.createElement('canvas'), // the live camera crop
    exposure: document.createElement('canvas'), // result of the time effect
    shown: document.createElement('canvas'), // what's on screen, held between steps
    history: [], // ring of { t, c } snapshots for the echo
    historyIndex: 0,
    lastCapture: -Infinity,
    lastStep: -Infinity,
    fresh: true,
  })

  const frames = [
    makeFrame(EYE_A, 'eyeSize', 'eyeZoom'),
    makeFrame(EYE_B, 'eyeSize', 'eyeZoom'),
    makeFrame(NOSE, 'noseSize', 'noseZoom', PORTRAIT),
    makeFrame(MOUTH, 'mouthSize', 'mouthZoom'),
  ]

  function placeFrames() {
    if (!width || !height) return
    const short = Math.min(width, height)
    const margin = 24
    for (const f of frames) {
      const w = short * f.size()
      const h = w / f.aspect
      // Never wider or taller than the page allows
      const fit = Math.min(1, (width - margin * 2) / w, (height - margin * 2) / h)
      f.w = Math.round(w * fit)
      f.h = Math.round(h * fit)
      for (const c of [f.cur, f.exposure, f.shown]) {
        c.width = Math.round(f.w * dpr)
        c.height = Math.round(f.h * dpr)
      }
      f.history = []
      f.historyIndex = 0
      f.fresh = true
    }
    const overlaps = (a, b) =>
      a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin
    // Try many random layouts and keep the first where nothing touches; on a small page, accept overlap
    for (let tries = 0; tries < 500; tries++) {
      for (const f of frames) {
        f.x = Math.round(margin + Math.random() * Math.max(0, width - f.w - margin * 2))
        f.y = Math.round(margin + Math.random() * Math.max(0, height - f.h - margin * 2))
      }
      const clash = frames.some((a, i) => frames.some((b, j) => j > i && overlaps(a, b)))
      if (!clash) break
    }
  }

  // --- camera + face tracking ---

  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true

  let face = null // latest keypoints, or null when no face is visible
  let status = 'Permite el uso de la cámara'

  async function startTracking() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      video.srcObject = stream
      await video.play()
      // The face detector reads the input size from the element's width/height attributes, which
      // are 0 on a bare <video>; without them it sees an empty image and never finds a face
      video.width = video.videoWidth
      video.height = video.videoHeight
    } catch (err) {
      console.error(err)
      status = 'No se pudo usar la cámara. Revisa los permisos y recarga la página.'
      return
    }
    status = 'Cargando el modelo…'
    let faceMesh
    try {
      faceMesh = await ml5.faceMesh({ maxFaces: 1, refineLandmarks: false })
    } catch (err) {
      console.error(err)
      status = 'No se pudo cargar el modelo de la cara. Revisa tu conexión y recarga la página.'
      return
    }
    status = 'Buscando una cara…'
    faceMesh.detectStart(video, (faces) => {
      face = faces.length ? faces[0].keypoints : null
    })
  }
  startTracking()

  // A crop in video pixels: centre, width (height follows from the frame's aspect) and angle
  function measure({ points, corners, length }, zoom, aspect) {
    let cx = 0
    let cy = 0
    for (const i of points) {
      cx += face[i].x
      cy += face[i].y
    }
    cx /= points.length
    cy /= points.length
    const [a, b] = (corners || length).map((i) => face[i])
    const span = Math.hypot(b.x - a.x, b.y - a.y) * zoom
    const [l, r] = EYE_OUTER.map((i) => face[i])
    return {
      cx,
      cy,
      w: length ? span * aspect : span,
      angle: params.followTilt ? Math.atan2(r.y - l.y, r.x - l.x) : 0,
    }
  }

  function updateCrops() {
    if (!face) return
    const k = 1 - params.smoothing
    for (const f of frames) {
      const t = measure(f.feature, f.zoom(), f.aspect)
      const c = f.crop
      if (!c) {
        f.crop = t
        continue
      }
      // Slack: the feature moves freely inside an ellipse shaped like the frame, around the crop's
      // centre. Only the part of the movement that goes past its edge drags the crop along
      const rx = params.slack * c.w
      const ry = rx / f.aspect
      const dx = t.cx - c.cx
      const dy = t.cy - c.cy
      const n = rx > 0 ? Math.hypot(dx / rx, dy / ry) : Infinity
      if (n > 1) {
        const keep = rx > 0 ? 1 / n : 0
        c.cx += (dx - dx * keep) * k
        c.cy += (dy - dy * keep) * k
      }
      c.w += (t.w - c.w) * k
      c.angle += (t.angle - c.angle) * k
    }
  }

  // --- per-frame pipeline ---

  // Draw the live camera crop into f.cur
  function renderCrop(f) {
    const crop = f.crop
    const g = f.cur.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, f.cur.width, f.cur.height)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Mirrored, like looking in a mirror; rotated so the eyes stay level
    g.translate(f.w / 2, f.h / 2)
    g.scale(-f.w / crop.w, f.w / crop.w)
    g.rotate(-crop.angle)
    g.translate(-crop.cx, -crop.cy)
    g.drawImage(video, 0, 0)
  }

  // Keep a small copy of the live crop every CAPTURE_MS, for the echo
  function capture(f, now) {
    if (now - f.lastCapture < CAPTURE_MS) return
    f.lastCapture = now
    let slot = f.history[f.historyIndex]
    if (!slot) {
      slot = { t: 0, c: document.createElement('canvas') }
      slot.c.width = f.w
      slot.c.height = f.h
      f.history[f.historyIndex] = slot
    }
    slot.c.getContext('2d').drawImage(f.cur, 0, 0, f.w, f.h)
    slot.t = now
    f.historyIndex = (f.historyIndex + 1) % HISTORY
  }

  // The newest snapshot taken at or before time t, if there is one close enough
  function snapshotAt(f, t) {
    let best = null
    for (const s of f.history) if (s.t <= t && (!best || s.t > best.t)) best = s
    return best && t - best.t < CAPTURE_MS * 2 ? best : null
  }

  function applyTrail(f, dt) {
    // Decay is per 60th of a second, so the trail is the same length on 60 Hz and 120 Hz screens
    const g = f.exposure.getContext('2d')
    g.globalAlpha = f.fresh ? 1 : 1 - params.trail ** (dt / (1000 / 60))
    g.drawImage(f.cur, 0, 0)
    g.globalAlpha = 1
    f.fresh = false
  }

  // Weighted average of the live crop and copies from i × echoDelay ago (weight echoStrength^i).
  // Drawing them oldest first, each with alpha = its weight / the total so far, gives that average
  function applyEcho(f, now) {
    const layers = []
    for (let i = params.echoes; i >= 1; i--) {
      const s = snapshotAt(f, now - i * params.echoDelay * 1000)
      if (s) layers.push({ c: s.c, w: params.echoStrength ** i })
    }
    layers.push({ c: f.cur, w: 1 })
    const g = f.exposure.getContext('2d')
    let total = 0
    for (const { c, w } of layers) {
      total += w
      g.globalAlpha = w / total
      g.drawImage(c, 0, 0, f.exposure.width, f.exposure.height)
    }
    g.globalAlpha = 1
  }

  // Contrast, brightness, saturation and a 3-colour gradient map, pixel by pixel
  function grade(g, w, h) {
    const { contrast, brightness, saturation, colorMap } = params
    if (contrast === 1 && brightness === 0 && saturation === 1 && colorMap === 0) return

    const tone = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) tone[v] = ((v / 255 - 0.5) * contrast + 0.5 + brightness) * 255

    // Brightness → colour: shadows at 0, mids at 0.5, lights at 1
    const stops = [params.shadows, params.mids, params.lights].map(hexToRgb)
    const ramp = new Uint8ClampedArray(256 * 3)
    for (let v = 0; v < 256; v++) {
      const t = v / 255
      const [a, b, u] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], t * 2 - 1]
      for (let ch = 0; ch < 3; ch++) ramp[v * 3 + ch] = a[ch] + (b[ch] - a[ch]) * u
    }

    const img = g.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      let r = tone[d[i]]
      let gr = tone[d[i + 1]]
      let b = tone[d[i + 2]]
      const luma = (r * 0.299 + gr * 0.587 + b * 0.114) | 0
      r = luma + (r - luma) * saturation
      gr = luma + (gr - luma) * saturation
      b = luma + (b - luma) * saturation
      const m = luma * 3
      d[i] = r + (ramp[m] - r) * colorMap
      d[i + 1] = gr + (ramp[m + 1] - gr) * colorMap
      d[i + 2] = b + (ramp[m + 2] - b) * colorMap
    }
    g.putImageData(img, 0, 0)
  }

  function drawFrame(f, now, dt) {
    if (f.crop && video.videoWidth) {
      renderCrop(f)
      capture(f, now)
      let source = f.cur
      if (params.effect === 'estela') {
        applyTrail(f, dt)
        source = f.exposure
      } else if (params.effect === 'eco') {
        applyEcho(f, now)
        source = f.exposure
      }

      // Step-printing: update what's on screen only `fps` times a second
      if (params.fps >= 60 || now - f.lastStep >= 1000 / params.fps) {
        f.lastStep = now
        const g = f.shown.getContext('2d', { willReadFrequently: true })
        g.drawImage(source, 0, 0)
        if (params.blur > 0) {
          // Blurred copy over a sharp one, so the edges don't fade to transparent
          g.filter = `blur(${params.blur * dpr}px)`
          g.drawImage(source, 0, 0)
          g.filter = 'none'
        }
        grade(g, f.shown.width, f.shown.height)
      }

      ctx.drawImage(f.shown, f.x, f.y, f.w, f.h)
      ctx.save()
      ctx.beginPath()
      ctx.rect(f.x, f.y, f.w, f.h)
      ctx.clip()
      drawGrain(videoTiles, params.videoGrainSize, params.videoGrain, 'overlay')
      ctx.restore()
    }
    // 2px black border, drawn inside the frame so it stays crisp
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2
    ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2)
  }

  let last = performance.now()

  function frame(now) {
    const dt = Math.min(100, now - last)
    last = now
    updateCrops()

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = params.background
    ctx.fillRect(0, 0, width, height)
    drawGrain(bgTiles, params.grainSize, params.grain, 'source-over')

    for (const f of frames) drawFrame(f, now, dt)

    if (!frames[0].crop) {
      ctx.fillStyle = theme.ink
      ctx.font = `13px ${theme.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(status, width / 2, height - 32)
    }

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
