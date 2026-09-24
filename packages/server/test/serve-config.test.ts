import { describe, expect, it } from 'vitest'
import { SERVE_HOSTNAME, SERVE_IDLE_TIMEOUT_SECONDS } from '../src/config'
import { HEARTBEAT_MS } from '../src/routes/stream'

/**
 * The two `Bun.serve` listen options (`src/index.ts`), pinned here because both
 * defaults are actively wrong for this app and both fail silently: Bun binds
 * `0.0.0.0` (the unauthenticated API is then LAN-reachable) and reaps idle
 * connections after 10s (every SSE stream and quiet terminal WebSocket dies
 * ~13s in and reconnects, looking like a flaky network).
 */
describe('Bun.serve listen options', () => {
  it('binds loopback only', () => {
    expect(SERVE_HOSTNAME).toBe('127.0.0.1')
  })

  it('keeps the idle timeout above the SSE heartbeat', () => {
    expect(SERVE_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(HEARTBEAT_MS / 1000)
  })

  it('stays within the idle timeout Bun accepts (max 255s)', () => {
    expect(SERVE_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255)
  })
})
