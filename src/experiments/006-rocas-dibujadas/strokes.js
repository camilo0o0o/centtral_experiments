// Brush strokes kept as vectors: { id, r, pts: [x0, y0, x1, y1, …] } in canvas px. The drawn
// radius is r · width, so the width can change after drawing. Strokes whose capsules touch belong
// to the same rock; strokes that don't touch become separate rocks.

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2

// Distance from point p to segment ab
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.sqrt(dist2(px, py, ax + dx * t, ay + dy * t))
}

const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

// Distance between segments ab and cd: 0 if they cross, otherwise the closest endpoint-to-segment
export function segDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay)
  const d2 = cross(cx, cy, dx, dy, bx, by)
  const d3 = cross(ax, ay, bx, by, cx, cy)
  const d4 = cross(ax, ay, bx, by, dx, dy)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by),
  )
}

// Bounding box of a stroke's centre line, grown by its drawn radius
export function strokeBox(s, width) {
  const r = s.r * width
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < s.pts.length; k += 2) {
    x0 = Math.min(x0, s.pts[k])
    y0 = Math.min(y0, s.pts[k + 1])
    x1 = Math.max(x1, s.pts[k])
    y1 = Math.max(y1, s.pts[k + 1])
  }
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r }
}

// A one-point stroke is a segment of zero length, so the same loop handles dabs and lines
function segments(s) {
  const p = s.pts
  if (p.length === 2) return [[p[0], p[1], p[0], p[1]]]
  const out = []
  for (let k = 0; k + 3 < p.length; k += 2) out.push([p[k], p[k + 1], p[k + 2], p[k + 3]])
  return out
}

function touching(a, b, width) {
  const reach = (a.r + b.r) * width
  const sb = segments(b)
  for (const [ax, ay, bx, by] of segments(a)) {
    for (const [cx, cy, dx, dy] of sb) if (segDist(ax, ay, bx, by, cx, cy, dx, dy) <= reach) return true
  }
  return false
}

// Union-find over strokes. Each group's id is its oldest stroke's id, so a rock keeps its seed
// when newer strokes join it.
export function groupStrokes(strokes, width) {
  const n = strokes.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const boxes = strokes.map((s) => strokeBox(s, width))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue
      if (find(i) !== find(j) && touching(strokes[i], strokes[j], width)) parent[find(i)] = find(j)
    }
  }
  const byRoot = new Map()
  strokes.forEach((s, i) => {
    const root = find(i)
    if (!byRoot.has(root)) byRoot.set(root, { id: s.id, strokes: [], box: { ...boxes[i] } })
    const g = byRoot.get(root)
    g.id = Math.min(g.id, s.id)
    g.strokes.push(s)
    g.box.x0 = Math.min(g.box.x0, boxes[i].x0)
    g.box.y0 = Math.min(g.box.y0, boxes[i].y0)
    g.box.x1 = Math.max(g.box.x1, boxes[i].x1)
    g.box.y1 = Math.max(g.box.y1, boxes[i].y1)
  })
  return [...byRoot.values()].sort((a, b) => a.id - b.id)
}

// Trace a stroke's centre line. A one-point stroke gets a tiny segment so round caps draw a disc.
export function traceStroke(ctx, s) {
  const p = s.pts
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1])
  for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1])
}

// The outline of the union of some strokes: a thick stroke with a slightly thinner one cut out
// of it, on a layer so the cut doesn't erase what's already on the canvas. Overlapping strokes
// cut each other's inner lines, so only the outer contour of the union is left.
let layer = null
export function drawOutline(ctx, strokes, width, color, lineWidth = 1.5) {
  if (!strokes.length) return
  const t = ctx.getTransform()
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  if (!layer || layer.width !== cw || layer.height !== ch) {
    layer = document.createElement('canvas')
    layer.width = cw
    layer.height = ch
  }
  const l = layer.getContext('2d')
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.clearRect(0, 0, cw, ch)
  l.setTransform(t)
  l.lineCap = 'round'
  l.lineJoin = 'round'
  l.strokeStyle = color
  l.globalCompositeOperation = 'source-over'
  for (const s of strokes) {
    traceStroke(l, s)
    l.lineWidth = 2 * s.r * width + lineWidth
    l.stroke()
  }
  l.globalCompositeOperation = 'destination-out'
  for (const s of strokes) {
    traceStroke(l, s)
    l.lineWidth = Math.max(0.1, 2 * s.r * width - lineWidth)
    l.stroke()
  }
  l.globalCompositeOperation = 'source-over'
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
}
