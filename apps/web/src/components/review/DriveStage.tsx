import type { ReactNode } from 'react'
import type { DriveScenario, DriveState } from '@runcastle/core'
import { Spinner, StatusLabel } from '../../ui'
import { IconClock, IconShield, IconTerminal } from '../../icons'
import { driveView, type DriveFailure } from '../../lib/feature-ui'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { DrivePanel } from './DrivePanel'
import { ScenarioDrive } from './ScenarioDrive'
import { DriveFooter, DriveMoment, DriveSetupFailed, DriveStateWindow } from './drive-parts'

/** The active drive as the stage reads it; whose it is comes from the server's `driveState`. */
export interface StageDrive {
  branch: string
  devPaneId?: string
  devUrl?: string
  devReady?: boolean
  devReadyTimedOut?: boolean
  /** The scenario the drive is in, and its chat (drive-scenarios). */
  scenario?: DriveScenario
  scenarioSessionId?: string
}

/**
 * A test drive, in whichever state the server says it is in — the one stage the
 * feature drive and the project drive share (test-drive-looks-the-part
 * decision 3). Serving, it is the app in the drive window with its scenarios;
 * otherwise it is the same window with the moment centred where the app will
 * appear. Only the way out of a failed setup differs, and the caller says it.
 * The head's two ends are the caller's: `leading` (the way back, what is being
 * driven) and `trailing` (Stop, the notes toggle), in every state.
 *
 * The states come from the server's one drive-state value (decision 20 of the
 * review flow), read through `driveView`, as the header's status line reads it.
 */
export function DriveStage({
  projectId,
  featureId,
  branch,
  driveState,
  drive,
  dryRun = false,
  failure,
  failed,
  where,
  leading,
  trailing,
  onCapture,
  onToChat,
}: {
  projectId: string
  /** Set on a feature drive: its scenarios first, captures land as its notes, Fix drive. Absent on a project drive. */
  featureId?: string
  branch: string
  driveState: DriveState
  drive?: StageDrive
  /** A preparation dry run is holding the one drive slot. */
  dryRun?: boolean
  failure: DriveFailure | null
  /** A project drive's way out of a failed setup; a feature drive offers Fix drive itself. */
  failed?: (failure: DriveFailure) => ReactNode
  /** A project drive's checkout and identity, for the status line (decision 5). */
  where?: { text: string; title: string }
  leading?: ReactNode
  trailing?: ReactNode
  /** Where a selected area of the app goes: the note box. */
  onCapture?: (png: Blob) => void
  /** An errand opened a chat, which lives on the chat page. */
  onToChat?: () => void
}) {
  const footer = <DriveFooter branch={drive?.branch ?? branch} drive={drive} where={where} />
  const window = (state: ReactNode, moment: ReactNode, withFooter = true) => (
    <DriveStateWindow state={state} leading={leading} trailing={trailing} footer={withFooter ? footer : undefined}>
      {moment}
    </DriveStateWindow>
  )

  if (driveState === 'idle') {
    return dryRun
      ? window(
          <StatusLabel tone="neutral">Drive held</StatusLabel>,
          <DriveMoment icon={<IconShield />} title="A preparation dry run is holding the drive">
            It is proving this project’s drive commands on your machine. Stop it from Preparation, and
            this branch can take the wheel.
          </DriveMoment>,
          false,
        )
      : window(
          <StatusLabel spinning>Starting</StatusLabel>,
          <DriveMoment icon={<Spinner />} title="Starting the test drive">
            Checking the branch out.
          </DriveMoment>,
          false,
        )
  }

  switch (driveView(driveState).stageKind) {
    case 'starting':
      return window(
        <StatusLabel spinning>Starting</StatusLabel>,
        <DriveMoment icon={<Spinner />} title="Starting the dev server">
          The branch is checked out and the project’s dev command is running. The app appears here as
          soon as it answers; its output is under the window.
        </DriveMoment>,
      )

    // The state is derived FROM the failure server-side, so `failure` is
    // present here; the guard keeps a wire that disagrees with itself from
    // rendering an empty window.
    case 'failed':
      return window(
        <StatusLabel tone="danger">Setup failed</StatusLabel>,
        failure ? (
          failed ? (
            failed(failure)
          ) : featureId ? (
            <DriveSetupFailed featureId={featureId} failure={failure} />
          ) : null
        ) : (
          <DriveMoment icon={<IconTerminal />} title="The drive’s setup command failed">
            Its output is in the timeline.
          </DriveMoment>
        ),
      )

    // Nothing was meant to start, so nothing is claimed to have (findings F22).
    case 'bare':
      return window(
        <StatusLabel tone="neutral">Nothing started</StatusLabel>,
        <DriveMoment icon={<IconTerminal />} title="Branch checked out, nothing started">
          This project has no dev command.{' '}
          <SettingsLink location={{ page: 'project', field: 'devCommand' }}>Set one in Settings</SettingsLink>{' '}
          and the next drive boots the app right here.
        </DriveMoment>,
      )

    // The review agent is at the wheel: the app shows exactly as the human's
    // own drive shows it and the toolbar says whose hands are on it. The
    // head's Stop drive is purpose-blind, so it takes the wheel back.
    case 'agent':
      if (featureId) {
        return drive?.devUrl ? (
          <DrivePanel
            url={drive.devUrl}
            agentDriving
            leading={leading}
            trailing={trailing}
            footer={footer}
            onCapture={onCapture}
          />
        ) : (
          window(
            <StatusLabel tone="live">Review agent driving</StatusLabel>,
            <DriveMoment icon={<IconClock />} title="No dev server answered">
              The review agent is driving this branch. Its notes land as it finds things.
            </DriveMoment>,
          )
        )
      }
      break
  }

  // The human's own drive: the app with its scenarios (drive-scenarios decision 7).
  return drive?.devUrl ? (
    <ScenarioDrive
      projectId={projectId}
      featureId={featureId}
      drive={{ ...drive, devUrl: drive.devUrl }}
      leading={leading}
      trailing={trailing}
      footer={footer}
      onCapture={onCapture}
      onToChat={onToChat}
    />
  ) : (
    window(
      <StatusLabel tone="live">Running</StatusLabel>,
      <DriveMoment icon={<IconClock />} title="Waiting for an address">
        The dev server is up but has not printed an address yet. Its output is under the window.
      </DriveMoment>,
    )
  )
}
