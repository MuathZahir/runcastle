import type { ReactNode } from 'react'
import type { DriveScenario, DriveState } from '@runcastle/core'
import { EmptyState, Spinner, StatusLabel } from '../../ui'
import { IconClock, IconShield, IconTerminal } from '../../icons'
import { driveView, type DriveFailure } from '../../lib/feature-ui'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { DrivePanel } from './DrivePanel'
import { ScenarioDrive } from './ScenarioDrive'
import { DriveFooter, DriveSetupFailed, DriveStateWindow } from './drive-parts'

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
  failureExit,
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
  failureExit?: (failure: DriveFailure) => ReactNode
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
  const frame = (state: ReactNode, moment: ReactNode, withFooter = true) => (
    <DriveStateWindow state={state} leading={leading} trailing={trailing} footer={withFooter ? footer : undefined}>
      {moment}
    </DriveStateWindow>
  )

  if (driveState === 'idle') {
    return dryRun
      ? frame(
          <StatusLabel tone="neutral">Drive held</StatusLabel>,
          <EmptyState
            icon={<IconShield />}
            title="A preparation dry run is holding the drive"
            hint={<>It is proving this project’s drive commands on your machine. Stop it from Preparation, and this branch can take the wheel.</>}
          />,
          false,
        )
      : frame(
          <StatusLabel spinning>Starting</StatusLabel>,
          <EmptyState
            icon={<Spinner />}
            title="Starting the test drive"
            hint={<>Checking the branch out.</>}
          />,
          false,
        )
  }

  switch (driveView(driveState).stageKind) {
    case 'starting':
      return frame(
        <StatusLabel spinning>Starting</StatusLabel>,
        <EmptyState
            icon={<Spinner />}
            title="Starting the dev server"
            hint={<>The branch is checked out and the project’s dev command is running. The app appears here as soon as it answers; its output is under the window.</>}
          />,
      )

    // The state is derived FROM the failure server-side, so `failure` is
    // present here; the guard keeps a wire that disagrees with itself from
    // rendering an empty window.
    case 'failed':
      return frame(
        <StatusLabel tone="danger">Setup failed</StatusLabel>,
        failure ? (
          failureExit ? (
            failureExit(failure)
          ) : featureId ? (
            <DriveSetupFailed featureId={featureId} failure={failure} onToChat={onToChat} />
          ) : null
        ) : (
          <EmptyState
            icon={<IconTerminal />}
            title="The drive’s setup command failed"
            hint={<>Its output is in the timeline.</>}
          />
        ),
      )

    // Nothing was meant to start, so nothing is claimed to have (findings F22).
    case 'bare':
      return frame(
        <StatusLabel tone="neutral">Nothing started</StatusLabel>,
        <EmptyState
            icon={<IconTerminal />}
            title="Branch checked out, nothing started"
            hint={<>This project has no dev command.{' '} <SettingsLink location={{ page: 'project', field: 'devCommand' }}>Set one in Settings</SettingsLink>{' '} and the next drive boots the app right here.</>}
          />,
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
          frame(
            <StatusLabel tone="live">Review agent driving</StatusLabel>,
            <EmptyState
            icon={<IconClock />}
            title="No dev server answered"
            hint={<>The review agent is driving this branch. Its notes land as it finds things.</>}
          />,
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
    frame(
      <StatusLabel tone="live">Running</StatusLabel>,
      <EmptyState
            icon={<IconClock />}
            title="Waiting for an address"
            hint={<>The dev server is up but has not printed an address yet. Its output is under the window.</>}
          />,
    )
  )
}
