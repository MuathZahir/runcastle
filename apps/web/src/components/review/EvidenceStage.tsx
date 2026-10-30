import { useEffect, useState, type RefObject } from 'react'
import { fmtClock, type TestNote } from '@runcastle/core'
import { IconButton } from '../../ui'
import { IconCollapse, IconExpand } from '../../icons'
import { latestReview } from '../../lib/feature-ui'
import type { ReviewArtifacts } from '../../lib/reviews'
import { useStageExpandKeys, type StageExpand } from '../../lib/stage-expand'
import { clusterMarkers } from '../../lib/walkthrough'
import { WalkthroughPlayer, type WalkthroughHandle } from '../WalkthroughPlayer'

/**
 * The top of the review page: one large evidence stage (decision 17).
 *
 * Not a card among cards and not a two-up split — roughly the full content
 * width, 16:9, and the first thing a returning human sees. It plays the latest
 * completed review pass's walkthrough. The stage is never a dead card: with no
 * recording there is no stage at all (decision 6), so its callers mount it only
 * when there is one. A live drive has its own page (`DrivePage`).
 */

/**
 * The box the recording sits in.
 *
 * Collapsed it is 16:9, clamped so the frame and its bar fit the viewport
 * together (decision 23e). Expanded it is the overlay's fill instead — no aspect
 * ratio and no clamp, because a box that kept either would leave the stage the
 * size it was and the expand would have bought nothing (decision 3).
 */
function stageFrame(expanded: boolean): string {
  const size = expanded ? 'min-h-0 flex-1' : 'aspect-video max-h-[calc(100vh-320px)]'
  return `relative flex w-full flex-col overflow-hidden rounded-md bg-surface-inset ${size}`
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

export function EvidenceStage({
  featureId,
  recordings,
  picked = null,
  notes,
  readonly,
  expand,
  handleRef,
  onStageRecording,
  onMarkerClick,
  onAnnotationSaved,
}: {
  featureId: string
  /** Every review pass that left a recording, newest last. */
  recordings: readonly ReviewArtifacts[]
  /**
   * The pass whose recording the page has staged, or null for "the latest" —
   * so a verification pass landing while the page is open puts the fresh
   * recording up rather than pinning whatever was latest at mount.
   *
   * Held by the page rather than here (decision 4): the round trail is what picks
   * a recording now, and the two cannot be the stage's private state.
   */
  picked?: string | null
  notes: readonly TestNote[]
  /** Looking back at review on a shipped feature — the record plays, nothing acts. */
  readonly: boolean
  /**
   * The stage's expanded state, held by the page above so that the page can
   * put its other bands away while the stage has the window. Absent on a page
   * with nowhere to expand into (the shipped record), where the stage offers no
   * expand at all.
   */
  expand?: StageExpand
  handleRef?: RefObject<WalkthroughHandle | null>
  /**
   * Which recording is playing right now.
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
  const [duration, setDuration] = useState<number | null>(null)

  const latest = latestReview(recordings)
  const onStage = recordings.find((r) => r.ticketId === picked) ?? latest
  // A recording swapped for another is a fresh measurement: the length on the
  // identity line must never be the one the previous recording reported.
  useEffect(() => setDuration(null), [onStage?.ticketId])

  // The fixes a verification pass confirms: what landed between the pass before
  // it and it. Both counts are "implementation tickets done since", so their
  // difference is the window between the two passes.
  const index = onStage ? recordings.indexOf(onStage) : -1
  const previous = index > 0 ? recordings[index - 1] : undefined
  const fixes = onStage && previous ? previous.landedSince - onStage.landedSince : null

  const playing = onStage?.videoUrl ? onStage.ticketId : null
  useEffect(() => {
    onStageRecording?.(playing ? { ticketId: playing } : null)
  }, [onStageRecording, playing])

  // The player binds F and Escape for itself, behind the guards that stop a
  // keystroke meant for a drawing from resizing the page under it; with nothing
  // playing they are bound here.
  useStageExpandKeys(expand, !playing)
  const expanded = expand?.expanded ?? false

  return (
    // `evidence-stage` is what a note's timestamp scrolls back to, so a jump
    // never moves the playhead off screen (decision 25b). It fills the height it
    // is given, which is the whole overlay while expanded and nothing in
    // particular while the column is scrolling past it.
    <section id="evidence-stage" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        {onStage && (
          <span
            className="min-w-0 truncate text-sm text-text-secondary"
            title={
              onStage.passKind === 'verification'
                ? 'the fix count is derived from what landed between the two passes'
                : undefined
            }
          >
            {stageIdentity(onStage, duration, fixes)}
          </span>
        )}

        {/* The stage takes the window (decision 3), and gives it back, saying
            the key that does the same thing from wherever the eye is. */}
        {expand && (
          <IconButton
            className="ml-auto"
            label={expanded ? 'Collapse' : 'Expand'}
            kbd="F"
            icon={expanded ? <IconCollapse /> : <IconExpand />}
            active={expanded}
            onClick={() => expand.set(!expanded)}
          />
        )}
      </header>

      {onStage?.videoUrl && (
        <WalkthroughPlayer
          key={onStage.ticketId}
          url={onStage.videoUrl}
          featureId={featureId}
          ticketId={onStage.ticketId}
          passKind={onStage.passKind}
          readonly={readonly}
          frameClassName={stageFrame(expanded)}
          expand={expand}
          markers={clusterMarkers(notes, onStage.ticketId)}
          onMarkerClick={onMarkerClick}
          onAnnotationSaved={onAnnotationSaved}
          onDuration={setDuration}
          handleRef={handleRef}
        />
      )}
    </section>
  )
}
