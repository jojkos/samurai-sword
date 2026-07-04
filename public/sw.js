/* Minimal service worker — just enough to make the game installable as a PWA
   and give the app shell a fast/offline-tolerant load. Deliberately lean:
   - HTML/navigation is network-FIRST, so a fresh deploy is never masked by a
     stale cached shell (the exact "why isn't my change showing" trap).
   - Vite's content-hashed assets are cache-first (a new build = new filenames,
     so this can never serve stale code).
   - Cross-origin traffic (PeerJS broker, anything not same-origin) and
     non-GET requests are passed straight through, untouched. */
const CACHE = 'samurai-sword-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never touch the PeerJS broker etc.

  const isNav = req.mode === 'navigate'
  if (isNav) {
    // network-first: always try for the freshest shell, fall back to cache offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('./'))),
    )
    return
  }

  // static assets: cache-first (hashed filenames make this safe)
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        }),
    ),
  )
})
