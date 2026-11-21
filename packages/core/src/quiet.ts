import { liveEvents, outsideCompactions, type ThreadEvent } from './thread'

/**
 * Runcastle says when nothing is running (ADR-0023 decision 12): one alert to
 * the human when a project has started features, nothing runs in it, and
 * nothing in it waits on them. This is the rule, IO-free: the server's quiet
 * watcher gathers a {@link QuietSnapshot} and asks {@link quietAlertLine}.
 */

/** How long a project must be quiet before the alert (decision 5). */
export const QUIET_ALERT_MS = 10 * 60_000

/** How the alert's line starts: how the watcher knows its own wait again after a restart. */
export const QUIET_ALERT_OPENING = 'Nothing is running:'

/** Why a stopped feature stopped, as far as runcastle knows (decision 8). */
export type QuietReason =
  /** A chat of the feature is held for the usage limit until `until` (ms). */
  | { kind: 'limit'; until: number }
  /** A worker given an assignment has no turn running and has not handed back. */
  | { kind: 'worker'; stalled?: boolean }
  /** Its last turn declared it ready, and nobody merged it. */
  | { kind: 'merge' }
  /** Nothing more is known: it stopped after its last turn. */
  | { kind: 'unknown' }

/** One started feature of the project (decision 2: drafts, merged and archived ones are never here). */
export interface QuietFeature {
  title: string
  /** Something of it actually runs: a lead or worker turn, a run, a queued worker. */
  running: boolean
  /** Its next move is the human's (decision 4): it neither raises the alert nor holds it back. */
  yourMove: boolean
  reason: QuietReason
}

/** One project, as the quiet rule reads it. */
export interface QuietSnapshot {
  features: QuietFeature[]
  /** Anything else runs in the project: an orchestrator chat's turn, a drive. */
  otherRunning: boolean
  /** Anything of the project is in Needs you (decision 3), epics included. */
  needsYou: boolean
}

/** Nothing runs in the project: the watcher's quiet clock runs while this holds. */
export function projectQuiet(s: QuietSnapshot): boolean {
  return !s.otherRunning && !s.features.some((f) => f.running)
}

/** The features that raise the alert: started, quiet, and not the human's move. */
export function stoppedFeatures(s: QuietSnapshot): QuietFeature[] {
  return projectQuiet(s) ? s.features.filter((f) => !f.yourMove) : []
}

/** Whether the alert's rule holds right now (decision 1), regardless of how long it has. */
export function quietAlertDue(s: QuietSnapshot): boolean {
  return !s.needsYou && stoppedFeatures(s).length > 0
}

/** "14:05", the time a hold lifts, in the server's local time. */
export function clockTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A reason in the alert's words (decision 8). */
export function quietReasonWords(reason: QuietReason, time: (at: number) => string = clockTime): string {
  switch (reason.kind) {
    case 'limit':
      return `held for the usage limit until ${time(reason.until)}`
    case 'worker':
      return reason.stalled ? 'a worker stalled' : 'a worker stopped mid-assignment'
    case 'merge':
      return 'ready and waiting on a merge'
    case 'unknown':
      return 'stopped after its last turn'
  }
}

/**
 * The alert's one line when its rule holds, else null: "Nothing is running: 2
 * features stopped. Search: held for the usage limit until 14:05. Header: a
 * worker stopped mid-assignment."
 */
export function quietAlertLine(s: QuietSnapshot, time: (at: number) => string = clockTime): string | null {
  if (!quietAlertDue(s)) return null
  const stopped = stoppedFeatures(s)
  const count = stopped.length === 1 ? '1 feature stopped' : `${stopped.length} features stopped`
  const each = stopped.map((f) => `${f.title.trim()}: ${quietReasonWords(f.reason, time)}.`)
  return [`${QUIET_ALERT_OPENING} ${count}.`, ...each].join(' ')
}

/**
 * Whether the thread's last turn answered the human's own message (decision 4):
 * the newest prompt sent to the agent was theirs. A held line started
 * nothing, a hidden command or a compaction answers nobody, and a turn the
 * agent started by itself (a background command finishing) carries on the
 * conversation it came from.
 */
export function lastTurnAnsweredHuman(events: readonly ThreadEvent[]): boolean {
  let human = false
  for (const e of outsideCompactions(liveEvents(events))) {
    if (e.type !== 'prompt' || e.held || e.hidden) continue
    human = e.source === 'human'
  }
  return human
}
