// Hand tracking from Puntos con los dedos (005): every extended fingertip the camera sees becomes a
// cursor. A finger counts as extended from its 3D joints, so it works at any hand angle.
import ml5 from 'ml5'

// A tracked hand that drops out for less than this keeps its cursors
const HAND_GRACE_MS = 150
// A finger has to read the same way on this many detections in a row before it switches on or off
const FINGER_VOTES = 2
// Thumb counts as out when its tip is this far from the pinky knuckle, in palm widths (on / off)
const THUMB_ON = 1.2
const THUMB_OFF = 1.05
// Index, middle, ring, pinky as [knuckle, tip] keypoint indices; the joints in between are knuckle + 1, + 2
const FINGERS = [
  ['index', 5, 8],
  ['middle', 9, 12],
  ['ring', 13, 16],
  ['pinky', 17, 20],
]

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// How big the palm looks in the camera frame, as a fraction of the frame width: bigger is closer.
// Palm length (wrist to middle knuckle) shrinks when the hand tips forward and palm width (index to
// pinky knuckle) when it turns sideways, rarely both, so take whichever reads larger.
function palmSize(k, vw) {
  return Math.max(dist2(k[0], k[9]), dist2(k[5], k[17]) * 1.3) / vw
}

// `params` is read live: reach, smoothing, straightness, useThumb, near, far.
// `size()` returns the canvas size in css px, which fingertips are mapped onto.
// Returns `cursors` (id → { x, y, u, v, depth }, x/y in canvas px, u/v in the mirrored camera frame,
// depth 0 at `far` palm size to 1 at `near`), `update(now, dt)` to call every frame, `status()`:
// a message while starting, or null, and `palm()`: the largest palm size seen last, for calibrating.
export function startHands(video, params, size) {
  const cursors = new Map()
  const fingerStates = new Map() // id → { on, votes }
  const palms = new Map() // hand → smoothed palm size
  let lastPalm = 0
  let status = 'iniciando cámara'

  start()

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      video.srcObject = stream
      await video.play()
      // The detector reads the input size from the width/height attributes, which are 0 on a bare <video>
      video.width = video.videoWidth
      video.height = video.videoHeight
    } catch (err) {
      console.error(err)
      status = 'sin cámara'
      return
    }
    status = 'cargando modelo'
    let handPose
    try {
      // Without p5 1.x around, ml5 returns a promise that resolves once the model has loaded
      handPose = await ml5.handPose({ maxHands: 2 })
    } catch (err) {
      console.error(err)
      status = 'no se pudo cargar el modelo'
      return
    }
    status = null
    handPose.detectStart(video, onHands)
  }

  // How extended each finger looks. Fingers: 1 when the knuckle-to-tip chain is a straight line,
  // lower as it curls; 0 if the whole finger is bent forward at the knuckle. Thumb: tip distance
  // from the pinky knuckle.
  function fingerReadings(k) {
    const out = []
    const wrist = k[0]
    for (const [name, mcp, tip] of FINGERS) {
      const chain = dist(k[mcp], k[mcp + 1]) + dist(k[mcp + 1], k[mcp + 2]) + dist(k[mcp + 2], k[tip])
      const straight = dist(k[mcp], k[tip]) / chain
      const palm = { x: k[mcp].x - wrist.x, y: k[mcp].y - wrist.y, z: k[mcp].z - wrist.z }
      const finger = { x: k[tip].x - k[mcp].x, y: k[tip].y - k[mcp].y, z: k[tip].z - k[mcp].z }
      const align = (palm.x * finger.x + palm.y * finger.y + palm.z * finger.z) / (Math.hypot(palm.x, palm.y, palm.z) * Math.hypot(finger.x, finger.y, finger.z))
      const value = align < 0.3 ? 0 : straight
      out.push({ name, tip, value, on: params.straightness, off: params.straightness - 0.1 })
    }
    if (params.useThumb) {
      const value = dist(k[4], k[17]) / dist(k[5], k[17])
      out.push({ name: 'thumb', tip: 4, value, on: THUMB_ON, off: THUMB_OFF })
    }
    return out
  }

  function onHands(hands) {
    const now = performance.now()
    const vw = video.videoWidth
    const vh = video.videoHeight
    const { width, height } = size()
    const keys = new Set()
    for (const [i, hand] of hands.entries()) {
      if (!hand.keypoints3D) continue
      let key = hand.handedness ?? 'hand'
      if (keys.has(key)) key += i
      keys.add(key)

      // Palm size jitters from frame to frame; smooth it so the brush doesn't pulse.
      const raw = palmSize(hand.keypoints, vw)
      const palm = palms.has(key) ? palms.get(key) + (raw - palms.get(key)) * 0.4 : raw
      palms.set(key, palm)
      const depth = Math.min(1, Math.max(0, (palm - params.far) / Math.max(params.near - params.far, 1e-3)))

      for (const f of fingerReadings(hand.keypoints3D)) {
        const id = `${key}-${f.name}`
        const state = fingerStates.get(id) ?? { on: false, votes: 0 }
        fingerStates.set(id, state)
        // Two thresholds so a finger near the edge doesn't flicker, and a few agreeing votes to switch
        const want = state.on ? f.value > f.off : f.value > f.on
        if (want !== state.on) {
          if (++state.votes >= FINGER_VOTES) {
            state.on = want
            state.votes = 0
          }
        } else {
          state.votes = 0
        }

        if (!state.on) {
          cursors.delete(id)
          continue
        }
        // Mirror so the canvas moves like a mirror, then map the central `reach` of the camera
        // frame onto the whole canvas.
        const tip = hand.keypoints[f.tip]
        const u = 1 - tip.x / vw
        const v = tip.y / vh
        const tx = ((u - 0.5) / params.reach + 0.5) * width
        const ty = ((v - 0.5) / params.reach + 0.5) * height
        const c = cursors.get(id)
        if (c) Object.assign(c, { tx, ty, u, v, depth, seen: now })
        else cursors.set(id, { x: tx, y: ty, tx, ty, u, v, depth, seen: now })
      }
    }
    lastPalm = Math.max(0, ...[...keys].map((k) => palms.get(k) ?? 0))
    for (const k of palms.keys()) if (!keys.has(k)) palms.delete(k)
  }

  // Ease fingertips toward their latest detection and drop the ones whose hand has gone.
  function update(now, dt) {
    const ease = 1 - Math.pow(params.smoothing, dt * 60)
    for (const [id, c] of cursors) {
      if (now - c.seen > HAND_GRACE_MS) {
        cursors.delete(id)
        fingerStates.delete(id)
        continue
      }
      c.x += (c.tx - c.x) * ease
      c.y += (c.ty - c.y) * ease
    }
  }

  return { cursors, update, status: () => status, palm: () => lastPalm }
}
