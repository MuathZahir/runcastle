
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

export type DriveState = 'idle' | 'starting' | 'serving' | 'bare-checkout' | 'setup-failed' | 'review-agent-driving'
export interface DriveView {
  barTitle: string
  barDesc: string
  primary: 'start' | 'stop' | 'fixDrive'
  stageKind: 'player' | 'panel' | 'bare' | 'failed' | 'agent' | 'starting'
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
}

export function driveView(state: DriveState, _info: object = {}): DriveView {
  return DRIVE_VIEWS[state]
}

// --- review honesty: the SUMMARY card and the merge confirmation -------------

/**
 * How much trust a review figure has earned, as a dot colour: `ok` green,
 * `warn` amber, `danger` red, `idle` grey for "there is nothing here".
 *
 * The distinction that matters is `idle` vs `ok`. The audit found the SUMMARY
 * card painting "0 commits", "0/0 done" and a missing run in all-clear green
 * (findings F23) — the one card meant to inform an irreversible merge reassuring
 * the user about data it did not have. Absence is never `ok` here.
 */
interface DriveFigure {
  purpose?: 'human' | 'review'
}

/** What an active drive on a feature branch says about itself. */
export interface DriveWheel {
  /** The live-state label beside the pulse. */
  label: string
  /** The sentence under it: what to do while this drive is up. */
  copy: string
}

/**
 * Who is behind the wheel, in the words the drive surfaces show (decisions #10).
 *
 * A review drive is the same machinery on the same checkout, so every surface
 * used to announce it as the human's own test drive — the screen lying about who
 * is at the keyboard at the one moment the human is meant to be watching rather
 * than clicking. The human's wording is untouched: this only adds the case that
 * had no words of its own.
 *
 * A drive with no purpose is the human's. `purpose` arrives on the wire only
 * with this feature, and every drive that predates it was started by hand.
 */
export function driveWheel(drive?: DriveFigure | null): DriveWheel {
  if (drive?.purpose === 'review') {
    return {
      label: 'review agent driving',
      copy:
        'The review agent is driving this branch and writing what it finds as notes below. ' +
        'Watch, or stop the drive to take the wheel yourself.',
    }
  }
  return {
    label: 'driving now',
    copy:
      'Click through the feature. When it feels right, merge — or stop the drive and send ' +
      'feedback back through tickets.',
  }
}

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
