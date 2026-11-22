/**
 * The machine's one limit of agents working at once (interactive-workers
 * decision 14): `burnConcurrency`, counting ticket agents and workers in the
 * middle of a turn together. Purely in memory, like the burn cache's slot
 * allocator beside it: a restart ends every turn and every burn, so nothing
 * held can outlive the process that held it.
 *
 * A ticket agent never waits here — its run already has a pool of that width,
 * and making a burn wait on the human's workers would stall a round — but it
 * counts while it runs. A worker's turn waits, first come first served, until
 * the count is under the limit.
 *
 * A turn may name the runtime it runs on. A runtime is put on hold when an
 * agent on it fails on an account-level error (burns-become-workers decision
 * 21): no turn on it is granted a slot, so none starts only to fail the same
 * way, until the hold is lifted. Turns on other runtimes go by meanwhile.
 *
 * Each turn may name its holder (a worker id), so the line-up can be read back
 * ({@link AgentSlots.snapshot}) and shown: who works, who waits and in which
 * order (one-number-for-how-many-build-at-once decisions 3 and 9).
 */
import { publishLive } from './bus'

/** Gives a held slot back; calling it again does nothing. */
export type ReleaseSlot = () => void

/** One turn in the limiter's line-up: who it is, and since when it holds or waits. */
export interface SlotEntry {
  /** The holder's id (a worker id), when the turn named one. */
  holder?: string
  /** When it was admitted (holding) or asked (waiting), epoch ms. */
  since: number
}

/** The line-up now: who holds a slot, in order of admission, and who waits, in queue order. */
export interface SlotSnapshot {
  limit: number
  holding: SlotEntry[]
  /** A waiter on a held runtime keeps its place and carries the hold's reason. */
  waiting: (SlotEntry & { heldBy?: string })[]
}

export interface AgentSlots {
  /** A slot now when one is free and `runtime` is not on hold, else undefined. */
  tryTake(runtime?: string, holder?: string): ReleaseSlot | undefined
  /** A slot as soon as one frees and `runtime` is not on hold, in the order asked. */
  take(runtime?: string, holder?: string): Promise<ReleaseSlot>
  /** Count an agent that does not wait (a ticket agent), over the limit if need be. */
  occupy(): ReleaseSlot
  /** Slots held now. */
  held(): number
  /** Turns waiting for one. */
  waiting(): number
  /** Who holds and who waits, in order (one-number decisions 3 and 9). */
  snapshot(): SlotSnapshot
  /** Retune the limit: a raise lets waiting turns in at once; slots held over a lowered one stay held. */
  resize(limit: number): void
  /** Grant no slot to a turn on `runtime` until {@link lift}, saying `reason`; the first reason stands. */
  hold(runtime: string, reason: string): void
  /** Why `runtime` is on hold, or undefined when it is not. */
  holdOf(runtime: string): string | undefined
  /** Lift every hold, letting waiting turns in. True when there was one. */
  lift(): boolean
}

interface Waiter {
  runtime?: string
  holder?: string
  since: number
  admit: (release: ReleaseSlot) => void
}

interface Holding {
  holder?: string
  since: number
}

/**
 * `onMove` is told whenever the line-up changes — a slot granted or given
 * back, a turn starting to wait, the limit retuned — so the queue on screen
 * moves with it. It must not throw.
 */
export function createAgentSlots(limit: number, onMove: () => void = () => {}, now: () => number = Date.now): AgentSlots {
  let width = Math.max(1, limit)
  const holding = new Set<Holding>()
  const queue: Waiter[] = []
  const holds = new Map<string, string>()

  const onHold = (runtime: string | undefined): boolean => runtime !== undefined && holds.has(runtime)
  /** Free now for `runtime`: under the limit, not on hold, and no earlier turn that could go waits. */
  const freeFor = (runtime: string | undefined): boolean => holding.size < width && !onHold(runtime) && !queue.some((w) => !onHold(w.runtime))

  /** Grant a slot to `holder`; `quiet` when the caller says the line-up moved itself. */
  function grant(holder: string | undefined, quiet = false): ReleaseSlot {
    const entry: Holding = { ...(holder !== undefined ? { holder } : {}), since: now() }
    holding.add(entry)
    if (!quiet) onMove()
    return () => {
      if (!holding.delete(entry)) return
      admit()
      onMove()
    }
  }

  function admit(): void {
    for (let i = 0; i < queue.length && holding.size < width; ) {
      const next = queue[i]!
      if (onHold(next.runtime)) {
        i++
        continue
      }
      queue.splice(i, 1)
      next.admit(grant(next.holder, true))
    }
  }

  return {
    tryTake: (runtime, holder) => (freeFor(runtime) ? grant(holder) : undefined),
    take(runtime, holder) {
      if (freeFor(runtime)) return Promise.resolve(grant(holder))
      return new Promise((resolve) => {
        queue.push({
          ...(runtime !== undefined ? { runtime } : {}),
          ...(holder !== undefined ? { holder } : {}),
          since: now(),
          admit: resolve,
        })
        onMove()
      })
    },
    occupy: () => grant(undefined),
    held: () => holding.size,
    waiting: () => queue.length,
    snapshot: () => ({
      limit: width,
      holding: [...holding].map((h) => ({ ...h })),
      waiting: queue.map((w) => {
        const heldBy = w.runtime === undefined ? undefined : holds.get(w.runtime)
        return {
          ...(w.holder !== undefined ? { holder: w.holder } : {}),
          since: w.since,
          ...(heldBy !== undefined ? { heldBy } : {}),
        }
      }),
    }),
    resize(next) {
      const was = width
      width = Math.max(1, next)
      if (width === was) return
      admit()
      onMove()
    },
    hold(runtime, reason) {
      if (holds.has(runtime)) return
      holds.set(runtime, reason)
      onMove()
    },
    holdOf: (runtime) => holds.get(runtime),
    lift() {
      if (holds.size === 0) return false
      holds.clear()
      admit()
      onMove()
      return true
    },
  }
}

let shared: AgentSlots | undefined

/** The one set of slots the whole server shares, retuned to `limit` (`config.burnConcurrency`) on every call. */
export function agentSlots(limit: number): AgentSlots {
  if (!shared) shared = createAgentSlots(limit, () => publishLive({ kind: 'queue' }))
  else shared.resize(limit)
  return shared
}

/** Forget the shared slots (tests). */
export function resetAgentSlotsForTests(): void {
  shared = undefined
}
