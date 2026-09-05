import { useState, type RefObject } from 'react'
import { fmtClock, type DriveState, type TestNote } from '@runcastle/core'
import { Button } from '../../ui'
import { driveView, latestReview, type DriveFailure } from '../../lib/feature-ui'
import type { ReviewArtifacts } from '../../lib/reviews'
import { clusterMarkers } from '../../lib/walkthrough'
import { WalkthroughPlayer, type WalkthroughHandle } from '../WalkthroughPlayer'
import { DriveFailureCard, DrivePane, DriveStatus, StopReviewDrive } from './drive-parts'

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
 * The drive half is deliberately today's pieces in the stage's position: ticket
 * 9 replaces them with the integrated Open-app panel that captures a drag-select
 * onto a note (decisions 7b / 39). The swap logic — which of the two is on the
 * stage — is this component's and stays here.
 */

/** The active drive as the stage and its parts read it. */
export interface StageDrive {
  branch: string
  purpose?: 'human' | 'review'
  devConfigured: boolean
  devPaneId?: string
  devUrl?: string
  devReady?: boolean
  devReadyTimedOut?: boolean
}

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
export function stageIdentity(
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
  devConfigured,
  starting,
  onStartDrive,
  handleRef,
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
  /** Whether this project has a dev command at all — what Open app depends on. */
  devConfigured: boolean
  starting: boolean
  onStartDrive: () => void
  handleRef?: RefObject<WalkthroughHandle | null>
}) {
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

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-sm text-text-2">
          {onStage ? (
            <span title="the fix count is derived from what landed between passes">
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
          onDuration={setDuration}
          handleRef={handleRef}
        />
      ) : (
        <div className="flex aspect-video max-h-[calc(100vh-320px)] w-full flex-col overflow-auto rounded-md border border-hairline bg-panel-2 p-4">
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
          ? 'No walkthrough was recorded for this feature — the review reported without driving.'
          : 'No walkthrough yet — the review agent records one when it drives; you can open the app and take your own notes.'}
        {!devConfigured && !readonly && (
          <div className="mt-2 text-text-3">
            This project has no dev command, so a drive checks the branch out and starts nothing ·
            set one in Settings.
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {failure ? (
        // Readonly keeps the account of what went wrong and drops the offer to
        // go and fix it (decision 33a) — history explains, it never acts.
        <DriveFailureCard
          featureId={featureId}
          failure={readonly ? { ...failure, canFix: false } : failure}
        />
      ) : (
        <DriveStatus branch={drive?.branch ?? branch} drive={drive} />
      )}
      {drive?.devPaneId && <DrivePane drive={drive} />}
      {drive?.purpose === 'review' && !readonly && <StopReviewDrive featureId={featureId} />}
    </>
  )
}
