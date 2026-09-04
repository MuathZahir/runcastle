import { useState } from 'react'
import { parsePhase, type Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { Button, DimLine, PhaseTag } from '../ui'
import type { FeatureFull, PrepView } from '../lib/api'
import { unverifiedDriveKeys } from '../lib/prep-findings'
import type { DriveState } from '../lib/workspace'
import {
  activeSession,
  defaultBaseBranch,
  deferredScope,
  effectivePhase,
  isReadonlyView,
  lapBanner,
  latestRun,
  mapDocPath,
  mergeSummary,
  nextStep,
  PHASE_LABELS,
  pipelineSteps,
  reviewOutcome,
  specDocPath,
  testDriveTaken,
  unresolvedMergeConflict,
  type ActionKind,
  type DraftBaseMissing,
  type MergeConflictState,
} from '../lib/feature-ui'
import { useResolveConflict } from '../lib/use-resolve-conflict'
import { IconBranch } from '../icons'
import { AddressNotesDialog } from './AddressNotesDialog'
import { MergeFeatureDialog } from './MergeFeatureDialog'
import { DraftBody } from './bodies/DraftBody'
import { GrillBody } from './bodies/GrillBody'
import { ReviewBody } from './bodies/ReviewBody'
import { ShippedBody } from './bodies/ShippedBody'
import { TicketsBody } from './bodies/TicketsBody'
import { RunBody } from './bodies/RunBody'
import { FeatureCrash, UnrecognizedPhase } from './workspace/FeaturePanes'
import { LapBannerRow } from './workspace/LapBannerRow'
import { NextStepBar } from './workspace/NextStepBar'
import { PipelineStepper } from './workspace/PipelineStepper'
import { copyText } from './workspace/copy-text'
import { useResumeFailedAlert } from './workspace/use-resume-failed-alert'

export { FeatureCrash } from './workspace/FeaturePanes'

/**
 * The pipeline-first workspace (app-redesign). A selected feature fills the
 * center: a header, a clickable horizontal pipeline stepper, a single guided
 * next-step bar (one solid action), and the body for the phase currently in
 * view. Clicking an earlier step pins a read-only view of that phase; the
 * next-step bar is replaced by a read-only banner until you snap back to live.
 */
export function Workspace({
  featureId,
  viewedPhase,
  onViewPhase,
  guidance,
  mapRailCollapsed,
  onToggleMapRail,
  driving,
  onDriveChange,
}: {
  featureId: string
  viewedPhase: Phase | null
  onViewPhase: (phase: Phase | null) => void
  guidance: boolean
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  const resumeFailed = useResumeFailedAlert(featureId)
  // The review bar has to know two things the feature row cannot tell it: whether
  // a merge conflict is standing (it must not recommend a merge that will fail
  // again — findings F8) and whether this branch was ever test-driven (the merge
  // confirmation reports it — F21). Both live in the event feed, same query key
  // as every other reader, so this shares one poll.
  const events = useEventLog(featureId)
  const conflict = unresolvedMergeConflict(events)
  const driveTaken = testDriveTaken(events)
  // Commits from git, for the confirmation's summary (same key as the review
  // body's read — one fetch between them).
  const commits = trpc.feature.commitCount.useQuery(
    { featureId },
    { refetchInterval: useLivePoll(5000) },
  )
  // Test-drive notes, for the confirmation's open-notes line — same query key the
  // review body's checklist reads, so the two share one fetch. The open ones are
  // also what the bar's Address-notes triage acts on (decisions.md #11).
  const notes = trpc.notes.list.useQuery({ featureId }, { refetchInterval: useLivePoll() })
  const openNoteRows = notes.data?.filter((n) => n.status === 'open') ?? []
  const openNotes = notes.data ? openNoteRows.length : undefined
  // The review agent's findings, counted server-side (findings joined to their
  // fix tickets) — the bar's Fix primary acts on exactly the rows the review
  // body lists, because both read this one query key. Review agents no longer
  // write test notes at all, so `openNotes` above is the human's own inbox and
  // nothing else.
  const findings = trpc.findings.listByFeature.useQuery(
    { featureId },
    { refetchInterval: useLivePoll() },
  )
  const openDefects = findings.data?.summary.open
  // What the review agent made of this branch, for the confirmation's status
  // line — the same two reads the review card derives it from, so the dialog
  // cannot report a different review than the screen behind it.
  const review = reviewOutcome({
    tickets: q.data?.tickets,
    findings: findings.data?.findings.length,
  })
  const [confirmMerge, setConfirmMerge] = useState(false)
  // The Address-notes triage fork is open (decisions.md #11).
  const [addressing, setAddressing] = useState(false)
  // The next-step bar warns about remaining fog on a mapped feature, which lives
  // in the map doc's prose — same query key as the map rail's read, so the two
  // share one fetch.
  const mapRelPath = q.data ? mapDocPath(q.data) : undefined
  const mapQ = trpc.docs.read.useQuery(
    { featureId, relPath: mapRelPath ?? 'map.md' },
    { enabled: !!mapRelPath },
  )
  // Scope the spec deliberately left for a later lap (decisions #7) — it steers
  // the review bar's primary and warns in the merge dialog. Same query key the
  // review body's Planned-next-lap card reads, so the bar and the card share one
  // fetch and cannot disagree about what is still deferred.
  // Only at review, where both readers are: every earlier phase would be paying
  // for a doc read whose answer it has nowhere to put.
  const specRelPath = q.data?.feature.phase === 'review' ? specDocPath(q.data) : undefined
  const specQ = trpc.docs.read.useQuery(
    { featureId, relPath: specRelPath ?? 'spec.md' },
    { enabled: !!specRelPath },
  )
  const laterLaps = deferredScope(specQ.data?.content)
  // Before recommending a test drive the bar has to know what the drive is about
  // to depend on that nothing has ever proven (decision 7) — that lives on the
  // project's findings, same query key the preparation surfaces poll. And a
  // preparation dry run holds the one drive slot (decision 9), which only the
  // server's drive info knows; ReviewBody polls the same key, so this is one fetch.
  const projectId = q.data?.feature.projectId
  const prepQ = trpc.project.prep.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, refetchInterval: useLivePoll() },
  )
  const driveQ = trpc.feature.driveInfo.useQuery(undefined, { refetchInterval: useLivePoll() })
  // A parked draft picks its base at Start, not at creation (decision 3), so the
  // branch list is read HERE — Start fires from the next-step bar, and the base
  // has to be readable at that click, not buried in the body that shows the
  // picker beside it. Only fetched for a draft; every other feature already has a branch.
  const isDraft = q.data?.feature.status === 'draft'
  const branchesQ = trpc.project.branches.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && isDraft },
  )
  // An explicit pick from the bar's branch menu, stamped with the
  // feature it was made on — this component is not remounted between features,
  // so an unstamped pick would follow the user to the next draft and quietly
  // fork it off a branch they chose for a different idea. No pick (or a stale
  // one) means the client default: the current checkout, and nothing at all when
  // that checkout is not a base a feature can fork from (decision 8).
  const [draftPick, setDraftPick] = useState<{ featureId: string; base: string } | null>(null)
  const effectiveDraftBase =
    (draftPick?.featureId === featureId ? draftPick.base : '') ||
    (branchesQ.data ? defaultBaseBranch(branchesQ.data) : '')
  // Why Start has no base to send, when it has none — read by the bar, which
  // warns on the picker and says so on the disabled button.
  const draftBaseMissing: DraftBaseMissing | undefined =
    !isDraft || effectiveDraftBase ? undefined : branchesQ.data ? 'unpicked' : 'loading'

  const invalidate = () => {
    void utils.feature.get.invalidate({ id: featureId })
    void utils.feature.list.invalidate()
    // The timeline too, and not as an afterthought: the bar's conflict banner and
    // its drive-taken stamp are derived from the event log, so a mutation that
    // refreshed only the feature row would leave the thing it just caused
    // waiting on the push pipe to become visible.
    void utils.events.invalidate()
  }

  const launch = trpc.feature.launchSession.useMutation({ onSuccess: invalidate, onError: (e) => toast.push(e.message) })
  const burn = trpc.feature.burn.useMutation({
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
    },
    onError: (e) => toast.push(e.message),
  })
  // Convergence is the bar's own action on a mapped feature (decision #4): it
  // crosses G1 — with an override reason when waypoints are still open — and
  // spawns the converge session, which lands the feature at `spec`.
  const converge = trpc.feature.converge.useMutation({
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
    },
    onError: (e) => toast.push(e.message),
  })
  const workWaypoint = trpc.feature.workWaypoint.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.push(e.message),
  })
  // Iterate is the review verb that starts the next lap (ADR-0010 §3; the
  // procedure keeps its `rethink` name so the timeline stays continuous): the
  // server bumps the lap, drops the feature back to ideation and opens the lap
  // session in one call — or rolls all of it back — so the bar just snaps the
  // view back to live.
  const rethink = trpc.feature.rethink.useMutation({
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
    },
    onError: (e) => toast.push(e.message),
  })
  // The triage fork's quick-fix road: the whole selection in ONE mutation, so
  // the tickets appear together and the notes list is frozen once, not per note.
  const promoteNotes = trpc.notes.promoteMany.useMutation({
    onSuccess: ({ tickets }) => {
      invalidate()
      void utils.notes.list.invalidate({ featureId })
      setAddressing(false)
      toast.push(`${tickets.length} fix ticket${tickets.length === 1 ? '' : 's'} added`, 'success')
    },
    onError: (e) => toast.push(e.message),
  })
  // The review's still-open defects, in one click and no dialog (decisions #7):
  // the server mints a fix ticket for each on this lap and starts the burn, so
  // the only thing left to do here is snap the view back to live.
  const fixDefects = trpc.findings.fixOpenDefects.useMutation({
    onSuccess: ({ tickets }) => {
      invalidate()
      void utils.findings.listByFeature.invalidate({ featureId })
      onViewPhase(null)
      toast.push(
        `${tickets.length} fix ticket${tickets.length === 1 ? '' : 's'} burning`,
        'success',
      )
    },
    onError: (e) => toast.push(e.message),
  })
  const cancel = trpc.run.cancel.useMutation({
    onSuccess: () => {
      invalidate()
      toast.push('cancel requested', 'info')
    },
    onError: (e) => toast.push(e.message),
  })
  const testDrive = trpc.feature.testDrive.useMutation({
    onSuccess: (res) => {
      // A drive takes and releases the branch and stamps the timeline; the bar
      // and the review body read all of it back through these queries.
      invalidate()
      // The project's own setup/teardown command failed. Surfaced first and as
      // an error: everything below is advisory, but a failed setup means the
      // app you are about to open probably is not running. The command's output
      // is in the timeline — the toast names which command, not why.
      if (res.hookFailure) {
        const f = res.hookFailure
        toast.push(
          `${f.phase === 'setup' ? 'Test drive setup' : 'Test drive teardown'} failed: ${f.command}${
            f.timedOut ? ' (timed out)' : ''
          } — see the timeline for its output`,
        )
      }
      // Git switches files; it cannot switch the dev database. When the drive's
      // branch carried migrations this one does not have, whatever was migrated
      // during the drive is still applied — and the next `migrate` reports drift
      // with nothing to connect it back to the test drive. Say so now, while the
      // cause is still obvious, and hand over the project's own reset command.
      // Never run it: a dev database can hold hand-built state.
      if (res.dbDrift) {
        toast.push(
          res.dbDrift.resetCommand
            ? `Migrations differ between the branches — your dev database may be ahead. Rebuild it with: ${res.dbDrift.resetCommand}`
            : 'Migrations differ between the branches — your dev database may be ahead. Set a database reset command in settings for a one-line fix here.',
          'info',
        )
      }
      if (res.carriedChanges?.length) {
        toast.push(
          `${res.carriedChanges.length} uncommitted file(s) came back with you onto ${res.branch}`,
          'info',
        )
      }
    },
    onError: (e) => toast.push(e.message),
  })
  // Settled, not success: a merge that hits a conflict is a REJECTED call, and
  // the conflict banner is derived from the event the server logged on its way
  // out (`unresolvedMergeConflict`). Invalidating here is what makes the banner
  // appear on the click that caused it, instead of only when the push pipe
  // delivers — the reported "I have to refresh to see the conflict".
  const merge = trpc.feature.merge.useMutation({
    onSettled: invalidate,
    onError: (e) => toast.push(e.message),
  })
  const unarchive = trpc.feature.unarchive.useMutation({
    onSuccess: () => {
      invalidate()
      toast.push('feature unarchived', 'success')
    },
    onError: (e) => toast.push(e.message),
  })
  // Start a parked draft (decision 7): the server cuts the branch, commits the
  // brief and activates the feature, and the grill session is chained after it
  // best-effort — mirroring the New Feature form's create-then-launch. A failure
  // leaves the draft intact and startable, so the toast is the whole recovery.
  const start = trpc.feature.start.useMutation({
    onSuccess: (_res, vars) => {
      invalidate()
      launch.mutate({ featureId: vars.featureId, kind: 'ideation' })
    },
    onError: (e) => toast.push(e.message),
  })
  // The resolve launch, shared with the conflict card below so the two brief the
  // agent identically (decisions #10) — and so the bar's primary can end a live
  // session on the way in rather than hiding until the human ends it themselves.
  const resolveConflict = useResolveConflict(featureId, q.data?.feature.branch ?? '')

  if (q.isLoading) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>loading feature…</DimLine>
        </div>
      </section>
    )
  }
  // Hard error ONLY when there was never data (first load failed). When a
  // refetch fails AFTER data exists (server restart mid-session), TanStack Query
  // keeps the last-good `data` alongside `error` — keep rendering it so the
  // embedded terminal stays MOUNTED (its own reconnect strip + scrollback replay
  // depend on surviving the outage) and show a slim banner instead. The 1.5s
  // refetchInterval keeps polling through the error, so the banner self-clears
  // the moment the server is back.
  if (!q.data) {
    return (
      <section className="workspace">
        <div className="ws-body">
          <DimLine>could not load feature{q.error ? `: ${q.error.message}` : ''}</DimLine>
        </div>
      </section>
    )
  }
  const offline = !!q.error

  const full = q.data
  const feature = full.feature
  // A phase this build does not know (a row from a newer server, a corrupt or
  // hand-edited column) falls through every exhaustive switch below at once —
  // the stepper, the next-step bar and the body all come back empty, and the
  // whole app used to render blank (findings F19). Degrade to a read-only view
  // that NAMES the value instead, so the feature is reportable and every other
  // feature stays usable.
  if (parsePhase(feature.phase) === null) {
    return <UnrecognizedPhase feature={feature} />
  }
  const effective = effectivePhase(feature, viewedPhase)
  const readonly = isReadonlyView(feature, effective)
  const steps = pipelineSteps(feature, effective)
  const run = latestRun(full.runs)
  const isDriving = driving?.featureId === feature.id
  const ns = nextStep(full, {
    driving: isDriving,
    mapContent: mapQ.data?.content,
    conflict,
    unverifiedDriveKeys: unverifiedDriveKeys((prepQ.data as PrepView | undefined)?.findings ?? []),
    dryRunActive: !!driveQ.data?.dryRun,
    ...(draftBaseMissing ? { draftBaseMissing } : {}),
    openNotes,
    openDefects,
    laterLaps,
  })
  // The terminal the resolve compound has to close on its way in — one read, so
  // the bar's "End session & resolve" and the click that follows it can never be
  // about different sessions.
  const liveSession = activeSession(full.sessions)
  // The lap the workspace is on, from lap 2 (decisions.md #6). Derived from the
  // same event feed as the conflict banner — one poll for all of it.
  const banner = lapBanner(full, events)
  // Why the triage fork's rethink road cannot fire, read off the bar's OWN
  // Iterate action rather than re-derived: the dialog must not disagree with the
  // button beside it about whether the lap session can start.
  const iterateAction = ns.secondary.find((a) => a.kind === 'rethink')
  const iterateBlocked = iterateAction
    ? iterateAction.disabled
    : 'One terminal per feature — end the live session first.'
  const busy =
    start.isPending ||
    launch.isPending ||
    burn.isPending ||
    converge.isPending ||
    workWaypoint.isPending ||
    rethink.isPending ||
    cancel.isPending ||
    testDrive.isPending ||
    merge.isPending ||
    promoteNotes.isPending ||
    fixDefects.isPending ||
    unarchive.isPending ||
    resolveConflict.pending

  const runAction = (kind: ActionKind, waypointId?: string) => {
    switch (kind) {
      case 'startDraft':
        // Send the base the body is SHOWING, not just an explicit pick: omitting
        // it falls back to the checkout's current branch server-side, which is
        // not necessarily what the picker has on screen. The bar's Start is
        // disabled while this is empty, so it never sends nothing.
        start.mutate({ featureId, baseBranch: effectiveDraftBase })
        break
      case 'startGrill':
        launch.mutate({ featureId, kind: 'ideation' })
        break
      case 'askQuestions':
        launch.mutate({ featureId, kind: 'qa' })
        break
      case 'revisit':
        launch.mutate({ featureId, kind: 'revisit' })
        break
      case 'rethink':
        rethink.mutate({ featureId })
        break
      case 'converge':
      case 'resumeConverge':
        converge.mutate({ featureId })
        break
      case 'workNext':
        if (waypointId) workWaypoint.mutate({ featureId, waypointId })
        break
      case 'burn':
        burn.mutate({ featureId })
        break
      case 'cancelRun':
        if (run) cancel.mutate({ runId: run.id })
        break
      case 'unarchive':
        unarchive.mutate({ featureId })
        break
      case 'testDriveStart':
        testDrive.mutate(
          { featureId, action: 'start' },
          {
            onSuccess: (res) => {
              invalidate()
              if (res.ok && res.branch) onDriveChange({ featureId, branch: res.branch })
              else if (!res.ok) toast.push(res.deniedReason ?? 'test drive denied')
            },
          },
        )
        break
      case 'testDriveStop':
        testDrive.mutate(
          { featureId, action: 'stop' },
          {
            onSuccess: () => {
              invalidate()
              onDriveChange(null)
            },
          },
        )
        break
      // The click opens the confirmation; `runMerge` below is what actually
      // merges (findings F21 — the pipeline's most irreversible action had no
      // confirmation at all).
      case 'merge':
        setConfirmMerge(true)
        break
      // Triage for the findings inbox: the dialog offers the fork (promote the
      // quick fixes, or start the lap session on all of them) — this click only
      // opens it, exactly as `merge` opens its confirmation.
      case 'addressNotes':
        setAddressing(true)
        break
      // The review's own findings never enter that dialog (decisions #7): one
      // click fixes every open defect, with nothing to confirm and nothing to
      // choose — the whole point is that the human's arrival at review costs
      // them one line read and one button.
      case 'fixDefects':
        fixDefects.mutate({ featureId })
        break
      // Resolve a recorded merge conflict: a revisit session briefed to merge the
      // base into this branch in the talk worktree — the same launch the conflict
      // card offers, promoted to the bar's primary while the conflict stands.
      // With a terminal already live this is the compound the bar's label
      // promises: end that one first, because only one runs per feature.
      case 'resolveConflict':
        if (conflict) void resolveConflict.resolve(conflict, liveSession?.id)
        break
    }
  }

  const runMerge = () => {
    merge.mutate(
      { featureId },
      {
        onSuccess: (res) => {
          invalidate()
          setConfirmMerge(false)
          if (res.ok) {
            onDriveChange(null)
            toast.push('merged — feature shipped', 'success')
          } else if (res.conflict) {
            const n = res.files.length
            toast.push(
              n > 0
                ? `merge conflict in ${n} file${n === 1 ? '' : 's'} — resolve below and retry`
                : 'merge conflict — resolve below and retry',
            )
          }
        },
      },
    )
  }

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          {/* Same reason the stepper is hidden below: a draft's phase is
              `ideation` by construction, and naming it here reads as progress. */}
          {isDraft ? <span className="tag is-draft">draft</span> : <PhaseTag phase={feature.phase} />}
          <span className="ws-title">{feature.title}</span>
          <span className="ws-title-spacer" />
          <button className="ws-branch" title="Copy branch name" onClick={() => copyText(feature.branch, toast)}>
            <IconBranch size={11} />
            {feature.branch}
          </button>
        </div>
        {/* A draft has no meaningful pipeline position (decision 9): it is
            created at `ideation` like everything else, and a stepper lit at that
            first step would claim work has begun on a feature with no branch. */}
        {!isDraft && (
          <PipelineStepper
            steps={steps}
            lap={feature.lap}
            onView={(p) => onViewPhase(p === feature.phase ? null : p)}
          />
        )}
      </div>

      {/* Lap 1 renders nothing here at all — a feature that merges first try
          looks exactly like the plain linear flow (ADR-0010 §4). */}
      {banner && <LapBannerRow banner={banner} />}

      {readonly ? (
        <div className="readonly-bar">
          <span className="readonly-tag">READ-ONLY</span>
          <span>You're viewing the {PHASE_LABELS[effective]} phase.</span>
          <button className="readonly-back" onClick={() => onViewPhase(null)}>
            Back to {PHASE_LABELS[feature.phase]} →
          </button>
        </div>
      ) : (
        <NextStepBar
          ns={ns}
          guidance={guidance}
          busy={busy}
          onAction={runAction}
          draftBranch={
            isDraft
              ? {
                  branches: branchesQ.data?.branches,
                  value: effectiveDraftBase || null,
                  detected: branchesQ.data?.detected,
                  missing: draftBaseMissing === 'unpicked',
                  onPick: (base) => setDraftPick({ featureId, base }),
                }
              : undefined
          }
        />
      )}

      {offline && (
        <div className="ws-banner is-offline" role="status">
          <span className="ws-banner-tag">OFFLINE</span>
          <span>server unreachable — retrying…</span>
        </div>
      )}

      {resumeFailed.message && (
        <div className="ws-banner" role="alert" onClick={resumeFailed.dismiss} title="dismiss">
          <span className="ws-banner-tag">RESUME FAILED</span>
          <span>{resumeFailed.message}</span>
        </div>
      )}

      {confirmMerge && (
        <MergeFeatureDialog
          title={feature.title}
          branch={feature.branch}
          base={commits.data?.base}
          summary={mergeSummary({
            commitCount: commits.data?.count,
            run,
            driveTaken,
            openNotes,
            review,
            laterLaps,
          })}
          busy={merge.isPending}
          onConfirm={runMerge}
          onCancel={() => setConfirmMerge(false)}
        />
      )}

      {addressing && (
        <AddressNotesDialog
          notes={openNoteRows}
          busy={promoteNotes.isPending || rethink.isPending}
          iterateBlocked={iterateBlocked}
          onPromote={(noteIds) => promoteNotes.mutate({ noteIds })}
          onIterate={() => {
            setAddressing(false)
            runAction('rethink')
          }}
          onCancel={() => setAddressing(false)}
        />
      )}

      <div className="ws-body">
        <div className="ws-body-inner" key={isDraft ? 'draft' : effective}>
          {/* Status wins over phase here (decision 9): a draft is created at
              `ideation`, and the grill body would offer a terminal on a feature
              that has no branch to open one against. */}
          {isDraft ? (
            <DraftBody full={full} />
          ) : (
            <PhaseBody
              effective={effective}
              full={full}
              driving={driving}
              conflict={conflict}
              runId={run?.id ?? null}
              readonly={readonly}
              mapRailCollapsed={mapRailCollapsed}
              onToggleMapRail={onToggleMapRail}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function PhaseBody({
  effective,
  full,
  driving,
  conflict,
  runId,
  readonly,
  mapRailCollapsed,
  onToggleMapRail,
}: {
  effective: Phase
  full: FeatureFull
  driving: DriveState | null
  conflict: MergeConflictState | null
  runId: string | null
  readonly: boolean
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
}) {
  switch (effective) {
    case 'ideation':
    case 'spec':
      return (
        <GrillBody
          full={full}
          effective={effective}
          readonly={readonly}
          mapRailCollapsed={mapRailCollapsed}
          onToggleMapRail={onToggleMapRail}
        />
      )
    case 'tickets':
      return <TicketsBody featureId={full.feature.id} readonly={readonly} />
    case 'implementation':
      // Before the first burn there is no run to narrate, so an empty run pane
      // is the wrong thing to show — the tickets about to burn are. This is the
      // quick-change door's resting state (decision 21: review the one card,
      // then Burn), and it also rescues a feature whose G3 was overridden.
      return runId ? (
        <RunBody featureId={full.feature.id} runId={runId} readonly={readonly} />
      ) : (
        <TicketsBody featureId={full.feature.id} readonly={readonly} />
      )
    case 'review':
      return <ReviewBody full={full} driving={driving} conflict={conflict} readonly={readonly} />
    case 'shipped':
      return <ShippedBody full={full} />
  }
}
