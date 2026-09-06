import { useEffect, useState, type RefObject } from 'react'
import { fmtClock, type DriveState, type TestNote } from '@runcastle/core'
import { Button } from '../../ui'
import { driveView, latestReview, type DriveFailure } from '../../lib/feature-ui'
import type { DriveCapabilities } from '../../lib/prep-findings'
import type { ReviewArtifacts } from '../../lib/reviews'
import { testDriveExplainer, testDriveLead } from '../../lib/vocabulary'
import { clusterMarkers } from '../../lib/walkthrough'
import { WalkthroughPlayer, type WalkthroughHandle } from '../WalkthroughPlayer'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { DrivePanel } from './DrivePanel'
import { DriveFooter, DriveSetupFailed, StopDrive } from './drive-parts'

/**
 * The top of the review page: one large evidence stage (decision 17).
 *
 * Not a card among cards and not a two-up split — roughly the full content
 * width, 16:9, and the first thing a returning human sees. By default it plays
 * the latest completed review pass's walkthrough; the moment a test drive is up
 * it becomes the drive panel, and stopping the drive swaps it back. Watching the
 * recording and driving the app are the same activity — inspecting the build
 * with annotation tools in hand — and never happen at once, so they share one
 * canvas.
 *
 * The stage is never a dead card. With no recording yet it says so and offers
 * the drive; a drive problem that is about the stage (setup failed, a bare
 * checkout) renders IN the stage, where the video would be, because that is
 * where the eye already is.
 *
 * Which of the two is on the stage, and what a drive that is not serving shows
 * instead, both come from the server's one drive-state value (decision 20) —
 * the same value the next-step bar resolves from, so the bar can no longer
 * invite a merge over a bare checkout or a failed setup command.
 */

/**
 * The active drive as the stage and its parts read it. Whose drive it is and
 * whether a dev command exists are not here: both are already answered by the
 * server's `driveState` (decision 20), and a second copy of either is a second
 * thing that can disagree with the bar.
 */
export interface StageDrive {
  branch: string
  devPaneId?: string
  devUrl?: string
  devReady?: boolean
  devReadyTimedOut?: boolean
}

/**
 * What a read-only view says when the review reported without ever driving.
 *
 * Exported because the shipped body says it *instead of* mounting the stage: a
 * page where no drive can ever start has nothing to put in a 16:9 box, so the
 * sentence is the whole band there (and the stage still says it where a
 * read-only review view does mount).
 */
export const NO_WALKTHROUGH_RECORDED =
  'No walkthrough was recorded for this feature — the review reported without driving.'

/** Which side of the swap is showing, from the server's one drive-state value. */
function stageShows(state: DriveState, hasRecording: boolean): 'player' | 'drive' {
  return driveView(state).stageKind === 'player' && hasRecording ? 'player' : 'drive'
}

/**
 * The recording's identity line (decision 41b): what this is, how long, and
 * which build it describes.
 *
 * `fixes` is how many implementation tickets landed between the pass before this
 * one and this one — the fixes a verification pass was minted to confirm. It is
 * an approximation from the landed-since counts rather than a read of the pass's
 * own brief, which is why the header carries it with a title saying so.
 */
function stageIdentity(
  recording: Pick<ReviewArtifacts, 'passKind' | 'reviewedCommit' | 'landedSince'>,
  duration: number | null,
  fixes: number | null,
): string {
  const parts = [recording.passKind === 'verification' ? 'Verification walkthrough' : 'Walkthrough']
  if (duration !== null && duration > 0) parts.push(fmtClock(duration))
  if (recording.passKind === 'verification' && fixes !== null && fixes > 0) {
    parts.push(`confirms ${fixes} fix${fixes === 1 ? '' : 'es'}`)
  }
  parts.push(
    recording.landedSince === 0
      ? 'this build'
      : `reviewed ${recording.reviewedCommit ? recording.reviewedCommit.slice(0, 7) : 'an earlier build'}`,
  )
  return parts.join(' · ')
}

/** How an older recording names itself in the "earlier recordings" list. */
function recordingLabel(recording: ReviewArtifacts): string {
  return `Lap ${recording.lap} · ${recording.passKind === 'verification' ? 'verification pass' : 'review pass'} · #${recording.seq}`
}

export function EvidenceStage({
  featureId,
  branch,
  recordings,
  notes,
  readonly,
  driveState,
  drive,
  dryRun,
  failure,
  caps,
  starting,
  onStartDrive,
  handleRef,
  onStageRecording,
  onMarkerClick,
  onAnnotationSaved,
}: {
  featureId: string
  branch: string
  /** Every review pass that left a recording, newest last. */
  recordings: readonly ReviewArtifacts[]
  notes: readonly TestNote[]
  /** Looking back at review on a shipped feature — the record plays, nothing acts. */
  readonly: boolean
  /** The server's own drive-state value (decision 20) — one truth for bar and stage. */
  driveState: DriveState
  drive?: StageDrive
  /** A preparation dry run is holding the one drive slot (decision 9). */
  dryRun: boolean
  failure: DriveFailure | null
  /**
   * What a drive on THIS project actually does, read off its settings —
   * `undefined` while they are still loading. The dev command is what Open app
   * depends on; the whole set is what the stage's explainer describes.
   */
  caps: DriveCapabilities | undefined
  starting: boolean
  onStartDrive: () => void
  handleRef?: RefObject<WalkthroughHandle | null>
  /**
   * Which recording is playing right now, or null when the stage is the drive.
   * The open-work rows below need it reactively — a timestamp is only a live
   * jump into the recording it was taken against (decision 22) — and the handle
   * ref beside it cannot say so, because a ref does not re-render its readers.
   */
  onStageRecording?: (recording: { ticketId: string } | null) => void
  /** A scrub-bar marker was clicked: highlight the notes taken at that moment. */
  onMarkerClick?: (noteIds: string[]) => void
  /** A note was just captured, so the list below can scroll to it. */
  onAnnotationSaved?: (noteId: string) => void
}) {
  const devConfigured = caps?.dev ?? false
  // Which recording is on the stage. Null means "the latest", so a verification
  // pass landing while the page is open puts the fresh recording up rather than
  // pinning whatever was latest at mount.
  const [picked, setPicked] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)

  const latest = latestReview(recordings)
  const onStage = recordings.find((r) => r.ticketId === picked) ?? latest
  const earlier = recordings.filter((r) => r.ticketId !== onStage?.ticketId)
  const showing = stageShows(driveState, !!onStage?.videoUrl)

  // The fixes a verification pass confirms: what landed between the pass before
  // it and it. Both counts are "implementation tickets done since", so their
  // difference is the window between the two passes.
  const index = onStage ? recordings.indexOf(onStage) : -1
  const previous = index > 0 ? recordings[index - 1] : undefined
  const fixes = onStage && previous ? previous.landedSince - onStage.landedSince : null

  const view = driveView(driveState)
  // The app fills its own frame; every other drive state is prose in a padded
  // card where the video would be.
  const fills = view.stageKind === 'panel' || view.stageKind === 'agent'

  const playing = showing === 'player' && onStage?.videoUrl ? onStage.ticketId : null
  useEffect(() => {
    onStageRecording?.(playing ? { ticketId: playing } : null)
  }, [onStageRecording, playing])

  return (
    // `evidence-stage` is what a note's timestamp scrolls back to, so a jump
    // never moves the playhead off screen (decision 25b).
    <section id="evidence-stage" className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-sm text-text-2">
          {onStage ? (
            <span
              title={
                onStage.passKind === 'verification'
                  ? 'the fix count is derived from what landed between the two passes'
                  : undefined
              }
            >
              {stageIdentity(onStage, duration, fixes)}
            </span>
          ) : (
            'No walkthrough yet'
          )}
        </span>

        {earlier.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer list-none font-mono text-xs text-text-3 underline decoration-dotted">
              Earlier recordings ({earlier.length})
            </summary>
            <ul className="absolute top-[calc(100%+6px)] left-0 z-20 flex w-80 list-none flex-col gap-0.5 rounded-md border border-hairline-strong bg-panel-3 p-1.5">
              {earlier.map((recording) => (
                <li key={recording.ticketId}>
                  <Button
                    className="w-full justify-start border-0 font-mono text-xs"
                    onClick={() => {
                      setPicked(recording.ticketId)
                      setDuration(null)
                    }}
                  >
                    {recordingLabel(recording)}
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <span className="flex-1" />

        {!readonly && driveState === 'idle' && (
          <span className="flex items-center gap-2">
            <Button disabled={!devConfigured || starting} onClick={onStartDrive}>
              Open app ▶
            </Button>
            {!devConfigured && (
              <span className="font-mono text-xs text-text-3">
                no dev command · set one in Settings
              </span>
            )}
          </span>
        )}
      </header>

      {showing === 'player' && onStage?.videoUrl ? (
        <WalkthroughPlayer
          key={onStage.ticketId}
          url={onStage.videoUrl}
          featureId={featureId}
          ticketId={onStage.ticketId}
          passKind={onStage.passKind}
          readonly={readonly}
          markers={clusterMarkers(notes, onStage.ticketId)}
          onMarkerClick={onMarkerClick}
          onAnnotationSaved={onAnnotationSaved}
          onDuration={setDuration}
          handleRef={handleRef}
        />
      ) : (
        <div
          className={
            fills
              ? 'flex aspect-video max-h-[calc(100vh-320px)] w-full flex-col overflow-hidden rounded-md border border-hairline bg-black'
              : 'flex aspect-video max-h-[calc(100vh-320px)] w-full flex-col overflow-auto rounded-md border border-hairline bg-panel-2 p-4'
          }
        >
          <DriveStage
            featureId={featureId}
            branch={branch}
            driveState={driveState}
            drive={drive}
            dryRun={dryRun}
            failure={failure}
            devConfigured={devConfigured}
            hasRecording={!!onStage?.videoUrl}
            readonly={readonly}
          />
        </div>
      )}

      {/* Under the stage while a drive is up (decision 20's footer chrome):
          which server, which branch, and its output one click away. */}
      {view.footer.showDevChip && (
        <DriveFooter branch={drive?.branch ?? branch} drive={drive} />
      )}

      {/* Idle with a dev command: one line about what Open app will do, with
          the full checkout/teardown account behind a disclosure. The stretched
          explainer card that used to be its own band on the page is gone. */}
      {!readonly && driveState === 'idle' && devConfigured && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-2">{testDriveLead(caps)}</p>
          <details>
            <summary className="cursor-pointer text-sm text-text-3">
              What a test drive does
            </summary>
            <p className="mt-2 text-sm text-text-2">{testDriveExplainer(caps)}</p>
          </details>
        </div>
      )}
    </section>
  )
}

/**
 * What the stage shows when it is not playing a recording (decision 20): the
 * drive, or the honest reason there is nothing to play.
 */
function DriveStage({
  featureId,
  branch,
  driveState,
  drive,
  dryRun,
  failure,
  devConfigured,
  hasRecording,
  readonly,
}: {
  featureId: string
  branch: string
  driveState: DriveState
  drive?: StageDrive
  dryRun: boolean
  failure: DriveFailure | null
  devConfigured: boolean
  hasRecording: boolean
  readonly: boolean
}) {
  if (driveState === 'idle') {
    if (dryRun) {
      return (
        <div className="text-sm text-text-2">
          A preparation dry-run is holding the drive — it is proving this project’s drive commands
          on your machine. Stop it from Preparation, and this branch can take the wheel.
        </div>
      )
    }
    if (hasRecording) {
      // A recording exists but the stage is showing this: the drive stopped and
      // the player is one render away. Nothing to say beyond the branch.
      return <div className="font-mono text-sm text-text-3">{branch}</div>
    }
    return (
      <div className="text-sm text-text-2">
        {readonly
          ? NO_WALKTHROUGH_RECORDED
          : 'No walkthrough yet — the review agent records one when it drives; you can open the app and take your own notes.'}
        {!devConfigured && !readonly && (
          <div className="mt-2 text-text-3">
            This project has no dev command, so a drive checks the branch out and starts nothing ·{' '}
            <SettingsLink location={{ page: 'project', field: 'devCommand' }}>
              set one in Settings
            </SettingsLink>
            .
          </div>
        )}
      </div>
    )
  }

  // Readonly describes what a drive did; it never instructs and never acts
  // (decision 33a), so every control below is gated on it rather than on the
  // state that mounted the card.
  const stop = readonly ? null : <StopDrive featureId={featureId} label="Stop test drive" />

  switch (driveView(driveState).stageKind) {
    case 'starting':
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="size-2 animate-pulse rounded-pill bg-drive" />
            <span className="text-sm font-semibold text-drive">starting the dev server…</span>
            <span className="font-mono text-xs text-text-2">{drive?.branch ?? branch}</span>
          </div>
          <div className="text-sm text-text-2">
            The branch is checked out and the project’s dev command is running. The app appears here
            as soon as it answers — its output is under the stage.
          </div>
        </div>
      )

    // The state is derived FROM the failure server-side, so `failure` is
    // present here; the guard is what keeps a wire that disagrees with itself
    // from rendering an empty card.
    case 'failed':
      return failure ? (
        <DriveSetupFailed featureId={featureId} failure={failure} readonly={readonly} />
      ) : (
        <div className="text-sm text-text-2">
          The drive’s setup command failed — its output is in the timeline.
        </div>
      )

    // Nothing was meant to start, so nothing is claimed to have (findings F22).
    case 'bare':
      return (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-text">
            Branch checked out — nothing started.
          </div>
          <div className="text-sm text-text-2">
            {readonly ? (
              'This project had no dev command, so the drive checked the branch out and started nothing.'
            ) : (
              <>
                This project has no dev command ·{' '}
                <SettingsLink location={{ page: 'project', field: 'devCommand' }}>
                  Set one in Settings
                </SettingsLink>{' '}
                and the next drive boots the app right here.
              </>
            )}
          </div>
          {stop}
        </div>
      )

    // The review agent is at the wheel. Its drive is the same machinery on the
    // same checkout, so the app is shown exactly as the human's own drive shows
    // it — with a banner saying whose hands are on it, and the purpose-blind
    // stop that lets the human take the wheel back.
    case 'agent':
      return (
        <>
          {drive?.devUrl ? (
            <DrivePanel featureId={featureId} url={drive.devUrl} agentDriving readonly={readonly} />
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <span className="size-2 animate-pulse rounded-pill bg-drive" />
                <span className="text-sm font-semibold text-drive">review agent driving</span>
                <span className="font-mono text-xs text-text-2">{drive?.branch ?? branch}</span>
              </div>
              <div className="text-sm text-text-2">
                Notes land below as it finds things. No dev server answered, so there is nothing to
                show here.
              </div>
            </div>
          )}
          {!readonly && (
            <div className="p-2">
              <StopDrive featureId={featureId} label="Stop the review drive" />
            </div>
          )}
        </>
      )

    default:
      return drive?.devUrl ? (
        <DrivePanel featureId={featureId} url={drive.devUrl} readonly={readonly} />
      ) : (
        <div className="p-4 text-sm text-text-2">
          The dev server is up but has not printed an address yet — its output is under the stage.
        </div>
      )
  }
}
