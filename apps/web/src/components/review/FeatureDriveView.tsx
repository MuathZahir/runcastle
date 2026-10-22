import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { useLivePoll } from '../../lib/live'
import { driveFailure, liveSessionLine } from '../../lib/feature-ui'
import { EvidenceStage } from './EvidenceStage'

/**
 * The panel's drive view (design-mode decision 5): this feature's test drive —
 * the app with its scenarios, or the honest reason it is not serving yet —
 * on the evidence stage's drive side, with no recording to swap to. The same
 * `driveInfo` key the bar and the review body read, so all three agree.
 */
export function FeatureDriveView({ full }: { full: Pick<FeatureFull, 'feature' | 'sessions'> }) {
  const { feature } = full
  const drive = trpc.feature.driveInfo.useQuery({ projectId: feature.projectId }, { refetchInterval: useLivePoll() })
  const notes = trpc.notes.list.useQuery({ featureId: feature.id })
  // The slot is shared with preparation's dry run, which belongs to no feature.
  const ownDrive = drive.data?.featureId === feature.id ? drive.data : undefined
  return (
    <div className="flex min-h-full flex-col p-4">
      <EvidenceStage
        featureId={feature.id}
        projectId={feature.projectId}
        branch={feature.branch}
        recordings={[]}
        notes={notes.data ?? []}
        readonly={false}
        driveState={ownDrive?.state ?? 'idle'}
        drive={ownDrive}
        dryRun={drive.data?.dryRun ?? false}
        failure={driveFailure(ownDrive, { sessionLive: !!liveSessionLine(full.sessions) })}
      />
    </div>
  )
}
