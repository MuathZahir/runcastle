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
import { slotBlocker, standingNotices, type SlotDriveInfo } from '../../lib/standing-notices'
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
  drive: SlotDriveInfo | null | undefined
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
  // Each kind of holder ends through its own stop; a refused stop says why.
  const stopped = {
    onSuccess: (res: { ok: boolean; deniedReason?: string }) => {
      if (!res.ok && res.deniedReason) toast.push(res.deniedReason)
      void utils.feature.driveInfo.invalidate()
    },
    onError: (e: { message: string }) => toast.push(e.message),
  }
  const stopFeature = trpc.feature.testDrive.useMutation(stopped)
  const stopProject = trpc.project.testDrive.useMutation(stopped)
  const stopDryRun = trpc.project.dryRunStop.useMutation(stopped)
  if (!full) return []
  const { feature } = full
  const blocker = slotBlocker(drive, feature, driveUp)
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
      blockingDrive: blocker,
    },
    {
      resolve: () => {
        if (conflict) void resolveConflict.resolve(conflict, liveSessionId ?? undefined)
      },
      resolving: resolveConflict.pending,
      dismissDenial: () => setDismissedDenial(denial?.eventId ?? null),
      stopDrive: () => {
        const stop = blocker?.stop
        if (stop?.kind === 'feature') stopFeature.mutate({ featureId: stop.featureId, action: 'stop' })
        else if (stop?.kind === 'project') stopProject.mutate({ projectId: stop.projectId, action: 'stop' })
        else if (stop?.kind === 'dryRun') stopDryRun.mutate({ projectId: stop.projectId })
      },
      stopping: stopFeature.isPending || stopProject.isPending || stopDryRun.isPending,
    },
  )
}
