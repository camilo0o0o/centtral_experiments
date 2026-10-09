// A word drawn white-on-black into an offscreen canvas, then three GPU passes every frame:
//   1. mask: the cursor paints into a low-res field that fades back to 0 (how much to blur, per pixel)
//   2. blur H: horizontal gaussian of the text, sigma = mask × blur radius
//   3. blur V + threshold: vertical gaussian, then a smoothstep around the threshold level
// Blurring and re-thresholding is what makes the letters melt: thin strokes fall under the level and
// vanish, nearby shapes swell into each other.

const FONTS = {
  'plex mono': null, // theme.font, read when drawing
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
}
const VIEWS = ['result', 'blur', 'mask']
const MASK_SCALE = 4 // mask texels are this many device px
const TAPS = 32 // blur samples on each side

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const MASK_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D prev;
uniform vec2 a, b;      // cursor segment this frame, in uv
uniform vec2 res;       // canvas size in css px
uniform float radius;   // brush radius, css px
uniform float decay;    // multiplier this frame
uniform float hovering; // 1 while the cursor is over the canvas
void main() {
  float v = texture(prev, uv).r * decay;
  vec2 p = uv * res, pa = p - a * res, ba = (b - a) * res;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float brush = exp(-2.5 * d * d / (radius * radius)) * hovering;
  o = vec4(max(v, brush), 0.0, 0.0, 1.0);
}`

const BLUR = `
uniform sampler2D src, mask;
uniform vec2 dir;       // one device px along the blur axis, in uv
uniform float maxBlur;  // sigma at full mask, device px
float blur(vec2 uv) {
  float sigma = texture(mask, uv).r * maxBlur;
  if (sigma < 0.3) return texture(src, uv).r;
  float stepPx = max(sigma * 3.0 / float(${TAPS}), 1.0);
  // Read from the mip level matching the sample spacing: without it, samples sliding across sharp
  // edges as sigma changes leave ripples in the blur, which the threshold turns into streaks.
  float lod = log2(stepPx);
  float sum = 0.0, wsum = 0.0;
  for (int i = -${TAPS}; i <= ${TAPS}; i++) {
    float x = float(i) * stepPx;
    float w = exp(-x * x / (2.0 * sigma * sigma));
    sum += textureLod(src, uv + dir * x, lod).r * w;
    wsum += w;
  }
  return sum / wsum;
}`

const BLUR_H_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
${BLUR}
void main() { o = vec4(blur(uv), 0.0, 0.0, 1.0); }`

const FINAL_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
${BLUR}
uniform float level, hardness;
uniform vec3 bg, ink;
uniform int view;
void main() {
  float v = blur(uv);
  float c;
  if (view == 1) c = v;
  else if (view == 2) c = texture(mask, uv).r;
  else {
    // hardness 0 leaves the plain blur, 1 a hard edge (kept ~1px wide so it stays antialiased)
    float w = max(0.5 * pow(1.0 - hardness, 2.0), fwidth(v) * 0.75);
    c = smoothstep(level - w, level + w, v);
  }
  o = vec4(mix(bg, ink, c), 1.0);
}`

export default function ({ container, gui, theme }) {
  const params = {
    text: 'derretir',
    font: 'plex mono',
    weight: 700,
    size: 0.9,
    blurRadius: 50,
    brushSize: 160,
    trail: 1.5,
    threshold: 0.5,
    hardness: 0.97,
    color: '#000000',
    bg: theme.bg,
    view: 'result',
    clear: () => clearMask(),
  }

  // --- controls ---

  const fText = gui.addFolder('text')
  fText.add(params, 'text').onChange(() => drawText())
  fText.add(params, 'font', Object.keys(FONTS)).onChange(() => drawText())
  fText.add(params, 'weight', [400, 500, 700]).onChange(() => drawText())
  fText.add(params, 'size', 0.2, 1, 0.01).onChange(() => drawText())

  const fBlur = gui.addFolder('blur')
  fBlur.add(params, 'blurRadius', 0, 120, 1).name('blur radius')
  fBlur.add(params, 'brushSize', 10, 400, 1).name('brush size')
  fBlur.add(params, 'trail', 0, 6, 0.05).name('trail (s)')
  fBlur.add(params, 'clear')

  const fThresh = gui.addFolder('threshold')
  fThresh.add(params, 'threshold', 0.05, 0.95, 0.01).name('level')
  fThresh.add(params, 'hardness', 0, 1, 0.01)

  const fLook = gui.addFolder('look')
  fLook.addColor(params, 'color')
  fLook.addColor(params, 'bg')
  fLook.add(params, 'view', VIEWS)

  // --- gl setup ---

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.touchAction = 'none'
  container.append(canvas)
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })
  if (!gl) {
    container.textContent = 'This experiment needs WebGL2.'
    return
  }
  // Half-float targets keep the blur and the fading mask smooth; RGBA8 is the fallback.
  const halfFloat = !!gl.getExtension('EXT_color_buffer_float')

  const progs = {
    mask: program(MASK_FRAG),
    blurH: program(BLUR_H_FRAG),
    final: program(FINAL_FRAG),
  }

  const textCanvas = document.createElement('canvas')
  const tctx = textCanvas.getContext('2d')
  const textTex = texture(true)

  const requested = new Set() // fonts asked to load
  let width = 0, height = 0, dpr = 1
  let maskA, maskB, blurTarget

  new ResizeObserver(() => {
    dpr = Math.min(devicePixelRatio, 2)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const mw = Math.max(1, Math.ceil(canvas.width / MASK_SCALE))
    const mh = Math.max(1, Math.ceil(canvas.height / MASK_SCALE))
    for (const t of [maskA, maskB, blurTarget]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    maskA = target(mw, mh)
    maskB = target(mw, mh)
    blurTarget = target(canvas.width, canvas.height, true)
    clearMask()
    drawText()
  }).observe(container)

  // The page's font loads async; redraw once it's in so the first frame isn't a fallback font.
  document.fonts.ready.then(() => drawText())

  // --- cursor ---

  let cursor = null // current pointer, in uv
  let last = null // pointer at the previous frame
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    cursor = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]
  })
  canvas.addEventListener('pointerleave', () => { cursor = null; last = null })

  // --- frame ---

  let prevT = performance.now()
  function frame(t) {
    if (!maskA) return requestAnimationFrame(frame) // first resize hasn't happened yet
    const dt = Math.min((t - prevT) / 1000, 0.1)
    prevT = t
    const bg = rgb(params.bg)
    const ink = rgb(params.color)

    // 1. mask
    const a = last ?? cursor ?? [0, 0]
    const b = cursor ?? a
    use(progs.mask, maskB)
    bindTex(0, maskA.tex)
    gl.uniform1i(progs.mask.u.prev, 0)
    gl.uniform2f(progs.mask.u.a, a[0], a[1])
    gl.uniform2f(progs.mask.u.b, b[0], b[1])
    gl.uniform2f(progs.mask.u.res, width, height)
    gl.uniform1f(progs.mask.u.radius, params.brushSize / 2)
    gl.uniform1f(progs.mask.u.decay, params.trail > 0 ? Math.exp(-dt * 3 / params.trail) : 0)
    gl.uniform1f(progs.mask.u.hovering, cursor ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    ;[maskA, maskB] = [maskB, maskA]
    last = cursor

    // 2. horizontal blur
    use(progs.blurH, blurTarget)
    blurUniforms(progs.blurH, textTex, [1 / canvas.width, 0])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D, blurTarget.tex)
    gl.generateMipmap(gl.TEXTURE_2D)

    // 3. vertical blur + threshold, to screen
    use(progs.final, null)
    blurUniforms(progs.final, blurTarget.tex, [0, 1 / canvas.height])
    gl.uniform1f(progs.final.u.level, params.threshold)
    gl.uniform1f(progs.final.u.hardness, params.hardness)
    gl.uniform3f(progs.final.u.bg, ...bg)
    gl.uniform3f(progs.final.u.ink, ...ink)
    gl.uniform1i(progs.final.u.view, VIEWS.indexOf(params.view))
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  function blurUniforms(p, src, dir) {
    bindTex(0, src)
    bindTex(1, maskA.tex)
    gl.uniform1i(p.u.src, 0)
    gl.uniform1i(p.u.mask, 1)
    gl.uniform2f(p.u.dir, dir[0], dir[1])
    gl.uniform1f(p.u.maxBlur, params.blurRadius * dpr)
  }

  // --- text ---

  function drawText() {
    if (!width) return
    const W = canvas.width, H = canvas.height
    textCanvas.width = W
    textCanvas.height = H
    tctx.fillStyle = '#000'
    tctx.fillRect(0, 0, W, H)

    const text = params.text || ' '
    const family = FONTS[params.font] ?? theme.font
    const fontAt = (px) => `${params.weight} ${px}px ${family}`

    // A weight the page hasn't used yet isn't loaded; ask for it once and redraw when it arrives.
    const probe = fontAt(100)
    if (!document.fonts.check(probe) && !requested.has(probe)) {
      requested.add(probe)
      document.fonts.load(probe).then(() => drawText())
    }

    // Fit the word to the canvas at 100px, then scale.
    tctx.font = fontAt(100)
    let m = tctx.measureText(text)
    const tw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
    const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    const fit = Math.min((W * 0.9) / Math.max(tw, 1), (H * 0.8) / Math.max(th, 1))
    tctx.font = fontAt(100 * fit * params.size)
    m = tctx.measureText(text)

    // Center on the ink, not the em box.
    const x = W / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
    const y = H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
    tctx.fillStyle = '#fff'
    tctx.fillText(text, x, y)

    gl.bindTexture(gl.TEXTURE_2D, textTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  function clearMask() {
    for (const t of [maskA, maskB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // --- gl helpers ---

  function program(frag) {
    const p = gl.createProgram()
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]]) {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
      gl.attachShader(p, s)
    }
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    const u = {}
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name
      u[name] = gl.getUniformLocation(p, name)
    }
    return { p, u }
  }

  function texture(mipmaps = false) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  function target(w, h, mipmaps = false) {
    const tex = texture(mipmaps)
    if (halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo, w, h }
  }

  function use(prog, tgt) {
    gl.useProgram(prog.p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fbo : null)
    gl.viewport(0, 0, tgt ? tgt.w : canvas.width, tgt ? tgt.h : canvas.height)
  }

  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }
}

// Any CSS color → [r, g, b] in 0..1, cached since it's read every frame
const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
const rgbCache = new Map()
function rgb(color) {
  if (!rgbCache.has(color)) rgbCache.set(color, parse(color))
  return rgbCache.get(color)
}
function parse(color) {
  swatch.fillStyle = '#000'
  swatch.fillStyle = color
  swatch.fillRect(0, 0, 1, 1)
  const d = swatch.getImageData(0, 0, 1, 1).data
  return [d[0] / 255, d[1] / 255, d[2] / 255]
}
