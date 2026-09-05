import { parsePhase, unresolvedMergeConflict } from '@runcastle/core'
import type { EventRow, GateId, MergeConflictState, Phase, SessionPurpose } from '@runcastle/core'
export { unresolvedMergeConflict }
export type { MergeConflictState }

export function mergeConflictKickoff(base: string, branch: string, files: string[]): string {
  const list = files.length ? files.join(', ') : '(run git status to see the conflicts)'
  return (
    `Proceed with your task: RESOLVE A MERGE CONFLICT. Merging ${base} into ${branch} conflicts ` +
    `on: ${list}. Your working directory IS the talk worktree, already checked out on ${branch}. ` +
    `Run \`git merge ${base}\`, then resolve every conflict using this feature’s spec.md and ` +
    `decisions.md for intent, and commit the merge. Do NOT push and do NOT advance the phase ` +
    `(never call complete_phase). When the merge commit is in, tell me to click “Merge & ship” ` +
    `again for a clean retry.`
  )
}

/**
 * Kickoff line for the run lane's "Resolve in terminal" — the human escape
 * hatch when the burner's automatic resolver could not finish a ticket's
 * landing conflict. Passed as the `launchSession` override, so the revisit
 * agent (cwd = the talk worktree, checked out on the feature branch) opens on
 * the resolution with the ticket's identity, its branch, and the conflicting
 * files already in hand.
 *
 * Note the direction: the human session merges the TICKET branch into the
 * feature branch (the landing that failed), which is the opposite of what the
 * unattended resolver does in the sandbox — there is no sandbox here, and the
 * talk worktree already holds the feature branch.
 */
export function ticketConflictKickoff(input: {
  seq: number
  title: string
  branch: string
  featureBranch: string
  files: string[]
}): string {
  const list = input.files.length
    ? input.files.join(', ')
    : '(run git status after the merge to see them)'
  return (
    `Proceed with your task: RESOLVE A MERGE CONFLICT. Ticket #${input.seq} (“${input.title}”) is ` +
    `fully implemented on branch ${input.branch}, but landing it on ${input.featureBranch} ` +
    `conflicts on: ${list}. Your working directory IS the talk worktree, already checked out on ` +
    `${input.featureBranch}. Run \`git merge ${input.branch}\`, read both sides before resolving ` +
    `(the ticket's work on one side, the sibling tickets that landed first on the other), and ` +
    `resolve by intent using this feature's spec.md and decisions.md — keep BOTH sides working. ` +
    `Run the tests over the touched code, then commit the merge. Do NOT push and do NOT advance ` +
    `the phase (never call complete_phase). When the merge commit is in, tell me to click Retry ` +
    `on the ticket so runcastle records it as landed.`
  )
}

/**
 * What "End session & resolve" costs, said before the click (decisions #10). The
 * resolve affordance never hides now, so the one-terminal rule it used to hide
 * behind has to be explained instead — on the bar and on the conflict card, in
 * the same words, because they fire the same compound.
 */
export const ONE_TERMINAL_WARNING =
  'One terminal per feature — your live session will be closed to open the resolve session.'


/**
 * The standing (unresolved) merge conflict for a feature, derived from its event
 * feed so the review conflict card survives a page reload. The latest
 * `merge.conflict` event carries the base branch + conflicting files; two later
 * events supersede it. `burn.started` — burning re-runs implementation and the
 * recorded file list no longer applies, so the card clears once the loop moves
 * on. `merge.resolved` — the server watched a resolve session land the merge
 * (decision 2a), which is how a resolved conflict stops disabling the pipeline's
 * last step instead of standing forever.
 * Returns null when there is no standing conflict. `events` must be in id order.
 */

/** The events that supersede a recorded conflict — see `unresolvedMergeConflict`. */
const CONFLICT_CLEARED = ['burn.started', 'merge.resolved', 'feature.shipped']

/** How a session's lifecycle events name the session they are about. */
function eventSessionId(event: EventRow): string | undefined {
  const id = (event.data as { sessionId?: unknown } | null)?.sessionId
  return typeof id === 'string' ? id : undefined
}

/**
 * Whether a resolve-conflict session has ENDED since the standing conflict was
 * recorded, without the merge landing (decision 30d).
 *
 * `merge.resolved` is emitted at session end only when the server's own probe
 * finds the base already merged in, and that probe is best-effort by design — a
 * worktree that has gone, a branch renamed, an agent that quit halfway. So the
 * card used to sit there unchanged after a resolve session came and went, which
 * reads as the button having done nothing at all. This is what lets it say so.
 *
 * There is no negative event to look for: `session.ended` carries only the
 * session's id, so the sessions are what say which of them was the resolve. Both
 * closing events count — a terminal the human closed emits `session.ended`, one
 * the server found dead at boot emits `session.reconciled`, and either way the
 * session is over and the merge has not landed.
 *
 * Answers for whatever conflict is standing at the end of the feed, so callers
 * only ask it where {@link unresolvedMergeConflict} already returned one.
 * `events` must be in id order.
 */
export function conflictResolveEnded(
  events: EventRow[],
  sessions: readonly { id: string; purpose?: SessionPurpose }[],
): boolean {
  const resolvers = new Set(
    sessions.filter((s) => s.purpose === 'resolve-conflict').map((s) => s.id),
  )
  let ended = false
  for (const event of events) {
    // A fresh conflict, or anything that retires the old one, starts the
    // question over: what matters is the resolve attempt on the CURRENT one.
    if (event.type === 'merge.conflict' || CONFLICT_CLEARED.includes(event.type)) ended = false
    else if (event.type === 'session.ended' || event.type === 'session.reconciled') {
      const id = eventSessionId(event)
      if (id && resolvers.has(id)) ended = true
    }
  }
  return ended
}

export interface UndoableOverride {
  /** The gate that was forced. */
  gate: GateId
  /** The phase the feature was on before the override advanced it. */
  from: Phase
  /** Where the override put it — the feature's phase, while the undo stands. */
  to: Phase
}

/**
 * The phase move an event records, or null if it records none. Every phase
 * change goes through the server's `setPhase`, which carries `{ from, to }` on
 * the event whatever it types the event as — so the data SHAPE identifies a
 * transition where a list of event types would go stale. Status changes carry
 * `{ from, to }` too, but of statuses, so requiring BOTH to parse as phases
 * separates them.
 */
function phaseTransition(e: EventRow): { from: Phase; to: Phase } | null {
  const d = (e.data ?? {}) as { from?: unknown; to?: unknown }
  const from = parsePhase(d.from)
  const to = parsePhase(d.to)
  return from && to ? { from, to } : null
}

/**
 * The gate override that can still be taken back, derived from the event feed
 * (so the affordance survives a reload, like the conflict card).
 *
 * Override is the pipeline's quietest irreversible action: Apply advanced the
 * phase instantly, and the only ways back were an agent action or DB surgery
 * (findings F24). Undo is offered only while the override is the feature's
 * LATEST transition — `overrideGate` emits `gate.overridden` and then the
 * advance, so any later phase transition (a burn, a lap, a merge, another
 * advance) means the pipeline has moved on and stepping back one phase would no
 * longer be the reversal of anything. `events` must be in id order.
 */
export function undoableOverride(events: EventRow[]): UndoableOverride | null {
  let forcedGate: GateId | null = null
  let undoable: UndoableOverride | null = null
  for (const e of events) {
    if (e.type === 'gate.overridden') {
      forcedGate = ((e.data ?? {}) as { gate?: GateId }).gate ?? null
      continue
    }
    const moved = phaseTransition(e)
    if (!moved) continue
    // The advance that the override just forced — or any other transition, which
    // closes the window on whatever was open.
    undoable = forcedGate ? { gate: forcedGate, ...moved } : null
    forcedGate = null
  }
  return undoable
}

/**
 * Whether this feature was ever test-driven, from the event feed — the third
 * figure the merge confirmation reports (findings F21). A stopped drive still
 * counts: the human did put the branch on the road.
 */
export function testDriveTaken(events: EventRow[]): boolean {
  return events.some((e) => e.type === 'testdrive.started')
}

/** The wall clock a `ticket.timing` event carries, if it carries a usable one. */
function timingWallMs(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const ms = (data as { wallMs?: unknown }).wallMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : undefined
}

/**
 * How long each ticket's lane says it took, from the event feed alone.
 *
 * The burner emits `ticket.timing` on every exit path of both execution kinds,
 * and its `wallMs` bounds exactly one execution — so that is the figure, and the
 * last such event wins when a ticket has been burned more than once in a run.
 * The spread of a ticket's other events is only the fallback, for a lane still
 * burning: it starts at whatever the run first said about the ticket, which for
 * a ticket that waited on a blocker is minutes before its agent existed.
 *
 * Never a log file. `run()` appends to `burn-<feature>-<seq>.log` and
 * `review-<feature>-<seq>.log` across attempts, so a log's own span is every
 * attempt at once — that is how a 5m 35s review once read as 5.2 hours.
 */
export function ticketDurations(events: readonly EventRow[]): Map<string, number> {
  const span = new Map<string, { min: number; max: number }>()
  const measured = new Map<string, number>()
  for (const e of events) {
    if (!e.ticketId) continue
    if (e.type === 'ticket.timing') {
      const ms = timingWallMs(e.data)
      if (ms !== undefined) measured.set(e.ticketId, ms)
    }
    const s = span.get(e.ticketId)
    if (!s) span.set(e.ticketId, { min: e.ts, max: e.ts })
    else {
      s.min = Math.min(s.min, e.ts)
      s.max = Math.max(s.max, e.ts)
    }
  }
  const out = new Map(measured)
  for (const [id, s] of span) if (!out.has(id) && s.max > s.min) out.set(id, s.max - s.min)
  return out
}

/** The "Open app" affordance, as the polled drive currently justifies it. */
export type KickoffTrouble = 'undelivered' | 'not-ready'

/**
 * How long a terminal may sit `launching` — spawned by the server, but with no
 * `SessionStart` check-in from Claude Code yet — before the panel says so.
 */
export const CHECK_IN_GRACE_MS = 30_000

/**
 * True when the session's terminal has been up past {@link CHECK_IN_GRACE_MS}
 * with the agent inside it still not checked in.
 *
 * Informational only. `launching` is a fully active state ({@link
 * sessionActive}) — the terminal is there and can be typed into — so this never
 * withholds anything; it is the panel's quiet explanation for why the strip
 * still reads "launching…", which is usually something on screen waiting on the
 * human (a trust prompt, a resume chooser).
 *
 * The age comes from the session's own `session.launching` event because the
 * session row carries no timestamp. No such event in the log means an age that
 * cannot be stated, and saying nothing beats guessing. `events` must be in id
 * order.
 */
export function awaitingCheckIn(
  session: { id: string; status: string },
  events: EventRow[],
  now: number = Date.now(),
): boolean {
  if (session.status !== 'launching') return false
  const launched = events.find(
    (e) =>
      e.type === 'session.launching' &&
      (e.data as { sessionId?: unknown } | null)?.sessionId === session.id,
  )
  return !!launched && now - launched.ts > CHECK_IN_GRACE_MS
}

/**
 * Whether a session's opening briefing is currently in trouble, derived from the
 * event feed (so it survives a reload, like the conflict card).
 *
 * The server types the briefing into the PTY and waits for Claude Code to
 * acknowledge it via the `UserPromptSubmit` hook. Two things can go wrong, and
 * both used to be invisible — the terminal looked healthy and the agent simply
 * never knew why it had been opened:
 * - `session.kickoff_undelivered` — typed, never acknowledged (a startup dialog
 *   ate the keystrokes), or the human typed first so injection stopped.
 * - `session.not_ready` — the terminal spawned but Claude Code never reported
 *   `SessionStart` at all, so nothing was ever typed.
 * A later `session.kickoff` (the automatic retry, or a manual Send) clears it.
 * `events` must be in id order.
 */
export function kickoffTrouble(events: EventRow[], sessionId: string): KickoffTrouble | null {
  let trouble: KickoffTrouble | null = null
  for (const e of events) {
    if ((e.data as { sessionId?: unknown } | null)?.sessionId !== sessionId) continue
    if (e.type === 'session.kickoff_undelivered') trouble = 'undelivered'
    else if (e.type === 'session.not_ready') trouble = 'not-ready'
    else if (e.type === 'session.kickoff' || e.type === 'session.ended') trouble = null
  }
  return trouble
}

/**
 * Whether a session's terminal is running — the one question every surface that
 * asks "is a session up?" should ask, and the only place the statuses that mean
 * yes are named.
 *
 * BOTH `launching` and `live` count. The server spawns the PTY, owns it, and
 * tracks its exit first-hand (it marks the row ended and emits
 * `session.pty_exited`), so either status means there is a real terminal the
 * human can already type into. `live` records something narrower: that Claude
 * Code's `SessionStart` hook called back, i.e. the agent confirmed it is inside.
 * That check-in only ever UPGRADES what is known about a session — it must never
 * gate whether one exists, because a hook that fails to arrive would then leave
 * the bar offering "Start grill session" over the terminal being worked in,
 * which is the reported bug.
 */
export function sessionActive(session: { status: string }): boolean {
  return session.status === 'launching' || session.status === 'live'
}

/**
 * The session strip's word for an active session — the ONE thing the two
 * statuses are allowed to read differently, because here the distinction is the
 * whole point: `launching…` says the terminal is up and the agent has not
 * checked in yet, `live` says it has. Every strip says it identically.
 */
export function sessionStatusLabel(session: { status: string }): string {
  return session.status === 'launching' ? 'launching…' : 'live'
}

/** The feature's active session ({@link sessionActive}), if it has one. */
export function activeSession<T extends { status: string }>(
  sessions: readonly T[],
): T | undefined {
  return sessions.find((s) => sessionActive(s))
}

/**
 * True when the feature has an ENDED session of `kind` whose Claude Code
 * conversation can still be picked up (it reached `live`, so it recorded a
 * `ccSessionId`). Opening a terminal of that kind `--resume`s the latest such
 * conversation server-side, so this only decides the WORDING — Resume vs Start —
 * never the action. A terminal is a real process, so quitting runcastle ends
 * every session row; without this the bar would keep saying "Start" for a
 * conversation that is actually being continued.
 *
 * `kind` is optional because a `revisit` launch is kind-BLIND server-side: it
 * resumes the feature's most recent resumable conversation whatever kind it was,
 * which is what the lap's own session asks for.
 */
