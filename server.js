import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 3000)
const DATA_DIR = path.join(__dirname, 'data')
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const STORE_PATH = path.join(DATA_DIR, 'store.json')

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ users: [], maps: [] }, null, 2))
  }
}

function readStore() {
  ensureStorage()
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return { users: [], maps: [] }
  }
}

function writeStore(store) {
  ensureStorage()
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2))
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex')
}

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function isAuthenticated(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  const store = readStore()
  return store.users.find((user) => user.token === token) || null
}

function getMapById(store, id) {
  return store.maps.find((map) => map.id === id)
}

function canAccessMap(user, map) {
  if (!map) return false
  if (map.published) return true
  return !!(user && map.userId === user.id)
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.css': 'text/css',
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'File not found' })
      return
    }

    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

function findRoute(data, fromId, toId) {
  const nodes = data.nodes || []
  const edges = data.edges || []
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]))

  if (!nodeMap[fromId] || !nodeMap[toId]) {
    return { error: 'Unknown node' }
  }

  if (fromId === toId) {
    return { nodes: [nodeMap[fromId]], length: 0 }
  }

  const adj = {}
  for (const n of nodes) adj[n.id] = []
  for (const e of edges) {
    if (!nodeMap[e.a] || !nodeMap[e.b]) continue
    const dx = nodeMap[e.a].x - nodeMap[e.b].x
    const dy = nodeMap[e.a].y - nodeMap[e.b].y
    const dist = Math.hypot(dx, dy)
    adj[e.a].push({ id: e.b, dist })
    adj[e.b].push({ id: e.a, dist })
  }

  const dist = {}
  const prev = {}
  const visited = new Set()
  for (const n of nodes) dist[n.id] = Infinity
  dist[fromId] = 0

  const pq = [{ id: fromId, d: 0 }]
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d)
    const { id: u, d } = pq.shift()
    if (visited.has(u)) continue
    visited.add(u)
    if (u === toId) break
    for (const { id: v, dist: w } of adj[u] || []) {
      const nd = d + w
      if (nd < dist[v]) {
        dist[v] = nd
        prev[v] = u
        pq.push({ id: v, d: nd })
      }
    }
  }

  if (dist[toId] === Infinity) {
    return { error: 'Route not found' }
  }

  const pathIds = []
  let cur = toId
  while (cur) {
    pathIds.push(cur)
    cur = prev[cur]
  }
  pathIds.reverse()

  return {
    nodes: pathIds.map((id) => nodeMap[id]),
    length: dist[toId],
  }
}

const server = http.createServer(async (req, res) => {
  ensureStorage()

  const { pathname } = new URL(req.url, `http://${req.headers.host}`)

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'ttk_hack-backend' })
    return
  }

  if (pathname.startsWith('/uploads/')) {
    const fileName = pathname.replace(/^\/uploads\//, '')
    const safePath = path.join(UPLOAD_DIR, fileName)
    if (!safePath.startsWith(UPLOAD_DIR)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    serveStaticFile(res, safePath)
    return
  }

  if (!pathname.startsWith('/api')) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  const route = pathname.replace(/^\/api/, '') || '/'

  try {
    if (req.method === 'POST' && route === '/auth/login') {
      const body = await parseJsonBody(req)
      const name = String(body.name || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!name || !password) {
        sendJson(res, 400, { error: 'Name and password are required' })
        return
      }

      const store = readStore()
      const user = store.users.find(
        (item) => item.name === name && item.passwordHash === hashPassword(password),
      )
      if (!user) {
        sendJson(res, 401, { error: 'Invalid credentials' })
        return
      }

      sendJson(res, 200, { token: user.token, user: { id: user.id, name: user.name } })
      return
    }

    if (req.method === 'POST' && route === '/auth/register') {
      const body = await parseJsonBody(req)
      const name = String(body.name || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!name || !password || password.length < 6) {
        sendJson(res, 400, { error: 'Name and password (min 6 chars) are required' })
        return
      }

      const store = readStore()
      const exists = store.users.some((user) => user.name === name)
      if (exists) {
        sendJson(res, 409, { error: 'User already exists' })
        return
      }

      const newUser = {
        id: uid('user'),
        name,
        passwordHash: hashPassword(password),
        token: `tok_${crypto.randomBytes(18).toString('hex')}`,
      }

      store.users.push(newUser)
      writeStore(store)
      sendJson(res, 201, { token: newUser.token, user: { id: newUser.id, name: newUser.name } })
      return
    }

    if (req.method === 'POST' && route === '/upload') {
      const user = isAuthenticated(req)
      if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }

      const chunks = []
      await new Promise((resolve, reject) => {
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', resolve)
        req.on('error', reject)
      })

      const buffer = Buffer.concat(chunks)
      if (!buffer.length) {
        sendJson(res, 400, { error: 'Empty upload' })
        return
      }

      const contentType = String(req.headers['content-type'] || 'application/octet-stream')
      const extension = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('gif')
            ? 'gif'
            : 'jpg'
      const fileName = `${uid('upload')}.${extension}`
      const filePath = path.join(UPLOAD_DIR, fileName)
      fs.writeFileSync(filePath, buffer)

      sendJson(res, 200, { url: `/uploads/${fileName}` })
      return
    }

    const user = isAuthenticated(req)
    if (!user && route !== '/maps') {
      const allowAnonymous =
        req.method === 'GET' &&
        (route.startsWith('/maps/') || route.match(/^\/maps\/[^/]+\/route$/))
      if (!allowAnonymous) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }
    }

    if (req.method === 'GET' && route === '/maps') {
      if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }
      const store = readStore()
      const maps = store.maps.filter((map) => map.userId === user.id)
      sendJson(
        res,
        200,
        maps.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
      )
      return
    }

    if (req.method === 'POST' && route === '/maps') {
      if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }
      const body = await parseJsonBody(req)
      const store = readStore()
      const map = {
        id: uid('map'),
        userId: user.id,
        title: String(body.title || 'Новая карта'),
        published: Boolean(body.published),
        data: body.data || { plan: { w: 1000, h: 700 }, rooms: [], nodes: [], edges: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      store.maps.push(map)
      writeStore(store)
      sendJson(res, 201, map)
      return
    }

    // GET /maps/:id/route?from=...&to=...
    const routeMatch = route.match(/^\/maps\/([^/]+)\/route$/)
    if (routeMatch) {
      const mapId = routeMatch[1]
      const store = readStore()
      const map = getMapById(store, mapId)

      if (!map) {
        sendJson(res, 404, { error: 'Map not found' })
        return
      }
      if (!canAccessMap(user, map)) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' })
        return
      }

      const url = new URL(req.url, `http://${req.headers.host}`)
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')

      if (!from || !to) {
        sendJson(res, 400, { error: 'from and to are required' })
        return
      }

      const result = findRoute(map.data || {}, from, to)
      if (result.error) {
        sendJson(res, result.error === 'Unknown node' ? 400 : 404, { error: result.error })
        return
      }

      sendJson(res, 200, result)
      return
    }

    // CRUD /maps/:id
    const mapId = route.match(/^\/maps\/([^/]+)$/)?.[1]
    if (!mapId) {
      sendJson(res, 404, { error: 'Route not found' })
      return
    }

    const store = readStore()
    const map = getMapById(store, mapId)

    if (req.method === 'GET') {
      if (!map) {
        sendJson(res, 404, { error: 'Map not found' })
        return
      }
      if (!canAccessMap(user, map)) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }
      sendJson(res, 200, map)
      return
    }

    if (req.method === 'PUT') {
      if (!map) {
        sendJson(res, 404, { error: 'Map not found' })
        return
      }
      if (!user || map.userId !== user.id) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }

      const body = await parseJsonBody(req)
      const next = { ...map }
      if (body.title !== undefined) next.title = String(body.title)
      if (body.data !== undefined) next.data = body.data
      if (body.published !== undefined) next.published = Boolean(body.published)
      next.updatedAt = new Date().toISOString()

      const index = store.maps.findIndex((item) => item.id === mapId)
      store.maps[index] = next
      writeStore(store)
      sendJson(res, 200, next)
      return
    }

    if (req.method === 'DELETE') {
      if (!map) {
        sendJson(res, 404, { error: 'Map not found' })
        return
      }
      if (!user || map.userId !== user.id) {
        sendJson(res, 403, { error: 'Forbidden' })
        return
      }

      store.maps = store.maps.filter((item) => item.id !== mapId)
      writeStore(store)
      sendJson(res, 204, null)
      return
    }

    sendJson(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`)
})