// The webcam as a luminance field: each new video frame is drawn, mirrored and cropped to cover
// the canvas, into a small W×H canvas, and read back as values from 0 (black) to 1 (white).

export function createCamera() {
  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.style.display = 'none'

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let lastTime = -1

  const cam = {
    video,
    status: 'Esperando la cámara…', // shown until the first frame arrives; null once it has
    async start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        video.srcObject = stream
        await video.play()
        cam.status = null
      } catch (err) {
        console.error(err)
        cam.status = 'No se pudo usar la cámara. Revisa los permisos y recarga la página.'
      }
    },
    // Writes the latest frame into `out` (length W×H). Returns false when there is no new frame.
    read(out, W, H, mirror) {
      if (cam.status || video.readyState < 2 || video.currentTime === lastTime) return false
      lastTime = video.currentTime
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const vw = video.videoWidth
      const vh = video.videoHeight
      const s = Math.max(W / vw, H / vh)
      ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? W : 0, 0)
      ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s)
      const px = ctx.getImageData(0, 0, W, H).data
      for (let i = 0, j = 0; i < out.length; i++, j += 4) {
        out[i] = (0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]) / 255
      }
      return true
    },
  }
  return cam
}
