import { useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import type { StandingNotice } from '../../lib/chat-notices'
import {
  conflictResolveEnded,
  liveSessionLine,
  mergeConflictResolved,
  reviewDriveDenial,
  unverifiedReview,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useReviewArtifacts } from '../../lib/reviews'
import { standingNotices } from '../../lib/standing-notices'
import { useToast } from '../../lib/toast'
import type { useResolveConflict } from '../../lib/use-resolve-conflict'

/**
 * The retired Review view's warnings, read under the conditions it read them
 * and wired to the acts it offered, as the chat strip's standing rows
 * (the-feature-s-right-panel decision 21).
 */
export function useStandingNotices({
  full,
  events,
  conflict,
  drive,
  driveUp,
  resolveConflict,
}: {
  full: FeatureFull | undefined
  events: EventRow[]
  conflict: MergeConflictState | null
  /** The project's drive slot (`feature.driveInfo`). */
  drive: { featureId?: string; projectId?: string; projectDrive?: boolean; holderLabel: string } | null | undefined
  /** A drive of this feature is up. */
  driveUp: boolean
  resolveConflict: ReturnType<typeof useResolveConflict>
}): StandingNotice[] {
  const utils = trpc.useUtils()
  const toast = useToast()
  const featureId = full?.feature.id ?? ''
  const shipped = full?.feature.status === 'shipped'
  // Only a review pass can have verified nothing, so a feature without one reads no artifacts.
  const reviewed = !!full?.tickets.some((t) => t.kind === 'review')
  const artifacts = useReviewArtifacts(featureId, reviewed && !shipped)
  // Keyed on the event id, so a NEW denial is a new id and the row comes back.
  const [dismissedDenial, setDismissedDenial] = useState<number | null>(null)
  const stop = trpc.project.testDrive.useMutation({
    onSuccess: () => void utils.feature.driveInfo.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  if (!full) return []
  const { feature } = full
  // Somebody else holds the slot; a project drive is the human's own, so it is offered a stop.
  const slotHolder = drive && drive.featureId !== feature.id ? drive : undefined
  const blockingProjectId = slotHolder?.projectDrive && slotHolder.projectId ? slotHolder.projectId : undefined
  const liveSessionId = liveSessionLine(full.sessions)?.sessionId ?? null
  const denial = reviewDriveDenial(events, full.runs, dismissedDenial)
  return standingNotices(
    {
      shipped,
      branch: feature.branch,
      conflict,
      conflictResolved: !conflict && mergeConflictResolved(events),
      resolveEnded: conflictResolveEnded(events, full.sessions),
      liveSessionId,
      denial,
      unverified: unverifiedReview({ passes: artifacts.data ?? [], tickets: full.tickets }),
      blockingDrive: !driveUp && slotHolder && blockingProjectId ? { holderLabel: slotHolder.holderLabel } : null,
    },
    {
      resolve: () => {
        if (conflict) void resolveConflict.resolve(conflict, liveSessionId ?? undefined)
      },
      resolving: resolveConflict.pending,
      dismissDenial: () => setDismissedDenial(denial?.eventId ?? null),
      stopDrive: () => {
        if (blockingProjectId) stop.mutate({ projectId: blockingProjectId, action: 'stop' })
      },
      stopping: stop.isPending,
    },
  )
}
