import { useEffect, useRef, useState } from 'react'
import { icon } from './util'

// SVG-план с панорамированием/зумом (палец, щипок, колесо). Координаты — в единицах плана.
const bb = (r) => {
  if (!r.pts) return r
  const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}
const shapeEl = (r, p) => r.pts ? <polygon points={r.pts.map((q) => q.join(',')).join(' ')} {...p} />
  : r.shape === 'ellipse' ? <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} {...p} />
  : <rect x={r.x} y={r.y} width={r.w} height={r.h} {...p} />

export default function Plan({ data, route, selected, showWay, onItem, onBg, onDrag, grid = 0, draft }) {
  const el = useRef(), vbR = useRef(), szR = useRef({ w: 1, h: 1 }), fit = useRef(true)
  const P = useRef(new Map()), S = useRef({})
  const [vb, setVb] = useState(null), [sw, setSw] = useState(1)
  const W = data.plan?.w || 1000, H = data.plan?.h || 700
  const put = (v) => { vbR.current = v; setVb(v) }

  useEffect(() => {
    fit.current = true
    const apply = () => {
      const r = el.current.getBoundingClientRect(), v = vbR.current
      if (!r.width || !r.height) return
      if (fit.current || !v) {
        fit.current = false
        const s = Math.max(W / r.width, H / r.height)
        put({ x: W / 2 - (r.width * s) / 2, y: H / 2 - (r.height * s) / 2, w: r.width * s, h: r.height * s })
      } else {
        const u = v.w / szR.current.w, cx = v.x + v.w / 2, cy = v.y + v.h / 2, nw = r.width * u, nh = r.height * u
        put({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh })
      }
      szR.current = { w: r.width, h: r.height }; setSw(r.width)
    }
    apply()
    const ro = new ResizeObserver(apply); ro.observe(el.current)
    return () => ro.disconnect()
  }, [W, H])

  const rect = () => el.current.getBoundingClientRect()
  const pt = (cx, cy) => { const r = rect(), v = vbR.current; return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h } }
  const zoom = (f, cx, cy) => {
    const v = vbR.current, p = pt(cx, cy), w = Math.min(Math.max(v.w * f, 40), Math.max(W, H) * 4), g = w / v.w
    put({ x: p.x - (p.x - v.x) * g, y: p.y - (p.y - v.y) * g, w, h: v.h * g })
  }
  const pan = (dx, dy) => { const v = vbR.current, r = rect(); put({ ...v, x: v.x - (dx * v.w) / r.width, y: v.y - (dy * v.h) / r.height }) }
  const dist = () => { const [a, b] = [...P.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }

  const down = (e) => {
    el.current.setPointerCapture(e.pointerId)
    P.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (P.current.size === 1) {
      const k = e.target.closest('[data-k]')?.dataset.k, i = k ? k.indexOf(':') : -1
      S.current = { kind: k?.slice(0, i), id: k?.slice(i + 1), moved: false, x0: e.clientX, y0: e.clientY }
    } else S.current = { moved: true, pinch: dist() }
  }
  const move = (e) => {
    const o = P.current.get(e.pointerId), s = S.current
    if (!o) return
    const n = { x: e.clientX, y: e.clientY }
    if (P.current.size === 2) {
      P.current.set(e.pointerId, n)
      const d = dist(), [a, b] = [...P.current.values()]
      zoom(s.pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); s.pinch = d; return
    }
    if (Math.hypot(n.x - s.x0, n.y - s.y0) > 5) s.moved = true
    if (s.moved) { if (s.kind === 'n' && onDrag) onDrag(s.id, pt(n.x, n.y)); else pan(n.x - o.x, n.y - o.y) }
    P.current.set(e.pointerId, n)
  }
  const up = (e) => {
    const s = S.current
    if (P.current.size === 1 && !s.moved) {
      const p = pt(e.clientX, e.clientY)
      s.kind ? onItem?.(s.kind, s.id, p) : onBg?.(p)
    }
    P.current.delete(e.pointerId)
  }

  const k = vb ? vb.w / sw : 1
  const N = Object.fromEntries(data.nodes.map((n) => [n.id, n]))
  const bg = data.plan?.bg
  return (
    <svg ref={el} className="plan" style={{ touchAction: 'none' }}
      viewBox={vb ? `${vb.x} ${vb.y} ${vb.w} ${vb.h}` : `0 0 ${W} ${H}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={(e) => zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)}>
      {vb && <>
        <rect x="0" y="0" width={W} height={H} fill="#fff" />
        {bg && <image href={bg} x="0" y="0" width={W} height={H} />}
        {grid > 0 && <>
          <defs><pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 H 0 V ${grid}`} fill="none" stroke="rgba(0,0,0,.18)" strokeWidth={k} />
          </pattern></defs>
          <rect x="0" y="0" width={W} height={H} fill="url(#grid)" pointerEvents="none" />
        </>}
        {data.rooms.map((r) => { const b = bb(r); return (
          <g key={r.id} data-k={'r:' + r.id}>
            {shapeEl(r, { fill: 'rgba(47,107,255,.08)', stroke: '#2f6bff', strokeWidth: 2 * k })}
            <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dy=".35em" fontSize={13 * k} fill="#2f6bff" pointerEvents="none">{r.name}</text>
          </g>) })}
        {draft?.pts.length > 0 && <g pointerEvents="none">
          {draft.pts.length > 1 && <polyline points={draft.pts.map((q) => q.join(',')).join(' ')} fill="rgba(47,107,255,.1)" stroke="#2f6bff" strokeWidth={2 * k} strokeDasharray={`${6 * k}`} />}
          {draft.pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={(i ? 4 : 8) * k} fill="#2f6bff" />)}
        </g>}
        {data.edges.map((e) => N[e.a] && N[e.b] && (
          <line key={e.a + e.b} data-k={'e:' + e.a + e.b} x1={N[e.a].x} y1={N[e.a].y} x2={N[e.b].x} y2={N[e.b].y}
            stroke="#e4dcc6" strokeWidth="28" strokeLinecap="round" opacity={bg ? 0.55 : 1} />
        ))}
        {route?.length > 1 && <polyline fill="none" stroke="#2f6bff" strokeWidth={6 * k} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={`${12 * k} ${10 * k}`} pointerEvents="none" points={route.map((n) => `${n.x},${n.y}`).join(' ')} />}
        {data.nodes.filter((n) => n.t === 'p' || showWay || n.pano).map((n) => (
          <g key={n.id} data-k={'n:' + n.id} transform={`translate(${n.x} ${n.y})`}>
            {n.id === selected && <circle r={23 * k} fill="none" stroke="#ff9f1a" strokeWidth={3 * k} />}
            {n.t === 'p' ? <>
              <circle r={15 * k} fill="#fff" stroke={n.pano ? '#2f6bff' : '#555'} strokeWidth={(n.pano ? 3 : 2) * k} />
              <text textAnchor="middle" dy=".35em" fontSize={16 * k}>{icon(n)}</text>
              {n.name && <text y={29 * k} textAnchor="middle" fontSize={12 * k} fill="#222" stroke="#fff" strokeWidth={3 * k} paintOrder="stroke">{n.name}</text>}
            </> : <>
              <circle r={16 * k} fill="transparent" />
              <circle r={6 * k} fill={n.pano ? '#2f6bff' : '#999'} stroke="#fff" strokeWidth={k} />
            </>}
          </g>
        ))}
        {route?.length > 1 && [route[0], route.at(-1)].map((n, i) => <circle key={i} cx={n.x} cy={n.y} r={9 * k} fill={i ? '#e5484d' : '#2fb36b'} stroke="#fff" strokeWidth={2 * k} pointerEvents="none" />)}
      </>}
    </svg>
  )
}
