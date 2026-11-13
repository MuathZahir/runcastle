import * as z from 'zod'

/**
 * Needs you is the agent's call (needs-you-is-the-agent-s-call decisions 1, 2,
 * 5): a chat needs the human only when its agent says so (`wait_for_you`,
 * `declare_ready`), when a permission prompt or question box waits on their
 * click, or when its run died and runcastle says so with a fixed line. Nothing
 * is guessed from a finished turn. Each wait lives on its chat's session row;
 * a feature's need is the newest of its chats' (decision 12).
 */

/** Who set a need: the agent itself, or runcastle for a dead run (decision 9). */
export const NeedBy = z.enum(['agent', 'runcastle'])
export type NeedBy = z.infer<typeof NeedBy>

/** What a chat, a worker or a feature needs from the human. */
export const Need = z.object({
  /** The agent's line, or runcastle's fixed line for a dead run. */
  why: z.string(),
  /** When it began (ms since the epoch). */
  since: z.number(),
  /** The chat to open. */
  threadId: z.string(),
  by: NeedBy,
})
export type Need = z.infer<typeof Need>

/** The newest of `needs`, or null when none stands (decisions 12, 18). */
export function newestNeed(needs: Iterable<Need | null | undefined>): Need | null {
  let newest: Need | null = null
  for (const need of needs) if (need && (!newest || need.since > newest.since)) newest = need
  return newest
}

/** The line `declare_ready` waits on (decision 8). */
export function readyToTestWhy(scenario: string): string {
  return `Ready to test · ${scenario}`
}

/** The line runcastle sets when an agent's run failed to launch or died in its turn (decision 9). */
export function wakeFailedWhy(exitCode: number | null): string {
  return exitCode === null ? 'The agent’s run failed' : `The agent’s run failed (exit ${exitCode})`
}

/** The line runcastle sets when the usage limit stopped a turn with "carry on" off (decision 9). */
export const USAGE_LIMIT_WHY = 'Usage limit reached'

/**
 * The one event pings hang off (decision 14): emitted once each time a chat
 * enters a need it was not in.
 */
export const FEATURE_NEEDS_YOU = 'feature.needs_you'

/** What a {@link FEATURE_NEEDS_YOU} event carries: the line, the chat to open, and its feature if any. */
export interface NeedsYouData {
  why: string
  threadId: string
  by: NeedBy
  /** Null for an orchestrator chat's own need. */
  featureId: string | null
}

/**
 * Whether a {@link FEATURE_NEEDS_YOU} event's data pings the human, on the
 * desktop and the phone alike: a well-formed one always does (decision 14).
 * One rule, so the web and the server cannot disagree.
 */
export function needPings(data: unknown): data is NeedsYouData {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d.why === 'string' &&
    typeof d.threadId === 'string' &&
    NeedBy.safeParse(d.by).success &&
    (d.featureId === null || typeof d.featureId === 'string')
  )
}
