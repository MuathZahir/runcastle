import { FEATURE_NEEDS_YOU, type FeatureNeed, type NeedsYouData } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
import { getSessionRow } from '../launcher/sessions'
import { subscribeLive } from './bus'
import { emit } from './events'
import { needOf } from './feature-need'
import { tryGetFeature } from './repo'

/**
 * The one event pings hang off (you-always-know-what-s-waiting decisions 11 to
 * 14): `feature.needs_you` `{ kind, words, held, why }`, emitted when a feature
 * enters a need it was not in, and when a held need passes its hour and comes
 * to the human. Never on a re-read, an unchanged need, or at boot.
 */
export { FEATURE_NEEDS_YOU }

/**
 * How long a feature's changes settle before its need is read again: a service
 * call emits more than once (a dispatch starts the run, then clears the waiting
 * reason), and a need read between two of its writes would ping for a state
 * that never really stood.
 */
export const NEED_SETTLE_MS = 50

/** How often held needs are read again, since no event marks their hour passing. */
export const HELD_SWEEP_MS = 60_000

/** What a feature was last seen needing. */
type Seen = Pick<FeatureNeed, 'kind' | 'held'>

export interface NeedWatchOptions {
  /** The clock needs are read against; the hour a held need waits is measured on it. */
  now?: () => number
}

export interface NeedWatch {
  /** Read every held need again now — what the minute sweep does. */
  sweep(): void
  /** Detach from the bus and stop the sweep. */
  stop(): void
}

/** Whether `need` is news against what was last seen: a new kind, or a held need come to the human. */
function entered(prev: Seen | undefined, need: FeatureNeed | null): need is FeatureNeed {
  if (!need) return false
  if (!prev || prev.kind !== need.kind) return true
  return prev.held && !need.held
}

/**
 * Watch every feature's need: re-read a feature after any of its events or a
 * turn change in one of its threads (an ask opening or answered moves a `turn`
 * signal), and emit {@link FEATURE_NEEDS_YOU} on what {@link entered} calls news.
 * What each feature was last seen needing is kept in memory, seeded at start
 * without emitting. Called once at boot.
 */
export function startNeedWatch(ctx: AppCtx, opts: NeedWatchOptions = {}): NeedWatch {
  const now = opts.now ?? Date.now
  const seen = new Map<string, Seen | null>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Set while this watcher emits, so its own event does not schedule a read. */
  let emitting = false

  function read(featureId: string): FeatureNeed | null {
    const feature = tryGetFeature(ctx, featureId)
    return feature ? needOf(ctx, feature, {}, now()) : null
  }

  function check(featureId: string): void {
    try {
      const need = read(featureId)
      const prev = seen.get(featureId) ?? undefined
      seen.set(featureId, need ? { kind: need.kind, held: need.held } : null)
      if (!entered(prev, need)) return
      emitting = true
      try {
        const data: NeedsYouData = { kind: need.kind, words: need.words, held: need.held, why: need.why ?? null }
        emit(ctx, featureId, { type: FEATURE_NEEDS_YOU, message: `needs you · ${need.words}`, data })
      } finally {
        emitting = false
      }
    } catch (err) {
      console.error('need watch failed', err)
    }
  }

  function flush(): void {
    timer = undefined
    const ids = [...pending]
    pending.clear()
    for (const id of ids) check(id)
  }

  function schedule(featureId: string): void {
    pending.add(featureId)
    if (timer) return
    timer = setTimeout(flush, NEED_SETTLE_MS)
    timer.unref?.()
  }

  const active = ctx.db.select({ id: features.id }).from(features).where(eq(features.status, 'active')).all()
  for (const { id } of active) {
    try {
      const need = read(id)
      seen.set(id, need ? { kind: need.kind, held: need.held } : null)
    } catch (err) {
      console.error('need watch failed', err)
    }
  }

  const unsubscribe = subscribeLive((signal) => {
    if (emitting) return
    if (signal.kind === 'event' && signal.featureId) schedule(signal.featureId)
    else if (signal.kind === 'turn') {
      const featureId = getSessionRow(ctx, signal.sessionId)?.featureId
      if (featureId) schedule(featureId)
    }
  })

  const sweep = (): void => {
    for (const [id, last] of seen) if (last?.held) check(id)
  }
  const sweeper = setInterval(sweep, HELD_SWEEP_MS)
  sweeper.unref?.()

  return {
    sweep,
    stop() {
      unsubscribe()
      clearInterval(sweeper)
      if (timer) clearTimeout(timer)
      pending.clear()
      seen.clear()
    },
  }
}

