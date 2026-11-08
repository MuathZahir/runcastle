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
 */

/** Gives a held slot back; calling it again does nothing. */
export type ReleaseSlot = () => void

export interface AgentSlots {
  /** A slot now when one is free and `runtime` is not on hold, else undefined. */
  tryTake(runtime?: string): ReleaseSlot | undefined
  /** A slot as soon as one frees and `runtime` is not on hold, in the order asked. */
  take(runtime?: string): Promise<ReleaseSlot>
  /** Count an agent that does not wait (a ticket agent), over the limit if need be. */
  occupy(): ReleaseSlot
  /** Slots held now. */
  held(): number
  /** Turns waiting for one. */
  waiting(): number
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
  admit: (release: ReleaseSlot) => void
}

export function createAgentSlots(limit: number): AgentSlots {
  let width = Math.max(1, limit)
  let count = 0
  const queue: Waiter[] = []
  const holds = new Map<string, string>()

  const onHold = (runtime: string | undefined): boolean => runtime !== undefined && holds.has(runtime)
  /** Free now for `runtime`: under the limit, not on hold, and no earlier turn that could go waits. */
  const freeFor = (runtime: string | undefined): boolean => count < width && !onHold(runtime) && !queue.some((w) => !onHold(w.runtime))

  function grant(): ReleaseSlot {
    count++
    let held = true
    return () => {
      if (!held) return
      held = false
      count--
      admit()
    }
  }

  function admit(): void {
    for (let i = 0; i < queue.length && count < width; ) {
      const next = queue[i]!
      if (onHold(next.runtime)) {
        i++
        continue
      }
      queue.splice(i, 1)
      next.admit(grant())
    }
  }

  return {
    tryTake: (runtime) => (freeFor(runtime) ? grant() : undefined),
    take(runtime) {
      if (freeFor(runtime)) return Promise.resolve(grant())
      return new Promise((resolve) => queue.push({ ...(runtime !== undefined ? { runtime } : {}), admit: resolve }))
    },
    occupy: grant,
    held: () => count,
    waiting: () => queue.length,
    resize(next) {
      width = Math.max(1, next)
      admit()
    },
    hold(runtime, reason) {
      if (!holds.has(runtime)) holds.set(runtime, reason)
    },
    holdOf: (runtime) => holds.get(runtime),
    lift() {
      if (holds.size === 0) return false
      holds.clear()
      admit()
      return true
    },
  }
}

let shared: AgentSlots | undefined

/** The one set of slots the whole server shares, retuned to `limit` (`config.burnConcurrency`) on every call. */
export function agentSlots(limit: number): AgentSlots {
  if (!shared) shared = createAgentSlots(limit)
  else shared.resize(limit)
  return shared
}

/** Forget the shared slots (tests). */
export function resetAgentSlotsForTests(): void {
  shared = undefined
}
