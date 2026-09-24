export default function ({ container, gui, theme }) {
  const bg = theme.bg // override per experiment, e.g. '#0e0e10'
  const params = { size: 80, color: '#333333' }
  gui.add(params, 'size', 10, 300)
  gui.addColor(params, 'color')

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  container.append(canvas)

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
  }).observe(container)

  function frame(t) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)
    const r = params.size / 2 + Math.sin(t / 500) * 10
    ctx.fillStyle = params.color
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2)
    ctx.fill()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
