// A stand-in for `codex app-server` (JSON-RPC over stdio lines), for the Codex
// usage side channel's test: it answers `initialize`, pushes a notification of
// its own, and answers `account/rateLimits/read` only once initialized, the way
// the real app server refuses requests before the handshake.
import { createInterface } from 'node:readline'

let initialized = false
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line)
  if (method === 'initialize') {
    initialized = true
    send({ id, result: { userAgent: 'codex_cli_rs/0.140.0' } })
    send({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 1 } } } })
  } else if (method === 'account/rateLimits/read') {
    if (!initialized) return send({ id, error: { code: -32600, message: 'Not initialized' } })
    send({
      id,
      result: {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 1_800_500_000 },
          planType: 'pro',
        },
        rateLimitsByLimitId: null,
      },
    })
  }
})
