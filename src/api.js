export const tok = {
  get: () => localStorage.getItem('tok'),
  set: (t) => (t ? localStorage.setItem('tok', t) : localStorage.removeItem('tok')),
}

export async function api(path, { method = 'GET', json, blob } = {}) {
  const h = {}, t = tok.get()
  if (t) h.Authorization = 'Bearer ' + t
  let body
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json) }
  if (blob) { h['Content-Type'] = blob.type; body = blob }
  const r = await fetch('/api' + path, { method, headers: h, body })
  if (r.status === 204) return null
  const d = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401 && t) { tok.set(null); location.hash = '#/login' }
    throw new Error(d.error || r.status)
  }
  return d
}
export const upload = async (blob) => (await api('/upload', { method: 'POST', blob })).url
