import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../../trpc'
import type { FeatureFull, SettingsView } from '../../lib/api'
import type { DriveState as BrowserDrive } from '../../lib/workspace'
import { driveCapabilities } from '../../lib/prep-findings'
import {
  activeSession,
  deferredScope,
  driveFailure,
  lapAccount,
  lapChip,
  latestReview,
  latestRun,
  reviewChecks,
  specDocPath,
  verificationState,
  type LapAbort,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useReviewArtifacts } from '../../lib/reviews'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { SessionPanel } from '../SessionPanel'
import { ConflictAlert } from '../review/ConflictCard'
import { LapAbortAlert } from '../review/LapAbortAlert'
import { EvidenceStage } from '../review/EvidenceStage'
import { FullAccounts } from '../review/FullAccounts'
import { OpenWork } from '../review/OpenWork'
import { StatusStrip } from '../review/StatusStrip'
import type { WalkthroughHandle } from '../WalkthroughPlayer'

/**
 * The review phase, in five bands: evidence, alerts, state, open work, prose
 * (decisions 17 and 18). Evidence first, prose last — the page opens on the
 * walkthrough at stage size rather than on a wall of digests, and everything an
 * agent wrote in paragraphs is one disclosure at the bottom.
 *
 * This component is the orchestrator and nothing else: it reads the queries, runs
 * the derivations, and lays the bands out. Every band is its own file under
 * `components/review/` and takes its data as props, which is what makes them
 * testable without a tRPC provider and what keeps the five bands from growing
 * back into one 971-line file (decision 34).
 *
 * `readonly` is passed down ONCE and every band answers it (decision 33a):
 * looking back at review on a shipped feature is history, so no live control
 * renders anywhere — the stage plays with Annotate gone, the conflict card is
 * absent rather than offering to launch an agent, and the drive states describe
 * rather than instruct.
 */
export function ReviewBody({
  full,
  driving,
  conflict,
  lapAbort = null,
  readonly = false,
  onViewPhase,
  onIterate,
}: {
  full: FeatureFull
  driving: BrowserDrive | null
  conflict: MergeConflictState | null
  /** An Iterate that rolled back, or null when the last one started (26g). */
  lapAbort?: LapAbort | null
  /** Looking back at review on a shipped feature — history, not work. */
  readonly?: boolean
  /** Go and look at another phase — how a defect reaches the lane fixing it. */
  onViewPhase?: (phase: 'implementation') => void
  /** Take the Iterate door again — what the failed lap's Retry re-runs. */
  onIterate?: () => void
}) {
  const { feature, tickets, runs } = full
  const toast = useToast()
  const utils = trpc.useUtils()
  const liveSession = activeSession(full.sessions)
  const run = latestRun(runs)

  // Commits come from git, not from ticket commit rows (findings F23). Polled
  // slower than the 1.5s shell: a `rev-list --count` is cheap but this figure
  // only moves when a burn lands, and a human reads a page, not a ticker.
  const commits = trpc.feature.commitCount.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll(5000) },
  )
  const drive = trpc.feature.driveInfo.useQuery(undefined, { refetchInterval: useLivePoll() })
  // The drive slot is shared with preparation's dry run, which belongs to no
  // feature (decision 9). Everything below reads this feature's own drive or
  // nothing: a dry run's pane and dev server described under this branch would
  // be a straight misattribution.
  const ownDrive = drive.data?.featureId === feature.id ? drive.data : undefined
  const poll = useLivePoll()
  // Notes and findings are review-phase reads. They used to poll in every phase
  // (research still-open 24), which is a timer per surface for data nothing on
  // screen was showing; the SSE feed invalidates both keys regardless.
  const reviewPoll = feature.phase === 'review' ? poll : (false as const)
  const notes = trpc.notes.list.useQuery({ featureId: feature.id }, { refetchInterval: reviewPoll })
  // What the review agent found, typed and counted server-side — the strip's
  // chip and the open-work list below both come out of this one read, and the
  // next-step bar reads the same query key, so the button that offers to fix N
  // defects and the list of them cannot disagree.
  const findings = trpc.findings.listByFeature.useQuery(
    { featureId: feature.id },
    { refetchInterval: reviewPoll },
  )
  // Scope the spec left for a later lap. Same read the next-step bar makes (one
  // query key, one fetch), so the lap chip and the bar cannot disagree about
  // whether this lap is the last one.
  const specRelPath = specDocPath(full)
  const specQ = trpc.docs.read.useQuery(
    { featureId: feature.id, relPath: specRelPath ?? 'spec.md' },
    { enabled: !!specRelPath },
  )
  // What the reviews left on disk, over the plain HTTP routes beside tRPC.
  const artifacts = useReviewArtifacts(feature.id)
  const rows = artifacts.data ?? []
  const recordings = rows.filter((a) => a.hasVideo && a.videoUrl)
  // The stamp is the LATEST COMPLETED pass (decision 41a) — a pass still burning
  // vouches for nothing, and ordering on completion is what makes "latest" mean
  // latest rather than highest-numbered.
  const stamped = latestReview(rows.filter((a) => a.completedAt !== null)) ?? null
  // What a drive on THIS project does — a prepared one renders an environment,
  // runs the setup command and boots a dev server; an unprepared one checks the
  // branch out and stops. (`useQuery().data` infers to `{}` here — the same
  // tRPC-in-component typing gap the settings overlay documents.)
  const settings = trpc.settings.get.useQuery({ projectId: feature.projectId })
  const caps = driveCapabilities(settings.data as SettingsView | undefined)
  const startDrive = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      void utils.feature.driveInfo.invalidate()
      void utils.feature.get.invalidate({ id: feature.id })
    },
    onError: (e) => toast.push(e.message),
  })
  // Jump to this moment (decision 25b). The stage and the open-work rows are
  // siblings, so a timestamp click travels up to the one parent they share: the
  // player writes its seek in here while it is mounted, and the rows call
  // whatever is in it. Nothing fills it when no recording is on the stage.
  const walkthroughHandle = useRef<WalkthroughHandle | null>(null)
  // Which recording the stage is actually playing, so a note's timestamp is a
  // live jump only into its own recording (decision 22). The stage reports it
  // rather than the ref answering, because a ref does not re-render its readers.
  const [staged, setStaged] = useState<{ ticketId: string } | null>(null)
  // The other direction of a jump (decision 25b): a marker click marks the notes
  // taken at that moment, and a fresh capture scrolls its new row into view.
  // Both fade after a beat — a permanent mark would read as a selection.
  const [spotlight, setSpotlight] = useState<{ ids: string[]; scrollTo: string | null }>({
    ids: [],
    scrollTo: null,
  })
  useEffect(() => {
    if (spotlight.ids.length === 0) return
    const timer = setTimeout(() => setSpotlight({ ids: [], scrollTo: null }), 2000)
    return () => clearTimeout(timer)
  }, [spotlight])

  const jumpTo = useCallback((seconds: number): void => {
    walkthroughHandle.current?.seek(seconds)
    // The playhead must never move off screen — the walked jump seeked a player
    // sitting above the fold and looked like nothing happened.
    document.getElementById('evidence-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {/* A retrospective view of review on a shipped feature must not offer to
          reopen its conversation (findings F10.6). */}
      <SessionPanel
        featureId={feature.id}
        sessions={full.sessions}
        className="review-session"
        showResume={!readonly}
      />

      <EvidenceStage
        featureId={feature.id}
        branch={feature.branch}
        recordings={recordings}
        notes={notes.data ?? []}
        readonly={readonly}
        driveState={ownDrive?.state ?? 'idle'}
        drive={ownDrive}
        dryRun={drive.data?.dryRun ?? false}
        failure={driveFailure(ownDrive, { sessionLive: !!liveSession })}
        caps={caps}
        // The one drive slot is taken — by this feature, another one, or a
        // preparation dry run — or this browser has a start in flight the server
        // poll has not caught up with yet.
        starting={startDrive.isPending || !!driving || !!drive.data}
        onStartDrive={() => startDrive.mutate({ featureId: feature.id, action: 'start' })}
        handleRef={walkthroughHandle}
        onStageRecording={setStaged}
        onMarkerClick={(noteIds) => setSpotlight({ ids: noteIds, scrollTo: null })}
        onAnnotationSaved={(noteId) => setSpotlight({ ids: [noteId], scrollTo: noteId })}
      />

      {/* The alert slot (decision 18a): interruptions render between the stage
          and the strip — the loudest thing on the page, but never above the
          evidence. */}
      {conflict && (
        <ConflictAlert
          featureId={feature.id}
          branch={feature.branch}
          conflict={conflict}
          readonly={readonly}
          liveSessionId={liveSession?.id ?? null}
        />
      )}

      {/* A lap that could not start rolls back in silence otherwise — the walked
          page came back exactly as it was (decision 26g). */}
      {lapAbort && onIterate && (
        <LapAbortAlert
          abort={lapAbort}
          lap={feature.lap}
          readonly={readonly}
          onRetry={onIterate}
        />
      )}

      <StatusStrip
        artifact={stamped}
        currentLap={feature.lap}
        landedSince={stamped?.landedSince ?? 0}
        tickets={tickets}
        checks={reviewChecks({
          tickets,
          run,
          commitCount: commits.data?.count,
          findings: findings.data?.findings.length,
        })}
        runState={run?.status ?? 'no run recorded'}
        verification={verificationState(tickets)}
        lap={lapChip(tickets, {
          lap: feature.lap,
          // The lap's own session has run once it has emitted this lap's tickets
          // — which is exactly what the past tense in its story claims.
          lapSessionRan: tickets.some((t) => t.lap === feature.lap),
        })}
        laterLaps={deferredScope(specQ.data?.content)}
        readonly={readonly}
      />

      <OpenWork
        featureId={feature.id}
        lap={feature.lap}
        tickets={tickets}
        notes={notes.data ?? []}
        findings={findings.data?.findings ?? []}
        summary={findings.data?.summary}
        openDefects={findings.data?.openDefects ?? []}
        readonly={readonly}
        onStage={staged}
        onSeek={jumpTo}
        highlight={spotlight.ids}
        scrollTo={spotlight.scrollTo}
        onViewLane={
          onViewPhase
            ? (ticketId) => {
                onViewPhase('implementation')
                // Best effort: the run body has to mount before its lanes exist,
                // so the scroll waits a frame. Landing on the run view is the
                // part that matters; the scroll is the courtesy on top.
                requestAnimationFrame(() =>
                  document
                    .getElementById(`lane-${ticketId}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                )
              }
            : undefined
        }
      />

      <FullAccounts account={lapAccount(tickets, feature.lap)} tickets={tickets} />
    </div>
  )
}
