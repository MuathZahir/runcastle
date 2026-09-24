import type { ReactNode } from 'react'
import { driveFailure, driveView } from '../../lib/feature-ui'
import type { SlotDrive } from '../../lib/use-project-drive'
import { Button } from '../../ui'
import { DrivePanel } from '../review/DrivePanel'
import { DriveFailureReport, DriveFooter } from '../review/drive-parts'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { ProjectNotesRail } from './ProjectNotesRail'

/**
 * A project drive, owning the workspace body the way a live chat does
 * (project-level-test-drive decision 4): the checkout's app on the left under a
 * header that names what is being driven, the project's notes inbox on the
 * right.
 *
 * The stage is composed from the feature drive's parts rather than its
 * `EvidenceStage`, which is bound to a feature's recordings and test notes; the
 * states are the same server-derived `DriveState` read through `driveView`.
 */
export function ProjectDriveView({
  projectId,
  repoPath,
  drive,
  hidden,
  onProjectPage,
  onStop,
  stopping,
  onOpenPreparation,
  switcher,
}: {
  projectId: string
  repoPath: string | undefined
  drive: SlotDrive
  hidden: boolean
  /** Step back to the resting page; the drive keeps running. */
  onProjectPage: () => void
  onStop: () => void
  stopping: boolean
  onOpenPreparation: () => void
  /** The Chat | Drive switch, when a live chat shares the body. */
  switcher?: ReactNode
}) {
  const stop = (
    <Button disabled={stopping} onClick={onStop}>
      {stopping ? 'Stopping…' : 'Stop drive'}
    </Button>
  )

  return (
    <div
      className={hidden ? 'hidden' : 'flex min-h-0 flex-1'}
      aria-hidden={hidden}
      data-project-drive
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {/* The branch is named up front because the checkout is driven as it is
            (decision 3): a checkout sitting somewhere other than main is seen
            here, before any note is taken. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h2 className="m-0 shrink-0 text-base font-semibold text-text">
              Driving{' '}
              <code className="rounded-sm border border-accent-line bg-accent-soft px-1.5 font-mono text-sm text-drive">
                {drive.branch}
              </code>
            </h2>
            <span
              className="min-w-0 truncate font-mono text-xs text-text-3"
              title={drive.commit ? `${repoPath ?? ''} @ ${drive.commit}` : repoPath}
            >
              {repoPath}
              {drive.commit && ` @ ${drive.commit}`}
            </span>
          </div>
          {switcher}
          <Button onClick={onProjectPage}>Project page</Button>
          {stop}
        </div>

        <ProjectStage
          projectId={projectId}
          drive={drive}
          stop={stop}
          onOpenPreparation={onOpenPreparation}
        />
        <DriveFooter branch={drive.branch} drive={drive} />
      </div>

      <ProjectNotesRail projectId={projectId} startedAt={drive.startedAt} />
    </div>
  )
}

/** The stage, in whichever state the server says the drive is in. */
function ProjectStage({
  projectId,
  drive,
  stop,
  onOpenPreparation,
}: {
  projectId: string
  drive: SlotDrive
  stop: ReactNode
  onOpenPreparation: () => void
}) {
  const failure = driveFailure(drive)

  switch (driveView(drive.state).stageKind) {
    // Preparation, not Fix drive: that opens an agent scoped to a feature, and
    // preparation is where a project's drive commands are repaired and proven
    // (decision 7). The drive stays up, so the notes rail keeps working.
    case 'failed':
      return failure ? (
        <StageBox>
          <DriveFailureReport
            failure={failure}
            explanation={
              <>
                Your checkout is as it was, but{' '}
                <code className="font-mono">{failure.command}</code> {failure.outcome} — so
                whatever it was meant to bring up is probably not running. Preparation is where this
                project’s drive commands are repaired and proven.
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Button variant="solid" onClick={onOpenPreparation}>
                Open preparation
              </Button>
              {stop}
            </div>
          </DriveFailureReport>
        </StageBox>
      ) : (
        <StageBox>
          <div className="text-sm text-text-2">
            The drive’s setup command failed — its output is in the timeline.
          </div>
        </StageBox>
      )

    // Nothing was meant to start, so nothing is claimed to have (findings F22).
    case 'bare':
      return (
        <StageBox>
          <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-text">Setup ran — nothing started.</div>
            <div className="text-sm text-text-2">
              This project has no dev command ·{' '}
              <SettingsLink location={{ page: 'project', field: 'devCommand' }}>
                Set one in Settings
              </SettingsLink>{' '}
              and the next drive boots the app right here.
            </div>
          </div>
        </StageBox>
      )

    case 'panel':
    case 'agent':
      if (drive.devUrl) {
        return (
          <div className="flex min-h-100 flex-1 flex-col">
            <DrivePanel projectId={projectId} url={drive.devUrl} />
          </div>
        )
      }
      return (
        <StageBox>
          <div className="text-sm text-text-2">
            The dev server is up but has not printed an address yet — its output is under the
            stage.
          </div>
        </StageBox>
      )

    default:
      return (
        <StageBox>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="size-2 animate-pulse rounded-pill bg-drive" />
              <span className="text-sm font-semibold text-drive">starting the dev server…</span>
            </div>
            <div className="text-sm text-text-2">
              Your checkout is driven as it is and the project’s dev command is running. The app
              appears here as soon as it answers — its output is under the stage.
            </div>
          </div>
        </StageBox>
      )
  }
}

/** The stage's frame when it is not showing the app. */
function StageBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-65 flex-1 flex-col justify-center rounded-md border border-hairline bg-panel p-5">
      {children}
    </div>
  )
}
