import { openNotes } from './notes.ts'

const store = openNotes(process.env.NOTES_DB ?? 'data/notes.db')
const port = Number(process.env.PORT ?? 3000)

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function page(): Response {
  const items = store
    .list()
    .map((n) => `<li>${escape(n.body)} <small>${n.createdAt}</small></li>`)
    .join('')
  const html = `<!doctype html><title>Tiny notes</title>
<h1>Tiny notes</h1>
<form method="post" action="/notes"><input name="body" autofocus><button>Add</button></form>
<ul>${items}</ul>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/notes') {
      const form = await req.formData()
      try {
        store.add(String(form.get('body') ?? ''))
      } catch {
        return new Response('A note cannot be empty', { status: 400 })
      }
      return Response.redirect(new URL('/', req.url).toString(), 303)
    }
    if (url.pathname === '/') return page()
    return new Response('Not found', { status: 404 })
  },
})

console.log(`tiny-notes listening on http://localhost:${port}`)
