import { driveFailure } from '../../lib/feature-ui'
import { PROJECT_DRIVE_SLUG } from '../../lib/project-drive'
import type { SlotDrive } from '../../lib/use-project-drive'
import { IconShield } from '../../icons'
import { Button } from '../../ui'
import { DrivePage } from '../review/DrivePage'
import { DriveStage } from '../review/DriveStage'
import { DriveFailureReport } from '../review/drive-parts'
import { useProjectDriveNotes } from '../review/drive-note-stores'

/**
 * A project drive as the page (test-drive-looks-the-part decision 13): the same
 * page a feature's drive is, on the checkout as it is. The branch is named up
 * front because the checkout is driven as it is (project-level-test-drive
 * decision 3): a checkout sitting somewhere other than main is seen here, before
 * any note is taken.
 */
export function ProjectDriveView({
  projectId,
  repoPath,
  drive,
  hidden,
  onBack,
  onStop,
  stopping,
  onOpenPreparation,
}: {
  projectId: string
  repoPath: string | undefined
  drive: SlotDrive
  /** The human is on the chat page, the drive still running. */
  hidden?: boolean
  /** Back to the chat page. */
  onBack: () => void
  onStop: () => void
  stopping: boolean
  onOpenPreparation: () => void
}) {
  const notes = useProjectDriveNotes(projectId, drive.startedAt)
  // The checkout and identity, read once: the status line, whole on hover.
  const folder = `${repoPath ?? ''}${drive.commit ? ` @ ${drive.commit}` : ''}`
  const where = { text: folder, title: `${folder} · runs as ${PROJECT_DRIVE_SLUG}` }

  return (
    <DrivePage
      title={
        <>
          Driving <span className="font-mono text-text">{drive.branch}</span>
        </>
      }
      store={notes}
      hidden={hidden}
      stopping={stopping}
      onBack={onBack}
      onStop={onStop}
      stage={(slots) => (
        <DriveStage
          projectId={projectId}
          branch={drive.branch}
          driveState={drive.state}
          drive={drive}
          failure={driveFailure(drive)}
          where={where}
          onToChat={onBack}
          // Preparation, not Fix drive: that opens an agent scoped to a
          // feature, and preparation is where a project's drive commands are
          // repaired and proven (project-level-test-drive decision 7).
          failureExit={(failure) => (
            <DriveFailureReport
              failure={failure}
              explanation={
                <>
                  Your checkout is as it was, but <code className="font-mono text-xs">{failure.command}</code>{' '}
                  {failure.outcome} — so whatever it was meant to bring up is probably not running. Preparation is
                  where this project’s drive commands are repaired and proven.
                </>
              }
            >
              <Button className="self-start" icon={<IconShield />} onClick={onOpenPreparation}>
                Open preparation
              </Button>
            </DriveFailureReport>
          )}
          {...slots}
        />
      )}
    />
  )
}
