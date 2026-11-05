/*
 * Runcastle's service worker (agents-can-notify-your-phone): the background
 * script a phone's browser keeps. It does three things and caches nothing, so it
 * can never serve a stale app.
 *
 * - A push becomes a notification. Browsers require one for every push.
 * - A tap opens the chat that sent it (decision 4).
 * - A page that cannot load gets a "can't reach your computer" page rather than
 *   the browser's error (decision 4). Every other request passes straight by.
 *
 * Plain JavaScript in public/, so it is served as is from the root and its scope
 * is the whole app.
 */

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#04060b">
<title>Runcastle</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-content: center; gap: 16px;
    padding: 24px; box-sizing: border-box; text-align: center;
    background: #04060b; color: #eceef4;
    font: 15px/22px system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; }
  p { margin: 0; color: #a9b1c1; }
  button {
    justify-self: center; height: 44px; padding: 0 20px; border: 0; border-radius: 10px;
    background: #eceef4; color: #04060b; font: inherit; font-weight: 500;
  }
</style>
</head>
<body>
  <h1>Can’t reach your computer</h1>
  <p>It may be asleep, or Tailscale is off on this phone.</p>
  <button onclick="location.reload()">Try again</button>
</body>
</html>`

/** Tailscale answers these itself while the machine is up but runcastle is not. */
const GATEWAY_FAILURES = [502, 503, 504]

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const { title, body, url } = event.data.json()
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      data: { url },
    }),
  )
})

/** Bring an open runcastle to the address, or open one. */
async function openAddress(address) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    try {
      await client.focus()
      await client.navigate(address)
      return
    } catch {
      // A window this worker does not control refuses to be navigated; try the next.
    }
  }
  await self.clients.openWindow(address)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const address = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(openAddress(address))
})

function offlinePage() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

async function loadPage(request) {
  try {
    const response = await fetch(request)
    return GATEWAY_FAILURES.includes(response.status) ? offlinePage() : response
  } catch {
    return offlinePage()
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(loadPage(event.request))
})
