import { useEffect, useRef, useState } from 'react'

const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}'
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D t;uniform vec2 a;uniform vec2 f;
void main(){vec3 d=normalize(vec3(v.x*f.x,v.y*f.y,1.));
float cp=cos(a.y),sp=sin(a.y),cy=cos(a.x),sy=sin(a.x);
d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);
d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);
gl_FragColor=texture2D(t,vec2(atan(d.x,d.z)/6.2831853+.5,.5-asin(clamp(d.y,-1.,1.))/3.1415927));}`
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

/**
 * Просмотр equirectangular-панорамы (WebGL, без зависимостей).
 * hotspots: [{id,yaw,pitch,kind:'info'|'go',title}] (радианы)
 * onTap({yaw,pitch}) — тап по пустому месту; onSpot(h) — тап по метке
 * look: {yaw,pitch,key} — куда смотреть после загрузки
 */
export default function Viewer({ url, hotspots = [], onTap, onSpot, look }) {
  const cv = useRef(), box = useRef(), els = useRef({}), ptr = useRef(new Map()), g = useRef({})
  const s = useRef({ yaw: 0, pitch: 0, fov: 80, dirty: true })
  const cb = useRef(); cb.current = { hotspots, onTap }
  const [msg, setMsg] = useState('Загрузка…')

  useEffect(() => {
    const c = cv.current, S = s.current, gl = c.getContext('webgl')
    if (!gl) { setMsg('WebGL недоступен на этом устройстве'); return }
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o }
    const pr = gl.createProgram()
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(pr); gl.useProgram(pr)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uA = gl.getUniformLocation(pr, 'a'), uF = gl.getUniformLocation(pr, 'f')
    S.gl = gl
    let raf
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const dpr = Math.min(devicePixelRatio || 1, 2), cw = c.clientWidth, ch = c.clientHeight
      if (c.width !== ((cw * dpr) | 0) || c.height !== ((ch * dpr) | 0)) { c.width = (cw * dpr) | 0; c.height = (ch * dpr) | 0; S.dirty = true }
      if (!S.dirty || !S.tex || !cw) return
      S.dirty = false
      const ty = Math.tan((S.fov * Math.PI) / 360), asp = cw / ch
      gl.viewport(0, 0, c.width, c.height); gl.bindTexture(gl.TEXTURE_2D, S.tex)
      gl.uniform2f(uA, S.yaw, S.pitch); gl.uniform2f(uF, ty * asp, ty)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      const cY = Math.cos(S.yaw), sY = Math.sin(S.yaw), cP = Math.cos(S.pitch), sP = Math.sin(S.pitch)
      for (const h of cb.current.hotspots) {
        const e = els.current[h.id]; if (!e) continue
        const cp = Math.cos(h.pitch), x = Math.sin(h.yaw) * cp, y = Math.sin(h.pitch), z = Math.cos(h.yaw) * cp
        const x1 = x * cY - z * sY, z1 = x * sY + z * cY, y2 = y * cP - z1 * sP, z2 = y * sP + z1 * cP
        if (z2 <= 0.05) { e.style.display = 'none'; continue }
        e.style.display = ''
        e.style.transform = `translate(${(x1 / z2 / (ty * asp) * 0.5 + 0.5) * cw}px,${(0.5 - (y2 / z2 / ty) * 0.5) * ch}px) translate(-50%,-50%)`
      }
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const S = s.current, gl = S.gl
    if (!gl || !url) return
    let dead = false; setMsg('Загрузка…')
    const img = new Image()
    img.onload = () => {
      if (dead) return
      try {
        const mx = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096), k = Math.min(1, mx / img.width)
        const c = document.createElement('canvas'); c.width = (img.width * k) | 0; c.height = (img.height * k) | 0
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        if (S.tex) gl.deleteTexture(S.tex)
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        S.tex = t; S.dirty = true; setMsg('')
      } catch { setMsg('Не удалось показать панораму') }
    }
    img.onerror = () => !dead && setMsg('Не удалось загрузить панораму')
    img.src = url
    return () => { dead = true }
  }, [url])

  useEffect(() => { const S = s.current; S.yaw = look?.yaw ?? 0; S.pitch = look?.pitch ?? 0; S.dirty = true }, [url, look?.key])
  useEffect(() => { s.current.dirty = true }, [hotspots])

  const pd = () => { const [a, b] = [...ptr.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const down = (e) => {
    box.current.setPointerCapture(e.pointerId)
    ptr.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.current = ptr.current.size === 1 ? { x0: e.clientX, y0: e.clientY, moved: false } : { moved: true, pd: pd() }
  }
  const move = (e) => {
    const o = ptr.current.get(e.pointerId), S = s.current
    if (!o) return
    const n = { x: e.clientX, y: e.clientY }
    if (ptr.current.size === 2) {
      ptr.current.set(e.pointerId, n); const d = pd()
      S.fov = clamp((S.fov * g.current.pd) / d, 30, 100); g.current.pd = d; S.dirty = true; return
    }
    if (Math.hypot(n.x - g.current.x0, n.y - g.current.y0) > 6) g.current.moved = true
    if (g.current.moved) {
      const r = (2 * Math.tan((S.fov * Math.PI) / 360)) / box.current.clientHeight
      S.yaw -= (n.x - o.x) * r; S.pitch = clamp(S.pitch + (n.y - o.y) * r, -1.48, 1.48); S.dirty = true
    }
    ptr.current.set(e.pointerId, n)
  }
  const up = (e) => {
    const tap = ptr.current.size === 1 && !g.current.moved
    ptr.current.delete(e.pointerId)
    if (!tap || !cb.current.onTap) return
    const r = box.current.getBoundingClientRect(), S = s.current, ty = Math.tan((S.fov * Math.PI) / 360)
    let x = ((e.clientX - r.left) / r.width * 2 - 1) * ty * (r.width / r.height), y = (1 - ((e.clientY - r.top) / r.height) * 2) * ty, z = 1
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l
    const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch), cy = Math.cos(S.yaw), sy = Math.sin(S.yaw)
    const y1 = y * cp + z * sp, z1 = -y * sp + z * cp
    cb.current.onTap({ yaw: Math.atan2(x * cy + z1 * sy, -x * sy + z1 * cy), pitch: Math.asin(clamp(y1, -1, 1)) })
  }

  return (
    <div ref={box} style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', background: '#000' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={(e) => { s.current.fov = clamp(s.current.fov * (e.deltaY > 0 ? 1.08 : 0.92), 30, 100); s.current.dirty = true }}>
      <canvas ref={cv} style={{ width: '100%', height: '100%', display: 'block' }} />
      {hotspots.map((h) => (
        <button key={h.id} className="hs" ref={(e) => { els.current[h.id] = e }}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => onSpot?.(h)}>
          {h.kind === 'go' ? '➡️' : 'ℹ️'} {h.title}
        </button>
      ))}
      {msg && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', pointerEvents: 'none' }}>{msg}</div>}
    </div>
  )
}
