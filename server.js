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
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!email || !password) {
        sendJson(res, 400, { error: 'Email and password are required' })
        return
      }

      const store = readStore()
      const user = store.users.find((item) => item.email === email && item.passwordHash === hashPassword(password))
      if (!user) {
        sendJson(res, 401, { error: 'Invalid credentials' })
        return
      }

      sendJson(res, 200, { token: user.token, user: { id: user.id, email: user.email } })
      return
    }

    if (req.method === 'POST' && route === '/auth/register') {
      const body = await parseJsonBody(req)
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!email || !password || password.length < 6) {
        sendJson(res, 400, { error: 'Email and password (min 6 chars) are required' })
        return
      }

      const store = readStore()
      const exists = store.users.some((user) => user.email === email)
      if (exists) {
        sendJson(res, 409, { error: 'User already exists' })
        return
      }

      const newUser = {
        id: uid('user'),
        email,
        passwordHash: hashPassword(password),
        token: `tok_${crypto.randomBytes(18).toString('hex')}`,
      }

      store.users.push(newUser)
      writeStore(store)
      sendJson(res, 201, { token: newUser.token, user: { id: newUser.id, email: newUser.email } })
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
      const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'jpg'
      const fileName = `${uid('upload')}.${extension}`
      const filePath = path.join(UPLOAD_DIR, fileName)
      fs.writeFileSync(filePath, buffer)

      sendJson(res, 200, { url: `/uploads/${fileName}` })
      return
    }

    const user = isAuthenticated(req)
    if (!user && route !== '/maps') {
      const allowAnonymousGetMap = req.method === 'GET' && route.startsWith('/maps/')
      if (!allowAnonymousGetMap) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }
    }

    if (req.method === 'GET' && route === '/maps') {
      const store = readStore()
      const maps = store.maps.filter((map) => map.userId === user.id)
      sendJson(res, 200, maps.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)))
      return
    }

    if (req.method === 'POST' && route === '/maps') {
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
      // Владелец или опубликованная карта
      if ((user && map.userId === user.id) || map.published) {
        sendJson(res, 200, map)
        return
      }
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }

    if (req.method === 'PUT') {
      if (!map) {
        sendJson(res, 404, { error: 'Map not found' })
        return
      }
      if (map.userId !== user.id) {
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
      if (map.userId !== user.id) {
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
