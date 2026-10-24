import { useEffect, useState } from 'react'
import { api } from './api'
import { CATS, icon } from './util'
import Plan from './Plan'
import Viewer from './Viewer'

export default function Visitor({ id, embed }) {
  const [m, setM] = useState(null), [err, setErr] = useState('')
  const [sel, setSel] = useState(null), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [rt, setRt] = useState(null), [q, setQ] = useState(''), [pv, setPv] = useState(null), [info, setInfo] = useState(null)

  useEffect(() => { api('/maps/' + id).then(setM).catch(() => setErr('Карта не найдена или не опубликована')) }, [id])
  useEffect(() => {
    setRt(null)
    if (!from || !to || from === to) return
    api(`/maps/${id}/route?from=${from}&to=${to}`).then(setRt).catch((e) => setRt({ err: e.message }))
  }, [from, to])

  if (err) return <div className="page">{err}</div>
  if (!m) return <div className="page">Загрузка…</div>
  const d = m.data, N = Object.fromEntries(d.nodes.map((n) => [n.id, n]))
  const pois = d.nodes.filter((n) => n.t === 'p' && n.name), s = N[sel]
  const mpp = d.plan.mpp ?? 100 / d.plan.w

  const cur = pv && N[pv.id]?.pano ? N[pv.id] : null
  if (cur) {
    const idx = pv.seq ? pv.seq.indexOf(cur.id) : -1, nextId = pv.seq?.[idx + 1]
    const h = cur.pano.hotspots.find((x) => x.kind === 'go' && x.to === nextId)
    const look = h ? { yaw: h.yaw, pitch: h.pitch, key: cur.id + nextId } : { key: cur.id }
    const goto = (nid) => { setInfo(null); setPv({ ...pv, id: nid }) }
    return (
      <div className="full" style={{ background: '#000' }}>
        <Viewer url={cur.pano.url} hotspots={cur.pano.hotspots} look={look}
          onSpot={(x) => (x.kind === 'go' ? N[x.to]?.pano && setPv({ id: x.to }) : setInfo(x))} />
        <div className="bar" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <button className="g" onClick={() => { setPv(null); setInfo(null) }}>← План</button><b>{cur.name || ''}</b>
        </div>
        {info && (
          <div className="sheet" style={{ position: 'absolute', bottom: pv.seq ? 56 : 0, left: 0, right: 0 }}>
            <div className="row"><b style={{ flex: 1 }}>{info.title}</b><button className="g" onClick={() => setInfo(null)}>✕</button></div>
            {info.desc && <div>{info.desc}</div>}
          </div>
        )}
        {pv.seq && (
          <div className="bar" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, justifyContent: 'space-between' }}>
            <button disabled={idx <= 0} onClick={() => goto(pv.seq[idx - 1])}>◀ Назад</button>
            <span>{idx + 1} / {pv.seq.length}</span>
            <button disabled={idx < 0 || idx >= pv.seq.length - 1} onClick={() => goto(nextId)}>Далее ▶</button>
          </div>
        )}
      </div>
    )
  }

  const seq = rt?.nodes?.filter((n) => n.pano).map((n) => n.id) || []
  const meters = rt?.length ? Math.round(rt.length * mpp) : 0
  const onItem = (k, i) => {
    if (k !== 'n') return
    if (N[i].t === 'p') setSel(i); else if (N[i].pano) setPv({ id: i })
  }
  return (
    <div className="full">
      {!embed && <div className="bar"><b>{m.title}</b></div>}
      <Plan data={d} route={rt?.nodes} selected={sel} onItem={onItem} onBg={() => setSel(null)} />
      <div className="sheet">
        <input placeholder="🔍 Найти место" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && pois.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map((n) => (
          <button key={n.id} className="g" onClick={() => { setSel(n.id); setQ('') }}>{icon(n)} {n.name}</button>
        ))}
        {s && (
          <div className="card">
            <b>{icon(s)} {s.name}</b><small>{CATS[s.cat]?.[1]}</small>
            {s.desc && <div>{s.desc}</div>}
            <div className="row">
              {s.pano && <button onClick={() => setPv({ id: s.id })}>👁 Осмотреть</button>}
              <button className="g" onClick={() => setFrom(s.id)}>Отсюда</button>
              <button className="g" onClick={() => setTo(s.id)}>Сюда</button>
            </div>
          </div>
        )}
        <div className="row">
          <select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Откуда</option>{pois.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
          <select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Куда</option>{pois.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
        </div>
        {rt?.err && <small>Маршрут не найден</small>}
        {rt?.nodes && (
          <div className="row">
            <small>≈ {meters} м, ~{Math.max(1, Math.round(meters / 80))} мин</small>
            {seq.length > 0 && <button onClick={() => setPv({ id: seq[0], seq })}>👣 Пройти по панорамам ({seq.length})</button>}
          </div>
        )}
      </div>
    </div>
  )
}
