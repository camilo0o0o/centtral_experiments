import p5 from 'p5'
import { createPipeline, fit } from './pipeline.js'
import {
  SOURCE,
  fieldImage,
  drawField,
  drawDots,
  drawOverlays,
  drawLabel,
  cellAt,
  drawCrosshair,
  drawProbe,
  drawTimings,
  stripLayout,
} from './debug.js'
import { drawOutline } from './strokes.js'

// Draw with the brush; on release the strokes become rocks. Strokes are kept as vectors, so the
// rock can be rebuilt at any width. Strokes that touch are one rock; separate ones are separate rocks.
// Each rock is a heightfield inside a silhouette, taken through three stages:
//   generate (rock.js / erode.js) → shade (shade.js) → stipple (stipple.js)
// pipeline.js caches each stage; debug.js can draw any intermediate buffer.
// While a stroke is being drawn nothing is generated: only its outline is drawn over the last frame.

const VIEWS = ['dots', 'dots over tone', 'silhouette', 'height', 'height contours', 'normals', 'lambert', 'cavity AO', 'shadow', 'tone']
const STRIP = ['silhouette', 'height', 'normals', 'lambert', 'cavity AO', 'shadow', 'tone', 'dots']

export default function ({ container, gui, theme }) {
  const bg = theme.bg
  const params = {
    seed: 1,
    newSeed: () => newSeed(),
    undo: () => undo(),
    clear: () => clear(),
    // brush
    brushSize: 28,
    width: 1,
    generator: 'eroded',
    view: 'dots',
    strip: false,
    // shape
    roughness: 0.4,
    cellPx: 2.5,
    // dome
    dome: true,
    domeHeight: 0.55,
    domeRadius: 0.35,
    domeSoft: 0.3,
    // faceted layers
    facets: true,
    extraFacets: 10,
    facetSlope: 0.9,
    noise: true,
    noiseAmp: 0.015,
    noiseScale: 7,
    ridged: false,
    cracks: true,
    crackScale: 4,
    crackWidth: 0.05,
    crackDepth: 0.025,
    crackCoverage: 0.5,
    pits: true,
    pitCount: 150,
    pitSize: 0.05,
    pitDepth: 0.6,
    // eroded layers
    warp: true,
    warpAmp: 0.08,
    warpScale: 2.5,
    warpAmount: 1.5,
    erosion: true,
    droplets: 80000,
    erodeSpeed: 0.3,
    depositSpeed: 0.3,
    inertia: 0.05,
    capacity: 4,
    evaporate: 0.02,
    lifetime: 30,
    brush: 3,
    // light
    azimuth: 225,
    elevation: 35,
    ambient: 0.1,
    exposure: 1.2,
    gamma: 1,
    baseTone: 0.04,
    lambert: true,
    lambertWeight: 1,
    ao: true,
    aoWeight: 1,
    aoRadius: 0.06,
    aoStrength: 4,
    shadow: true,
    shadowWeight: 0.85,
    softness: 0.3,
    // dots
    spacing: 2.4,
    dotSize: 1.8,
    color: '#000000',
    edge: 0.6,
    relax: 3,
    // debug
    overlayOutline: false,
    overlayCuts: false,
    overlayLight: false,
    overlayDroplets: false,
    contours: 16,
    probe: false,
    timings: true,
  }

  // { id, r, pts: [x0, y0, x1, y1, …] } in canvas px; the drawn radius is r · width
  const strokes = []
  let nextId = 1
  const pipeline = createPipeline(params, strokes)
  let requestDraw = () => {} // re-render the frame (runs whatever stages are dirty)
  let requestOverlay = () => {} // redraw only the live layer (brush, current stroke, probe)
  const redraw = () => requestDraw()
  // onChange handler that re-runs `stage` and everything after it
  const rerun = (stage) => () => {
    pipeline.invalidate(stage)
    requestDraw()
  }

  function newSeed() {
    params.seed = Math.floor(Math.random() * 100000)
    seedCtrl.updateDisplay()
    rerun('shape')()
  }
  function undo() {
    if (!strokes.length) return
    strokes.pop()
    rerun('shape')()
  }
  function clear() {
    strokes.length = 0
    rerun('shape')()
  }

  // --- controls ---

  const seedCtrl = gui.add(params, 'seed', 0, 99999, 1).onChange(rerun('shape'))
  gui.add(params, 'newSeed').name('new seed')
  gui.add(params, 'undo').name('undo (ctrl/⌘ z)')
  gui.add(params, 'clear')
  gui.add(params, 'brushSize', 4, 120, 1).name('brush size').onChange(() => requestOverlay())
  gui.add(params, 'width', 0.2, 3).name('stroke width').onChange(rerun('shape'))
  gui.add(params, 'generator', ['faceted', 'eroded']).onChange(() => {
    updateFolders()
    rerun('height')()
  })
  gui.add(params, 'view', VIEWS).onChange(redraw)
  gui.add(params, 'strip').name('pipeline strip').onChange(redraw)

  const fShape = gui.addFolder('Shape')
  fShape.add(params, 'roughness', 0, 1).name('outline roughness').onChange(rerun('shape'))
  fShape.add(params, 'cellPx', 1.5, 6).name('grid px / cell').onChange(rerun('shape'))

  const fDome = gui.addFolder('Dome')
  fDome.add(params, 'dome').name('dome (off = slab)').onChange(rerun('height'))
  fDome.add(params, 'domeHeight', 0.05, 1.5).name('height').onChange(rerun('height'))
  fDome.add(params, 'domeRadius', 0.05, 1.5).name('radius').onChange(rerun('height'))
  fDome.add(params, 'domeSoft', 0, 1).name('softness').onChange(rerun('height'))

  const fFac = gui.addFolder('Faceted')
  const fFacets = fFac.addFolder('Facets')
  fFacets.add(params, 'facets').name('on').onChange(rerun('height'))
  fFacets.add(params, 'extraFacets', 0, 30, 1).name('scars per rock').onChange(rerun('height'))
  fFacets.add(params, 'facetSlope', 0.1, 3).name('slope').onChange(rerun('height'))
  const fNoise = fFac.addFolder('Noise')
  fNoise.add(params, 'noise').name('on').onChange(rerun('height'))
  fNoise.add(params, 'noiseAmp', 0, 0.1).name('amount').onChange(rerun('height'))
  fNoise.add(params, 'noiseScale', 1, 30).name('scale').onChange(rerun('height'))
  fNoise.add(params, 'ridged').onChange(rerun('height'))
  const fCracks = fFac.addFolder('Cracks')
  fCracks.add(params, 'cracks').name('on').onChange(rerun('height'))
  fCracks.add(params, 'crackScale', 1, 15).name('scale').onChange(rerun('height'))
  fCracks.add(params, 'crackWidth', 0.005, 0.3).name('width').onChange(rerun('height'))
  fCracks.add(params, 'crackDepth', 0, 0.1).name('depth').onChange(rerun('height'))
  fCracks.add(params, 'crackCoverage', 0, 1).name('coverage').onChange(rerun('height'))
  const fPits = fFac.addFolder('Pits')
  fPits.add(params, 'pits').name('on').onChange(rerun('height'))
  fPits.add(params, 'pitCount', 0, 1500, 1).name('count').onChange(rerun('height'))
  fPits.add(params, 'pitSize', 0.01, 0.2).name('size').onChange(rerun('height'))
  fPits.add(params, 'pitDepth', 0, 1).name('depth').onChange(rerun('height'))

  const fEro = gui.addFolder('Eroded')
  const fWarp = fEro.addFolder('Warp')
  fWarp.add(params, 'warp').name('on').onChange(rerun('height'))
  fWarp.add(params, 'warpAmp', 0, 0.3).name('amount').onChange(rerun('height'))
  fWarp.add(params, 'warpScale', 0.5, 10).name('scale').onChange(rerun('height'))
  fWarp.add(params, 'warpAmount', 0, 4).name('warp').onChange(rerun('height'))
  const fErosion = fEro.addFolder('Erosion')
  fErosion.add(params, 'erosion').name('on').onChange(rerun('height'))
  fErosion.add(params, 'droplets', 0, 400000, 1000).onChange(rerun('height'))
  fErosion.add(params, 'erodeSpeed', 0, 1).name('erode').onChange(rerun('height'))
  fErosion.add(params, 'depositSpeed', 0, 1).name('deposit').onChange(rerun('height'))
  fErosion.add(params, 'capacity', 0.5, 16).onChange(rerun('height'))
  fErosion.add(params, 'inertia', 0, 0.9).onChange(rerun('height'))
  fErosion.add(params, 'evaporate', 0, 0.2).onChange(rerun('height'))
  fErosion.add(params, 'lifetime', 5, 120, 1).onChange(rerun('height'))
  fErosion.add(params, 'brush', 1, 8, 1).name('brush radius').onChange(rerun('height'))

  const fLight = gui.addFolder('Shading')
  fLight.add(params, 'azimuth', 0, 360, 1).onChange(rerun('shade'))
  fLight.add(params, 'elevation', 5, 90, 1).onChange(rerun('shade'))
  fLight.add(params, 'ambient', 0, 1).onChange(rerun('shade'))
  fLight.add(params, 'exposure', 0.3, 3).onChange(rerun('shade'))
  fLight.add(params, 'gamma', 0.3, 3).onChange(rerun('shade'))
  fLight.add(params, 'baseTone', 0, 0.4).name('base tone').onChange(rerun('shade'))
  fLight.add(params, 'lambert').name('lambert (N·L)').onChange(rerun('shade'))
  fLight.add(params, 'lambertWeight', 0, 1).name('  weight').onChange(rerun('shade'))
  fLight.add(params, 'ao').name('cavity AO').onChange(rerun('shade'))
  fLight.add(params, 'aoWeight', 0, 1).name('  weight').onChange(rerun('shade'))
  fLight.add(params, 'aoRadius', 0.01, 0.3).name('  radius').onChange(rerun('shade'))
  fLight.add(params, 'aoStrength', 0, 15).name('  strength').onChange(rerun('shade'))
  fLight.add(params, 'shadow').name('cast shadow').onChange(rerun('shade'))
  fLight.add(params, 'shadowWeight', 0, 1).name('  weight').onChange(rerun('shade'))
  fLight.add(params, 'softness', 0, 1).name('  softness').onChange(rerun('shade'))

  const fDots = gui.addFolder('Dots')
  fDots.add(params, 'spacing', 1.2, 10).onChange(rerun('candidates'))
  fDots.add(params, 'dotSize', 0.5, 8).name('dot size').onChange(redraw)
  fDots.addColor(params, 'color').onChange(redraw)
  fDots.add(params, 'edge', 0, 1).name('edge dots').onChange(rerun('dots'))
  fDots.add(params, 'relax', 0, 20, 1).name('relax (lloyd)').onChange(rerun('dots'))

  const fDebug = gui.addFolder('Debug')
  fDebug.add(params, 'overlayOutline').name('stroke outlines').onChange(redraw)
  fDebug.add(params, 'overlayCuts').name('facet lines').onChange(redraw)
  fDebug.add(params, 'overlayLight').name('light').onChange(redraw)
  fDebug.add(params, 'overlayDroplets').name('droplet paths').onChange(redraw)
  fDebug.add(params, 'contours', 4, 60, 1).name('contour levels').onChange(redraw)
  fDebug.add(params, 'probe').name('hover probe').onChange(() => requestOverlay())
  fDebug.add(params, 'timings').onChange(redraw)

  function updateFolders() {
    fFac.show(params.generator === 'faceted')
    fEro.show(params.generator === 'eroded')
  }
  updateFolders()
  ;[fShape, fDome, fFac, fEro, fLight, fDots, fDebug].forEach((f) => f.close())

  // Buffer images, rebuilt only when the stage that produces them re-runs
  const images = new Map()
  function image(kind) {
    const key = `${pipeline.version[SOURCE[kind]]}:${kind === 'height contours' ? params.contours : ''}`
    const hit = images.get(kind)
    if (hit?.key === key) return hit.canvas
    const canvas = fieldImage(kind, pipeline.data, params)
    images.set(kind, { key, canvas })
    return canvas
  }

  new p5((p) => {
    let mouse = null // pointer position in canvas px, while over the canvas
    let current = null // the stroke being drawn
    let panels = [] // what was drawn where, so the probe can find the cell under the cursor
    let frame = null // the last full render, redrawn under the live layer
    let frameDirty = true

    const schedule = (() => {
      let pending = false
      return () => {
        if (pending) return
        pending = true
        requestAnimationFrame(() => {
          pending = false
          p.redraw()
        })
      }
    })()
    requestDraw = () => {
      frameDirty = true
      schedule()
    }
    requestOverlay = schedule

    function drawView(ctx, view, tf) {
      const { data } = pipeline
      if (view === 'dots' || view === 'dots over tone') {
        if (view === 'dots over tone') {
          ctx.globalAlpha = 0.35
          drawField(ctx, image('tone'), tf)
          ctx.globalAlpha = 1
        }
        // Dot size is set in px for the main view; smaller panels scale it down with everything else
        drawDots(ctx, data.dots, tf, (params.dotSize / 2) * (tf.s / data.tf.s), params.color)
      } else drawField(ctx, image(view), tf)
    }

    p.setup = () => {
      const cnv = p.createCanvas(container.clientWidth, container.clientHeight)
      p.noLoop()
      cnv.elt.style.touchAction = 'none' // a finger draws instead of scrolling the page
      cnv.elt.style.cursor = 'crosshair'
      // Hiding the controls (h) changes the free area, so re-layout
      new ResizeObserver(() => requestDraw()).observe(gui.domElement)
      const toCanvas = (e) => {
        const rect = cnv.elt.getBoundingClientRect()
        return { x: ((e.clientX - rect.left) / rect.width) * p.width, y: ((e.clientY - rect.top) / rect.height) * p.height }
      }
      cnv.elt.addEventListener('pointerdown', (e) => {
        if (params.strip || (e.pointerType === 'mouse' && e.button !== 0)) return
        cnv.elt.setPointerCapture(e.pointerId)
        mouse = toCanvas(e)
        // Store the radius at width 1, so the stroke comes out the size the brush shows now
        current = { id: nextId++, r: params.brushSize / params.width, pts: [mouse.x, mouse.y] }
        requestOverlay()
      })
      cnv.elt.addEventListener('pointermove', (e) => {
        mouse = toCanvas(e)
        if (current) {
          const pts = current.pts
          const step = Math.max(1.5, params.brushSize * 0.2)
          if (Math.hypot(mouse.x - pts[pts.length - 2], mouse.y - pts[pts.length - 1]) >= step) pts.push(mouse.x, mouse.y)
        }
        requestOverlay()
      })
      const endStroke = () => {
        if (!current) return
        const pts = current.pts
        if (mouse && (mouse.x !== pts[pts.length - 2] || mouse.y !== pts[pts.length - 1])) pts.push(mouse.x, mouse.y)
        strokes.push(current)
        current = null
        rerun('shape')()
      }
      cnv.elt.addEventListener('pointerup', endStroke)
      cnv.elt.addEventListener('pointercancel', endStroke)
      cnv.elt.addEventListener('pointerleave', () => {
        if (current) return // captured: the stroke continues outside the canvas
        mouse = null
        requestOverlay()
      })
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.target.tagName !== 'INPUT') {
          e.preventDefault()
          undo()
        }
      })
    }

    // The controls panel floats over the canvas; keep the strip panels clear of it while it's shown,
    // unless the screen is too narrow to spare the room
    function freeArea() {
      const area = { x: 0, y: 0, w: p.width, h: p.height }
      const g = gui.domElement.getBoundingClientRect()
      const c = p.canvas.getBoundingClientRect()
      const covered = c.right - g.left + 8
      if (g.width > 0 && covered > 0 && covered < p.width * 0.45) area.w -= covered
      return area
    }

    // Everything that depends on the pipeline: the rocks, debug views, overlays and timings
    function render(ctx) {
      pipeline.run({ w: p.width, h: p.height })
      const { data } = pipeline
      p.background(bg)
      panels = []
      if (data.empty) {
        ctx.font = `13px ${theme.font}`
        ctx.fillStyle = theme.muted
        ctx.textAlign = 'center'
        ctx.fillText('dibuja para crear una roca', p.width / 2, p.height / 2)
        ctx.textAlign = 'start'
        return
      }

      if (params.strip) {
        const area = freeArea()
        const label = 18
        const { W, H } = data.shape
        panels = stripLayout(STRIP.length, W, H, area.w, area.h, 16, label).map((r, k) => {
          const tf = fit(W, H, r.x, r.y + label, r.w, r.h - label)
          drawLabel(ctx, `${k + 1} · ${STRIP[k]}`, r.x, r.y, theme)
          drawView(ctx, STRIP[k], tf)
          return tf
        })
      } else {
        drawView(ctx, params.view, data.tf)
        drawOverlays(ctx, data, data.tf, params, theme)
        panels = [data.tf]
      }
      if (params.timings) drawTimings(ctx, pipeline, 12, p.height - 12, theme)
    }

    p.draw = () => {
      const ctx = p.drawingContext
      if (frameDirty || !frame) {
        render(ctx)
        frameDirty = false
        if (!frame || frame.width !== p.canvas.width || frame.height !== p.canvas.height) {
          frame = document.createElement('canvas')
          frame.width = p.canvas.width
          frame.height = p.canvas.height
        }
        const f = frame.getContext('2d')
        f.clearRect(0, 0, frame.width, frame.height)
        f.drawImage(p.canvas, 0, 0)
      } else {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(frame, 0, 0)
        ctx.restore()
      }

      // Live layer: cheap enough for every pointer move
      if (current) drawOutline(ctx, [current], params.width, theme.ink)
      else if (mouse && !params.strip) drawOutline(ctx, [{ r: params.brushSize, pts: [mouse.x, mouse.y] }], 1, theme.muted, 1)

      const { data } = pipeline
      if (params.probe && mouse && !current && !data.empty) {
        const tf = panels.find((t) => cellAt(data.shape, t, mouse.x, mouse.y))
        const cell = tf && cellAt(data.shape, tf, mouse.x, mouse.y)
        if (cell) {
          // Mark the same cell in every panel so the stages can be compared at one spot
          for (const t of panels) drawCrosshair(ctx, data.shape, t, cell, '#e4572e')
          drawProbe(ctx, data, cell, mouse.x, mouse.y, p.width, p.height, theme)
        }
      }
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      requestDraw()
    }
  }, container)
}
