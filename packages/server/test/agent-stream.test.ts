import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendTranscript,
  beginTranscript,
  clearAllTranscripts,
  endTranscript,
  readTranscript,
} from '../src/services/agent-stream'

describe('agent-stream transcript store', () => {
  beforeEach(() => clearAllTranscripts())

  it('unknown ticket reads as empty, never throws', () => {
    expect(readTranscript('nope')).toEqual({
      live: false,
      chunks: [],
      firstIndex: 0,
      nextIndex: 0,
    })
  })

  it('append before begin is a no-op (no run in flight)', () => {
    appendTranscript('t1', { kind: 'text', text: 'orphan' })
    expect(readTranscript('t1').chunks).toHaveLength(0)
  })

  it('begin → append → read returns chunks with monotonic indices and live=true', () => {
    beginTranscript('t1')
    appendTranscript('t1', { kind: 'text', text: 'thinking…' })
    appendTranscript('t1', { kind: 'tool', text: 'bun test', name: 'Bash' })
    const r = readTranscript('t1')
    expect(r.live).toBe(true)
    expect(r.chunks.map((c) => c.i)).toEqual([0, 1])
    expect(r.chunks[1]).toMatchObject({ kind: 'tool', name: 'Bash', text: 'bun test' })
  })

  it('cursor read returns only chunks after the given index', () => {
    beginTranscript('t1')
    for (const s of ['a', 'b', 'c']) appendTranscript('t1', { kind: 'text', text: s })
    const r = readTranscript('t1', 0)
    expect(r.chunks.map((c) => c.text)).toEqual(['b', 'c'])
    expect(r.nextIndex).toBe(3)
  })

  it('endTranscript flips live off but keeps the content readable', () => {
    beginTranscript('t1')
    appendTranscript('t1', { kind: 'text', text: 'done deal' })
    endTranscript('t1')
    const r = readTranscript('t1')
    expect(r.live).toBe(false)
    expect(r.chunks).toHaveLength(1)
  })

  it('re-begin (re-burn) resets content and indices', () => {
    beginTranscript('t1')
    appendTranscript('t1', { kind: 'text', text: 'first attempt' })
    endTranscript('t1')
    beginTranscript('t1')
    appendTranscript('t1', { kind: 'text', text: 'second attempt' })
    const r = readTranscript('t1')
    expect(r.chunks.map((c) => c.text)).toEqual(['second attempt'])
    expect(r.chunks[0].i).toBe(0)
    expect(r.live).toBe(true)
  })

  it('trims oldest chunks beyond the byte cap but indices keep counting', () => {
    beginTranscript('t1')
    const big = 'x'.repeat(600_000)
    appendTranscript('t1', { kind: 'text', text: big })
    appendTranscript('t1', { kind: 'text', text: big })
    appendTranscript('t1', { kind: 'text', text: big }) // > 1.5MB → first drops
    const r = readTranscript('t1')
    expect(r.chunks.length).toBe(2)
    expect(r.firstIndex).toBe(1)
    expect(r.nextIndex).toBe(3)
  })

  it('tickets are isolated from each other', () => {
    beginTranscript('t1')
    beginTranscript('t2')
    appendTranscript('t1', { kind: 'text', text: 'one' })
    appendTranscript('t2', { kind: 'text', text: 'two' })
    expect(readTranscript('t1').chunks[0].text).toBe('one')
    expect(readTranscript('t2').chunks[0].text).toBe('two')
  })
})
