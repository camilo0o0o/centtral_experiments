// Procedural sound for the melting letters: plain Web Audio, nothing to download.
//
// The sketch sends two signals every frame:
//   touch: 0..1, fingers moving through ink (speed × ink under the brush, plus a little for moving in the air)
//   melt:  0..1, roughly how much of the word is melted right now; it fades with the same trail as the mask
// Each style turns `touch` into a sound. The optional ring layer plays `melt` fading away, i.e. the letters
// hardening again.
//
// Browsers only start audio after a click or key press, so nothing is built until unlock() is called from
// one (the sound checkbox, or a click on the canvas).

export const STYLES = ['saber', 'wind']
const LAYER_LEVEL = { saber: 0.9, wind: 1 }

export function startSound(params) {
  let audio = null
  let touch = 0, present = 0 // smoothed

  function unlock() {
    if (!params.sound) return
    if (!audio) audio = build(new AudioContext())
    if (audio.ac.state !== 'running') audio.ac.resume()
  }

  function update(dt, s) {
    // Fast attack and a slower release, so a sweep swells and trails off instead of clicking
    const k = s.touch > touch ? 0.03 : 0.18
    touch += (s.touch - touch) * (1 - Math.exp(-dt / k))
    present += ((s.present ? 1 : 0) - present) * (1 - Math.exp(-dt / 0.3))

    if (!audio) return
    const { ac } = audio
    if (!params.sound) {
      if (ac.state === 'running') ac.suspend()
      return
    }
    if (ac.state !== 'running') return

    const now = ac.currentTime
    const set = (param, value, tc = 0.03) => param.setTargetAtTime(value, now, tc)
    const t = touch, t2 = t * t

    set(audio.master.gain, params.volume * 0.8, 0.05)
    set(audio.pan.pan, s.pan * 0.7, 0.1)
    for (const style of STYLES) set(audio[style].gain, params.style === style ? LAYER_LEVEL[style] : 0, 0.1)

    // saber: the hum idles while a hand is in view; touching ink opens the filter, swells it and bends the
    // pitch up (the "doppler" of a swing), with a band of noise on top for the whoosh
    for (const [o, f] of audio.hums) set(o.frequency, f * (1 + 0.3 * t))
    set(audio.humFilter.frequency, 250 + 3500 * t2)
    set(audio.humGain.gain, 0.12 * present + 0.88 * t)
    set(audio.swoosh.frequency, 300 + 2500 * t)
    set(audio.swooshGain.gain, 0.7 * t2)

    // wind: two noise bands that rise and brighten with the touch
    set(audio.windBand.frequency, 200 + 1600 * t)
    set(audio.windLow.frequency, 150 + 600 * t)
    set(audio.windGain.gain, Math.pow(t, 1.5) * 1.6)

    // ring: a tone that slides down and fades with the melt, heard once the fingers stop touching
    const ring = params.ring ? 0.3 * s.melt * (1 - t) ** 2 : 0
    const f = 140 + 500 * s.melt
    set(audio.ringOscs[0].frequency, f, 0.05)
    set(audio.ringOscs[1].frequency, f * 2.003, 0.05)
    set(audio.ringGain.gain, ring, 0.08)
  }

  return { unlock, update }
}

function build(ac) {
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.ratio.value = 4
  const pan = ac.createStereoPanner()
  const master = ac.createGain()
  master.gain.value = 0
  master.connect(pan).connect(comp).connect(ac.destination)

  const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  const noiseSource = () => {
    const src = ac.createBufferSource()
    src.buffer = noise
    src.loop = true
    src.start()
    return src
  }
  const node = (make, props = {}) => {
    const n = make.call(ac)
    for (const [key, value] of Object.entries(props)) {
      if (n[key] instanceof AudioParam) n[key].value = value
      else n[key] = value
    }
    return n
  }
  const filter = (type, frequency, Q = 1) => node(ac.createBiquadFilter, { type, frequency, Q })
  const gain = (value = 0) => node(ac.createGain, { gain: value })
  const layer = () => {
    const g = gain()
    g.connect(master)
    return g
  }

  // saber: two detuned saws and a sub sine through a resonant low-pass and soft distortion
  const saber = layer()
  const humFilter = filter('lowpass', 250, 4)
  const humGain = gain()
  const hums = [[88, 'sawtooth', 0.5], [90.7, 'sawtooth', 0.5], [44, 'sine', 0.8]].map(([f, type, level]) => {
    const o = node(ac.createOscillator, { type, frequency: f })
    o.connect(gain(level)).connect(humFilter)
    o.start()
    return [o, f]
  })
  const drive = node(ac.createWaveShaper, { curve: softClip(2.5), oversample: '2x' })
  humFilter.connect(drive).connect(humGain).connect(saber)
  const swoosh = filter('bandpass', 300, 1.2)
  const swooshGain = gain()
  noiseSource().connect(swoosh).connect(swooshGain).connect(saber)

  // wind
  const wind = layer()
  const windGain = gain()
  const windBand = filter('bandpass', 200, 0.7)
  const windLow = filter('lowpass', 150)
  noiseSource().connect(windBand).connect(windGain)
  noiseSource().connect(windLow).connect(windGain)
  windGain.connect(wind)

  // ring: two sines an octave apart with a slow vibrato, into a short feedback echo
  const ringGain = gain()
  const vibrato = node(ac.createOscillator, { frequency: 5 })
  const vibratoDepth = gain(1.5)
  vibrato.connect(vibratoDepth)
  vibrato.start()
  const ringOscs = [0.6, 0.25].map((level) => {
    const o = node(ac.createOscillator, { frequency: 140 })
    vibratoDepth.connect(o.frequency)
    o.connect(gain(level)).connect(ringGain)
    o.start()
    return o
  })
  const echo = node(ac.createDelay, { delayTime: 0.23 })
  const echoFb = gain(0.35)
  ringGain.connect(master)
  ringGain.connect(echo).connect(echoFb).connect(echo)
  echo.connect(gain(0.5)).connect(master)

  return {
    ac, master, pan,
    saber, hums, humFilter, humGain, swoosh, swooshGain,
    wind, windGain, windBand, windLow,
    ringGain, ringOscs,
  }
}

function softClip(k) {
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}
