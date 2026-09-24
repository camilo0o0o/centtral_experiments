import p5 from 'p5'

export default function ({ container, gui, theme }) {
  const bg = theme.bg // override per experiment, e.g. '#0e0e10'
  const params = {
    count: 1500,
    noiseScale: 0.003,
    speed: 1.5,
    fade: 12,
    hue: 200,
    hueRange: 60,
    clear: () => clear(),
  }

  // Assigned once p5 is running; the GUI calls them.
  let clear = () => {}
  let reset = () => {}
  let particles = []

  new p5((p) => {
    let bgColor

    const spawn = () => {
      p.colorMode(p.HSB, 360, 100, 100, 100)
      const color = p.color((params.hue + p.random(params.hueRange)) % 360, 70, 65, 50)
      p.colorMode(p.RGB)
      return { x: p.random(p.width), y: p.random(p.height), color }
    }

    p.setup = () => {
      p.createCanvas(container.clientWidth, container.clientHeight)
      bgColor = p.color(bg)
      p.background(bgColor)
      reset = () => { particles = Array.from({ length: params.count }, spawn) }
      clear = () => p.background(bgColor)
      reset()
    }

    p.draw = () => {
      // Paint the background at low opacity so old strokes fade into trails.
      p.noStroke()
      p.fill(p.red(bgColor), p.green(bgColor), p.blue(bgColor), params.fade * 2.55)
      p.rect(0, 0, p.width, p.height)

      p.strokeWeight(1.2)
      const t = p.frameCount * 0.002
      for (const pt of particles) {
        const angle = p.noise(pt.x * params.noiseScale, pt.y * params.noiseScale, t) * p.TWO_PI * 2
        const nx = pt.x + Math.cos(angle) * params.speed
        const ny = pt.y + Math.sin(angle) * params.speed
        p.stroke(pt.color)
        p.line(pt.x, pt.y, nx, ny)
        pt.x = nx
        pt.y = ny
        if (nx < 0 || nx > p.width || ny < 0 || ny > p.height) Object.assign(pt, spawn())
      }
    }

    p.windowResized = () => {
      p.resizeCanvas(container.clientWidth, container.clientHeight)
      p.background(bgColor)
    }
  }, container)

  gui.add(params, 'count', 100, 5000, 100).onFinishChange(() => reset())
  gui.add(params, 'noiseScale', 0.0005, 0.01, 0.0001)
  gui.add(params, 'speed', 0.2, 5)
  gui.add(params, 'fade', 0, 50, 1).name('trail fade')
  gui.add(params, 'hue', 0, 360, 1).onFinishChange(() => reset())
  gui.add(params, 'hueRange', 0, 360, 1).name('hue range').onFinishChange(() => reset())
  gui.add(params, 'clear')
}
