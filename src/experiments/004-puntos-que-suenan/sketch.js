// A dot grid that swells under the cursor and slowly relaxes when it leaves.
// Every dot the cursor touches plays a short synth note, pitched by its place in the grid.

// Notes come from a minor pentatonic scale over three octaves, rising from left to right.
const SCALE = [0, 3, 5, 7, 10]
const OCTAVES = 3
const ROOT_NOTE = 48 // MIDI C3
// How close the cursor must pass to a dot to play it, as a fraction of the grid spacing
const TRIGGER_RADIUS = 0.6

// Each preset is a complete sound. The panel only exposes volume, pitch and length on top of it.
const PRESETS = {
  bell: { wave: 'sine', attack: 0.002, decay: 1.6, cutoff: 8000, resonance: 0.5, filterEnv: 0, detune: 3, echoMix: 0.15, echoTime: 0.18, echoFeedback: 0.35, reverb: 0.5 },
  pluck: { wave: 'sawtooth', attack: 0.003, decay: 0.35, cutoff: 900, resonance: 4, filterEnv: 3, detune: 8, echoMix: 0.2, echoTime: 0.18, echoFeedback: 0.35, reverb: 0.25 },
  blip: { wave: 'square', attack: 0.001, decay: 0.08, cutoff: 3000, resonance: 1, filterEnv: 1, detune: 0, echoMix: 0.3, echoTime: 0.12, echoFeedback: 0.4, reverb: 0.1 },
  glass: { wave: 'triangle', attack: 0.01, decay: 0.9, cutoff: 4000, resonance: 8, filterEnv: 1.5, detune: 12, echoMix: 0.35, echoTime: 0.24, echoFeedback: 0.4, reverb: 0.45 },
  pad: { wave: 'sawtooth', attack: 0.25, decay: 1.8, cutoff: 600, resonance: 2, filterEnv: 1, detune: 18, echoMix: 0.25, echoTime: 0.3, echoFeedback: 0.3, reverb: 0.7 },
}

export default function ({ container, gui, theme }) {
  const params = {
    // look
    bg: '#C2C0B1',
    dotColor: '#E8E8E8',
    textColor: '#E8E8E8',
    spacing: 16,
    dotSize: 1.7,
    // interaction
    hitArea: 70,
    growSpeed: 26,
    decaySpeed: 0.37,
    // text
    topWords: 'source essence spark seed heart',
    bottomWords: 'pulse origin core',
    fontSize: 36,
    weight: 400,
    lineHeight: 0.95,
    textPadding: 8,
    // sound
    sound: true,
    preset: 'bell',
    volume: 0.5,
    pitch: 0, // octaves up or down
    length: 1, // multiplies the preset's note length
    test: () => testArpeggio(),
    resetDots: () => dots.g.fill(0),
  }

  const fLook = gui.addFolder('Aspecto')
  fLook.addColor(params, 'bg').name('background')
  fLook.addColor(params, 'dotColor').name('dot color')
  fLook.addColor(params, 'textColor').name('text color')
  fLook.add(params, 'spacing', 10, 60, 1).onChange(() => layout())
  fLook.add(params, 'dotSize', 0.5, 10).name('dot size')

  const fMove = gui.addFolder('Interacción')
  fMove.add(params, 'hitArea', 5, 250).name('hit area (px)')
  fMove.add(params, 'growSpeed', 0, 80).name('grow speed (px/s)')
  fMove.add(params, 'decaySpeed', 0.05, 5).name('decay speed')
  fMove.add(params, 'resetDots').name('reset dots')

  const fText = gui.addFolder('Texto')
  fText.add(params, 'topWords').name('top left').onFinishChange(() => layout())
  fText.add(params, 'bottomWords').name('bottom right').onFinishChange(() => layout())
  fText.add(params, 'fontSize', 12, 200, 1).name('font size').onChange(() => layout())
  fText.add(params, 'weight', 100, 900, 100).onFinishChange(() => loadFont())
  fText.add(params, 'lineHeight', 0.6, 2).name('line height').onChange(() => layout())
  fText.add(params, 'textPadding', -10, 40, 1).name('cutout padding').onChange(() => layout())

  const fSound = gui.addFolder('Sonido')
  fSound.add(params, 'sound').name('on')
  fSound.add(params, 'preset', Object.keys(PRESETS))
  fSound.add(params, 'volume', 0, 1)
  fSound.add(params, 'pitch', -2, 2, 1).name('pitch (octaves)')
  fSound.add(params, 'length', 0.2, 3).name('note length')
  fSound.add(params, 'test').name('play test')
  // Any interaction with the sound panel is a user gesture, so it can start the audio.
  fSound.onChange(() => unlockAudio())

  const canvas = document.createElement('canvas')
  canvas.style.touchAction = 'none'
  const ctx = canvas.getContext('2d')
  container.append(canvas)

  let width = 0
  let height = 0

  // --- grid ---

  // Dots live in flat arrays: position, extra growth over the base size, and per-dot flags.
  let dots = { n: 0, x: new Float32Array(0), y: new Float32Array(0), g: new Float32Array(0) }
  let cols = 0
  let rows = 0
  let words = [] // { text, x, y } positioned for drawing

  function buildGrid() {
    const s = params.spacing
    cols = Math.max(1, Math.floor((width - 2 * s) / s) + 1)
    rows = Math.max(1, Math.floor((height - 2 * s) / s) + 1)
    const ox = (width - (cols - 1) * s) / 2
    const oy = (height - (rows - 1) * s) / 2
    const n = cols * rows
    dots = {
      n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      g: new Float32Array(n),
      hidden: new Uint8Array(n),
      touching: new Uint8Array(n),
      degree: new Uint16Array(n),
      ox,
      oy,
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        dots.x[k] = ox + i * s
        dots.y[k] = oy + j * s
      }
    }
    assignDegrees()
  }

  // Lay the words out against the grid's corners and hide the dots underneath them.
  function placeWords() {
    words = []
    if (!fontFamily || !dots.n) return
    ctx.font = fontString()
    const s = params.spacing
    const r = params.dotSize
    const left = dots.ox - r
    const top = dots.oy - r
    const right = dots.ox + (cols - 1) * s + r
    const bottom = dots.oy + (rows - 1) * s + r
    const step = params.fontSize * params.lineHeight
    const ascent = ctx.measureText('hdklt').actualBoundingBoxAscent

    const topList = params.topWords.split(/\s+/).filter(Boolean)
    topList.forEach((text, i) => {
      const m = ctx.measureText(text)
      words.push({ text, m, x: left + m.actualBoundingBoxLeft, y: top + ascent + i * step })
    })

    const bottomList = params.bottomWords.split(/\s+/).filter(Boolean)
    const last = bottomList.length ? ctx.measureText(bottomList.at(-1)) : null
    const lastBaseline = last ? bottom - last.actualBoundingBoxDescent : 0
    bottomList.forEach((text, i) => {
      const m = ctx.measureText(text)
      const y = lastBaseline - (bottomList.length - 1 - i) * step
      words.push({ text, m, x: right - m.actualBoundingBoxRight, y })
    })

    dots.hidden.fill(0)
    const pad = params.textPadding
    for (const w of words) {
      const x0 = w.x - w.m.actualBoundingBoxLeft - pad
      const x1 = w.x + w.m.actualBoundingBoxRight + pad
      const y0 = w.y - w.m.actualBoundingBoxAscent - pad
      const y1 = w.y + w.m.actualBoundingBoxDescent + pad
      for (let k = 0; k < dots.n; k++) {
        const x = dots.x[k]
        const y = dots.y[k]
        if (x > x0 && x < x1 && y > y0 && y < y1) dots.hidden[k] = 1
      }
    }
  }

  function layout() {
    if (!width || !height) return
    buildGrid()
    placeWords()
  }

  // Each dot gets a fixed scale degree from its column: low on the left, high on the right.
  function assignDegrees() {
    const count = OCTAVES * SCALE.length + 1
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1)
        dots.degree[j * cols + i] = Math.min(count - 1, Math.floor(u * count))
      }
    }
  }

  function degreeToFreq(degree) {
    const octave = Math.floor(degree / SCALE.length) + params.pitch
    const midi = ROOT_NOTE + octave * 12 + SCALE[degree % SCALE.length]
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  // --- font ---

  // Bitcount Single comes straight from Google Fonts. Its default pixels are round dots, like the grid.
  // Canvas text can't set variable-font axes, so each weight is fetched as its own instance.
  let fontFamily = null
  let fontRequest = 0

  async function loadFont() {
    const request = ++fontRequest
    const weight = params.weight
    const family = `Bitcount Single ${weight}`
    try {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=Bitcount+Single:wght@${weight}&display=swap`).then((r) => r.text())
      const faces = [...css.matchAll(/src:\s*url\(([^)]+)\)[^;]*;\s*unicode-range:\s*([^;]+);/g)].map(
        ([, url, unicodeRange]) => new FontFace(family, `url(${url})`, { unicodeRange }),
      )
      if (!faces.length) throw new Error('no font faces in Google Fonts response')
      faces.forEach((f) => document.fonts.add(f))
      await Promise.all(faces.map((f) => f.load()))
      if (request !== fontRequest) return
      fontFamily = `"${family}"`
    } catch (err) {
      console.warn('Bitcount Single failed to load, using the site font', err)
      if (request !== fontRequest) return
      fontFamily = theme.font
    }
    placeWords()
  }

  function fontString() {
    return `${params.fontSize}px ${fontFamily}`
  }

  // --- pointer ---

  let mouse = null // { x, y } while the pointer is over the canvas
  let lastMouse = null

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  canvas.addEventListener('pointermove', (e) => (mouse = pointerPos(e)))
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio()
    mouse = pointerPos(e)
  })
  canvas.addEventListener('pointerleave', () => (mouse = null))
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') mouse = null
  })

  // --- audio ---

  let audio = null

  function unlockAudio() {
    if (!audio) audio = createAudio()
    if (audio.ac.state !== 'running') audio.ac.resume()
  }

  function createAudio() {
    const ac = new AudioContext()
    const bus = ac.createGain()
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    comp.connect(ac.destination)
    bus.connect(comp)

    const echo = ac.createDelay(1.5)
    const echoFb = ac.createGain()
    const echoWet = ac.createGain()
    bus.connect(echo)
    echo.connect(echoFb)
    echoFb.connect(echo)
    echo.connect(echoWet)
    echoWet.connect(comp)

    // Reverb impulse: stereo noise with an exponential tail
    const verb = ac.createConvolver()
    const len = Math.floor(ac.sampleRate * 2.8)
    const ir = ac.createBuffer(2, len, ac.sampleRate)
    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c)
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    }
    verb.buffer = ir
    const verbWet = ac.createGain()
    bus.connect(verb)
    verb.connect(verbWet)
    verbWet.connect(comp)

    return { ac, bus, echo, echoFb, echoWet, verbWet, voices: 0 }
  }

  const MAX_VOICES = 32

  function playNote(freq, delay = 0) {
    if (!params.sound || !audio || audio.ac.state !== 'running' || audio.voices >= MAX_VOICES) return
    const { ac } = audio
    const p = PRESETS[params.preset]
    const decay = p.decay * params.length
    const now = ac.currentTime
    const t0 = now + 0.005 + delay

    // Mixer settings are read per note so slider changes are heard right away.
    audio.bus.gain.setTargetAtTime(params.volume * 0.35, now, 0.02)
    audio.echo.delayTime.setTargetAtTime(p.echoTime, now, 0.05)
    audio.echoFb.gain.setTargetAtTime(p.echoFeedback, now, 0.02)
    audio.echoWet.gain.setTargetAtTime(p.echoMix, now, 0.02)
    audio.verbWet.gain.setTargetAtTime(p.reverb, now, 0.02)

    const end = t0 + p.attack + decay
    const amp = ac.createGain()
    amp.gain.setValueAtTime(0.0001, t0)
    amp.gain.exponentialRampToValueAtTime(1, t0 + p.attack)
    amp.gain.exponentialRampToValueAtTime(0.0001, end)
    amp.connect(audio.bus)

    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = p.resonance
    const peak = Math.min(18000, p.cutoff * Math.pow(2, p.filterEnv))
    filter.frequency.setValueAtTime(peak, t0)
    filter.frequency.setTargetAtTime(p.cutoff, t0 + p.attack, Math.max(0.01, decay / 4))
    filter.connect(amp)

    // Two oscillators, detuned apart, for a little width and movement
    audio.voices++
    const oscs = [-1, 1].map((side) => {
      const osc = ac.createOscillator()
      osc.type = p.wave
      osc.frequency.value = freq
      osc.detune.value = (side * p.detune) / 2
      const g = ac.createGain()
      g.gain.value = 0.5
      osc.connect(g)
      g.connect(filter)
      osc.start(t0)
      osc.stop(end + 0.05)
      return osc
    })
    oscs[0].onended = () => {
      audio.voices--
      amp.disconnect()
    }
  }

  function testArpeggio() {
    unlockAudio()
    const steps = [0, 2, 4, SCALE.length, 4, 2]
    const run = () => steps.forEach((d, i) => playNote(degreeToFreq(d), i * 0.12))
    if (audio.ac.state === 'running') run()
    else audio.ac.resume().then(run)
  }

  // --- frame ---

  // Distance from point (px, py) to segment a→b, and how far along the segment the closest point is (0..1).
  function segmentDistance(px, py, a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
    return { d: Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)), t }
  }

  let lastTime = performance.now()

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000)
    lastTime = now

    const R = params.hitArea
    const decay = Math.exp(-params.decaySpeed * dt)
    const trigger = TRIGGER_RADIUS * params.spacing
    const from = lastMouse ?? mouse

    for (let k = 0; k < dots.n; k++) {
      if (dots.hidden[k]) continue
      const x = dots.x[k]
      const y = dots.y[k]

      // Growth: soft falloff inside the hit area, exponential decay back to the base size outside it.
      const d = mouse ? Math.hypot(x - mouse.x, y - mouse.y) : Infinity
      if (d < R) {
        const t = 1 - d / R
        dots.g[k] += params.growSpeed * t * t * (3 - 2 * t) * dt
      } else {
        dots.g[k] *= decay
      }

      // Sound: a note when the cursor path first comes within the trigger radius of a dot.
      // Checking the whole path since last frame catches dots crossed by fast sweeps.
      if (mouse) {
        const hit = segmentDistance(x, y, from, mouse)
        const inside = hit.d < trigger
        if (inside && !dots.touching[k]) playNote(degreeToFreq(dots.degree[k]), hit.t * dt)
        dots.touching[k] = inside ? 1 : 0
      } else {
        dots.touching[k] = 0
      }
    }
    lastMouse = mouse

    ctx.fillStyle = params.bg
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = params.dotColor
    ctx.beginPath()
    for (let k = 0; k < dots.n; k++) {
      if (dots.hidden[k]) continue
      const r = params.dotSize + dots.g[k]
      ctx.moveTo(dots.x[k] + r, dots.y[k])
      ctx.arc(dots.x[k], dots.y[k], r, 0, Math.PI * 2)
    }
    ctx.fill()

    if (fontFamily) {
      ctx.font = fontString()
      ctx.fillStyle = params.textColor
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      for (const w of words) ctx.fillText(w.text, w.x, w.y)
    }

    requestAnimationFrame(frame)
  }

  new ResizeObserver(() => {
    const dpr = Math.min(devicePixelRatio, 2)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    layout()
  }).observe(container)

  loadFont()
  requestAnimationFrame(frame)
}
