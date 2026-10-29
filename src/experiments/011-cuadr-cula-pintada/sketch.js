// Paint cells on a fine grid. All painted cells form one shape: each cell gets a thin border,
// every cell corner gets a dot, and the outer edge of the shape gets a thick outside stroke.
const CELL = 24 // px per small cell
const MAJOR = 6 // a yellow line every 6 cells (144px)
const HISTORY = 50

export default function ({ container, gui }) {
  const params = {
    brush: 3,
    outline: 5,
    dot: 4,
    line: 2,
    bg: '#CCCDD6',
    grid: '#FFE26F',
    shape: '#F87436',
    undo: () => undo(),
    clear: () => clear(),
  }
  gui.add(params, 'brush', 1, 12, 1).name('brush (cells)').onChange(() => requestDraw())
  gui.add(params, 'outline', 0, 12, 0.5).name('outline width').onChange(() => requestDraw())
  gui.add(params, 'dot', 0, 8, 0.5).name('dot radius').onChange(() => requestDraw())
  gui.add(params, 'line', 0.5, 4, 0.5).name('cell line').onChange(() => requestDraw())
  gui.addColor(params, 'bg').name('background').onChange(() => requestDraw())
  gui.addColor(params, 'grid').onChange(() => requestDraw())
  gui.addColor(params, 'shape').onChange(() => requestDraw())
  gui.add(params, 'undo').name('undo (ctrl/⌘ z)')
  gui.add(params, 'clear')

  const canvas = document.createElement('canvas')
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'crosshair'
  const ctx = canvas.getContext('2d')
  container.append(canvas)

  // Painted cells, keyed "i,j" in grid coordinates so a resize never loses the drawing.
  let cells = new Set()
  const history = []
  const key = (i, j) => `${i},${j}`
  const has = (i, j) => cells.has(key(i, j))

  let width, height
  new ResizeObserver(() => {
    const dpr = Math.min(devicePixelRatio, 2)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }).observe(container)

  // --- Brush ---

  // Cells under a round brush of `params.brush` cells diameter centred near (x, y). Odd sizes centre on a
  // cell, even sizes on a cell corner, so every size is symmetric.
  function footprint(x, y) {
    const d = params.brush
    const r = d / 2
    const gx = x / CELL
    const gy = y / CELL
    const cx = d % 2 ? Math.floor(gx) + 0.5 : Math.round(gx)
    const cy = d % 2 ? Math.floor(gy) + 0.5 : Math.round(gy)
    const out = []
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
        const dx = i + 0.5 - cx
        const dy = j + 0.5 - cy
        if (i >= 0 && j >= 0 && dx * dx + dy * dy <= r * r + 0.25) out.push([i, j])
      }
    }
    return out
  }

  function stamp(x, y, erase) {
    let changed = false
    for (const [i, j] of footprint(x, y)) {
      const k = key(i, j)
      if (erase ? cells.delete(k) : !cells.has(k)) {
        if (!erase) cells.add(k)
        changed = true
      }
    }
    return changed
  }

  let stroke = null // { erase, x, y, changed, before }
  let hover = null // { x, y, erase } for the brush preview

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return
    canvas.setPointerCapture(e.pointerId)
    const erase = e.button === 2 || e.altKey
    stroke = { erase, x: e.offsetX, y: e.offsetY, changed: false, before: new Set(cells) }
    stroke.changed = stamp(e.offsetX, e.offsetY, erase)
    hover = { x: e.offsetX, y: e.offsetY, erase }
    requestDraw()
  })

  canvas.addEventListener('pointermove', (e) => {
    hover = { x: e.offsetX, y: e.offsetY, erase: stroke ? stroke.erase : e.altKey }
    if (stroke) {
      // Stamp along the segment so fast strokes don't leave gaps.
      const dx = e.offsetX - stroke.x
      const dy = e.offsetY - stroke.y
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (CELL / 2)))
      for (let s = 1; s <= steps; s++) {
        if (stamp(stroke.x + (dx * s) / steps, stroke.y + (dy * s) / steps, stroke.erase)) stroke.changed = true
      }
      stroke.x = e.offsetX
      stroke.y = e.offsetY
    }
    requestDraw()
  })

  const endStroke = (e) => {
    if (stroke?.changed) pushHistory(stroke.before)
    stroke = null
    if (e.pointerType !== 'mouse') hover = null
    requestDraw()
  }
  canvas.addEventListener('pointerup', endStroke)
  canvas.addEventListener('pointercancel', endStroke)
  canvas.addEventListener('pointerleave', () => {
    hover = null
    requestDraw()
  })

  // --- Undo / clear ---

  function pushHistory(snapshot) {
    history.push(snapshot)
    if (history.length > HISTORY) history.shift()
  }

  function undo() {
    if (!history.length) return
    cells = history.pop()
    requestDraw()
  }

  function clear() {
    if (!cells.size) return
    pushHistory(cells)
    cells = new Set()
    requestDraw()
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
    }
    if (e.key === 'Alt' && hover) {
      hover.erase = true
      requestDraw()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && hover && !stroke) {
      hover.erase = false
      requestDraw()
    }
  })

  // --- Drawing ---

  let pending = false
  function requestDraw() {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      draw()
    })
  }

  function draw() {
    if (!width) return
    ctx.fillStyle = params.bg
    ctx.fillRect(0, 0, width, height)

    // Big yellow grid.
    const step = CELL * MAJOR
    ctx.strokeStyle = params.grid
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }
    ctx.stroke()

    const list = [...cells].map((k) => k.split(',').map(Number))

    // Thick outline: stroke every boundary edge at twice the width, clipped to the outside of the shape.
    // Square caps fill the outer corners; inside the shape they are clipped away.
    if (params.outline > 0 && list.length) {
      const edges = new Path2D()
      for (const [i, j] of list) {
        const x = i * CELL
        const y = j * CELL
        if (!has(i, j - 1)) edges.moveTo(x, y), edges.lineTo(x + CELL, y)
        if (!has(i + 1, j)) edges.moveTo(x + CELL, y), edges.lineTo(x + CELL, y + CELL)
        if (!has(i, j + 1)) edges.moveTo(x, y + CELL), edges.lineTo(x + CELL, y + CELL)
        if (!has(i - 1, j)) edges.moveTo(x, y), edges.lineTo(x, y + CELL)
      }
      // Canvas rect plus every cell; cells never overlap, so evenodd leaves exactly the outside.
      const outside = new Path2D()
      outside.rect(-CELL, -CELL, width + 2 * CELL, height + 2 * CELL)
      for (const [i, j] of list) outside.rect(i * CELL, j * CELL, CELL, CELL)

      ctx.save()
      ctx.clip(outside, 'evenodd')
      ctx.strokeStyle = params.shape
      ctx.lineWidth = params.outline * 2
      ctx.lineCap = 'square'
      ctx.stroke(edges)
      ctx.restore()
    }

    // Thin cell borders: top and left of every cell, right and bottom only where the neighbour is empty,
    // so shared edges are drawn once.
    ctx.strokeStyle = params.shape
    ctx.lineWidth = params.line
    ctx.lineCap = 'square'
    ctx.beginPath()
    for (const [i, j] of list) {
      const x = i * CELL
      const y = j * CELL
      ctx.moveTo(x, y + CELL)
      ctx.lineTo(x, y)
      ctx.lineTo(x + CELL, y)
      if (!has(i + 1, j)) ctx.moveTo(x + CELL, y), ctx.lineTo(x + CELL, y + CELL)
      if (!has(i, j + 1)) ctx.moveTo(x, y + CELL), ctx.lineTo(x + CELL, y + CELL)
    }
    ctx.stroke()
    ctx.lineCap = 'butt'

    // A dot on every corner of every painted cell.
    if (params.dot > 0) {
      const corners = new Set()
      for (const [i, j] of list) {
        corners.add(key(i, j)).add(key(i + 1, j)).add(key(i, j + 1)).add(key(i + 1, j + 1))
      }
      ctx.fillStyle = params.shape
      ctx.beginPath()
      for (const k of corners) {
        const [i, j] = k.split(',').map(Number)
        ctx.moveTo(i * CELL + params.dot, j * CELL)
        ctx.arc(i * CELL, j * CELL, params.dot, 0, Math.PI * 2)
      }
      ctx.fill()
    }

    // Brush preview: the cells the brush would paint (or erase, dashed).
    if (hover) {
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.strokeStyle = params.shape
      ctx.lineWidth = 1
      if (hover.erase) ctx.setLineDash([3, 3])
      ctx.beginPath()
      for (const [i, j] of footprint(hover.x, hover.y)) ctx.rect(i * CELL + 0.5, j * CELL + 0.5, CELL - 1, CELL - 1)
      ctx.stroke()
      ctx.restore()
    }
  }
}
