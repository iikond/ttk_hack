import { useEffect, useRef, useState } from 'react'
import { api, upload } from './api'
import { CATS, resize, uid } from './util'
import Plan from './Plan'
import Viewer from './Viewer'
import PanoCapture from './PanoCapture'

const TOOLS = [['select', '✋', 'Выбор'], ['point', '📍', 'Точка'], ['way', '〰️', 'Коридор'], ['link', '🔗', 'Связь'], ['room', '▭', 'Комната'], ['del', '🗑', 'Удалить']]
const HINT = {
  select: 'Тяните точки, чтобы двигать. Тап по точке — свойства и панорама',
  point: 'Тап по плану — новая точка (стенд, зал, вход…). Сама присоединится к ближайшему коридору',
  way: 'Ставьте точки цепочкой вдоль коридоров (для маршрутов). Новая соединяется с выбранной',
  link: 'Тап по двум точкам — соединить',
  room: 'Тап по двум противоположным углам комнаты',
  del: 'Тап по точке, комнате или коридору — удалить',
}
const addEdge = (d, a, b) => {
  if (a !== b && !d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) d.edges.push({ a, b })
}

function PanoEditor({ node, others, onChange, onClose }) {
  const [f, setF] = useState(null)
  const hs = node.pano.hotspots
  const set = (p) => setF((o) => ({ ...o, ...p }))
  const save = () => {
    const h = { ...f, id: f.id || uid() }
    if (h.kind === 'go' && !h.title) h.title = others.find((o) => o.id === h.to)?.name || 'Переход'
    if (h.kind === 'go' && !h.to) return
    onChange(f.id ? hs.map((x) => (x.id === h.id ? h : x)) : [...hs, h]); setF(null)
  }
  return (
    <div className="full" style={{ zIndex: 20, background: '#000' }}>
      <Viewer url={node.pano.url} hotspots={hs} onTap={(p) => setF({ kind: 'info', title: '', desc: '', ...p })} onSpot={(h) => setF(h)} />
      <div className="bar" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <span style={{ flex: 1 }}>Тап по панораме — добавить метку</span><button onClick={onClose}>Готово</button>
      </div>
      {f && (
        <div className="sheet" style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="info">ℹ️ Информация</option><option value="go">➡️ Переход к другой панораме</option>
          </select>
          {f.kind === 'go' ? (
            <select value={f.to || ''} onChange={(e) => set({ to: e.target.value })}>
              <option value="">Куда ведёт…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name || 'Точка ' + o.id.slice(0, 4)}</option>)}
            </select>
          ) : <>
            <input placeholder="Название" value={f.title} onChange={(e) => set({ title: e.target.value })} />
            <textarea rows={2} placeholder="Описание" value={f.desc || ''} onChange={(e) => set({ desc: e.target.value })} />
          </>}
          <div className="row">
            <button onClick={save}>Сохранить</button><button className="g" onClick={() => setF(null)}>Отмена</button>
            {f.id && <button className="r" onClick={() => { onChange(hs.filter((x) => x.id !== f.id)); setF(null) }}>Удалить</button>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Editor({ id }) {
  const [m, setM] = useState(null), [tool, setTool] = useState('select'), [sel, setSel] = useState(null)
  const [link, setLink] = useState(null), [corner, setCorner] = useState(null)
  const [grid, setGrid] = useState(20), [shape, setShape] = useState('rect'), [poly, setPoly] = useState([])
  const [st, setSt] = useState(''), [dirty, setDirty] = useState(false), [modal, setModal] = useState(null)
  const planFile = useRef(), panoFile = useRef()

  useEffect(() => { api('/maps/' + id).then(setM).catch((e) => setSt(e.message)) }, [id])
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(async () => {
      try {
        setSt('Сохранение…')
        await api('/maps/' + id, { method: 'PUT', json: { title: m.title, data: m.data } })
        setSt('Сохранено'); setDirty(false)
      } catch (e) { setSt('Ошибка: ' + e.message) }
    }, 1000)
    return () => clearTimeout(t)
  }, [m, dirty])

  if (!m) return <div className="page">{st || 'Загрузка…'}</div>
  const d = m.data, node = d.nodes.find((n) => n.id === sel)
  const upd = (fn) => { setM((o) => { const nd = structuredClone(o.data); fn(nd); return { ...o, data: nd } }); setDirty(true) }
  const setN = (patch) => upd((x) => Object.assign(x.nodes.find((n) => n.id === sel), patch))
  const pick = (t) => { setTool(t); setLink(null); setCorner(null); setPoly([]) }
  const sn = (p) => grid ? { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid } : { x: Math.round(p.x), y: Math.round(p.y) }
  const finishPoly = () => {
    if (poly.length < 3) return
    const name = prompt('Название комнаты') || ''
    upd((x) => x.rooms.push({ id: uid(), name, shape: 'poly', pts: poly })); setPoly([])
  }
  const mpp = d.plan.mpp ?? 100 / d.plan.w

  const tap = (kind, nid, p) => {
    if (kind === 'n') {
      if (tool === 'del') {
        upd((x) => { x.nodes = x.nodes.filter((n) => n.id !== nid); x.edges = x.edges.filter((e) => e.a !== nid && e.b !== nid) })
        setSel(null); return
      }
      if (tool === 'link') { if (link && link !== nid) upd((x) => addEdge(x, link, nid)); setLink(nid) }
      setSel(nid); return
    }
    if (kind && tool === 'del') {
      upd((x) => { if (kind === 'r') x.rooms = x.rooms.filter((r) => r.id !== nid); else x.edges = x.edges.filter((e) => e.a + e.b !== nid) })
      return
    }
    const x0 = sn(p).x, y0 = sn(p).y
    if (tool === 'point') {
      const nn = uid()
      upd((x) => {
        const n = { id: nn, t: 'p', x: x0, y: y0, name: '', cat: 'stand', desc: '' }
        const w = x.nodes.filter((q) => q.t === 'w').map((q) => [Math.hypot(q.x - x0, q.y - y0), q]).sort((a, b) => a[0] - b[0])[0]
        x.nodes.push(n); if (w && w[0] < 300) addEdge(x, nn, w[1].id)
      })
      setSel(nn)
    } else if (tool === 'way') {
      const nn = uid(), cur = node?.t === 'w' ? node.id : null
      upd((x) => { x.nodes.push({ id: nn, t: 'w', x: x0, y: y0 }); if (cur) addEdge(x, cur, nn) })
      setSel(nn)
    } else if (tool === 'room') {
      const q = sn(p)
      if (shape === 'poly') {
        if (poly.length > 2 && Math.hypot(q.x - poly[0][0], q.y - poly[0][1]) < Math.max(grid, 20)) finishPoly()
        else setPoly([...poly, [q.x, q.y]])
      } else if (!corner) setCorner(q)
      else if (Math.abs(corner.x - q.x) > 4 && Math.abs(corner.y - q.y) > 4) {
        const name = prompt('Название комнаты') || ''
        upd((x) => x.rooms.push({ id: uid(), name, shape, x: Math.min(corner.x, q.x), y: Math.min(corner.y, q.y), w: Math.abs(corner.x - q.x), h: Math.abs(corner.y - q.y) }))
        setCorner(null)
      }
    } else if (tool === 'select') setSel(null)
  }

  const putPlan = async (f) => {
    if (!f) return
    try {
      setSt('Загрузка плана…')
      const { blob, w, h } = await resize(f, 2000)
      const url = await upload(blob)
      upd((x) => { x.plan = { ...x.plan, w, h, bg: url, mpp: undefined } }); setSt('')
    } catch (e) { setSt('Ошибка: ' + e.message) }
  }
  const putPano = async (nid, blob) => {
    try {
      setSt('Загрузка панорамы…')
      const url = await upload(blob)
      upd((x) => { x.nodes.find((n) => n.id === nid).pano = { url, hotspots: [] } }); setSt('')
    } catch (e) { setSt('Ошибка: ' + e.message) }
  }
  const publish = async () => {
    const r = await api('/maps/' + id, { method: 'PUT', json: { published: !m.published } })
    setM((o) => ({ ...o, published: r.published }))
  }
  const url = `${location.origin}/#/m/${id}`
  const withPano = d.nodes.filter((n) => n.pano && n.id !== sel)

  return (
    <div className="full">
      <div className="bar">
        <button className="g" onClick={() => (location.hash = '#/')}>←</button>
        <input value={m.title} onChange={(e) => { setM({ ...m, title: e.target.value }); setDirty(true) }} />
        <small style={{ whiteSpace: 'nowrap' }}>{st}</small>
      </div>
      <div className="bar">
        <button className="g" onClick={() => planFile.current.click()}>🗺 План</button>
        <input ref={planFile} type="file" accept="image/*" hidden onChange={(e) => putPlan(e.target.files[0])} />
        <small>Ширина, м</small>
        <input type="number" style={{ width: 80, minWidth: 80 }} value={Math.round(d.plan.w * mpp)}
          onChange={(e) => upd((x) => { x.plan.mpp = (+e.target.value || 1) / x.plan.w })} />
        <select value={grid} style={{ width: 110, minWidth: 110 }} onChange={(e) => setGrid(+e.target.value)}>
          <option value={0}>Без сетки</option><option value={10}>Сетка 10</option><option value={20}>Сетка 20</option><option value={50}>Сетка 50</option>
        </select>
        <button className="g" onClick={publish}>{m.published ? '🟢 Опубликована' : '⚪ Опубликовать'}</button>
        <button className="g" onClick={() => (navigator.clipboard ? navigator.clipboard.writeText(url) : prompt('Ссылка', url))}>🔗 Ссылка</button>
        <button className="g" onClick={() => window.open(url, '_blank')}>👁</button>
      </div>
      <Plan data={d} selected={sel} showWay onItem={tap} onBg={(p) => tap(null, null, p)} grid={grid}
        draft={tool === 'room' ? { pts: shape === 'poly' ? poly : corner ? [[corner.x, corner.y]] : [] } : null}
        onDrag={tool === 'select' ? (nid, p) => upd((x) => { const n = x.nodes.find((q) => q.id === nid), q = sn(p); n.x = q.x; n.y = q.y }) : undefined} />
      <div className="bar">
        {TOOLS.map(([t, i, l]) => <button key={t} className={tool === t ? '' : 'g'} onClick={() => pick(t)}>{i} {l}</button>)}
      </div>
      {node ? (
        <div className="sheet">
          <div className="row"><b style={{ flex: 1 }}>{node.t === 'p' ? 'Точка' : 'Точка коридора'}</b><button className="g" onClick={() => setSel(null)}>✕</button></div>
          {node.t === 'p' && <>
            <input placeholder="Название" value={node.name || ''} onChange={(e) => setN({ name: e.target.value })} />
            <select value={node.cat} onChange={(e) => setN({ cat: e.target.value })}>
              {Object.entries(CATS).map(([k, [i, l]]) => <option key={k} value={k}>{i} {l}</option>)}
            </select>
            <textarea rows={2} placeholder="Описание" value={node.desc || ''} onChange={(e) => setN({ desc: e.target.value })} />
          </>}
          <div className="row">
            {node.pano && <button onClick={() => setModal({ k: 'spots' })}>🏷 Метки ({node.pano.hotspots.length})</button>}
            <button className="g" onClick={() => setModal({ k: 'shoot', nid: node.id })}>📷 {node.pano ? 'Переснять' : 'Снять панораму'}</button>
            <button className="g" onClick={() => panoFile.current.click()}>🖼 {node.pano ? 'Заменить' : 'Загрузить готовую'}</button>
            <input ref={panoFile} type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files[0], nid = node.id; e.target.value = ''
              if (f) { const { blob } = await resize(f, 4096); putPano(nid, blob) }
            }} />
            {node.pano && <button className="g" onClick={() => setN({ pano: undefined })}>Убрать панораму</button>}
          </div>
        </div>
      ) : <div className="sheet">
          {tool === 'room' && <div className="row">
            {[['rect', '▭ Прямоугольник'], ['ellipse', '◯ Овал'], ['poly', '⬠ Многоугольник']].map(([k, l]) => (
              <button key={k} className={shape === k ? '' : 'g'} onClick={() => { setShape(k); setCorner(null); setPoly([]) }}>{l}</button>))}
            {shape === 'poly' && <><button disabled={poly.length < 3} onClick={finishPoly}>Готово</button><button className="g" onClick={() => setPoly(poly.slice(0, -1))}>↩</button></>}
          </div>}
          <small>{tool === 'room' ? (shape === 'poly' ? 'Тапайте вершины; «Готово» или тап по первой вершине замкнёт контур' : corner ? 'Теперь противоположный угол' : 'Тап по двум противоположным углам') : HINT[tool]}</small>
        </div>}

      {modal?.k === 'shoot' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 30 }}>
          <PanoCapture onDone={(b) => setModal((o) => ({ ...o, blob: b }))} />
          <button className="g" style={{ position: 'fixed', top: 10, right: 10, zIndex: 31 }} onClick={() => setModal(null)}>✕</button>
          {modal.blob && (
            <div className="bar" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 32 }}>
              <button style={{ flex: 1 }} onClick={() => { putPano(modal.nid, modal.blob); setModal(null) }}>Использовать</button>
              <button className="g" onClick={() => setModal(null)}>Отмена</button>
            </div>
          )}
        </div>
      )}
      {modal?.k === 'spots' && node?.pano && (
        <PanoEditor node={node} others={withPano} onClose={() => setModal(null)}
          onChange={(hs) => upd((x) => { x.nodes.find((n) => n.id === sel).pano.hotspots = hs })} />
      )}
    </div>
  )
}
