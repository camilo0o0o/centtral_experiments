import * as THREE from 'three'

export default function ({ container, gui, theme }) {
  const bg = theme.bg // override per experiment, e.g. '#0e0e10'
  const params = { speed: 1, color: '#333333' }

  // preserveDrawingBuffer lets the "S" key capture a thumbnail.
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setClearColor(bg)
  container.append(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 4

  const material = new THREE.MeshStandardMaterial({ color: params.color })
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  scene.add(cube)
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(2, 3, 4)
  scene.add(light)

  gui.add(params, 'speed', 0, 5)
  gui.addColor(params, 'color').onChange((c) => material.color.set(c))

  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = container
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }).observe(container)

  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta() * params.speed
    cube.rotation.x += dt * 0.6
    cube.rotation.y += dt
    renderer.render(scene, camera)
  })
}
