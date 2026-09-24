import p5 from 'p5'

export default function ({ container, gui, theme }) {
  const bg = theme.bg // override per experiment, e.g. '#0e0e10'
  const params = { size: 80, color: '#333333' }
  gui.add(params, 'size', 10, 300)
  gui.addColor(params, 'color')

  new p5((p) => {
    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight)
    }
    p.draw = () => {
      p.background(bg)
      p.noStroke()
      p.fill(params.color)
      p.circle(p.width / 2, p.height / 2, params.size)
    }
    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
    }
  }, container)
}
