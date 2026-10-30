import type { StandingNotice } from './chat-notices'
import {
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
  /** A project drive holds the drive slot while no drive of this feature is up. */
  blockingDrive: { holderLabel: string } | null
}

export interface StandingActs {
  resolve: () => void
  resolving: boolean
  dismissDenial: () => void
  stopDrive: () => void
  stopping: boolean
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function standingNotices(input: StandingInput, acts: StandingActs): StandingNotice[] {
  if (input.shipped) return []
  const rows: StandingNotice[] = []
  const { conflict } = input
  if (conflict) {
    const files = conflict.files.length > 0 ? `${plural(conflict.files.length, 'file')} · ` : ''
    const tooltip = [
      ...conflict.files,
      ...(input.resolveEnded ? ['The resolve session ended but the merge hasn’t landed — resolve by hand or retry.'] : []),
      ...(input.liveSessionId ? [ONE_TERMINAL_WARNING] : []),
    ].join('\n')
    rows.push({
      key: 'conflict',
      hue: 'danger',
      title: 'Merge conflict',
      subtitle: `${files}${conflict.base} into ${input.branch}`,
      ...(tooltip ? { tooltip } : {}),
      action: {
        label: input.liveSessionId ? 'End session & resolve' : 'Resolve with agent',
        onClick: acts.resolve,
        disabled: acts.resolving,
      },
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
      subtitle: 'uncommitted changes — commit or discard them, then ask the agent for another review',
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
      subtitle: 'ask the agent for another review, or drive it yourself',
      ...(tooltip ? { tooltip } : {}),
    })
  }
  if (input.blockingDrive) {
    rows.push({
      key: 'project-drive',
      hue: 'review',
      title: `${holderSentence(input.blockingDrive.holderLabel)} is running`,
      subtitle: 'it holds the drive slot',
      action: { label: acts.stopping ? 'Stopping…' : 'Stop it', onClick: acts.stopDrive, disabled: acts.stopping },
    })
  }
  return rows
}
