// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which queries a live frame refreshes — the resync allowlist in `useLiveSync`.
 *
 * The seam is the hook: the allowlist lives inside its effect, so what is
 * observable is which `utils.<router>.<query>.invalidate()` calls a stream frame
 * produces. `EventSource` is the one system boundary here, and is stubbed.
 */

/** Every `utils…invalidate()` the resync called, as a dotted path. */
const recorded = vi.hoisted(() => ({ paths: [] as string[] }))

vi.mock('../src/trpc', () => {
  /** A tRPC-utils stand-in: any path is callable, and records itself when called. */
  const recorder = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => (typeof key === 'string' ? recorder([...path, key]) : undefined),
      apply: () => {
        recorded.paths.push(path.join('.'))
      },
    })
  return { trpc: { useUtils: () => recorder([]) } }
})

const { useLiveSync } = await import('../src/lib/live')

type Listener = (ev: unknown) => void

/** Stand-in for the browser's `EventSource`, whose frames the test drives. */
class StubEventSource {
  static readonly CLOSED = 2
  static last: StubEventSource | null = null

  readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {
    StubEventSource.last = this
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  close(): void {
    this.readyState = StubEventSource.CLOSED
  }

  /** Deliver a server frame. */
  emit(type: string, data = '{}'): void {
    this.readyState = 1
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data })
  }
}

const globals = globalThis as unknown as Record<string, unknown>

function Harness() {
  useLiveSync()
  return null
}

/** Mount the hook and deliver one event signal; returns the paths it invalidated. */
function signalOneEvent(): string[] {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  )
  const source = StubEventSource.last
  if (!source) throw new Error('the hook opened no EventSource')
  // Mounting only opens the stream — nothing is invalidated until a frame lands.
  const frame = JSON.stringify({ kind: 'event', projectId: 'proj_1', eventId: 7 })
  act(() => source.emit('live', frame))
  return recorded.paths
}

beforeEach(() => {
  recorded.paths.length = 0
  StubEventSource.last = null
  globals.EventSource = StubEventSource
})

afterEach(() => {
  cleanup()
  delete globals.EventSource
})

describe('useLiveSync resync', () => {
  it('refreshes settings, and no longer asks for the retired image build target', () => {
    const paths = signalOneEvent()

    expect(paths).toContain('settings.get.invalidate')
    expect(paths.filter((p) => p.startsWith('setup.imageBuildTarget'))).toEqual([])
  })

  it('refreshes the project notes, so the rail badge follows a jot or a triage', () => {
    const paths = signalOneEvent()

    expect(paths).toContain('projectNotes.invalidate')
  })

  it('answers a thread signal with that thread’s log and the thread lists, nothing else', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    )
    const source = StubEventSource.last
    if (!source) throw new Error('the hook opened no EventSource')
    act(() => source.emit('live', JSON.stringify({ kind: 'thread', threadId: 'th1' })))

    expect([...recorded.paths].sort()).toEqual(['thread.events.invalidate', 'thread.list.invalidate'])
  })

  it('still leaves the doctor report off the list — it shells out to probe the machine', () => {
    const paths = signalOneEvent()

    expect(paths.filter((p) => p.startsWith('setup.doctor'))).toEqual([])
  })
})
