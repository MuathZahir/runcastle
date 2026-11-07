import type { Readable, Writable } from 'node:stream'

/**
 * The runcastle side of a worker's tool relay (interactive-workers decision 9).
 * Runcastle opens a `docker exec -i` into the worker's container running the
 * relay (`WORKER_RELAY_SCRIPT`), which listens on a socket inside the
 * container; the worker's own MCP server asks it, and each call comes out of
 * the exec's stdout as one JSON line, `{ id, tool, args }`. Runcastle answers
 * on the exec's stdin with `{ id, result }` or `{ id, error }`. The container
 * gets no route to runcastle: every byte travels over a channel runcastle opened.
 */

/** Runcastle's half of a worker's tools: one call's text answer, or a throw that becomes its error. */
export type WorkerToolHandler = (tool: string, args: Record<string, unknown>) => Promise<string>

interface RelayCall {
  id: number
  tool: string
  args?: Record<string, unknown>
}

function isCall(v: unknown): v is RelayCall {
  const m = v as Partial<RelayCall> | null
  return !!m && typeof m.id === 'number' && typeof m.tool === 'string'
}

/** Answer every call that comes out of `from` on `to`, until `from` ends. Lines that are not calls (the relay's ready line) are passed over. */
export function serveToolRelay(from: Readable, to: Writable, handle: WorkerToolHandler): void {
  let buf = ''
  const answer = (msg: Record<string, unknown>): void => {
    if (!to.destroyed && to.writable) to.write(`${JSON.stringify(msg)}\n`)
  }
  from.setEncoding('utf8')
  from.on('data', (chunk: string) => {
    buf += chunk
    let i = buf.indexOf('\n')
    while (i >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
      if (!line) continue
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (!isCall(msg)) continue
      const { id, tool } = msg
      handle(tool, msg.args ?? {}).then(
        (result) => answer({ id, result }),
        (err: unknown) => answer({ id, error: err instanceof Error ? err.message : String(err) }),
      )
    }
  })
}
