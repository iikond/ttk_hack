import { useEffect, useReducer, useState } from 'react'
import { api, tok } from './api'
import { EMPTY } from './util'
import Editor from './Editor'
import Visitor from './Visitor'

const useHash = () => {
  const [h, setH] = useState(location.hash.slice(1) || '/')
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || '/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

function Login({ onAuth }) {
  const [name, setName] = useState(''), [password, setP] = useState(''), [err, setErr] = useState('')
  const go = async (kind) => {
    try {
      const r = await api('/auth/' + kind, { method: 'POST', json: { name, password } })
      tok.set(r.token); location.hash = '#/'; onAuth()
    } catch (e) { setErr(e.message) }
  }
  return (
    <div className="page" style={{ marginTop: '12vh' }}>
      <h2 style={{ margin: 0 }}>Карта пространства</h2>
      <div className="card">
        <b>Вход для организаторов</b>
        <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Пароль (от 6 символов)" type="password" value={password} onChange={(e) => setP(e.target.value)} />
        {err && <small style={{ color: '#e5484d' }}>{err}</small>}
        <div className="row">
          <button onClick={() => go('login')}>Войти</button>
          <button className="g" onClick={() => go('register')}>Регистрация</button>
        </div>
      </div>
      <small>Посетителям вход не нужен: откройте ссылку на карту от организатора.</small>
    </div>
  )
}

function Dashboard() {
  const [maps, setMaps] = useState(null), [err, setErr] = useState('')
  const load = () => api('/maps').then(setMaps).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  const link = (id) => `${location.origin}/#/m/${id}`
  const copy = (t) => (navigator.clipboard ? navigator.clipboard.writeText(t) : prompt('Скопируйте', t))
  const create = async () => {
    const m = await api('/maps', { method: 'POST', json: { title: 'Новая карта', data: EMPTY() } })
    location.hash = '#/edit/' + m.id
  }
  const toggle = async (m) => { await api('/maps/' + m.id, { method: 'PUT', json: { published: !m.published } }); load() }
  const del = async (m) => { if (confirm('Удалить карту «' + m.title + '»?')) { await api('/maps/' + m.id, { method: 'DELETE' }); load() } }
  return (
    <div className="page">
      <div className="row"><h2 style={{ margin: 0, flex: 1 }}>Мои карты</h2>
        <button onClick={create}>+ Новая</button>
        <button className="g" onClick={() => { tok.set(null); location.hash = '#/'; location.reload() }}>Выйти</button></div>
      {err && <small style={{ color: '#e5484d' }}>{err}</small>}
      {maps?.length === 0 && <div className="card">Карт пока нет. Создайте первую.</div>}
      {maps?.map((m) => (
        <div className="card" key={m.id}>
          <b>{m.title} {m.published ? '🟢' : '⚪'}</b>
          <div className="row">
            <button onClick={() => (location.hash = '#/edit/' + m.id)}>Редактор</button>
            <button className="g" onClick={() => (location.hash = '#/m/' + m.id)}>Просмотр</button>
            <button className="g" onClick={() => toggle(m)}>{m.published ? 'Снять с публикации' : 'Опубликовать'}</button>
          </div>
          <div className="row">
            <button className="g" onClick={() => copy(link(m.id))}>🔗 Ссылка</button>
            <button className="g" onClick={() => copy(`<iframe src="${link(m.id)}?embed=1" style="width:100%;height:600px;border:0" allow="fullscreen"></iframe>`)}>{'</>'} Код для сайта</button>
            <button className="g r" style={{ color: '#fff', background: '#e5484d' }} onClick={() => del(m)}>Удалить</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const h = useHash(), [, force] = useReducer((x) => x + 1, 0)
  const [path, qs = ''] = h.split('?'), m = path.match(/^\/(m|edit)\/(\w+)/)
  if (m?.[1] === 'm') return <Visitor key={m[2]} id={m[2]} embed={qs.includes('embed')} />
  if (!tok.get()) return <Login onAuth={force} />
  if (m) return <Editor key={m[2]} id={m[2]} />
  return <Dashboard />
}
