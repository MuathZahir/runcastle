import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureFull, PrepView } from '../../lib/api'
import type { DriveState as BrowserDrive } from '../../lib/workspace'
import { unverifiedDriveKeys } from '../../lib/prep-findings'
import {
  conflictResolveEnded,
  deferredScope,
  driveFailure,
  findingCountsLine,
  lapAccount,
  lapAccountLine,
  lapChip,
  latestReview,
  latestRun,
  liveSessionLine,
  reviewChecks,
  reviewDriveDenial,
  slotHeldReason,
  specDocPath,
  unverifiedLap,
  verificationState,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useEventLog } from '../../lib/events'
import { useReviewArtifacts } from '../../lib/reviews'
import { useLivePoll } from '../../lib/live'
import type { StageExpand } from '../../lib/stage-expand'
import { useToast } from '../../lib/toast'
import { CarriedFindings } from '../review/CarriedFindings'
import { ConflictAlert } from '../review/ConflictCard'
import { DriveInstructions } from '../review/drive-parts'
import { EvidenceStage } from '../review/EvidenceStage'
import { FullAccounts } from '../review/FullAccounts'
import { LiveSessionAlert } from '../review/LiveSessionAlert'
import { NothingVerifiedAlert } from '../review/NothingVerifiedAlert'
import { NotesRail } from '../review/NotesRail'
import { ProjectDriveBlocking } from '../review/ProjectDriveBlocking'
import { ReviewDriveDeniedAlert } from '../review/ReviewDriveDeniedCard'
import { ReviewTrail } from '../review/ReviewTrail'
import { CheckDetails, LapStory, StatusStrip } from '../review/StatusStrip'
import { OpenWork } from '../review/OpenWork'
import { WorkList, partitionWork } from '../review/WorkList'
import type { WalkthroughHandle } from '../WalkthroughPlayer'

/**
 * The review phase, as one document under the feature page's header
 * (DESIGN.md §Page anatomy): notices only when something is really wrong, the
 * state as a property list with the two things you can start from it, the
 * evidence stage only when there is evidence, the open work as a section only
 * when there is some, what an earlier lap carried, the laps, and the long
 * read-once text in closed disclosures at the foot.
 *
 * There is no permanent right rail any more: an empty "What still needs
 * attention" column beside every review was the loudest dead space on the page.
 * The notes become the ONE aside only while the stage has the window
 * (decisions 3–4): expanded, the page is a CSS overlay holding the stage with
 * the notes aside beside it — a working mode, where reaching a note must never
 * scroll the stage away — which is why it is an overlay rather than the native
 * fullscreen the walkthrough's F key used to ask for.
 *
 * The order within the column is what the page is FOR: state and one obvious
 * action lead, prose follows. What is gone is as load-bearing as what is here —
 * no terminal band (decision 5), no 16:9 box holding one apologetic sentence
 * when nothing was recorded (decision 6), no test-drive explainer, and no
 * observations on arrival (decision 2).
 *
 * This component is the orchestrator and nothing else: it reads the queries, runs
 * the derivations, and lays the bands out. Every band is its own file under
 * `components/review/` and takes its data as props, which is what makes them
 * testable without a tRPC provider and what keeps the bands from growing back
 * into one 971-line file (decision 34).
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
  readonly = false,
  onViewPhase,
}: {
  full: FeatureFull
  driving: BrowserDrive | null
  conflict: MergeConflictState | null
  /** Looking back at review on a shipped feature — history, not work. */
  readonly?: boolean
  /**
   * Go and look at another phase — how a defect reaches the lane fixing it, and
   * where the alert line's Open sends a session that is still up.
   */
  onViewPhase?: (phase: Phase) => void
}) {
  const { feature, tickets, runs } = full
  const toast = useToast()
  const utils = trpc.useUtils()
  // No terminal renders here any more (decision 5): a session that is still up
  // is one line in the alerts band, whatever kind it is, and an ended one says
  // nothing at all.
  const live = liveSessionLine(full.sessions)
  const run = latestRun(runs)
  // The same query key the workspace shell reads, so the conflict card's state
  // and the bar's conflict branch come out of one fetch of one feed.
  const events = useEventLog(feature.id)
  // Commits come from git, not from ticket commit rows (findings F23). Polled
  // slower than the 1.5s shell: a `rev-list --count` is cheap but this figure
  // only moves when a burn lands, and a human reads a page, not a ticker.
  const commits = trpc.feature.commitCount.useQuery(
    { featureId: feature.id },
    { refetchInterval: useLivePoll(5000) },
  )
  const drive = trpc.feature.driveInfo.useQuery(undefined, {
    refetchInterval: useLivePoll(),
  })
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
  // What a test drive is about to depend on that no dry run has ever proven
  // (decision 8) — the state line's amber chip. Same query key the next-step bar
  // reads, so the chip and the bar come out of one fetch of the project's
  // findings. (`useQuery().data` infers to `{}` here — the same tRPC-in-component
  // typing gap the settings overlay documents.)
  const prep = trpc.project.prep.useQuery({ projectId: feature.projectId })
  const unverifiedKeys = unverifiedDriveKeys((prep.data as PrepView | undefined)?.findings ?? [])
  // How this project says to drive it (decision 6), for the block beside the
  // Test drive control. The project row is the shell's own list read — one query
  // key, so the page pays nothing for it.
  const projects = trpc.project.list.useQuery()
  const project = projects.data?.find((p) => p.id === feature.projectId)
  const startDrive = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      void utils.feature.driveInfo.invalidate()
      void utils.feature.get.invalidate({ id: feature.id })
    },
    onError: (e) => toast.push(e.message),
  })
  // Another review pass, on demand (decisions 6–7): a fresh review ticket is
  // minted on this lap and burned. The server refuses it while a run is live or
  // while the tree would deny the drive again, and those refusals are the
  // server's own words — a toast here, and inside the banner where the banner
  // is what asked.
  const agenticReview = trpc.feature.agenticReview.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: feature.id })
      void utils.events.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  // Jump to this moment (decision 25b). The stage and the open-work rows are
  // siblings, so a timestamp click travels up to the one parent they share: the
  // player writes its seek in here while it is mounted, and the rows call
  // whatever is in it. Nothing fills it when no recording is on the stage.
  const walkthroughHandle = useRef<WalkthroughHandle | null>(null)
  // Which recording the human picked off the trail, or null for "the latest"
  // (decision 4). Held here because the two bands that share it are siblings:
  // the trail below picks, the stage above plays, and a fresh pass landing
  // while nothing is picked still puts its recording up.
  const [picked, setPicked] = useState<string | null>(null)
  // Which recording the stage is actually playing, so a note's timestamp is a
  // live jump only into its own recording (decision 22). The stage reports it
  // rather than the ref answering, because a ref does not re-render its readers.
  const [staged, setStaged] = useState<{ ticketId: string } | null>(null)
  // The stage with the window to itself (decisions 3–4). Held here rather than
  // in the stage because the page is what has to put its other bands away — and
  // because a switch between the drive and the recording is then just the stage
  // changing what it shows, with the expand untouched.
  const [expanding, setExpanding] = useState(false)
  // The notes aside beside the expanded stage, open by default each time the
  // stage takes the window; its close hides it for that expand only.
  const [railOpen, setRailOpen] = useState(true)
  useEffect(() => {
    if (expanding) setRailOpen(true)
  }, [expanding])
  // Which denied review drive the human has waved away (decision 7). Keyed on
  // the event id, so a NEW denial is a new id and the banner comes back; a
  // dismissal is a gesture about one denial, not a preference to be persisted.
  const [dismissedDenial, setDismissedDenial] = useState<number | null>(null)
  // The other direction of a jump (decision 25b): a marker click marks the notes
  // taken at that moment, and a fresh capture scrolls its new row into view.
  // Both fade after a beat — a permanent mark would read as a selection.
  const [spotlight, setSpotlight] = useState<{
    ids: string[]
    scrollTo: string | null
  }>({
    ids: [],
    scrollTo: null,
  })
  useEffect(() => {
    if (spotlight.ids.length === 0) return
    const timer = setTimeout(() => setSpotlight({ ids: [], scrollTo: null }), 2000)
    return () => clearTimeout(timer)
  }, [spotlight])

  // A pass picked off the trail (decision 4). The stage is above the band that
  // picked it, so the same nudge a note's timestamp makes is owed here: a
  // recording swapped onto a stage the human has scrolled past looks like
  // nothing happened.
  const stageRecording = useCallback((ticketId: string): void => {
    setPicked(ticketId)
    document.getElementById('evidence-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const jumpTo = useCallback((seconds: number): void => {
    walkthroughHandle.current?.seek(seconds)
    // The playhead must never move off screen — the walked jump seeked a player
    // sitting above the fold and looked like nothing happened. The stage is
    // beside the rows now rather than above them, so this only ever nudges the
    // main column, and never the rail the row was clicked in.
    document.getElementById('evidence-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // A defect being fixed links to its lane, which lives in the run view one
  // phase back (decision 18c). Both halves of the list offer it, so it is
  // resolved once here.
  const onViewLane = onViewPhase
    ? (ticketId: string): void => {
        onViewPhase('building')
        // Best effort: the run body has to mount before its lanes exist, so the
        // scroll waits a frame. Landing on the run view is the part that
        // matters; the scroll is the courtesy on top.
        requestAnimationFrame(() =>
          document
            .getElementById(`lane-${ticketId}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        )
      }
    : undefined

  const driveState = ownDrive?.state ?? 'idle'
  // A drive of this feature is up — the server says so, or this browser started
  // one and the poll has not caught up yet.
  const driveUp = driveState !== 'idle' || !!driving
  // The stage mounts only when it has something to put on it (decision 6): a
  // recording, or that drive. With neither there is no band at all, so nothing
  // on the page is a bordered box holding one sentence.
  const stageMounted = recordings.length > 0 || driveUp
  // There is nothing to expand into without a stage, so an expand outlives the
  // thing it was about by exactly nothing: a drive that stops with no recording
  // behind it takes the stage away (decision 6), and an overlay over that would
  // be an empty window with no way out of it.
  const expand: StageExpand = {
    expanded: expanding && stageMounted,
    set: setExpanding,
  }
  // The one drive slot is taken by somebody else — another feature, a
  // preparation dry run (decision 9) or a project drive — named as the server
  // names it (project-level-test-drive decision 9).
  const slotHolder = drive.data && drive.data.featureId !== feature.id ? drive.data : undefined
  // A project drive is the human's own, so this page offers to stop it.
  const blockingProjectDrive =
    slotHolder?.projectDrive && slotHolder.projectId ? slotHolder.projectId : undefined
  // A review drive the human's own uncommitted files refused (decision 7). Only
  // while the feature is actually AT review — this body also mounts to look back
  // at review on a feature that has moved on, and a denial answered by a later
  // phase is a record, not something to act on.
  const denial = feature.phase === 'review' ? reviewDriveDenial(events, runs, dismissedDenial) : null
  // This lap's review ran and verified nothing (decision 5) — the page's top
  // line, in runcastle's own words. A history view states nothing and offers
  // nothing (decision 33a), so the banner is the live page's alone.
  const unverified = readonly ? null : unverifiedLap({ passes: rows, tickets, currentLap: feature.lap })
  // One burn at a time is a hard rule the server enforces, so the control says
  // so rather than dead-ending on the click (findings F3). Same shape as the
  // Test drive control's occupied-slot reason beside it.
  const agenticReviewControl = readonly
    ? null
    : {
        onStart: () => agenticReview.mutate({ featureId: feature.id }),
        ...(agenticReview.isPending
          ? { blocked: 'starting…' }
          : run?.status === 'running'
            ? { blocked: 'a burn is running' }
            : {}),
      }
  // One partition, two halves (decision 8): what needs attention is the middle
  // of the page, what has been dealt with rides inside the bottom disclosure.
  const { attention, settled } = partitionWork({
    findings: findings.data?.findings ?? [],
    notes: notes.data ?? [],
    tickets,
    openDefects: findings.data?.openDefects ?? [],
  })
  const observations = (findings.data?.findings ?? []).filter((f) => f.kind === 'observation')
  const account = lapAccount(tickets, feature.lap)
  // Every count on this page is the server's own, scoped to THIS lap
  // (decisions #5) — the inflated all-laps figure is what sent the human back
  // through Iterate over defects a later lap had already answered. So the review
  // row's finding count is read off the summary rather than measured on the
  // `findings` array, which spans every lap the feature has run.
  const summary = findings.data?.summary
  const lapFindings = summary ? summary.found + summary.observations : undefined
  // The lap at one line (decision 8): the review agent's digest is written to
  // open with exactly this line. With no digest, the counts say what happened
  // instead — the same figures the bar is holding.
  const accountLine = lapAccountLine(account) ?? findingCountsLine(summary)

  const checks = reviewChecks({
    tickets,
    run,
    commitCount: commits.data?.count,
    findings: lapFindings,
  })
  const lapFigure = lapChip(tickets, {
    lap: feature.lap,
    // The lap's own session has run once it has emitted this lap's tickets —
    // exactly what the past tense in its story claims.
    lapSessionRan: tickets.some((t) => t.lap === feature.lap),
  })
  const laterLaps = deferredScope(specQ.data?.content)

  // The stage is one element in both states — expanding changes what is AROUND
  // it, never what it is, which is what lets a drive ↔ walkthrough switch happen
  // under an expand without disturbing it.
  const stage = stageMounted ? (
    <EvidenceStage
      featureId={feature.id}
      branch={feature.branch}
      recordings={recordings}
      picked={picked}
      notes={notes.data ?? []}
      readonly={readonly}
      driveState={driveState}
      drive={ownDrive}
      dryRun={drive.data?.dryRun ?? false}
      failure={driveFailure(ownDrive, { sessionLive: !!live })}
      expand={expand}
      handleRef={walkthroughHandle}
      onStageRecording={setStaged}
      onMarkerClick={(noteIds) => setSpotlight({ ids: noteIds, scrollTo: null })}
      onAnnotationSaved={(noteId) => setSpotlight({ ids: [noteId], scrollTo: noteId })}
    />
  ) : null

  const notices = (
    <>
      {/* Nothing renders here unless something is really wrong or really
          still running (decision 8). */}
      {conflict && (
        <ConflictAlert
          featureId={feature.id}
          branch={feature.branch}
          conflict={conflict}
          readonly={readonly}
          liveSessionId={live?.sessionId ?? null}
          resolveEnded={conflictResolveEnded(events, full.sessions)}
        />
      )}
      {/* The refusal the human can still act on, at the moment they can act
          on it — the digest that used to carry it is read long afterwards. */}
      {denial && (
        <ReviewDriveDeniedAlert
          // A new denial is a new notice, so a refusal answered about the old
          // one cannot linger under it.
          key={denial.eventId}
          featureId={feature.id}
          denial={denial}
          readonly={readonly}
          // Both notices can be up at once — a denied drive whose pass then
          // declares nothing — and both mints are the same verb, so this one
          // steps down to ghost beside the other.
          primary={!unverified}
          onDismiss={() => setDismissedDenial(denial.eventId)}
        />
      )}
      {/* The lap that verified nothing says so before anything else on the
          page (decision 5) — loud, and blocking nothing. */}
      {unverified && (
        <NothingVerifiedAlert lap={feature.lap} outcome={unverified} agenticReview={agenticReviewControl} />
      )}
      {/* One line for a session that is still up, wherever it belongs, with
          the way to it and the way out of it (decision 5). */}
      {live && (
        <LiveSessionAlert featureId={feature.id} line={live} readonly={readonly} onOpen={onViewPhase} />
      )}
      {!readonly && !driveUp && slotHolder && blockingProjectDrive && (
        <ProjectDriveBlocking projectId={blockingProjectDrive} holderLabel={slotHolder.holderLabel} />
      )}
    </>
  )

  const workProps = {
    featureId: feature.id,
    lap: feature.lap,
    rows: attention,
    readonly,
    // Nothing is on the stage when there is no stage, so a timestamp on a row
    // is a plain figure rather than a jump into a player that is not there.
    onStage: stageMounted ? staged : null,
    onSeek: jumpTo,
    highlight: spotlight.ids,
    scrollTo: spotlight.scrollTo,
    onViewLane,
  }

  const expanded = expand.expanded
  const hasNotices =
    !!conflict ||
    !!denial ||
    !!unverified ||
    (!!live && !readonly) ||
    (!readonly && !driveUp && !!blockingProjectDrive)

  // Expanded, the stage and the notes ARE the window (decision 3): a plain CSS
  // overlay over the app, below its dialogs, with every piece of React state on
  // the page still mounted underneath it. Not the native Fullscreen API, which
  // shows one element and would take the notes and the transport with it.
  //
  // Portalled to <body>: the page column rises in with a transform, and a
  // transformed ancestor would make `fixed` mean "fixed to the column" — the
  // overlay would be a box inside the page rather than the window.
  const overlay = expanded ? (
    <div data-stage-overlay="" className="fixed inset-0 z-[100] flex bg-surface animate-fade-in">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">{stage}</div>
      {railOpen && <NotesRail {...workProps} onClose={() => setRailOpen(false)} />}
    </div>
  ) : null

  return (
    // The page's own column when the frame gives it one; when the frame hands
    // the body the whole panel instead, this is the scroller (in a page column
    // an auto-height block never scrolls, so it costs nothing there).
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-10">
        {hasNotices && <div className="flex flex-col gap-4">{notices}</div>}

        {
          <StatusStrip
            artifact={stamped}
            currentLap={feature.lap}
            landedSince={stamped?.landedSince ?? 0}
            tickets={tickets}
            checks={checks}
            runState={run?.status ?? 'no run recorded'}
            verification={verificationState(tickets)}
            // History states what was; a caveat about the next drive is the live page's.
            {...(readonly ? {} : { unverifiedKeys })}
            {...(readonly ? {} : { driving: driveUp })}
            // Always offered while the page can act (decision 6): asking for
            // another review pass is never about what the last one did.
            {...(agenticReviewControl ? { agenticReview: agenticReviewControl } : {})}
            // A drive already at the wheel is the stage's to stop, and a
            // history view starts nothing at all.
            {...(readonly || driveUp
              ? {}
              : {
                  testDrive: {
                    onStart: () =>
                      startDrive.mutate({
                        featureId: feature.id,
                        action: 'start',
                      }),
                    ...(startDrive.isPending
                      ? { blocked: 'starting…' }
                      : slotHolder
                        ? { blocked: slotHeldReason(slotHolder.holderLabel) }
                        : {}),
                  },
                })}
          />
        }

        {!expanded && stage}

        <OpenWork {...workProps} />

        {/* What earlier laps parked instead of answering (decisions #5) —
            outside the open count, since the server keeps carried defects out
            of the summary the page leads with. */}
        {
          <CarriedFindings
            featureId={feature.id}
            findings={findings.data?.carriedFindings ?? []}
            readonly={readonly}
          />
        }

        {/* The feature's laps, newest first (decisions 4–5) — history, below
            the state and the open work it is the record behind. Clicking a
            pass's recording stages it above. */}
        {
          <ReviewTrail
            passes={rows}
            tickets={tickets}
            findings={findings.data?.findings ?? []}
            notes={notes.data ?? []}
            currentLap={feature.lap}
            account={accountLine}
            staged={staged?.ticketId ?? null}
            onStage={stageRecording}
            {...(onViewPhase ? { onViewRun: () => onViewPhase('building') } : {})}
          />
        }

        {/* Read once, so closed (DESIGN.md principle 6). */}
        {
          <div className="flex flex-col [&>*:last-child]:border-b [&>*:last-child]:border-border-subtle">
            <DriveInstructions text={project?.driveInstructions} />
            <FullAccounts
              account={account}
              tickets={tickets}
              observations={observations}
              carried={
                settled.length > 0 ? (
                  <WorkList
                    featureId={feature.id}
                    rows={settled}
                    readonly={readonly}
                    onStage={stageMounted ? staged : null}
                    onSeek={jumpTo}
                    onViewLane={onViewLane}
                  />
                ) : null
              }
            />
            <CheckDetails checks={checks} />
            <LapStory lap={lapFigure} laterLaps={laterLaps} currentLap={feature.lap} readonly={readonly} />
          </div>
        }
      </div>
      {overlay && (typeof document === 'undefined' ? overlay : createPortal(overlay, document.body))}
    </div>
  )
}
