import { useState, type ReactNode } from 'react'
import { driveFailure, driveView } from '../../lib/feature-ui'
import type { SlotDrive } from '../../lib/use-project-drive'
import {
  IconAlert,
  IconClock,
  IconFolder,
  IconMessage,
  IconPanelRight,
  IconPlay,
  IconShield,
  IconStop,
  IconTerminal,
  IconUser,
} from '../../icons'
import { AsideLayout, Button, EmptyState, IconButton, MetaLine, PageTopbar, StatusLabel, Tabs } from '../../ui'
import { DrivePanel } from '../review/DrivePanel'
import { DriveFailureReport, DriveFooter } from '../review/drive-parts'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { ProjectNotesRail } from './ProjectNotesRail'

/**
 * A project drive, owning the workspace body the way a live chat does
 * (project-level-test-drive decision 4): a topbar (project › Test drive, Stop,
 * the notes toggle), the checkout's app under a header that names what is being
 * driven, and the project's notes inbox as the one aside on the right.
 *
 * The stage is composed from the feature drive's parts rather than its
 * `EvidenceStage`, which is bound to a feature's recordings and test notes; the
 * states are the same server-derived `DriveState` read through `driveView`.
 */
export function ProjectDriveView({
  projectId,
  projectName = 'Project',
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
  /** The parent crumb — clicking it steps back to the project page. */
  projectName?: string
  repoPath: string | undefined
  drive: SlotDrive
  hidden: boolean
  /** Step back to the resting page; the drive keeps running. */
  onProjectPage: () => void
  onStop: () => void
  stopping: boolean
  onOpenPreparation: () => void
  /** The Chat | Drive tabs, when a live chat shares the body. */
  switcher?: ReactNode
}) {
  // The notes aside is the point of driving, so it starts open; the topbar
  // toggle folds it away for a wider stage.
  const [notesOpen, setNotesOpen] = useState(true)
  const stage = driveView(drive.state).stageKind
  const state =
    stage === 'failed' ? (
      <StatusLabel tone="danger">Setup failed</StatusLabel>
    ) : stage === 'starting' ? (
      <StatusLabel spinning>Starting</StatusLabel>
    ) : (
      <StatusLabel tone="live">Running</StatusLabel>
    )
  const stop = (
    <Button icon={<IconStop />} loading={stopping} disabled={stopping} onClick={onStop}>
      Stop drive
    </Button>
  )
  const where = `${repoPath ?? ''}${drive.commit ? ` @ ${drive.commit}` : ''}`

  return (
    <div
      className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}
      aria-hidden={hidden}
      data-project-drive
    >
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, onClick: onProjectPage },
          { label: 'Test drive', icon: <IconPlay /> },
        ]}
        tabs={switcher}
        actions={
          <>
            {stop}
            <IconButton
              label={notesOpen ? 'Hide notes' : 'Show notes'}
              icon={<IconPanelRight />}
              active={notesOpen}
              onClick={() => setNotesOpen((open) => !open)}
            />
          </>
        }
      />
      <AsideLayout
        aside={
          notesOpen && (
            <ProjectNotesRail
              projectId={projectId}
              startedAt={drive.startedAt}
              onClose={() => setNotesOpen(false)}
            />
          )
        }
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-4 animate-fade-in">
          {/* The branch is named up front because the checkout is driven as it
              is (decision 3): a checkout sitting somewhere other than main is
              seen here, before any note is taken. */}
          <header className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="m-0 text-lg font-semibold text-text">
                Driving <span className="font-mono text-base font-medium">{drive.branch}</span>
              </h2>
              {state}
            </div>
            <MetaLine
              items={[
                { icon: <IconFolder />, mono: true, text: where, title: where },
                { icon: <IconUser />, mono: true, text: 'project-drive', title: 'the identity this drive runs as' },
              ]}
            />
          </header>

          <ProjectStage
            projectId={projectId}
            drive={drive}
            stop={stop}
            onOpenPreparation={onOpenPreparation}
          />
          <DriveFooter branch={drive.branch} drive={drive} />
        </div>
      </AsideLayout>
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
    // (decision 7). The drive stays up, so the notes aside keeps working.
    case 'failed':
      return failure ? (
        <StageFrame>
          <DriveFailureReport
            failure={failure}
            explanation={
              <>
                Your checkout is as it was, but{' '}
                <code className="font-mono text-xs">{failure.command}</code> {failure.outcome} — so
                whatever it was meant to bring up is probably not running. Preparation is where this
                project’s drive commands are repaired and proven.
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={<IconShield />} onClick={onOpenPreparation}>
                Open preparation
              </Button>
              {stop}
            </div>
          </DriveFailureReport>
        </StageFrame>
      ) : (
        <StageFrame>
          <EmptyState
            icon={<IconAlert />}
            title="The drive’s setup command failed"
            hint="Its output is in the timeline."
          />
        </StageFrame>
      )

    // Nothing was meant to start, so nothing is claimed to have (findings F22).
    case 'bare':
      return (
        <StageFrame>
          <EmptyState
            icon={<IconTerminal />}
            title="Setup ran — nothing started."
            hint={
              <>
                This project has no dev command ·{' '}
                <SettingsLink location={{ page: 'project', field: 'devCommand' }}>
                  Set one in Settings
                </SettingsLink>{' '}
                and the next drive boots the app right here.
              </>
            }
          />
        </StageFrame>
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
        <StageFrame>
          <EmptyState
            icon={<IconClock />}
            title="Waiting for an address"
            hint="The dev server is up but has not printed an address yet — its output is under the stage."
          />
        </StageFrame>
      )

    default:
      return (
        <StageFrame>
          <div className="flex flex-col items-center gap-2 text-center">
            <StatusLabel tone="live" size="sm" strong>
              Starting the dev server…
            </StatusLabel>
            <p className="m-0 max-w-[52ch] text-sm text-pretty text-text-tertiary">
              Your checkout is driven as it is and the project’s dev command is running. The app
              appears here as soon as it answers — its output is under the stage.
            </p>
          </div>
        </StageFrame>
      )
  }
}

/** What fills the project page's body: the resting overview, a live chat, a live drive. */
export type ProjectView = 'overview' | 'chat' | 'drive'

/**
 * The project page's view tabs, shown in every topbar of the page while a chat
 * or a drive is live — so the overview (chats, New chat, Test drive) is never
 * more than one labelled click away from either, and back again.
 */
export function ProjectViewSwitch({
  value,
  chat,
  drive,
  onPick,
}: {
  value: ProjectView
  /** A chat is live — offer its tab. */
  chat: boolean
  /** A drive is live — offer its tab. */
  drive: boolean
  onPick: (view: ProjectView) => void
}) {
  return (
    <Tabs<ProjectView>
      label="Project views"
      size="sm"
      value={value}
      onChange={onPick}
      items={[
        { id: 'overview', label: 'Overview', icon: <IconFolder /> },
        ...(chat ? [{ id: 'chat' as const, label: 'Live chat', icon: <IconMessage /> }] : []),
        ...(drive ? [{ id: 'drive' as const, label: 'Drive', icon: <IconPlay /> }] : []),
      ]}
    />
  )
}

/**
 * The stage's ground when it is not showing the app: the inset surface the app
 * will fill, not a bordered card.
 */
function StageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-65 flex-1 flex-col justify-center rounded-md bg-surface-inset p-6">
      {children}
    </div>
  )
}
