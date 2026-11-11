
import type { EventRow } from '@runcastle/core'

export interface OpenApp {
  url: string
  /**
   * `starting` while the server is still polling the URL, `ready` once it has
   * answered, `timedOut` when the poll gave up waiting. Only `ready` earns a
   * link: the point of the whole state is that a click always loads something.
   */
  state: 'starting' | 'ready' | 'timedOut'
}

/**
 * What to show for "Open app" on a drive — the feature drive's pane and the
 * preparation dry-run row ask the same question of the same `DriveInfo`.
 *
 * `null` until a URL has been sniffed at all. A dev server prints its address
 * seconds-to-minutes before it serves, so a URL alone is not an invitation.
 */
export function openApp(
  drive?: { devUrl?: string; devReady?: boolean; devReadyTimedOut?: boolean } | null,
): OpenApp | null {
  if (!drive?.devUrl) return null
  if (drive.devReady) return { url: drive.devUrl, state: 'ready' }
  return { url: drive.devUrl, state: drive.devReadyTimedOut ? 'timedOut' : 'starting' }
}

/** The plain text shown in place of the link while it is not one yet. */
export function openAppWaitingLabel(open: OpenApp): string {
  return open.state === 'timedOut' ? `${open.url} — not answering` : `starting… ${open.url}`
}

/**
 * The server's `holderLabel` ("a project drive of main") opening a sentence.
 * The label itself is shown verbatim — only its first letter moves.
 */
export function holderSentence(holderLabel: string): string {
  return `${holderLabel.charAt(0).toUpperCase()}${holderLabel.slice(1)}`
}

// --- whose drive it is (triage-batch decisions 5, 15, 16) --------------------

/** Who a feature drive belongs to, as `feature.driveInfo` reports it. */
export interface DriveOwner {
  purpose?: 'human' | 'review'
  workerId?: string
  workerLabel?: string
}

/** The worker driving an agent's drive. */
export interface AgentDriver {
  /** Its chat, to open; absent when the server could not name the worker. */
  workerId?: string
  /** What to call it: "Review worker". */
  name: string
}

/**
 * The worker's name in a sentence: a Review worker's label ("Review", "Review:
 * verify") reads "Review worker", with the verify pass in brackets.
 */
export function driverName(label: string | undefined): string {
  if (!label || label === 'Review') return 'Review worker'
  const verify = /^Review:\s*(.+)$/.exec(label)
  return verify ? `Review worker (${verify[1]})` : label
}

/** The agent driving, or null when the drive is the human's own (or none). */
export function agentDriver(drive: DriveOwner | null | undefined): AgentDriver | null {
  if (drive?.purpose !== 'review') return null
  return { ...(drive.workerId ? { workerId: drive.workerId } : {}), name: driverName(drive.workerLabel) }
}

/** The drive slot's line for an agent's drive: "Review worker is trying this feature". */
export function agentDriveLine(driver: AgentDriver): string {
  return `${driver.name} is trying this feature`
}

/**
 * Whether `featureId` is on the human's own drive — the "is driving" flag the
 * header's Stop drive and the chat's "the agent can't land its own edits" line
 * read. An agent's drive of the feature is not: the feature reads as a worker
 * at work.
 */
export function humanDriving(drive: ({ featureId: string } & DriveOwner) | null | undefined, featureId: string): boolean {
  return !!drive && drive.featureId === featureId && !agentDriver(drive)
}

/**
 * Why the human's own Test drive of `featureId` is refused while the Review
 * worker holds the slot (triage-batch decision 16; ADR-0014's one slot), or
 * undefined when no agent drives. Its chat opens from the note over the chat.
 */
export function agentDriveRefusal(
  drive: ({ featureId?: string; branch?: string; cutOff?: boolean } & DriveOwner) | null | undefined,
  featureId: string,
): string | undefined {
  const driver = agentDriver(drive)
  if (!driver || drive?.cutOff) return undefined
  const line = drive?.featureId === featureId ? agentDriveLine(driver) : `${driver.name} is trying ${drive?.branch ?? 'another feature'}`
  return `${line} — your test drive waits until the review hands back`
}

/**
 * What Stop on an agent's drive asks first. It ends the review's drive and
 * gives the human the slot; the Review worker itself is not stopped. Its drive
 * tools then refuse, and its assignment tells it to start the drive once more,
 * or else to review by reading the branch.
 */
export function stopAgentDriveConfirm(driver: AgentDriver): { title: string; description: string; confirm: string } {
  return {
    title: 'Stop the review’s drive?',
    description:
      `This ends the ${driver.name}’s drive and frees the drive slot for you. The review itself keeps running: ` +
      'without the app it may start the drive again, or finish by reading the code instead.',
    confirm: 'Stop its drive',
  }
}

/** A drive whose setup hook failed, as the review panel surfaces it. */
export interface DriveFailure {
  /** The setup command the project ran, verbatim. */
  command: string
  /** How it ended, in words: `exited 3`, `timed out`. */
  outcome: string
  /** The command's own output tail — the part actually worth reading. */
  output: string
  /**
   * Whether to offer "Fix drive". One terminal per feature, so not while a
   * session is live — the launcher refuses a second one regardless, and an
   * affordance that can only be turned down is worse than no affordance.
   */
  canFix: boolean
}

/**
 * The setup-failure surface for a drive (multi-service decision 4).
 *
 * `null` for a drive that came up, which is the ordinary case. When one did not,
 * the human used to get a toast on the click that caused it and then a panel
 * that said "driving now" over an app that was never running — so this reads the
 * failure off the polled drive, where it stays for as long as the drive does.
 */
export function driveFailure(
  drive?: {
    hookFailure?: { command: string; exitCode?: number | null; timedOut: boolean; output: string }
  } | null,
  opts: { sessionLive?: boolean } = {},
): DriveFailure | null {
  const f = drive?.hookFailure
  if (!f) return null
  return {
    command: f.command,
    outcome: f.timedOut ? 'timed out' : `exited ${f.exitCode ?? 'without a code'}`,
    output: f.output,
    canFix: !opts.sessionLive,
  }
}

/** What takes the banner down: the retry landing, or review being left behind. */
const ANSWERED_BY = ['ticket.retry', 'burn.started', 'feature.shipped']

/** A review drive the server refused because the working tree was dirty. */
export interface ReviewDriveDenial {
  /**
   * The event that recorded it. Dismissal is keyed on this, so the human waves
   * away ONE denial — the next one is a different id and speaks up again.
   */
  eventId: number
  /** The uncommitted paths that stood in the way, as the server named them. */
  dirtyFiles: string[]
  /** The server's own sentence, for a banner that never paraphrases it. */
  message: string
  /** When the drive guard refused. */
  at: number
}

/**
 * The dirty-tree refusal the review panel is still asking the human to answer,
 * or null when there is nothing outstanding (decision 7).
 *
 * The drive guard emits `reviewdrive.denied` at the moment it refuses
 * (`services/git.ts`), which is the record; this is the prompt on top of it, so
 * it is the LATEST denial that counts and anything that answers one takes it
 * back down. Two things answer one, and either is enough: an event that says
 * the re-burn is under way — `ticket.retry`, the burn's own `burn.started`,
 * which is also how the feature leaves review, and the feature shipping — or a
 * run that started after the denial, which is the server's own
 * retry-eligibility rule read from this side, and covers a burn whose events
 * have not landed on this feed yet. A later denial raises it again.
 *
 * The phase and the readonly history view are the caller's to answer; this
 * function only reads the record.
 */
export function reviewDriveDenial(
  events: readonly EventRow[],
  runs: readonly { startedAt: number }[] = [],
  dismissedEventId?: number | null,
): ReviewDriveDenial | null {
  let denial: ReviewDriveDenial | null = null
  for (const event of events) {
    if (event.type === 'reviewdrive.denied') {
      const data = (event.data ?? {}) as { dirtyFiles?: unknown }
      denial = {
        eventId: event.id,
        dirtyFiles: Array.isArray(data.dirtyFiles)
          ? data.dirtyFiles.filter((file): file is string => typeof file === 'string')
          : [],
        message: event.message,
        at: event.ts,
      }
    } else if (ANSWERED_BY.includes(event.type)) {
      denial = null
    }
  }
  if (!denial || denial.eventId === dismissedEventId) return null
  return denial.at < Math.max(...runs.map((r) => r.startedAt), -Infinity) ? null : denial
}

export type DriveState = 'idle' | 'starting' | 'serving' | 'bare-checkout' | 'setup-failed' | 'review-agent-driving' | 'cut-off'
export interface DriveView {
  barTitle: string
  barDesc: string
  primary: 'start' | 'stop' | 'fixDrive'
  stageKind: 'player' | 'panel' | 'bare' | 'failed' | 'agent' | 'starting' | 'cutOff'
  footer: { showDevChip: boolean; showBranch: boolean; showOutput: boolean }
}

const footer = (active: boolean) => ({ showDevChip: active, showBranch: active, showOutput: active })
const DRIVE_VIEWS: Record<DriveState, DriveView> = {
  idle: { barTitle: 'Review the build', barDesc: 'Open the app when you are ready to test it.', primary: 'start', stageKind: 'player', footer: footer(false) },
  starting: { barTitle: 'Starting the test drive', barDesc: 'Preparing the branch and development server.', primary: 'stop', stageKind: 'starting', footer: footer(true) },
  serving: { barTitle: 'Test-driving the branch — merge when it looks right', barDesc: 'The development server is ready.', primary: 'stop', stageKind: 'panel', footer: footer(true) },
  'bare-checkout': { barTitle: 'Branch checked out for inspection', barDesc: 'Branch checked out — nothing started. This project has no dev command · Set one in Settings', primary: 'stop', stageKind: 'bare', footer: footer(true) },
  'setup-failed': { barTitle: 'Drive setup failed — fix it or stop the drive', barDesc: 'The project setup command did not complete.', primary: 'fixDrive', stageKind: 'failed', footer: footer(true) },
  'review-agent-driving': { barTitle: 'Review agent driving', barDesc: 'review agent driving — notes land below as it finds things', primary: 'stop', stageKind: 'agent', footer: footer(true) },
  'cut-off': { barTitle: 'Drive cut off by a restart', barDesc: 'Nothing is running — stop it to run its stop script and return the checkout.', primary: 'stop', stageKind: 'cutOff', footer: footer(true) },
}

export function driveView(state: DriveState, _info: object = {}): DriveView {
  return DRIVE_VIEWS[state]
}

// --- review honesty: the SUMMARY card and the merge confirmation -------------

/**
 * The review agent's figure, as both review surfaces render it — or null when
 * there is nothing to say because no review was ever asked for.
 *
 * `no findings` is green on purpose: a review that ran clean is the one positive
 * signal this machinery can produce, and greying it would make a good result
 * look like a missing one. Findings are amber, never red — they are things to
 * read, not failures (decisions #6) — and so is a review that could not run,
 * which merely leaves the human where they stood before any of this existed.
 */
