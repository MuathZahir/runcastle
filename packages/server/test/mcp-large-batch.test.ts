import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { Ticket, TicketInput } from '@runcastle/core'
import { RuncastleConfig } from '@runcastle/core'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../src/db/schema'
import type { AppCtx, Db } from '../src/db/types'
import { listByFeature } from '../src/services/tickets'
import { resolveBun } from './helpers/bun'

/**
 * `emit_tickets` with a fully-enriched batch, over a REAL TCP socket.
 *
 * Why this test is shaped so awkwardly: every other MCP test in this suite mounts
 * the Hono app in-process (`app.fetch(new Request(...))`), which never touches a
 * socket, a `Content-Length`, or Bun's request-body reader — precisely the layer
 * the reported stall lives at. And the suite runs under node (`helpers/db.ts`),
 * where `Bun.serve` is not even a global. So the server is a spawned bun child
 * (`fixtures/mcp-tcp-server.ts`) wired the production way, and the client is this
 * node process — which is the realistic pairing, since Claude Code's `type: "http"`
 * MCP transport is the node/undici `@modelcontextprotocol/sdk` client.
 *
 * ── Failing-first evidence (2026-09-09, linux x64, bun 1.3.14, @hono/mcp 0.3.1,
 *    @modelcontextprotocol/sdk 1.29.0) ──────────────────────────────────────────
 *
 * The stall DID NOT REPRODUCE against the unfixed stack. Every payload size and
 * every framing below returned 200 with all tickets stored, in 12–60ms; the
 * largest call measured was 654KB / 175 tickets at 23ms. What was swept, against
 * this same fixture server:
 *
 *   • sizes 1, 4, 8, 10, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512KB
 *     — well past the ~10KB the incident reported and the 15KB/45KB batches that
 *     actually failed on 2026-08-29;
 *   • `fetch` with `Content-Length`, and `fetch` with a `ReadableStream` body
 *     (chunked transfer-encoding), on pooled keep-alive connections;
 *   • raw `net.Socket` writes at 512B / 1400B / 64KB segments, with 0/1/2ms gaps
 *     between segments, in both `Content-Length` and chunked framing — i.e. real
 *     multi-packet bodies with real boundaries, which a localhost `fetch` cannot
 *     produce;
 *   • `Expect: 100-continue` (Bun never sends the interim `100`, but accepts the
 *     body anyway — a client that blocks waiting for it would hang, which is a
 *     latent hazard, not the observed one);
 *   • the same, with a `/mcp` SSE GET stream and an `/api/stream` SSE stream held
 *     open concurrently;
 *   • the same, with 8/32/64 concurrent `tools/list` calls saturating the server's
 *     event loop (`tools/list` rebuilds the whole tool server per request and is
 *     the handler's synchronous hot spot).
 *   • the real `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` — the
 *     exact client Claude Code uses — at 6/12/15/45/64/128/256/512KB.
 *
 * RESIDUAL GAP: the incident host is Windows, and this sandbox is linux. A
 * win32-only fault in Bun's socket read path is the one hypothesis this sweep
 * cannot rule out, and no `@hono/mcp` / MCP-SDK release notes indict a large-body
 * bug (0.3.2, the only newer `@hono/mcp`, only adds `onsessiondisconnected`), so
 * no dependency bump was confirmed. The other standing hypothesis is the client,
 * where the same symptom is reported open upstream — anthropics/claude-code
 * https://github.com/anthropics/claude-code/issues/86314 (a large tool-input
 * argument silently stalls the client's stream before the call is dispatched) and
 * https://github.com/anthropics/claude-code/issues/72228 (parameters after a long
 * one are dropped client-side); neither is reachable from this test, which drives
 * the transport directly. The fix therefore landed at the one layer this
 * repo owns and the sweep showed was structurally at risk — see the body pre-read
 * in `src/mcp/server.ts`. This test stands as the 256KB guard regardless.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/mcp-tcp-server.ts', import.meta.url))

/**
 * The bar from the feature spec: a 256KB batch must come back in seconds, well
 * under any MCP client's tool timeout. Enforced as a hard `AbortSignal.timeout`
 * so a regression shows up as a failed call rather than a slow suite.
 */
const CLIENT_TIMEOUT_MS = 5_000
const TARGET_BYTES = 256 * 1024
const TICKET_COUNT = 12

const BUN = resolveBun()

interface BootLine {
  port: number
  featureId: string
  sessionId: string
  repoPath: string
}

interface TcpServer extends BootLine {
  dbFile: string
  /** Resolve once the server has written something matching `re` to stderr. */
  waitForLog(re: RegExp, timeoutMs: number): Promise<string>
  stop(): Promise<void>
}

/** Boot the fixture server and wait for the one JSON line it prints. */
async function startTcpServer(bun: string): Promise<TcpServer> {
  const dbFile = join(mkdtempSync(join(tmpdir(), 'runcastle-mcp-tcp-')), 'runcastle.db')
  const child: ChildProcess = spawn(bun, [FIXTURE, dbFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  const watchers = new Set<() => void>()
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (c: string) => {
    stderr += c
    for (const notify of watchers) notify()
  })

  const boot = await new Promise<BootLine>((resolve, reject) => {
    const fail = (why: string): void => reject(new Error(`${why}\nfixture stderr:\n${stderr}`))
    const timer = setTimeout(() => fail('fixture never printed its boot line'), 30_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(`fixture exited (${code}) before booting`)
    })
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).once('line', (line) => {
      clearTimeout(timer)
      resolve(JSON.parse(line) as BootLine)
    })
  })

  return {
    ...boot,
    dbFile,
    waitForLog: (re, timeoutMs) =>
      new Promise<string>((resolve, reject) => {
        const check = (): void => {
          if (!re.test(stderr)) return
          watchers.delete(check)
          clearTimeout(timer)
          resolve(stderr)
        }
        const timer = setTimeout(() => {
          watchers.delete(check)
          reject(new Error(`server never logged ${re}. stderr was:\n${stderr}`))
        }, timeoutMs)
        watchers.add(check)
        check()
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.stdin?.write('shutdown\n')
        // Backstop: a fixture wedged in the very stall under test would never
        // read its stdin, and a leaked bun child outlives the whole suite.
        setTimeout(() => child.kill(), 5_000).unref()
      }),
  }
}

/** As much of an MCP reply as this test reads. */
interface McpResponse {
  result?: {
    serverInfo?: { name?: string }
    isError?: boolean
    content?: { text: string }[]
  }
}

/** What `emit_tickets` itself answers, inside the MCP envelope. */
interface EmitTicketsResult {
  stored: number
  tickets: { id: string; seq: number; title: string }[]
}

/** One JSON-RPC round trip over the socket, with the hard client deadline. */
async function rpc(server: TcpServer, body: unknown): Promise<McpResponse> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'X-Runcastle-Session': server.sessionId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  })
  expect(res.status, 'MCP endpoint did not answer 200').toBe(200)
  return (await res.json()) as McpResponse
}

/** The `emit_tickets` tool's own JSON payload, unwrapped from the MCP envelope. */
function emitResult(body: McpResponse): EmitTicketsResult {
  expect(body.result?.isError, `tool returned an error: ${JSON.stringify(body)}`).toBeFalsy()
  const text = body.result?.content?.[0]?.text
  expect(text, `no tool content in ${JSON.stringify(body)}`).toBeTypeOf('string')
  return JSON.parse(text as string) as EmitTicketsResult
}

/**
 * A batch shaped like a real fully-enriched one — long prose contexts, a
 * dependency chain — padded to roughly `TARGET_BYTES`.
 */
function enrichedBatch(): TicketInput[] {
  const perTicket = Math.round(TARGET_BYTES / TICKET_COUNT)
  return Array.from({ length: TICKET_COUNT }, (_, i) => ({
    title: `Ticket ${i + 1} — a fully enriched one`,
    goal: `Everything ticket ${i + 1} must achieve. `.repeat(20),
    // Non-ASCII on purpose: `Content-Length` is bytes, not characters, and a
    // length computed in UTF-16 units would truncate the body mid-read.
    context: `Context line for ticket ${i + 1} — ünïcode ✓\n`.repeat(Math.round(perTicket / 45)),
    acceptanceCriteria: [`Criterion A for ${i + 1}. `.repeat(10), `Criterion B for ${i + 1}.`],
    seams: [`seam/${i + 1}.ts`],
    blockedBy: i === 0 ? [] : [i],
  }))
}

/**
 * Send a POST whose `Content-Length` promises far more than it delivers, then
 * hang up — the wire shape of a body that stalls partway through. Needs a raw
 * socket: `fetch` will not lie about its own content length.
 */
function postTruncatedBody(server: TcpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect(server.port, '127.0.0.1')
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error('the server never let go of a truncated request'))
    }, CLIENT_TIMEOUT_MS)
    const done = (): void => {
      clearTimeout(timer)
      sock.destroy()
      resolve()
    }
    sock.on('close', done)
    // ECONNRESET is a fine outcome: there is nobody left to answer.
    sock.on('error', done)
    sock.on('connect', () => {
      sock.write(
        `${[
          'POST /mcp HTTP/1.1',
          `Host: 127.0.0.1:${server.port}`,
          'Content-Type: application/json',
          'Accept: application/json, text/event-stream',
          `X-Runcastle-Session: ${server.sessionId}`,
          'Content-Length: 5000',
          'Connection: close',
        ].join('\r\n')}\r\n\r\n`,
      )
      sock.end('x'.repeat(100))
    })
  })
}

/**
 * Read the tickets back through the ordinary service, from the same sqlite file
 * the server wrote. sql.js takes the file's bytes (the fixture keeps the db in
 * DELETE journal mode so there is no `-wal` sidecar to miss).
 */
async function readBackTickets(dbFile: string, featureId: string): Promise<Ticket[]> {
  const SQL = await initSqlJs()
  const db = drizzle(new SQL.Database(readFileSync(dbFile)), { schema }) as unknown as Db
  const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }
  return listByFeature(ctx, featureId)
}

// Skipped only where no bun can be found at all; `bun run test` always has one.
describe.skipIf(BUN === null)('emit_tickets over a real TCP socket', () => {
  let server: TcpServer

  beforeEach(async () => {
    server = await startTcpServer(BUN as string)
  })

  afterEach(() => server.stop())

  it(
    'stores a ~256KB fully-enriched batch in one call, in seconds',
    async () => {
      const init = await rpc(server, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'mcp-large-batch.test', version: '1' },
        },
      })
      expect(init.result?.serverInfo?.name).toBe('runcastle')

      const tickets = enrichedBatch()
      const payloadBytes = Buffer.byteLength(JSON.stringify({ tickets }), 'utf8')
      // Guard the guard: a refactor of `enrichedBatch` that quietly shrank the
      // payload would leave a green test that no longer tests anything.
      expect(payloadBytes).toBeGreaterThan(240 * 1024)

      const emitted = emitResult(
        await rpc(server, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'emit_tickets', arguments: { tickets } },
        }),
      )
      expect(emitted.stored).toBe(TICKET_COUNT)
      expect(emitted.tickets).toHaveLength(TICKET_COUNT)

      // The payload survived end to end, not just the call returning: full
      // contexts intact, and the batch-relative blockedBy resolved to seqs.
      const stored = await readBackTickets(server.dbFile, server.featureId)
      expect(stored).toHaveLength(TICKET_COUNT)
      expect(stored.map((t) => t.seq)).toEqual(tickets.map((_, i) => i + 1))
      expect(stored.map((t) => t.context)).toEqual(tickets.map((t) => t.context))
      expect(stored[TICKET_COUNT - 1].blockedBy).toEqual([TICKET_COUNT - 1])
    },
    // The call itself is bounded by CLIENT_TIMEOUT_MS; this budget only has to
    // cover spawning the bun child and migrating a fresh db.
    60_000,
  )

  it(
    'says so in the server log when a request dies mid-body-read',
    async () => {
      // The incident's defining symptom was silence: the call hung, and the
      // server had nothing to say about it. A body that never finishes arriving
      // is the only way an `/mcp` request can die that way, so it is the one
      // thing the handler's pre-read is required to announce.
      await postTruncatedBody(server)
      expect(await server.waitForLog(/\[mcp] request body read failed/, CLIENT_TIMEOUT_MS)).toMatch(
        /declared bytes/,
      )
    },
    60_000,
  )
})
