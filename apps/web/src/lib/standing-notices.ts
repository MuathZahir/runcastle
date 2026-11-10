import type { StandingNotice } from './chat-notices'
import {
  agentDriver,
  agentDriveLine,
  holderSentence,
  ONE_TERMINAL_WARNING,
  type MergeConflictState,
  type ReviewDriveDenial,
  type UnverifiedReview,
} from './feature-ui'

/**
 * What the retired Review view warned about, as the chat's standing rows
 * (the-feature-s-right-panel decision 21). Pure: the caller reads each
 * condition the way the Review view did and hands over the acts; this says
 * which rows stand and in what words. A shipped feature's record warns about
 * nothing, as the Review view's history did not.
 */
export interface StandingInput {
  shipped: boolean
  branch: string
  /** The standing merge conflict (`unresolvedMergeConflict`). */
  conflict: MergeConflictState | null
  /** The last conflict was resolved and the merge can go ahead (`mergeConflictResolved`). */
  conflictResolved: boolean
  /** A resolve session came and went without the merge landing (`conflictResolveEnded`). */
  resolveEnded: boolean
  /** The terminal the resolve has to close first. */
  liveSessionId: string | null
  /** The review drive the human's uncommitted files refused, not yet waved away (`reviewDriveDenial`). */
  denial: ReviewDriveDenial | null
  /** The latest review verified nothing (`unverifiedReview`). */
  unverified: UnverifiedReview | null
  /** Whatever holds the drive slot in this feature's way (`slotBlocker`). */
  blockingDrive: SlotBlocker | null
  /**
   * Shown on a phone (ready-to-publish decision 10): a row whose fix needs the
   * computer says so and offers no button that cannot work there.
   */
  phone: boolean
}

const ON_YOUR_COMPUTER = 'on your computer'

/** The mutation that ends a slot holder, by its kind. */
export type SlotStop =
  | { kind: 'feature'; featureId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'dryRun'; projectId: string }

/** A drive in this feature's way, named, with how to stop it — `null` for a Review worker's live drive. */
export interface SlotBlocker {
  holderLabel: string
  cutOff: boolean
  stop: SlotStop | null
  /**
   * A Review worker's live drive (triage-batch decision 16): who drives, the
   * feature it tries, and whether that is this one. The human's Test drive
   * waits for it; its chat is one click away.
   */
  agent?: { featureId: string; workerId?: string; name: string; thisFeature: boolean; branch: string }
}

/** The project's drive slot as `feature.driveInfo` reports it. */
export interface SlotDriveInfo {
  holderLabel: string
  featureId?: string
  projectId?: string
  projectDrive?: boolean
  dryRun?: boolean
  purpose?: 'human' | 'review'
  workerId?: string
  workerLabel?: string
  branch?: string
  cutOff?: boolean
}

/**
 * The drive holding the slot in this feature's way, or null (ADR-0014: a
 * blocking drive is always named, and stoppable where the human owns it).
 * Anything but this feature's own live drive blocks it: another feature's drive,
 * a project drive, a dry run, and a drive a restart cut off — this feature's
 * own included, since nothing of it runs any more. A Review worker's live drive
 * is named but not offered a stop: it ends when the review hands back, which the human did
 * not start from here. A cut-off one has no review left behind it.
 */
export function slotBlocker(
  drive: SlotDriveInfo | null | undefined,
  feature: { id: string; projectId: string },
  /** A drive of this feature is up (or starting). */
  driveUp: boolean,
): SlotBlocker | null {
  if (!drive) return null
  const cutOff = !!drive.cutOff
  // A Review worker's live drive is named as the agent's, this feature's own
  // included: the human's Test drive is refused while it holds the slot.
  const driver = agentDriver(drive)
  if (driver && !cutOff && drive.featureId) {
    return {
      holderLabel: drive.holderLabel,
      cutOff,
      stop: null,
      agent: { ...driver, featureId: drive.featureId, thisFeature: drive.featureId === feature.id, branch: drive.branch ?? '' },
    }
  }
  if (!cutOff && (driveUp || drive.featureId === feature.id)) return null
  const stop: SlotStop | null = drive.projectDrive
    ? { kind: 'project', projectId: drive.projectId ?? feature.projectId }
    : drive.dryRun
      ? { kind: 'dryRun', projectId: feature.projectId }
      : drive.featureId && (cutOff || drive.purpose !== 'review')
        ? { kind: 'feature', featureId: drive.featureId }
        : null
  return { holderLabel: drive.holderLabel, cutOff, stop }
}

export interface StandingActs {
  resolve: () => void
  resolving: boolean
  dismissDenial: () => void
  stopDrive: () => void
  stopping: boolean
  /** Open a worker's chat on its feature's page: the Review worker's, when it holds the slot. */
  openWorker?: (featureId: string, workerId: string) => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function standingNotices(input: StandingInput, acts: StandingActs): StandingNotice[] {
  if (input.shipped) return []
  const rows: StandingNotice[] = []
  const { conflict } = input
  if (conflict) {
    const files = conflict.files.length > 0 ? `${plural(conflict.files.length, 'file')} · ` : ''
    // Resolving past a live chat closes that chat's terminal first, which
    // only the computer can do; a resolve with nothing in its way is a chat
    // like any other, and works from the phone.
    const computerOnly = input.phone && !!input.liveSessionId
    const tooltip = [
      ...conflict.files,
      ...(input.resolveEnded ? ['The resolve chat ended but the merge hasn’t landed — resolve by hand or retry.'] : []),
      ...(input.liveSessionId && !computerOnly ? [ONE_TERMINAL_WARNING] : []),
    ].join('\n')
    rows.push({
      key: 'conflict',
      hue: 'danger',
      title: 'Merge conflict',
      subtitle: `${files}${conflict.base} into ${input.branch}${computerOnly ? ` — resolve it ${ON_YOUR_COMPUTER}` : ''}`,
      ...(tooltip ? { tooltip } : {}),
      ...(computerOnly
        ? {}
        : {
            action: {
              label: input.liveSessionId ? 'End the chat & resolve' : 'Resolve with agent',
              onClick: acts.resolve,
              disabled: acts.resolving,
            },
          }),
    })
  } else if (input.conflictResolved) {
    rows.push({ key: 'conflict-resolved', hue: 'review', title: 'Conflict resolved', subtitle: 'ready to merge' })
  }
  const { denial } = input
  if (denial) {
    rows.push({
      key: `denial-${denial.eventId}`,
      hue: 'review',
      title: 'Review couldn’t drive',
      subtitle: `uncommitted changes — commit or discard them${input.phone ? ` ${ON_YOUR_COMPUTER}` : ''}, then ask the agent for another review`,
      tooltip: [denial.message, ...denial.dirtyFiles].join('\n'),
      onDismiss: acts.dismissDenial,
    })
  }
  const { unverified } = input
  if (unverified) {
    const tooltip = [unverified.line, unverified.reason].filter(Boolean).join('\n')
    rows.push({
      key: 'unverified',
      hue: 'review',
      title: 'Nothing verified',
      subtitle: `ask the agent for another review, or drive it yourself${input.phone ? ` ${ON_YOUR_COMPUTER}` : ''}`,
      ...(tooltip ? { tooltip } : {}),
    })
  }
  const blocker = input.blockingDrive
  const agent = blocker?.agent
  if (agent) {
    const open = acts.openWorker
    rows.push({
      key: 'slot-drive',
      hue: 'review',
      title: agent.thisFeature
        ? agentDriveLine(agent)
        : `${agent.name} is trying ${agent.branch || 'another feature'}`,
      subtitle: 'it holds the drive slot, so your test drive waits until the review hands back',
      ...(agent.workerId && open
        ? { action: { label: 'Open its chat', onClick: () => open(agent.featureId, agent.workerId!) } }
        : {}),
    })
  } else if (blocker) {
    const holder = holderSentence(blocker.holderLabel)
    rows.push({
      key: 'slot-drive',
      hue: 'review',
      title: blocker.cutOff ? `${holder} holds the drive slot` : `${holder} is running`,
      subtitle: !blocker.stop
        ? 'it holds the drive slot until the review hands back'
        : blocker.cutOff
          ? 'nothing of it runs — stop it to run its stop script and free the slot'
          : 'it holds the drive slot',
      ...(blocker.stop
        ? { action: { label: acts.stopping ? 'Stopping…' : 'Stop it', onClick: acts.stopDrive, disabled: acts.stopping } }
        : {}),
    })
  }
  return rows
}
