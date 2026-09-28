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

// A rock is a heightfield inside a silhouette, taken through three stages:
//   generate (rock.js / erode.js) → shade (shade.js) → stipple (stipple.js)
// pipeline.js caches each stage; debug.js can draw any intermediate buffer.

const VIEWS = ['dots', 'dots over tone', 'silhouette', 'height', 'height contours', 'normals', 'lambert', 'cavity AO', 'shadow', 'tone']
const STRIP = ['silhouette', 'height', 'normals', 'lambert', 'cavity AO', 'shadow', 'tone', 'dots']

export default function ({ container, gui, theme }) {
  const bg = theme.bg
  const params = {
    seed: 1,
    lockSeed: false,
    newRock: () => newRock(),
    generator: 'faceted',
    view: 'dots',
    strip: false,
    // shape
    elongation: 1.3,
    roughness: 0.3,
    resolution: 360,
    // faceted: silhouette
    cuts: 7,
    depth: 0.5,
    // eroded: silhouette
    neighbours: 7,
    jitter: 0.5,
    smoothing: 2,
    // dome
    dome: true,
    domeHeight: 0.55,
    domeRound: 0.8,
    domeSoft: 0.3,
    // faceted layers
    facets: true,
    extraFacets: 6,
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
    pitCount: 30,
    pitSize: 0.05,
    pitDepth: 0.6,
    // eroded layers
    warp: true,
    warpAmp: 0.08,
    warpScale: 2.5,
    warpAmount: 1.5,
    erosion: true,
    droplets: 30000,
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
    ground: true,
    groundStrength: 0.5,
    groundFade: 0.6,
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

  const pipeline = createPipeline(params)
  let requestDraw = () => {}
  const redraw = () => requestDraw()
  // onChange handler that re-runs `stage` and everything after it
  const rerun = (stage) => () => {
    pipeline.invalidate(stage)
    requestDraw()
  }

  function newRock() {
    params.seed = Math.floor(Math.random() * 100000)
    seedCtrl.updateDisplay()
    rerun('shape')()
  }

  // --- controls ---

  const seedCtrl = gui.add(params, 'seed', 0, 99999, 1).onChange(rerun('shape'))
  gui.add(params, 'lockSeed').name('lock seed (click)')
  gui.add(params, 'newRock').name('new rock')
  gui.add(params, 'generator', ['faceted', 'eroded']).onChange(() => {
    updateFolders()
    rerun('shape')()
  })
  gui.add(params, 'view', VIEWS).onChange(redraw)
  gui.add(params, 'strip').name('pipeline strip').onChange(redraw)

  const fShape = gui.addFolder('Shape')
  fShape.add(params, 'elongation', 1, 3).onChange(rerun('shape'))
  fShape.add(params, 'roughness', 0, 1).onChange(rerun('shape'))
  fShape.add(params, 'resolution', 128, 640, 1).name('grid cells').onChange(rerun('shape'))

  const fDome = gui.addFolder('Dome')
  fDome.add(params, 'dome').name('dome (off = slab)').onChange(rerun('height'))
  fDome.add(params, 'domeHeight', 0.05, 1.5).name('height').onChange(rerun('height'))
  fDome.add(params, 'domeRound', 0.05, 1).name('roundness').onChange(rerun('height'))
  fDome.add(params, 'domeSoft', 0, 1).name('softness').onChange(rerun('height'))

  const fFac = gui.addFolder('Faceted')
  fFac.add(params, 'cuts', 1, 24, 1).name('outline cuts').onChange(rerun('shape'))
  fFac.add(params, 'depth', 0, 1).name('cut depth').onChange(rerun('shape'))
  const fFacets = fFac.addFolder('Facets')
  fFacets.add(params, 'facets').name('on').onChange(rerun('height'))
  fFacets.add(params, 'extraFacets', 0, 30, 1).name('extra scars').onChange(rerun('height'))
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
  fPits.add(params, 'pitCount', 0, 300, 1).name('count').onChange(rerun('height'))
  fPits.add(params, 'pitSize', 0.01, 0.2).name('size').onChange(rerun('height'))
  fPits.add(params, 'pitDepth', 0, 1).name('depth').onChange(rerun('height'))

  const fEro = gui.addFolder('Eroded')
  fEro.add(params, 'neighbours', 3, 16, 1).onChange(rerun('shape'))
  fEro.add(params, 'jitter', 0, 1).onChange(rerun('shape'))
  fEro.add(params, 'smoothing', 0, 4, 1).onChange(rerun('shape'))
  const fWarp = fEro.addFolder('Warp')
  fWarp.add(params, 'warp').name('on').onChange(rerun('height'))
  fWarp.add(params, 'warpAmp', 0, 0.3).name('amount').onChange(rerun('height'))
  fWarp.add(params, 'warpScale', 0.5, 10).name('scale').onChange(rerun('height'))
  fWarp.add(params, 'warpAmount', 0, 4).name('warp').onChange(rerun('height'))
  const fErosion = fEro.addFolder('Erosion')
  fErosion.add(params, 'erosion').name('on').onChange(rerun('height'))
  fErosion.add(params, 'droplets', 0, 200000, 1000).onChange(rerun('height'))
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
  fLight.add(params, 'ground').name('ground shadow').onChange(rerun('shade'))
  fLight.add(params, 'groundStrength', 0, 1).name('  strength').onChange(rerun('shade'))
  fLight.add(params, 'groundFade', 0.05, 2).name('  fade').onChange(rerun('shade'))

  const fDots = gui.addFolder('Dots')
  fDots.add(params, 'spacing', 1.2, 10).onChange(rerun('candidates'))
  fDots.add(params, 'dotSize', 0.5, 8).name('dot size').onChange(redraw)
  fDots.addColor(params, 'color').onChange(redraw)
  fDots.add(params, 'edge', 0, 1).name('edge dots').onChange(rerun('dots'))
  fDots.add(params, 'relax', 0, 20, 1).name('relax (lloyd)').onChange(rerun('dots'))

  const fDebug = gui.addFolder('Debug')
  fDebug.add(params, 'overlayOutline').name('outline').onChange(redraw)
  fDebug.add(params, 'overlayCuts').name('facet lines').onChange(redraw)
  fDebug.add(params, 'overlayLight').name('light').onChange(redraw)
  fDebug.add(params, 'overlayDroplets').name('droplet paths').onChange(redraw)
  fDebug.add(params, 'contours', 4, 60, 1).name('contour levels').onChange(redraw)
  fDebug.add(params, 'probe').name('hover probe').onChange(redraw)
  fDebug.add(params, 'timings').onChange(redraw)

  function updateFolders() {
    fFac.show(params.generator === 'faceted')
    fEro.show(params.generator === 'eroded')
  }
  updateFolders()
  ;[fShape, fDome, fFacets, fNoise, fCracks, fPits, fWarp, fErosion, fDebug].forEach((f) => f.close())

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
    let mouse = null
    let panels = [] // what was drawn where, so the probe can find the cell under the cursor

    requestDraw = (() => {
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
      // Hiding the controls (h) changes the free area, so re-layout
      new ResizeObserver(() => requestDraw()).observe(gui.domElement)
      const toCanvas = (e) => {
        const rect = cnv.elt.getBoundingClientRect()
        return { x: ((e.clientX - rect.left) / rect.width) * p.width, y: ((e.clientY - rect.top) / rect.height) * p.height }
      }
      cnv.elt.addEventListener('pointerdown', () => {
        if (!params.lockSeed) newRock()
      })
      cnv.elt.addEventListener('pointermove', (e) => {
        mouse = toCanvas(e)
        if (params.probe) requestDraw()
      })
      cnv.elt.addEventListener('pointerleave', () => {
        mouse = null
        if (params.probe) requestDraw()
      })
    }

    // The controls panel floats over the canvas; keep the views clear of it while it's shown,
    // unless the screen is too narrow to spare the room
    function freeArea() {
      const area = { x: 0, y: 0, w: p.width, h: p.height }
      const g = gui.domElement.getBoundingClientRect()
      const c = p.canvas.getBoundingClientRect()
      const covered = c.right - g.left + 8
      if (g.width > 0 && covered > 0 && covered < p.width * 0.45) area.w -= covered
      return area
    }

    p.draw = () => {
      const area = freeArea()
      pipeline.run(area)
      const { data } = pipeline
      const ctx = p.drawingContext
      p.background(bg)

      if (params.strip) {
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

      if (params.probe && mouse) {
        const tf = panels.find((t) => cellAt(data.shape, t, mouse.x, mouse.y))
        const cell = tf && cellAt(data.shape, tf, mouse.x, mouse.y)
        if (cell) {
          // Mark the same cell in every panel so the stages can be compared at one spot
          for (const t of panels) drawCrosshair(ctx, data.shape, t, cell, '#e4572e')
          drawProbe(ctx, data, cell, mouse.x, mouse.y, p.width, p.height, theme)
        }
      }
      if (params.timings) drawTimings(ctx, pipeline, 12, p.height - 12, theme)
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      requestDraw()
    }
  }, container)
}
