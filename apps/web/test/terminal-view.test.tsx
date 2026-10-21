// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * design-mode ticket 12: a TerminalView kept mounted behind another view is
 * laid out at 0×0, and fitting it there resized the shared PTY to a sliver —
 * the visible terminal on the same session then wrapped at ~22 columns. A
 * hidden or zero-size view must send no resize, and refit once it has a size.
 *
 * Boundaries faked: xterm and its fit addon (they measure a canvas happy-dom
 * has not got — the fake fits one column per 8px and one row per 16px, as the
 * real one sizes to its container), the layout (happy-dom lays nothing out),
 * ResizeObserver, and the terminal's WebSocket, whose resize frames are what
 * the PTY sees.
 */
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    element: HTMLElement | null = null
    private listeners: ((size: { cols: number; rows: number }) => void)[] = []
    open(el: HTMLElement) {
      this.element = el
    }
    resize(cols: number, rows: number) {
      if (cols === this.cols && rows === this.rows) return
      this.cols = cols
      this.rows = rows
      for (const l of this.listeners) l({ cols, rows })
    }
    onResize(l: (size: { cols: number; rows: number }) => void) {
      this.listeners.push(l)
      return { dispose: () => {} }
    }
    onData() {
      return { dispose: () => {} }
    }
    loadAddon(addon: { activate: (t: unknown) => void }) {
      addon.activate(this)
    }
    attachCustomKeyEventHandler() {}
    write() {}
    reset() {}
    dispose() {}
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    private term: { element: HTMLElement | null; resize: (c: number, r: number) => void } | null = null
    activate(term: FitAddon['term']) {
      this.term = term
    }
    dispose() {}
    // Like the real addon: never below two columns and one row, however small.
    fit() {
      const el = this.term?.element
      if (!el || !this.term) return
      this.term.resize(Math.max(2, Math.floor(el.clientWidth / 8)), Math.max(1, Math.floor(el.clientHeight / 16)))
    }
  }
  return { FitAddon }
})

const { TerminalView } = await import('../src/components/TerminalView')

let size = { width: 0, height: 0 }
let observers: (() => void)[] = []
let sockets: FakeSocket[] = []

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  readyState = FakeSocket.CONNECTING
  binaryType = ''
  bufferedAmount = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    sockets.push(this)
  }
  send(data: unknown) {
    if (typeof data === 'string') this.sent.push(data)
  }
  close() {}
}

beforeEach(() => {
  size = { width: 0, height: 0 }
  observers = []
  sockets = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {}
      observe() {
        observers.push(this.cb)
      }
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => size.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => size.height)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The socket opens and the server says the PTY is live. */
function goLive(): FakeSocket {
  const ws = sockets[0]
  act(() => {
    ws.readyState = FakeSocket.OPEN
    ws.onopen?.()
    ws.onmessage?.({ data: JSON.stringify({ t: 'status', status: 'live' }) })
  })
  return ws
}
const layout = (width: number, height: number): void => {
  size = { width, height }
  act(() => observers.forEach((cb) => cb()))
}
const resizes = (ws: FakeSocket) =>
  ws.sent.map((s) => JSON.parse(s) as { t: string; cols: number; rows: number }).filter((f) => f.t === 'resize')

describe('TerminalView’s grid size', () => {
  it('sends its fitted grid to the PTY once live, when it has a size', () => {
    size = { width: 800, height: 480 }
    render(<TerminalView sessionId="sess_1" wsBase="ws://x" />)
    const ws = goLive()
    expect(resizes(ws)).toEqual([{ t: 'resize', cols: 100, rows: 30 }])
  })

  it('sends no resize while it is hidden at 0×0, and refits once shown', () => {
    render(<TerminalView sessionId="sess_1" wsBase="ws://x" />)
    const ws = goLive()
    layout(0, 0)
    expect(resizes(ws)).toEqual([])

    layout(800, 480)
    expect(resizes(ws)).toEqual([{ t: 'resize', cols: 100, rows: 30 }])
  })

  it('refits to the width it is shown at after being hidden', () => {
    size = { width: 800, height: 480 }
    render(<TerminalView sessionId="sess_1" wsBase="ws://x" />)
    const ws = goLive()
    layout(0, 0)
    layout(640, 480)
    expect(resizes(ws)).toEqual([
      { t: 'resize', cols: 100, rows: 30 },
      { t: 'resize', cols: 80, rows: 30 },
    ])
  })
})
