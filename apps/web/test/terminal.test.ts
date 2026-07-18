import { describe, expect, it } from 'vitest'
import { wsBaseFrom } from '../src/lib/terminal'

/**
 * Issue #38 — the terminal WebSocket derives its host+port from the page
 * location instead of a hardcoded 4512, so it connects correctly whatever port
 * the server (which serves both the SPA and the WS in production) runs on.
 */
describe('wsBaseFrom', () => {
  it('derives ws:// origin with the page port, not a hardcoded 4512', () => {
    expect(wsBaseFrom({ protocol: 'http:', host: 'localhost:9090' })).toBe('ws://localhost:9090')
  })

  it('keeps a default (no-port) host as-is', () => {
    expect(wsBaseFrom({ protocol: 'http:', host: 'example.com' })).toBe('ws://example.com')
  })

  it('upgrades to wss:// over https', () => {
    expect(wsBaseFrom({ protocol: 'https:', host: 'runcastle.dev:8443' })).toBe(
      'wss://runcastle.dev:8443',
    )
  })
})
