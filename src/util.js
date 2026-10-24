export const CATS = {
  entrance: ['🚪', 'Вход'], hall: ['🏛️', 'Зал'], stand: ['🎪', 'Стенд'], service: ['🛎️', 'Сервис'],
  wifi: ['📶', 'Wi-Fi'], wc: ['🚻', 'Туалет'], food: ['🍽️', 'Еда'], other: ['📍', 'Другое'],
}
export const icon = (n) => (CATS[n.cat] || CATS.other)[0]
export const uid = () => Math.random().toString(16).slice(2, 10)
export const EMPTY = () => ({ plan: { w: 1000, h: 700 }, rooms: [], nodes: [], edges: [] })

// уменьшаем картинку перед загрузкой (скорость загрузки карт и панорам)
export async function resize(file, max, q = 0.85) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  return { blob: await new Promise((r) => c.toBlob(r, 'image/jpeg', q)), w: c.width, h: c.height }
}
