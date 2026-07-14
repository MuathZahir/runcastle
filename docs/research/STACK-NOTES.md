# Stack Notes — runcastle (researched 2026-07-14)

Wiring patterns + exact current versions for Hono-on-Bun, tRPC v11, Drizzle ORM
(bun:sqlite), Vite + React 19, and `@modelcontextprotocol/sdk`. Sourced via ctx7
against each library's official docs/repo, cross-checked against npm `latest`
dist-tags on 2026-07-14. Re-check versions before a fresh scaffold months from now.

## Version pins (npm `latest` as of 2026-07-14)

| package | version |
|---|---|
| hono | 4.12.30 |
| @trpc/server / @trpc/client / @trpc/react-query | 11.18.0 |
| @hono/trpc-server | 0.4.2 |
| @tanstack/react-query | 5.101.2 |
| drizzle-orm | 0.45.2 |
| drizzle-kit | 0.31.10 |
| vite | 8.1.4 |
| react / react-dom | 19.2.7 |
| @vitejs/plugin-react | 6.0.3 |
| @modelcontextprotocol/sdk | 1.29.0 |
| @hono/mcp | 0.3.1 |
| zod | 4.4.3 |
| bun-types | 1.3.14 |

---

## 1. Hono on Bun

```
bun add hono
```

Bun runs Hono via its own `Bun.serve`-compatible export shape — no separate adapter
package needed. Export an object with `fetch` (and optionally `port`) instead of the
`app` instance directly:

```ts
// src/index.ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hello Bun!'))

export default {
  port: 3000,
  fetch: app.fetch,
}
```

Run with `bun run src/index.ts` (or `bun --hot`). No explicit `Bun.serve()` call
needed — Bun detects the default export shape.

### Mounting sub-routes

```ts
// index.ts
import { Hono } from 'hono'
import authors from './authors'
import books from './books'

const app = new Hono()
app.route('/authors', authors)
app.route('/books', books)

export default app
```

Each sub-router is its own `new Hono()` instance exporting `default app`;
`app.route(prefix, subApp)` mounts it.

### SSE endpoint (nice-to-have)

```ts
import { streamSSE } from 'hono/streaming'

app.get('/sse', async (c) => {
  let id = 0
  return streamSSE(c, async (stream) => {
    while (!stream.aborted) {
      await stream.writeSSE({ data: new Date().toISOString(), event: 'tick', id: String(id++) })
      await stream.sleep(1000)
    }
  })
})
```

Note: the built-in `timeout` middleware can't wrap SSE streams; use `stream.onAbort()`
+ a manual `setTimeout` → `stream.close()` if needed. Runcastle is polling-first, so
treat this as optional.

---

## 2. tRPC v11 on Hono + React client (TanStack Query v5)

```
bun add @trpc/server @trpc/client @hono/trpc-server zod
bun add @trpc/react-query @tanstack/react-query   # client workspace
```

### Server: router + zod validation

```ts
// server/router.ts
import { initTRPC } from '@trpc/server'
import * as z from 'zod'

const t = initTRPC.create()
const publicProcedure = t.procedure

export const appRouter = t.router({
  hello: publicProcedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => ({ greeting: `hello ${input.text}` })),
})

export type AppRouter = typeof appRouter
```

### Mounting on Hono — `@hono/trpc-server` (the recommended adapter)

```ts
// server/index.ts
import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import { appRouter } from './router'

const app = new Hono()

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
  })
)

export default { port: 3000, fetch: app.fetch }
```

Exposes procedures at `/trpc/*` via the standard tRPC HTTP protocol (batched
GET/POST). No `express`/`node-server` adapter needed — `@hono/trpc-server` is
purpose-built for Hono and is the current recommended way to mount tRPC there.

### React client (Vite app) — `@trpc/react-query` + TanStack Query v5

```ts
// src/utils/trpc.ts
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../server/router'

export const trpc = createTRPCReact<AppRouter>()
```

```tsx
// src/main.tsx
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { trpc } from './utils/trpc'
import App from './App'

function Root() {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [httpBatchLink({ url: 'http://localhost:3000/trpc' })] })
  )
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
    </trpc.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
```

Usage in a component, with polling:

```tsx
const { data } = trpc.hello.useQuery(
  { text: 'world' },
  { refetchInterval: 2000 } // plain TanStack Query v5 option, passed straight through
)
```

**Polling confirmation:** `refetchInterval` is a plain TanStack Query v5 option and
works unmodified through `@trpc/react-query` (it's `useQuery` underneath). Plain
`httpBatchLink` is sufficient — nothing subscription/WebSocket/SSE-specific is
needed. Skip `httpSubscriptionLink` and any `wsLink` entirely for this project.

---

## 3. Drizzle ORM + `bun:sqlite`

```
bun add drizzle-orm
bun add -D drizzle-kit
```

### Driver setup

```ts
// db/index.ts
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema'

const sqlite = new Database('runcastle.db')
export const db = drizzle({ client: sqlite, schema })
```

(Shorthand `drizzle(process.env.DB_FILE_NAME!)` also works if you don't need the raw
`Database` handle for anything else.)

### Schema definition

```ts
// db/schema.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const tasksTable = sqliteTable('tasks', {
  id: integer().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  done: integer({ mode: 'boolean' }).notNull().default(false),
})
```

### Migrations vs `push` — recommendation

For a local, single-user, desktop-style app that owns its own SQLite file (no
shared/prod DB, no team migration history to coordinate), **use `drizzle-kit push`**
instead of a migrations folder. It diffs `schema.ts` against the live `.db` file and
applies changes directly — simplest reliable option when there's no multi-environment
coordination problem to solve.

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  dbCredentials: {
    url: './runcastle.db',
  },
})
```

```
bunx drizzle-kit push
```

Run after any schema edit in dev. Only switch to `migrations/` + `drizzle-kit
generate` + `migrate()` if runcastle later needs versioned upgrades applied to a
user's *existing* installed database — the one case `push` doesn't cover.

---

## 4. Vite + React 19 scaffold (Bun workspace)

```
bun create vite my-app --template react-ts
```

Generated deps (React 19 + Vite 8 template, current defaults): `react`/`react-dom`
`^19.2.7`, `@vitejs/plugin-react` `^6.0.3`, `vite` `^8.1.1`, `typescript` `~6.0.2`.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

### Bun workspace gotcha: `workspace:*` protocol

Bun **fully supports** the `workspace:*` protocol natively — no gotcha to work
around. Root `package.json`: `"workspaces": ["apps/*", "packages/*"]`. Any
workspace package can then reference another local one directly:

```json
// apps/web/package.json
{ "name": "web", "dependencies": { "shared": "workspace:*" } }
```

`bun install` from the repo root resolves `workspace:*` deps to the local symlinked
package rather than hitting the npm registry. Real gotcha: Bun resolves workspace
deps by a hash of the package **name** — rename a workspace package and a stale
reference elsewhere silently falls through to an npm registry lookup instead of
erroring, so update every `workspace:*` reference immediately on rename.

---

## 5. `@modelcontextprotocol/sdk` — MCP server with tools over Streamable HTTP

```
bun add @modelcontextprotocol/sdk @hono/mcp zod
```

**Important version note:** `@modelcontextprotocol/sdk` is the stable v1.x line,
currently `1.29.0` — install this one. A *separate*, newer package,
`@modelcontextprotocol/server` (currently `2.0.0-beta.4`), is a from-scratch
rewrite/split (separate server/client/hono packages, a different `registerTool`
config-object API) — still beta, **not** what `npm install @modelcontextprotocol/sdk`
gives you. Most fresh examples online (and some ctx7 hits during this research) are
already written against the v2 beta name — double-check before trusting a snippet.

### Server with a tool (zod schema)

```ts
// mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

export const mcpServer = new McpServer({
  name: 'runcastle-mcp',
  version: '1.0.0',
})

mcpServer.registerTool(
  'list-tasks',
  { description: 'List tasks in runcastle', inputSchema: { status: z.enum(['open', 'done']).optional() } },
  async ({ status }) => ({ content: [{ type: 'text', text: JSON.stringify(await queryTasks(status)) }] })
)
```

### Exposing it over Streamable HTTP — `@hono/mcp` adapter (yes, it exists)

`@hono/mcp` (0.3.1) is the Hono adapter built for the **stable** `@modelcontextprotocol/sdk`
(peer dep: `@modelcontextprotocol/sdk ^1.29.0`) — this is the one to use, not
`@modelcontextprotocol/hono` (that belongs to the v2 beta package family above).

```ts
// mcp/index.ts
import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { mcpServer } from './server'

const app = new Hono()
const transport = new StreamableHTTPTransport()

app.all('/mcp', async (c) => {
  if (!mcpServer.isConnected()) {
    await mcpServer.connect(transport)
  }
  return transport.handleRequest(c)
})

export default app
```

Mount this sub-app onto the main Hono app the same way as any other sub-route
(`app.route('/mcp', mcpApp)`, per section 1).

`StreamableHTTPTransport` takes an optional `{ strictAcceptHeader: true }` (default
`false`) to force strict `Accept` header validation per the MCP spec; leave it at
the permissive default unless a client needs strict compliance. Without Hono, the
SDK's own `StreamableHTTPServerTransport` (from `.../server/streamableHttp.js`)
works directly against a `Request`/`Response` pair, taking a `sessionIdGenerator`.

`zod` compatibility: `@modelcontextprotocol/sdk@1.29.0` declares
`zod: "^3.25 || ^4.0"` as both dependency and peer dependency, so current
`zod@4.4.3` is fine — no downgrade needed.

---

## Surprises worth flagging back to the team

1. **MCP SDK is mid-split.** `@modelcontextprotocol/sdk` (stable, 1.29.0) vs
   `@modelcontextprotocol/server` (beta, 2.0.0-beta.4) — different packages,
   different APIs. Same split for the Hono adapter: `@hono/mcp` (stable) vs
   `@modelcontextprotocol/hono` (beta). Section 5 targets the stable pair; re-check
   before scaffolding in case v2 has since gone stable.
2. Everything else here (Hono-on-Bun, tRPC v11 + `@hono/trpc-server`, Drizzle
   `bun-sqlite`, Vite React 19 scaffold, Bun `workspace:*`) is stable and
   well-documented — no gotchas beyond what's noted inline above.
