import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { useLivePoll } from '../../lib/live'
import { driveFailure, liveSessionLine } from '../../lib/feature-ui'
import { DrivePage } from './DrivePage'
import { DriveStage } from './DriveStage'
import { useFeatureDriveNotes } from './drive-note-stores'

/**
 * This feature's test drive as the page (test-drive-looks-the-part decision 13):
 * the app with its scenarios, or the honest reason it is not serving yet, beside
 * the drive's notes. The same `driveInfo` key the header's status line reads, so
 * the two agree.
 */
export function FeatureDriveView({
  full,
  hidden,
  stopping,
  onBack,
  onStop,
}: {
  full: Pick<FeatureFull, 'feature' | 'sessions'>
  /** The human is on the chat page, the drive still running. */
  hidden?: boolean
  stopping: boolean
  /** Back to the chat page. */
  onBack: () => void
  onStop: () => void
}) {
  const { feature } = full
  const drive = trpc.feature.driveInfo.useQuery({ projectId: feature.projectId }, { refetchInterval: useLivePoll() })
  // The slot is shared with preparation's dry run, which belongs to no feature.
  const ownDrive = drive.data?.featureId === feature.id ? drive.data : undefined
  const notes = useFeatureDriveNotes(feature.id, onBack)
  return (
    <DrivePage
      title={feature.title}
      store={notes}
      hidden={hidden}
      stopping={stopping}
      onBack={onBack}
      onStop={onStop}
      stage={(slots) => (
        <DriveStage
          projectId={feature.projectId}
          featureId={feature.id}
          branch={feature.branch}
          driveState={ownDrive?.state ?? 'idle'}
          drive={ownDrive}
          dryRun={drive.data?.dryRun ?? false}
          failure={driveFailure(ownDrive, { sessionLive: !!liveSessionLine(full.sessions) })}
          onToChat={onBack}
          {...slots}
        />
      )}
    />
  )
}
