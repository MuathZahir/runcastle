/**
 * Serves `site/` for design review, with caching off: a phone or browser that
 * opened a page once must never keep showing that copy after the page changes.
 * Run by the feature's design server: `bun .runcastle/site-design-server.ts`.
 */
import { existsSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'site')
const port = Number(process.env.RUNCASTLE_DESIGN_PORT ?? 4600)

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname))
    let file = join(root, path)
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 })
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return new Response('Not found', { status: 404 })
    const headers = { 'Cache-Control': 'no-store' }
    if (file.endsWith('.html')) {
      // A copy a browser saved before caching was off is still reused for the
      // same address: mark every stylesheet and script with its file's age, so
      // a changed one is a new address.
      const html = (await Bun.file(file).text()).replace(
        /(href|src)="(\/[^"?#]+\.(?:css|js))"/g,
        (_, attr: string, asset: string) => {
          const on = join(root, asset)
          const v = existsSync(on) ? Math.floor(statSync(on).mtimeMs) : 0
          return `${attr}="${asset}?v=${v}"`
        },
      )
      return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html;charset=utf-8' } })
    }
    return new Response(Bun.file(file), { headers })
  },
})

console.log(`site design server on http://localhost:${server.port}/`)
