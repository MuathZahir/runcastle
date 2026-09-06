export type ActionKind =
  | 'startDraft' // feature.start — cut the branch on a parked draft, then start ideation
  | 'startGrill' // launchSession { kind: 'ideation' }
  | 'converge' // feature.converge — crosses G1 on a mapped feature
  | 'workNext' // feature.workWaypoint — work the next ready mapped waypoint
  | 'resumeConverge' // feature.converge — resume a stranded converge session
  | 'advance' // feature.advance (crosses non-human gates — "Continue to review", decision 11b)
  | 'burn' // feature.burn (G3, and resume a parked run)
  | 'cancelRun' // run.cancel
  | 'testDriveStart' // feature.testDrive { action: 'start' }
  | 'testDriveStop' // feature.testDrive { action: 'stop' }
  | 'stopDriveAndIterate' // feature.testDrive { action: 'stop' }, then feature.rethink
  | 'fixDrive' // feature.fixDrive — an agent repairs the environment a drive's setup died in
  | 'merge' // feature.merge (G5)
  | 'askQuestions' // launchSession { kind: 'qa' }
  | 'revisit' // launchSession { kind: 'revisit' } — resume the old conversation, amend docs + tickets
  | 'resolveConflict' // launchSession { kind: 'revisit', kickoffLine: mergeConflictKickoff(…) }
  | 'rethink' // feature.rethink — start the next lap with nothing to triage first
  | 'iterate' // opens the triage step over the open notes and defects (decision 21)
  | 'unarchive' // feature.unarchive — restore an archived feature to its lane (next-step bar)

/**
 * An action that can't fire on click: the bar expands inline to a free-text
 * input first and hands the typed string to the dispatcher (today, the reason
 * recorded with a forced G1 override).
 */
export interface NextAction {
  label: string
  kind: ActionKind
  danger?: boolean
  waypointId?: string
  /** Additional explanation rendered as the action's title. */
  hint?: string
  /**
   * Why this action cannot fire right now — the server would refuse it in this
   * state. Set means shown-but-disabled, with this sentence as the reason: an
   * action that vanishes leaves the user hunting for it, and one that fails on
   * click teaches nothing (findings F3).
   */
  disabled?: string
  /**
   * The one click that clears {@link disabled} and takes this road anyway —
   * rendered on the reason line beside the dead button (decision 20). Iterate
   * during a test drive is the case it exists for: "Stop the test drive first"
   * was a true sentence and a dead end, and the escape makes it a button.
   */
  escape?: NextAction
}

export interface NextStep {
  /** Small tracked kicker above the title (e.g. NEXT STEP / IN PROGRESS). */
  kick: string
  title: string
  desc: string
  primary?: NextAction
  secondary: NextAction[]
  /** A run is actively burning — show a spinner in the bar. */
  busy: boolean
  /** Optional dim context line beneath the description. */
  note?: string
}

/**
 * Kickoff line for a review-phase revisit session opened to RESOLVE a merge
 * conflict (CONTEXT decision #9). Passed as the `launchSession` override, so the
 * revisit agent — whose cwd IS the talk worktree checked out on the feature
 * branch — opens straight on the merge-into-feature resolution rather than the
 * generic revisit prompt. Parameterized with the base branch, feature branch,
 * and conflicting files carried on the `merge.conflict` event.
 */
export type DraftBaseMissing = 'loading' | 'unpicked'
