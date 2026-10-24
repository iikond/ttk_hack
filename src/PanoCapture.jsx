import { useEffect, useRef, useState } from 'react'

const D = Math.PI / 180
// W3C deviceorientation -> матрица поворота (устройство -> мир), 3x3 построчно
const rot = (a, b, g) => {
  const cX = Math.cos(b), sX = Math.sin(b), cY = Math.cos(g), sY = Math.sin(g), cZ = Math.cos(a), sZ = Math.sin(a)
  return [
    cZ * cY - sZ * sX * sY, -cX * sZ, cY * sZ * sX + cZ * sY,
    cY * sZ + cZ * sX * sY, cZ * cX, sZ * sY - cZ * cY * sX,
    -cX * sY, sX, cX * cY,
  ]
}
const fwd = (R) => [-R[2], -R[5], -R[8]] // направление задней камеры в мире
const dir = (yaw, p) => [Math.sin(yaw) * Math.cos(p), Math.cos(yaw) * Math.cos(p), Math.sin(p)]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const toCam = (R, v) => [
  R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
  R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
  R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
]

const ring = (p, n) => Array.from({ length: n }, (_, i) => ({ yaw: ((i * 360) / n) * D, pitch: p * D }))
const TARGETS = [...ring(0, 12), ...ring(45, 8), ...ring(-45, 8), { yaw: 0, pitch: 90 * D }, { yaw: 0, pitch: -90 * D }]
const TOL = 5 * D
const MIN_SHOTS = 12

// Проекция кадров на equirectangular по известным углам (без поиска фич): стабильно и быстро
async function stitch(shots, yaw0, W, prog) {
  const H = W / 2
  const acc = new Float32Array(W * H * 3), wt = new Float32Array(W * H)
  const lonS = new Float32Array(W), lonC = new Float32Array(W), latS = new Float32Array(H), latC = new Float32Array(H)
  for (let x = 0; x < W; x++) {
    const l = ((x + 0.5) / W) * 2 * Math.PI - Math.PI + yaw0
    lonS[x] = Math.sin(l); lonC[x] = Math.cos(l)
  }
  for (let y = 0; y < H; y++) {
    const l = Math.PI / 2 - ((y + 0.5) / H) * Math.PI
    latS[y] = Math.sin(l); latC[y] = Math.cos(l)
  }
  for (let si = 0; si < shots.length; si++) {
    const { R, w, h, f, img } = shots[si], d = img.data
    const cam = fwd(R), half = Math.atan(Math.hypot(w, h) / 2 / f), cosH = Math.cos(half)
    const pc = Math.asin(cam[2])
    const y0 = Math.max(0, Math.floor(((Math.PI / 2 - pc - half) / Math.PI) * H))
    const y1 = Math.min(H - 1, Math.ceil(((Math.PI / 2 - pc + half) / Math.PI) * H))
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < W; x++) {
        const vx = lonS[x] * latC[y], vy = lonC[x] * latC[y], vz = latS[y]
        if (vx * cam[0] + vy * cam[1] + vz * cam[2] < cosH) continue
        const cz = R[2] * vx + R[5] * vy + R[8] * vz
        if (cz >= -1e-3) continue
        const cx = R[0] * vx + R[3] * vy + R[6] * vz, cy = R[1] * vx + R[4] * vy + R[7] * vz
        const px = w / 2 + (f * cx) / -cz, py = h / 2 - (f * cy) / -cz
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        const k = Math.min(1 - Math.abs((px / w) * 2 - 1), 1 - Math.abs((py / h) * 2 - 1)) + 0.001
        const j = ((py | 0) * w + (px | 0)) * 4, o = y * W + x
        acc[o * 3] += d[j] * k; acc[o * 3 + 1] += d[j + 1] * k; acc[o * 3 + 2] += d[j + 2] * k; wt[o] += k
      }
    }
    prog((si + 1) / shots.length)
    await new Promise((r) => setTimeout(r))
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d'), out = ctx.createImageData(W, H)
  for (let o = 0; o < W * H; o++) {
    const k = wt[o]
    out.data[o * 4] = k ? acc[o * 3] / k : 30
    out.data[o * 4 + 1] = k ? acc[o * 3 + 1] / k : 30
    out.data[o * 4 + 2] = k ? acc[o * 3 + 2] / k : 30
    out.data[o * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
}

/**
 * <PanoCapture onDone={(blob) => ...} longFov={65} />
 * longFov — угол обзора камеры по длинной стороне кадра (типично 60–70°).
 * Нужен HTTPS и телефон с гироскопом.
 */
export default function PanoCapture({ onDone, longFov = 65 }) {
  const video = useRef(), cv = useRef()
  const S = useRef({ R: null, yaw0: null, T: null, shots: [], done: new Set(), prev: null, still: 0, stream: null })
  const [phase, setPhase] = useState('intro')
  const [n, setN] = useState(0)
  const [hint, setHint] = useState('')
  const [err, setErr] = useState('')
  const [pct, setPct] = useState(0)
  const [url, setUrl] = useState('')
  const s = S.current

  const onOri = useRef((e) => {
    if (e.alpha == null) return
    const st = S.current
    st.R = rot(e.alpha * D, e.beta * D, e.gamma * D)
    if (st.yaw0 == null) {
      const f = fwd(st.R)
      st.yaw0 = Math.atan2(f[0], f[1])
      st.T = TARGETS.map((t) => dir(st.yaw0 + t.yaw, t.pitch))
    }
  }).current

  const stop = () => {
    window.removeEventListener('deviceorientation', onOri)
    S.current.stream?.getTracks().forEach((t) => t.stop())
  }
  useEffect(() => stop, []) // eslint-disable-line

  const start = async () => {
    setErr('')
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('Нет доступа к датчикам')
      }
      s.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      video.current.srcObject = s.stream
      await video.current.play()
      s.R = null; s.yaw0 = null
      window.addEventListener('deviceorientation', onOri)
      await new Promise((r) => setTimeout(r, 800))
      if (!s.R) throw new Error('Нет данных гироскопа. Откройте на телефоне по HTTPS.')
      setPhase('shoot')
    } catch (e) {
      stop(); setErr(e.message || String(e))
    }
  }

  const finish = async () => {
    stop(); setPhase('render')
    const blob = await stitch(s.shots, s.yaw0, 2048, setPct)
    setUrl(URL.createObjectURL(blob)); setPhase('done'); onDone?.(blob)
  }

  const capture = (i) => {
    const v = video.current, k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(v, 0, 0, w, h)
    s.shots.push({ img: x.getImageData(0, 0, w, h), R: s.R.slice(), w, h, f: Math.max(w, h) / 2 / Math.tan((longFov * D) / 2) })
    s.done.add(i); setN(s.done.size); navigator.vibrate?.(30)
    if (s.done.size === TARGETS.length) finish()
  }

  useEffect(() => {
    if (phase !== 'shoot') return
    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const v = video.current, c = cv.current, R = s.R
      if (!R || !v.videoWidth) return
      const cw = (c.width = c.clientWidth), ch = (c.height = c.clientHeight), g = c.getContext('2d')
      const sc = Math.max(cw / v.videoWidth, ch / v.videoHeight)
      const f = (Math.max(v.videoWidth, v.videoHeight) / 2 / Math.tan((longFov * D) / 2)) * sc
      const cam = fwd(R)
      let best = -1, bd = 9
      s.T.forEach((t, i) => {
        if (s.done.has(i)) return
        const a = Math.acos(Math.min(1, dot(cam, t)))
        if (a < bd) { bd = a; best = i }
      })
      if (best < 0) return
      const proj = (i) => {
        const p = toCam(R, s.T[i])
        return { p, ok: p[2] < -0.05, x: cw / 2 + (f * p[0]) / -p[2], y: ch / 2 - (f * p[1]) / -p[2] }
      }
      s.T.forEach((_, i) => {
        const q = proj(i)
        if (!q.ok || q.x < -30 || q.x > cw + 30 || q.y < -30 || q.y > ch + 30) return
        g.beginPath(); g.arc(q.x, q.y, i === best ? 24 : 12, 0, 7)
        if (s.done.has(i)) { g.fillStyle = 'rgba(60,220,110,.7)'; g.fill() }
        else { g.lineWidth = i === best ? 4 : 2; g.strokeStyle = i === best ? '#fff' : 'rgba(255,255,255,.5)'; g.stroke() }
      })
      const q = proj(best)
      const onScreen = q.ok && q.x > 0 && q.x < cw && q.y > 0 && q.y < ch
      if (!onScreen) { // стрелка к следующей точке
        const a = Math.atan2(-q.p[1], q.p[0]), r = Math.min(cw, ch) * 0.35
        const ax = cw / 2 + Math.cos(a) * r, ay = ch / 2 + Math.sin(a) * r
        g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = '#fff'
        g.beginPath(); g.moveTo(30, 0); g.lineTo(-15, -22); g.lineTo(-15, 22); g.fill(); g.restore()
      }
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2
      g.beginPath(); g.moveTo(cw / 2 - 12, ch / 2); g.lineTo(cw / 2 + 12, ch / 2); g.moveTo(cw / 2, ch / 2 - 12); g.lineTo(cw / 2, ch / 2 + 12); g.stroke()
      // автосъёмка: цель в допуске и телефон неподвижен
      const mv = s.prev ? Math.acos(Math.min(1, dot(cam, s.prev))) : 0
      s.prev = cam
      s.still = mv < 0.4 * D ? s.still + 1 : 0
      if (bd < TOL) {
        setHint('Держите ровно…')
        if (s.still >= 8) { s.still = 0; capture(best) }
      } else setHint(onScreen ? 'Наведите центр на кружок' : 'Поворачивайтесь по стрелке')
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [phase]) // eslint-disable-line

  const btn = { padding: '14px 22px', fontSize: 17, borderRadius: 12, border: 0, background: '#2f6bff', color: '#fff' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', font: '16px system-ui' }}>
      <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <canvas ref={cv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {phase === 'intro' && (
        <div style={{ position: 'absolute', inset: 0, background: '#111', padding: 24, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' }}>
          <h2 style={{ margin: 0 }}>Съёмка панорамы</h2>
          <p>Встаньте в центре помещения, держите телефон вертикально и вытянутыми руками. Вращайтесь на месте, не сходя с точки. Наводите центр экрана на кружки: снимок делается сам, когда телефон замрёт.</p>
          <p>Порядок: круг на уровне глаз, затем вверх, затем вниз.</p>
          {err && <p style={{ color: '#ff7b7b' }}>{err}</p>}
          <button style={btn} onClick={start}>Начать</button>
        </div>
      )}
      {phase === 'shoot' && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 16, textAlign: 'center', background: 'rgba(0,0,0,.5)' }}>{hint}</div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,.5)' }}>
            <span>{n} / {TARGETS.length}</span>
            <button style={{ ...btn, opacity: n >= MIN_SHOTS ? 1 : 0.4 }} disabled={n < MIN_SHOTS} onClick={finish}>Готово</button>
          </div>
        </>
      )}
      {phase === 'render' && (
        <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'grid', placeItems: 'center' }}>Склейка… {Math.round(pct * 100)}%</div>
      )}
      {phase === 'done' && (
        <div style={{ position: 'absolute', inset: 0, background: '#111', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
          <img src={url} style={{ width: '100%', borderRadius: 8 }} />
          <a href={url} download="panorama.jpg" style={{ ...btn, textAlign: 'center', textDecoration: 'none' }}>Скачать JPG</a>
        </div>
      )}
    </div>
  )
}
