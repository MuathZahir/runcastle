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
 */

/** Gives a held slot back; calling it again does nothing. */
export type ReleaseSlot = () => void

export interface AgentSlots {
  /** A slot now when one is free, else undefined. */
  tryTake(): ReleaseSlot | undefined
  /** A slot as soon as one frees, in the order asked. */
  take(): Promise<ReleaseSlot>
  /** Count an agent that does not wait (a ticket agent), over the limit if need be. */
  occupy(): ReleaseSlot
  /** Slots held now. */
  held(): number
  /** Turns waiting for one. */
  waiting(): number
  /** Retune the limit: a raise lets waiting turns in at once; slots held over a lowered one stay held. */
  resize(limit: number): void
}

export function createAgentSlots(limit: number): AgentSlots {
  let width = Math.max(1, limit)
  let count = 0
  const queue: ((release: ReleaseSlot) => void)[] = []

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
    while (count < width && queue.length) queue.shift()?.(grant())
  }

  return {
    tryTake: () => (count < width && queue.length === 0 ? grant() : undefined),
    take() {
      const now = count < width && queue.length === 0 ? grant() : undefined
      if (now) return Promise.resolve(now)
      return new Promise((resolve) => queue.push(resolve))
    },
    occupy: grant,
    held: () => count,
    waiting: () => queue.length,
    resize(next) {
      width = Math.max(1, next)
      admit()
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
