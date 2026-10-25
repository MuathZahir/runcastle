import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRow } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { waitMessages } from '../src/launcher/hook-client'
import { writeToLiveTerminal } from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { codexHomeDir } from '../src/launcher/runtimes/codex'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { ptyRegistry, type PtyEntry } from '../src/pty/registry'
import hooksApp from '../src/routes/hooks'
import {
  asyncRewakeDelivery,
  bracketedPaste,
  CODEX_GATHER_MS,
  codexQueueCommand,
  codexQueueDelivery,
  deliveryFor,
  typingDelivery,
  type CodexQueueCommand,
} from '../src/services/orchestrator-delivery'
import {
  answerOrchestratorWaiter,
  ORCHESTRATOR_GATHER_MS,
  queueOrchestratorLine,
  takeOrchestratorLines,
  waitForOrchestratorLines,
} from '../src/services/orchestrator-messages'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * How the orchestrator's pending lines reach it (`whole-cuts-plan-themselves`
 * decision 20): one message per batch on every delivery, through the CLI's own
 * channel, and a typing fallback that never lets two batches run together.
 */

const SUBMIT_MS = 350

/** Stand a terminal up for a session and record every write into it. */
function terminalFor(sessionId: string): { writes: string[]; entry: PtyEntry } {
  const writes: string[] = []
  const entry = { sessionId, exited: false, pty: { write: (d: string) => writes.push(d) } } as unknown as PtyEntry
  vi.spyOn(ptyRegistry(), 'get').mockImplementation((id) => (id === sessionId ? entry : undefined))
  return { writes, entry }
}

/** What the TUI submits: the typed text split on each carriage return. */
function submissions(writes: string[]): string[] {
  return writes.join('').split('\r').filter((s) => s.length > 0)
}

function session(id: string, extra: Partial<SessionRow> = {}): SessionRow {
  return { id, kind: 'project', status: 'live', ...extra } as SessionRow
}

let n = 0
const freshId = (): string => `sess-${++n}-${Math.random().toString(36).slice(2)}`

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('writeToLiveTerminal — a per-session queue', () => {
  beforeEach(() => vi.useFakeTimers())

  it('keeps two writes inside 350 ms as two separate submissions (the lap 1 joined line)', () => {
    const id = freshId()
    const { writes } = terminalFor(id)

    expect(writeToLiveTerminal(id, 'first line.')).toBe(true)
    expect(writeToLiveTerminal(id, 'second line.')).toBe(true)
    vi.advanceTimersByTime(SUBMIT_MS * 5)

    expect(writes).toEqual(['first line.', '\r', 'second line.', '\r'])
    expect(submissions(writes)).toEqual(['first line.', 'second line.'])
  })

  it('starts the next write only after the previous one’s carriage return, with a gap', () => {
    const id = freshId()
    const { writes } = terminalFor(id)
    writeToLiveTerminal(id, 'a')
    writeToLiveTerminal(id, 'b')

    vi.advanceTimersByTime(SUBMIT_MS)
    expect(writes).toEqual(['a', '\r'])
    vi.advanceTimersByTime(SUBMIT_MS)
    expect(writes).toEqual(['a', '\r', 'b'])
  })

  it('refuses a terminal that is not there, and drops what was queued when it exits', () => {
    const id = freshId()
    const { writes, entry } = terminalFor(id)
    expect(writeToLiveTerminal('nobody', 'x')).toBe(false)

    writeToLiveTerminal(id, 'a')
    writeToLiveTerminal(id, 'b')
    entry.exited = true
    vi.advanceTimersByTime(SUBMIT_MS * 5)

    expect(writes).toEqual(['a'])
    expect(writeToLiveTerminal(id, 'c')).toBe(false)
  })
})

describe('the typing fallback', () => {
  it('types every pending line as one bracketed paste, submitted once', () => {
    vi.useFakeTimers()
    const id = freshId()
    const { writes } = terminalFor(id)
    queueOrchestratorLine(id, '[runcastle] a finished.')
    queueOrchestratorLine(id, '[runcastle] b finished.')

    typingDelivery.kick(session(id))
    vi.advanceTimersByTime(SUBMIT_MS * 5)

    expect(writes).toEqual([bracketedPaste('[runcastle] a finished.\n[runcastle] b finished.'), '\r'])
    expect(takeOrchestratorLines(id)).toEqual([])
  })
})

describe('the Claude Code delivery — the asyncRewake waiter', () => {
  beforeEach(() => vi.useFakeTimers())

  it('gathers two lines ending 10 ms apart into one answer for the one waiter', async () => {
    const id = freshId()
    const answer = waitForOrchestratorLines(id, 'w1', 25_000)
    let settled: unknown
    void answer.then((a) => (settled = a))

    queueOrchestratorLine(id, '[runcastle] a review pass (ticket 2) finished.')
    asyncRewakeDelivery.kick(session(id))
    await vi.advanceTimersByTimeAsync(10)
    queueOrchestratorLine(id, '[runcastle] a burn finished (2/2 tickets done).')
    asyncRewakeDelivery.kick(session(id))
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBeUndefined()

    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GATHER_MS)
    expect(await answer).toEqual({
      status: 'lines',
      lines: ['[runcastle] a review pass (ticket 2) finished.', '[runcastle] a burn finished (2/2 tickets done).'],
    })
  })

  it('answers a waiter at once with lines that waited out the window before it came up', async () => {
    const id = freshId()
    queueOrchestratorLine(id, '[runcastle] a finished.')
    asyncRewakeDelivery.kick(session(id))
    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_GATHER_MS * 10)

    const answer = waitForOrchestratorLines(id, 'w1', 25_000)
    expect(await answer).toEqual({ status: 'lines', lines: ['[runcastle] a finished.'] })
  })
})

describe('the Codex delivery — codex queue', () => {
  it('renders the queue argv for the conversation, with the session’s own CODEX_HOME', () => {
    const command = codexQueueCommand({ id: 'sess-1' }, 'conv-uuid', 'line one\nline two', { PATH: '/bin' })

    expect(command.args.slice(-5)).toEqual(['queue', '--thread', 'conv-uuid', '--message', 'line one\nline two'])
    expect(command.env).toEqual({ PATH: '/bin', CODEX_HOME: codexHomeDir('sess-1') })
  })

  /** A delivery whose spawns are recorded and finish only when the test says so. */
  function heldDelivery(): { delivery: ReturnType<typeof codexQueueDelivery>; runs: CodexQueueCommand[]; finish: Array<(code: number) => void> } {
    const runs: CodexQueueCommand[] = []
    const finish: Array<(code: number) => void> = []
    const delivery = codexQueueDelivery(
      (command) =>
        new Promise((resolve) => {
          runs.push(command)
          finish.push(resolve)
        }),
    )
    return { delivery, runs, finish }
  }

  it('gathers two events ending 10 ms apart into one spawn (the drive’s two turns)', () => {
    vi.useFakeTimers()
    const { delivery, runs } = heldDelivery()
    const id = freshId()
    const row = session(id, { runtime: 'codex', ccSessionId: 'conv-1' })

    queueOrchestratorLine(id, 'A')
    delivery.kick(row)
    vi.advanceTimersByTime(10)
    queueOrchestratorLine(id, 'B')
    delivery.kick(row)
    vi.advanceTimersByTime(CODEX_GATHER_MS)

    expect(runs.map((r) => r.args.at(-1))).toEqual(['A\nB'])
  })

  it('sends all pending lines as one spawn, and one spawn at a time per session', async () => {
    vi.useFakeTimers()
    const { delivery, runs, finish } = heldDelivery()
    const id = freshId()
    const row = session(id, { runtime: 'codex', ccSessionId: 'conv-1' })

    queueOrchestratorLine(id, 'one')
    queueOrchestratorLine(id, 'two')
    delivery.kick(row)
    vi.advanceTimersByTime(CODEX_GATHER_MS)
    queueOrchestratorLine(id, 'three')
    delivery.kick(row)
    queueOrchestratorLine(id, 'four')
    delivery.kick(row)
    vi.advanceTimersByTime(CODEX_GATHER_MS)

    expect(runs.map((r) => r.args.at(-1))).toEqual(['one\ntwo'])
    finish[0]?.(0)
    await vi.advanceTimersByTimeAsync(CODEX_GATHER_MS)
    expect(runs).toHaveLength(2)
    expect(runs[1]?.args.at(-1)).toBe('three\nfour')
    expect(runs[1]?.args.slice(-5, -1)).toEqual(['queue', '--thread', 'conv-1', '--message'])
  })

  it('holds the lines until the session has a conversation to queue to', () => {
    const run = vi.fn(async () => 0)
    const id = freshId()
    queueOrchestratorLine(id, 'one')

    codexQueueDelivery(run).kick(session(id, { runtime: 'codex' }))

    expect(run).not.toHaveBeenCalled()
    expect(takeOrchestratorLines(id)).toEqual(['one'])
  })
})

describe('the per-runtime delivery table', () => {
  it('uses each CLI’s own channel, never the typing fallback; an unset runtime is Claude Code', () => {
    expect(deliveryFor({ runtime: 'claude-code' })).toBe(asyncRewakeDelivery)
    expect(deliveryFor({})).toBe(asyncRewakeDelivery)
    expect(deliveryFor({ runtime: 'codex' })).not.toBe(typingDelivery)
    expect(deliveryFor({ runtime: 'codex' })).not.toBe(asyncRewakeDelivery)
  })
})

describe('the waiter route', () => {
  let ctx: AppCtx
  let projectId: string

  function mount(): Hono {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    return app
  }

  async function poll(app: Hono, sessionId: string, waiter: string): Promise<unknown> {
    const res = await app.request(`/api/hooks/orchestrator-messages?sessionId=${sessionId}&waiter=${waiter}`)
    return res.json()
  }

  /** A live project session — the orchestrator — or, with `kind`, a live session of another kind. */
  function orchestrator(kind: 'project' | 'prepare' = 'project'): string {
    const row = createSessionRow(ctx, { projectId, kind, worktreePath: '/repo' })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return row.id
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('hands lines already pending to the waiter at once, and never twice', async () => {
    const app = mount()
    const id = orchestrator()
    queueOrchestratorLine(id, 'one')
    queueOrchestratorLine(id, 'two')

    expect(await poll(app, id, 'w1')).toEqual({ status: 'lines', lines: ['one', 'two'] })
    expect(takeOrchestratorLines(id)).toEqual([])
  })

  it('answers only the newest waiter, and the older one superseded', async () => {
    const app = mount()
    const id = orchestrator()
    const older = poll(app, id, 'w1')
    await vi.waitFor(() => expect(takeOrchestratorLines(id)).toEqual([]))
    const newer = poll(app, id, 'w2')

    expect(await older).toEqual({ status: 'superseded' })
    queueOrchestratorLine(id, 'one')
    answerOrchestratorWaiter(id)
    expect(await newer).toEqual({ status: 'lines', lines: ['one'] })
  })

  it('answers ended when the session ends, and for a session that is over or not orchestrating', async () => {
    const app = mount()
    const id = orchestrator()
    const held = poll(app, id, 'w1')
    await new Promise((r) => setTimeout(r, 20))

    markSessionEnded(ctx, id)

    expect(await held).toEqual({ status: 'ended' })
    expect(await poll(app, id, 'w2')).toEqual({ status: 'ended' })
    expect(await poll(app, orchestrator('prepare'), 'w3')).toEqual({ status: 'ended' })
    expect(await poll(app, 'nobody', 'w4')).toEqual({ status: 'ended' })
  })

  it('answers empty when the hold runs out with nothing pending', async () => {
    expect(await waitForOrchestratorLines(freshId(), 'w1', 10)).toEqual({ status: 'empty' })
  })
})

describe('the hook client’s wait-messages mode', () => {
  /** A fetch that answers each poll with the next of `answers` (an Error rejects). */
  function fakeFetch(answers: Array<object | Error>): typeof fetch {
    let i = 0
    return (async () => {
      const next = answers[i++] ?? { status: 'ended' }
      if (next instanceof Error) throw next
      return new Response(JSON.stringify(next))
    }) as unknown as typeof fetch
  }
  const noSleep = async (): Promise<void> => {}

  it('exits 2 with every line, one per line, after polling through empty holds', async () => {
    const fetch = fakeFetch([{ status: 'empty' }, { status: 'lines', lines: ['[runcastle] a', '[runcastle] b'] }])
    expect(await waitMessages('http://x', 'sess-1', { fetch, sleep: noSleep })).toEqual({
      code: 2,
      output: '[runcastle] a\n[runcastle] b',
    })
  })

  it('exits 0 silently when superseded or ended, or with no session', async () => {
    for (const status of ['superseded', 'ended']) {
      expect(await waitMessages('http://x', 'sess-1', { fetch: fakeFetch([{ status }]), sleep: noSleep })).toEqual({
        code: 0,
        output: '',
      })
    }
    expect(await waitMessages('http://x', undefined)).toEqual({ code: 0, output: '' })
  })

  it('backs off and retries a failed poll, and never exits 2 without lines', async () => {
    const sleep = vi.fn(noSleep)
    const fetch = fakeFetch([new Error('ECONNREFUSED'), {}, { status: 'lines', lines: [] }, { status: 'lines', lines: ['x'] }])

    expect(await waitMessages('http://x', 'sess-1', { fetch, sleep })).toEqual({ code: 2, output: 'x' })
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('polls the waiter route with its session and waiter id', async () => {
    const urls: string[] = []
    const fetch = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ status: 'ended' }))
    }) as unknown as typeof fetch

    await waitMessages('http://localhost:4512', 'sess-1', { fetch, waiterId: 'w-9' })

    expect(urls).toEqual(['http://localhost:4512/api/hooks/orchestrator-messages?sessionId=sess-1&waiter=w-9'])
  })
})
