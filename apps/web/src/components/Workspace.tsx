import { useEffect, useReducer, useState } from 'react'
import type { RefObject } from 'react'
import { isStoppableHeadlessRun, parsePhase, PLAN_UNFINISHED, type EventRow, type Phase } from '@runcastle/core'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { STOP_TIMEOUT } from '../lib/vocabulary'
import { relTimeAgo } from '../lib/format'
import { pathFor, type FeatureView } from '../lib/routes'
import { useLandOnChat } from '../lib/land-on-chat'
import { availableViews, bodyLabel, PANEL_VIEW_LABEL, type PanelView } from '../lib/feature-ui/panel'
import {
  DimLine,
  IconButton,
  Page,
  PageTopbar,
  StatusLabel,
  cx,
  type MetaItem,
} from '../ui'
import { IconX, PhaseIcon } from '../icons'
import type { FeatureFull, PrepView } from '../lib/api'
import { unverifiedDriveKeys } from '../lib/prep-findings'
import { effectiveStepModel, settingsLocationFromMessage } from '../lib/settings'
import { useOpenSettings } from './settings/MessageWithSettingsLink'
import type { DriveState } from '../lib/workspace'
import {
  activeSession,
  burnInterruption,
  defaultBaseBranch,
  deferredScope,
  dependencyCandidates,
  effectivePhase,
  freshness,
  goSummary,
  isReadonlyView,
  isHeadlessRun,
  isSelfPlanRun,
  lastTestDriveLap,
  latestRun,
  mergeSummary,
  nextStep,
  pendingTickets,
  phaseFacts,
  shippedAt,
  specDocPath,
  stampedReview,
  startOpensChat,
  planningFills,
  ticketsAreBody,
  unfinishedRuns,
  unresolvedMergeConflict,
  unverifiedLap,
  verificationState,
  type ActionKind,
  type DraftBaseMissing,
  type MergeConflictState,
} from '../lib/feature-ui'
import { useReviewArtifacts } from '../lib/reviews'
import { useResolveConflict } from '../lib/use-resolve-conflict'
import { useSuccessSettle } from '../lib/use-success-settle'
import { docPath, useFeatureDoc } from '../lib/use-feature-doc'
import { GoFeatureDialog } from './GoFeatureDialog'
import { DeleteFeatureDialog } from './DeleteFeatureDialog'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { MergeFeatureDialog } from './MergeFeatureDialog'
import { DraftBody } from './bodies/DraftBody'
import { GrillBody } from './bodies/grill/GrillBody'
import { PinnedBody } from './bodies/PinnedBody'
import { PreviewPanel } from './PreviewPanel'
import { ReviewBody } from './bodies/ReviewBody'
import { ShippedBody } from './bodies/ShippedBody'
import { TicketsBody } from './bodies/tickets/TicketsBody'
import { RunBody } from './bodies/RunBody'
import { DesignView, useDesignPath } from './design/DesignView'
import { DetailsView } from './inspector/Inspector'
import { FeatureDriveView } from './review/FeatureDriveView'
import { copyText } from './workspace/copy-text'
import { FeatureChat } from './workspace/FeatureChat'
import { ScenarioChatContext, ScenarioChatView } from './chat/ScenarioChat'
import { SideSessionsView } from './chat/SideSessions'
import type { GoProps } from './bodies/tickets/GoAction'
import { FeatureSessionSwitcher } from './chat/FeatureSessionSwitcher'
import { useFeatureChatColumn } from './chat/use-feature-chat-column'
import { FEATURE_CHAT } from '../lib/chat-sessions'
import { FeaturePanel, PanelSplit, PanelStrip, PanelToggle, usePanel } from './workspace/FeaturePanel'
import { HeaderAction } from './workspace/HeaderAction'
import { usePanelShow } from './workspace/use-panel-show'
import { UnrecognizedPhase } from './workspace/FeaturePanes'
import { BlocksLine, DependenciesRow } from './workspace/FeatureDependencies'
import { FeatureHeader } from './workspace/FeatureHeader'
import { FeatureSkeleton } from './workspace/FeatureSkeleton'
import { ACTION_ICON, NextStepBar } from './workspace/NextStepBar'
import { FeatureStatusLine, StopAgentDialog, WhatToTest } from './workspace/FeatureStatusLine'
import { DrivePrerequisitesNotice } from './review/DrivePrerequisitesNotice'
import {
  featureStatus,
  LEAD_WAKE_GRACE_MS,
  headerActions,
  leadWakeOf,
  type HeaderActions,
} from '../lib/feature-ui/status-line'
import { ScenarioMenuItems } from './review/ScenarioMenuItems'
import { scenarioMenu, testDriveLabel } from '../lib/feature-ui/scenarios'
import { ReadonlyBanner } from './workspace/ReadonlyBanner'
import { useResumeFailedAlert } from './workspace/use-resume-failed-alert'

export { FeatureCrash } from './workspace/FeaturePanes'

/** The page's root: a column filling the content panel. */
const FRAME = 'flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface'

/** The wall clock, re-read once `deadline` passes so what it decides catches up. */
function useNowPast(deadline: number | undefined): number {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (deadline === undefined) return
    const wait = deadline - Date.now()
    if (wait <= 0) return
    const timer = setTimeout(tick, wait)
    return () => clearTimeout(timer)
  }, [deadline])
  return Date.now()
}

/**
 * The feature page — the page every feature lives on (DESIGN.md §Frame, §Page
 * anatomy), chat-first (design-mode decisions 4, 5), rendered inside the
 * shell's content panel:
 *
 *   the one header row (decision 12) — phase glyph + title · the quiet status
 *              line, then the session switcher, at most one action (the
 *              status's primary, or Merge & ship when it applies), "…" with
 *              everything else, and the panel toggle
 *   the chat — the feature's live session (`FeatureChat`), filling the page,
 *              with the page's notices atop it
 *   one panel — on the right when open, one view at a time: the phase body,
 *              the plan preview, the design, a drive, or the details
 *
 * Go is not in the header: planning's tickets view carries it above the list.
 * The panel opens from the header's toggle (at its last view), from the
 * agent's `panel.show`, and from runcastle only as the result of the human's
 * own Go or Test drive click. Clicking an earlier step pins a read-only view
 * of that phase in the body, which says so atop it with a way back. A draft
 * has no chat, so its body is the page, its next step in its header.
 */
export function Workspace({
  featureId,
  view: viewProp,
  onViewChange,
  viewedPhase,
  onViewPhase,
  guidance,
  driving,
  onDriveChange,
  onDeleted,
}: {
  featureId: string
  /** The panel view beside the chat, or `chat` for none — the shell's, so the address bar can name it. */
  view: FeatureView
  onViewChange: (view: FeatureView) => void
  viewedPhase: Phase | null
  onViewPhase: (phase: Phase | null) => void
  guidance: boolean
  driving: DriveState | null
  onDriveChange: (d: DriveState | null) => void
  /**
   * The feature was deleted from this page's own menu: leave it. Without one,
   * the page's menu offers no Delete (the sidebar's still does).
   */
  onDeleted?: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const openSettings = useOpenSettings()
  const q = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  const resumeFailed = useResumeFailedAlert(featureId)
  // The review bar has to know two things the feature row cannot tell it: whether
  // a merge conflict is standing (it must not recommend a merge that will fail
  // again — findings F8) and which lap this branch was last test-driven in (the
  // merge confirmation reports it — F21, decision 8a). Both live in the event
  // feed, same query key as every other reader, so this shares one poll.
  const events = useEventLog(featureId)
  const conflict = unresolvedMergeConflict(events)
  const driveLap = lastTestDriveLap(events)
  // The status line reads Working on a pending wake only inside its grace, so
  // the clock is re-read once that grace runs out.
  const leadWake = leadWakeOf(events)
  const now = useNowPast(leadWake.pendingSince === undefined ? undefined : leadWake.pendingSince + LEAD_WAKE_GRACE_MS)
  // Commit and file scale from git, for the confirmation's "what lands" row
  // (decision 31a) — the base it reports is also the branch the dialog names.
  // Only at review, where the dialog that reports it is: every earlier phase
  // would be paying for two git reads whose answer it has nowhere to put
  // (research still-open 24).
  const atReview = q.data?.feature.phase === 'review'
  const delta = trpc.feature.mergeDelta.useQuery(
    { featureId },
    { refetchInterval: useLivePoll(5000), enabled: atReview },
  )
  // Test-drive notes, for the confirmation's open-notes line — same query key the
  // review body's checklist reads, so the two share one fetch.
  // Both this and the findings read below are review-phase data: everything that
  // consumes them — the merge confirmation, the bar's counts, the review
  // page's own bands — only exists at review. They used to poll in every phase
  // (research still-open 24), a timer per surface for rows nothing on screen was
  // showing; the SSE feed invalidates both keys whatever the phase.
  const poll = useLivePoll()
  const reviewPoll = atReview ? poll : (false as const)
  const notes = trpc.notes.list.useQuery({ featureId }, { refetchInterval: reviewPoll })
  const openNoteRows = notes.data?.filter((n) => n.status === 'open') ?? []
  const openNotes = notes.data ? openNoteRows.length : undefined
  // The review agent's findings, counted server-side (findings joined to their
  // fix tickets) — the bar counts exactly the rows the review body lists,
  // because both read this one query key. Review agents no longer write test
  // notes at all, so `openNotes` above is the human's own inbox and nothing else.
  const findings = trpc.findings.listByFeature.useQuery(
    { featureId },
    { refetchInterval: reviewPoll },
  )
  const openDefects = findings.data?.summary.open
  // How fresh the review evidence is, for the confirmation's review row
  // (decision 19d). The same artifacts listing and the same stamp the review
  // page's status strip reads, so the dialog and the screen behind it cannot
  // vouch for different builds — the walked bug was a green merge row over a
  // review of a build that fix tickets had already replaced.
  const artifacts = useReviewArtifacts(featureId, atReview)
  const stamped = stampedReview(artifacts.data ?? [], q.data?.tickets ?? [])
  const reviewFreshness = freshness(
    stamped,
    { landedSince: stamped?.landedSince ?? 0, lap: q.data?.feature.lap ?? 1 },
    verificationState(q.data?.tickets ?? []),
  )
  // This lap's review verified nothing (review-as-a-lap-trail decision 5) — off
  // the same artifacts listing the review page's own banner reads, so the bar
  // and the banner can never disagree about whether anything was checked.
  const unverifiedReview = unverifiedLap({
    passes: artifacts.data ?? [],
    tickets: q.data?.tickets ?? [],
    currentLap: q.data?.feature.lap ?? 1,
  })
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [confirmBurn, setConfirmBurn] = useState(false)
  // What the Burn confirmation prints in its warn box (decision 5) — computed
  // server-side, in the same pattern as `mergeDelta`, so the dialog never
  // re-derives policy. Read in every state a Burn can be clicked from, which
  // is every one but shipped, so the box is already populated when the dialog
  // opens rather than popping in after it.
  const burnable = !!q.data && q.data.feature.phase !== 'shipped'
  const burnWarningsQ = trpc.feature.goWarnings.useQuery(
    { featureId },
    { refetchInterval: useLivePoll(), enabled: burnable },
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
  // preparation dry run holds this project's drive slot (decision 9), which only the
  // server's drive info knows; ReviewBody polls the same key, so this is one fetch.
  const projectId = q.data?.feature.projectId
  const prepQ = trpc.project.prep.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, refetchInterval: useLivePoll() },
  )
  const driveQ = trpc.feature.driveInfo.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, refetchInterval: useLivePoll() },
  )
  // What a drive of this feature can land on (drive-scenarios decision 7), for
  // the Test drive split button. Review is the only phase that offers a drive,
  // and the list is two git reads, so it waits for review like the merge delta.
  const scenariosQ = trpc.feature.driveScenarios.useQuery(
    { projectId: projectId ?? '', featureId },
    { enabled: !!projectId && atReview, refetchInterval: useLivePoll(5000) },
  )
  const startMenu = scenarioMenu(scenariosQ.data?.scenarios ?? [], {
    withOwnSection: true,
    runnerConfigured: scenariosQ.data?.runnerConfigured ?? false,
  })
  // How long tickets have actually been taking in THIS project, for the pre-burn
  // bar's time expectation (decision #16b). History, so it does not poll — a
  // median over every ticket the project has ever finished cannot move within a
  // sitting by enough to matter.
  const burnStatsQ = trpc.ticket.durationStats.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  )
  // The model a ticket with no assignment of its own burns on, for the Burn
  // confirmation's "model" row. Same query key the ticket ledger's model menus
  // read, so the dialog and the ledger behind it share one fetch and cannot
  // name different defaults.
  const settingsQ = trpc.settings.get.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && burnable },
  )
  const defaultBurnModel = effectiveStepModel(settingsQ.data, 'implement')
  // The status line's inputs (`the-feature-lead-runs-rounds` decision 21): the
  // rounds and the agent's ready declarations.
  const roundsQ = trpc.feature.rounds.useQuery({ featureId }, { refetchInterval: useLivePoll() })
  const declarationsQ = trpc.feature.readyDeclarations.useQuery(
    { featureId },
    { refetchInterval: useLivePoll() },
  )
  // What this host is missing to record a drive's walkthrough — said where a
  // drive starts, and only then (decision 24). The server caches the probe.
  const drivePrereqs = trpc.project.drivePrerequisites.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  )
  // What the next burn's docs digest will cost EVERY ticket in it, for the
  // pre-burn bar's warning — the burner's own read of the same files, so the bar
  // and the run timeline's event cannot report different sizes. Only on the two
  // roads into a burn, where the bar has somewhere to put it, and it does not
  // poll: a session writing the docs pushes, and the stream invalidates the
  // whole `docs` router on the same signal that refreshes their text.
  const preBurn = q.data?.feature.phase === 'planning' || q.data?.feature.phase === 'building'
  const digestQ = trpc.docs.digestSize.useQuery({ featureId }, { enabled: preBurn })
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
  // A run watched to success is seen to succeed before the page changes
  // (decision #15a): the burn finalizer advances the phase itself, so the body
  // swap — and only the body swap — waits out the lanes' all-green beat.
  const settlingRunId = useSuccessSettle(latestRun(q.data?.runs ?? []))
  // How many decisions ideation settled — the one fact the phase summary cannot
  // read off the feed (decision 10). Same `docs.read` query key the artifact
  // pane resolves, so the banner, the stepper's tooltip and the pane the human
  // is reading all share one fetch.
  const decisions = useFeatureDoc(featureId, docPath(q.data?.docs ?? [], 'decisions.md')).content

  // The panel (design-mode decision 5): the views this state offers, and the
  // one open — the shell's, shown only while this state still offers it (a
  // drive that stopped takes its view with it).
  const isDriving = driving?.featureId === featureId
  const views = q.data
    ? availableViews({
        isDraft,
        phase: q.data.feature.phase,
        hasPreview: !!q.data.preview,
        driveActive: isDriving || (driveQ.data?.featureId === featureId && driveQ.data.state !== 'idle'),
      })
    : []
  const requested = viewProp === 'chat' ? null : viewProp
  const panel = usePanel(requested && views.includes(requested) ? requested : null, onViewChange)
  // The agent's `show_panel`, for a view this state offers.
  usePanelShow(events, featureId, (request) => {
    if (views.includes(request.view)) panel.dispatch({ type: 'open', ...request, origin: 'agent' })
  })
  // The page the design view loads, for the panel header to name.
  const designPath = useDesignPath(featureId, panel.state.path, panel.state.view === 'design')
  // The chat column (decision 9): the feature chat, the drive errand's
  // scenario chat, which an errand's open brings to the front, and the
  // feature's side sessions (several-sessions-per-feature decision 10).
  const column = useFeatureChatColumn({
    featureId,
    sessions: q.data?.sessions ?? [],
    driveSessionId: driveQ.data?.featureId === featureId ? driveQ.data.scenarioSessionId : undefined,
  })

  // Settles once the refetches land, for a mutation that must stay pending
  // until the page shows what it caused.
  const refresh = () =>
    Promise.all([
      utils.feature.get.invalidate({ id: featureId }),
      utils.feature.list.invalidate(),
      // The timeline too, and not as an afterthought: the bar's conflict banner and
      // its drive-taken stamp are derived from the event log, so a mutation that
      // refreshed only the feature row would leave the thing it just caused
      // waiting on the push pipe to become visible.
      utils.events.invalidate(),
    ])
  const invalidate = () => {
    void refresh()
  }

  // Every session this page launches lands on the chat once it is up
  // (one-chat-layout-everywhere decision 3) — the bar's Chat, a draft's Start,
  // every road into the next lap and fix drive.
  const landOnChat = useLandOnChat(featureId)
  const launched = () => {
    invalidate()
    landOnChat()
  }
  const launch = trpc.feature.launchSession.useMutation({ onSuccess: launched, onError: (e) => toast.push(e.message) })
  const burn = trpc.feature.go.useMutation({
    // The human's Go: the run it started opens beside the chat.
    onSuccess: () => {
      invalidate()
      onViewPhase(null)
      panel.dispatch({ type: 'follow', click: 'go' })
    },
    onError: (e) => toast.push(e.message),
  })
  // Stop, the status row's primary while a round runs (decision 23).
  const [confirmStop, setConfirmStop] = useState(false)
  const stopAgent = trpc.feature.stop.useMutation({
    onSuccess: () => {
      invalidate()
      void utils.feature.rounds.invalidate({ featureId })
      toast.push('stopped — nothing new starts until you reply to the agent', 'info')
    },
    onError: (e) => toast.push(e.message),
  })
  // The end half of every end-and-proceed compound (decision 4). No surface
  // refuses a click because a terminal is live any more: the label says the
  // session will be closed, and this is the close it promised.
  const endSession = trpc.feature.endSession.useMutation({
    onError: (e) => toast.push(e.message),
  })
  const cancel = trpc.run.cancel.useMutation({
    // It resolves once the run's agents are confirmed dead, so this says what
    // happened rather than what was asked for — unless the kill could not be
    // confirmed, which is the one thing the human has to hear.
    onSuccess: (r) => {
      invalidate()
      if (r.confirmed) toast.push('run cancelled — its agents are stopped', 'info')
      else toast.push(STOP_TIMEOUT)
    },
    onError: (e) => toast.push(e.message),
  })
  // An agent sent at the environment a drive's setup command died in — the
  // stage offers the same launch from inside the failure it explains.
  const fixDrive = trpc.feature.fixDrive.useMutation({
    onSuccess: launched,
    onError: (e) => toast.push(e.message),
  })
  const testDrive = trpc.feature.testDrive.useMutation({
    onSuccess: (res, vars) => {
      // A drive takes and releases the branch and stamps the timeline; the bar
      // and the review body read all of it back through these queries.
      invalidate()
      // The human's Test drive: the drive it started opens beside the chat.
      if (vars.action === 'start' && res.ok) panel.dispatch({ type: 'follow', click: 'testDrive' })
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
  // best-effort — mirroring the New Feature form's create-then-launch. A parked
  // quick change skips the chat: it lands ready to Burn, as a started one does.
  // A failure leaves the draft intact and startable, so the toast is the whole
  // recovery.
  // A draft's Waits-on row (ADR-0013): candidates come from the rail's own list
  // query, and a refusal is rejected back to the row, which says it inline.
  const projectList = trpc.feature.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && isDraft },
  )
  const setDependencies = trpc.feature.setDependencies.useMutation({
    onSuccess: invalidate,
    // No toast: the row already says the refusal inline, and without a handler
    // here the MutationCache safety net would repeat it raw (backticks and all).
    onError: () => undefined,
  })
  const start = trpc.feature.start.useMutation({
    onSuccess: (res, vars) => {
      invalidate()
      if (startOpensChat(res)) launch.mutate({ featureId: vars.featureId, kind: 'chat' })
    },
    onError: (e) => toast.push(e.message),
  })
  // Plan it yourself (features-plan-themselves decisions 5, 9): the same start
  // and launch as above, but the session is a headless run with no terminal, so
  // neither lands on the chat — the plan is watched from the body.
  // It stays pending until the feature is refetched with the new run on it, so
  // the row reads Planning by itself from the click on, never idle in between.
  const launchSelfPlan = trpc.feature.launchSession.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.push(e.message),
  })
  const startSelfPlan = trpc.feature.start.useMutation({
    onSuccess: (res, vars) => {
      invalidate()
      if (startOpensChat(res)) launchSelfPlan.mutate({ featureId: vars.featureId, kind: 'chat', purpose: 'self-plan' })
    },
    onError: (e) => toast.push(e.message),
  })
  // The resolve launch, shared with the conflict card below so the two brief the
  // agent identically (decisions #10) — and so the bar's primary can end a live
  // session on the way in rather than hiding until the human ends it themselves.
  const resolveConflict = useResolveConflict(featureId, q.data?.feature.branch ?? '')

  const [deleteOpener, setDeleteOpener] = useState<RefObject<HTMLButtonElement | null> | null>(null)
  const archive = trpc.feature.archive.useMutation({
    onSuccess: () => {
      invalidate()
      toast.push('feature archived', 'success')
    },
    onError: (e) => toast.push(e.message),
  })
  const del = trpc.feature.delete.useMutation({
    onSuccess: () => {
      void utils.feature.list.invalidate()
      setDeleteOpener(null)
      onDeleted?.()
    },
    onError: (e) => toast.push(e.message),
  })

  if (q.isLoading) {
    return (
      <section className={FRAME}>
        <FeatureSkeleton />
      </section>
    )
  }
  // Hard error ONLY when there was never data (first load failed). When a
  // refetch fails AFTER data exists (server restart mid-session), TanStack Query
  // keeps the last-good `data` alongside `error` — keep rendering it so the
  // embedded terminal stays MOUNTED (its own reconnect strip + scrollback replay
  // depend on surviving the outage) and show a quiet offline word instead. The
  // 1.5s refetchInterval keeps polling through the error, so it self-clears the
  // moment the server is back.
  if (!q.data) {
    return (
      <section className={FRAME}>
        <PageTopbar />
        <Page>
          <DimLine>Could not load the feature{q.error ? `: ${q.error.message}` : ''}</DimLine>
        </Page>
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
  const run = latestRun(full.runs)
  const interruptedBurn = burnInterruption(events, run?.id)
  // The beat is over the body only — the status line and the bar tell the truth
  // about the phase throughout, and a human who is not on the run view (viewing
  // an earlier phase, or already past review) is never held.
  const settling = !!settlingRunId && run?.id === settlingRunId && effective === 'review'
  const bodyPhase = settling ? 'building' : effective
  const ns = nextStep(full, {
    driving: isDriving,
    // The server's own drive state, scoped to THIS feature (decision 20) — the
    // same value the evidence stage renders from, so the bar and the stage can
    // no longer derive drive truth separately and disagree.
    driveState: driveQ.data?.featureId === feature.id ? driveQ.data.state : 'idle',
    conflict,
    unverifiedDriveKeys: unverifiedDriveKeys((prepQ.data as PrepView | undefined)?.findings ?? []),
    // Whoever else holds this project's drive slot, named as the server names it.
    ...(driveQ.data && driveQ.data.featureId !== feature.id
      ? { slotHolder: driveQ.data.holderLabel }
      : {}),
    ...(burnStatsQ.data ? { burnStats: burnStatsQ.data } : {}),
    ...(digestQ.data ? { docsDigestBytes: digestQ.data.bytes } : {}),
    ...(draftBaseMissing ? { draftBaseMissing } : {}),
    openNotes,
    openDefects,
    ...(unverifiedReview ? { unverifiedReview: { reason: unverifiedReview.reason } } : {}),
    laterLaps,
    interruptedBurn,
    unfinishedRuns: unfinishedRuns(events),
  })
  // The terminal the resolve compound has to close on its way in — one read, so
  // the bar's "End session & resolve" and the click that follows it can never be
  // about different sessions.
  const liveSession = activeSession(full.sessions)
  const busy =
    start.isPending ||
    launch.isPending ||
    startSelfPlan.isPending ||
    launchSelfPlan.isPending ||
    burn.isPending ||
    cancel.isPending ||
    testDrive.isPending ||
    merge.isPending ||
    fixDrive.isPending ||
    unarchive.isPending ||
    endSession.isPending ||
    resolveConflict.pending

  /**
   * The end half of the compound (decision 4): end the live terminal, if there
   * is one, and say whether the road on is clear. The order is enforced here
   * rather than server-side — the launcher's `assertSpawnable` refuses a second
   * live session outright, so the end has to have LANDED before the launch is
   * attempted, and `endSession` marks the row ended synchronously, so awaiting
   * it is enough (the same reasoning as `use-resolve-conflict`).
   *
   * A failed end aborts whatever was going to follow: its toast has already said
   * why, and a launch fired into a session that is still live would only collect
   * a second refusal.
   */
  const endLiveSession = async (): Promise<boolean> => {
    if (!liveSession) return true
    try {
      await endSession.mutateAsync({ sessionId: liveSession.id })
    } catch {
      return false
    }
    invalidate()
    return true
  }

  /**
   * Resume the feature's one conversation, or start the first one (decisions 8
   * and 12) — the chat's own Resume / Start button.
   */
  const launchChat = () => {
    launch.mutate({ featureId, kind: 'chat' })
  }

  /**
   * The bar's constant Chat door: it starts or resumes the conversation and
   * lands on the chat (one-chat-layout-everywhere decision 5).
   *
   * A session that is already up is not re-launched on the way in — the chat
   * hosts whichever one is live (decision 9). The server would answer a chat
   * launch with that same session (decision 12), but it would also write a fresh
   * state header into its terminal on every click (decision 13), which is for a
   * human arriving at a conversation they had lost sight of.
   */
  const openChat = () => {
    // A headless run has no terminal to land on, and the server refuses a chat
    // beside it — say so rather than land on a chat with nothing to answer.
    if (liveSession && isHeadlessRun(liveSession))
      toast.push(
        isSelfPlanRun(liveSession)
          ? 'This feature is planning itself — stop the run to open the chat.'
          : 'This feature is working by itself — stop the run to open the chat.',
        'info',
      )
    else if (liveSession) landOnChat()
    else launchChat()
  }

  /** Start this feature's drive on a scenario, or on the blank app with `null`. */
  const startDrive = (scenario: string | null) =>
    testDrive.mutate(
      { featureId, action: 'start', ...(scenario ? { scenario } : {}) },
      {
        onSuccess: (res) => {
          invalidate()
          if (res.ok && res.branch) onDriveChange({ featureId, branch: res.branch })
          else if (!res.ok) toast.push(res.deniedReason ?? 'test drive denied')
        },
      },
    )

  const runAction = (kind: ActionKind) => {
    switch (kind) {
      case 'startDraft':
        // Send the base the body is SHOWING, not just an explicit pick: omitting
        // it falls back to the checkout's current branch server-side, which is
        // not necessarily what the picker has on screen. The bar's Start is
        // disabled while this is empty, so it never sends nothing.
        start.mutate({ featureId, baseBranch: effectiveDraftBase })
        break
      case 'chat':
        openChat()
        break
      // Plan it yourself: a draft is started off the same base Start would send,
      // then launched as a self-planning run; a started feature just launches.
      case 'selfPlan':
        if (isDraft) startSelfPlan.mutate({ featureId, baseBranch: effectiveDraftBase })
        else launchSelfPlan.mutate({ featureId, kind: 'chat', purpose: 'self-plan' })
        break
      // Stop is ending the run: it has no terminal to type into (decision 9).
      // Only the run it was offered for — never a lead woken in its place.
      case 'stopHeadlessRun':
        if (liveSession && isStoppableHeadlessRun(liveSession)) void endLiveSession()
        break
      // The click opens the confirmation; `runBurn` below is what actually
      // burns. Every ex-gate that used to refuse this click is a warning inside
      // that dialog now (decision 5), so the reading has to happen somewhere.
      case 'burn':
        setConfirmBurn(true)
        break
      case 'cancelRun':
        if (run) cancel.mutate({ runId: run.id })
        break
      // The click opens the confirmation; the dialog's Stop is what stops.
      case 'stopAgent':
        setConfirmStop(true)
        break
      // A burn that could not start named its fix in the summary — open the
      // settings row that summary points at (the image rebuild).
      case 'openBurnSettings': {
        const location = run?.summary ? settingsLocationFromMessage(run.summary) : null
        if (location) openSettings?.(location)
        break
      }
      case 'unarchive':
        unarchive.mutate({ featureId })
        break
      // The split button's main click: the feature's first own scenario, or the
      // blank app when it has none (drive-scenarios decision 7).
      case 'testDriveStart':
        startDrive(startMenu.defaultScenario?.file ?? null)
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
      // A drive whose setup command died: an agent reads the failure on the
      // human's machine and repairs the environment, with the branch left
      // checked out because that is the state it needs.
      case 'fixDrive':
        fixDrive.mutate({ featureId })
        break
      // The click opens the confirmation; `runMerge` below is what actually
      // merges (findings F21 — the pipeline's most irreversible action had no
      // confirmation at all).
      case 'merge':
        setConfirmMerge(true)
        break
      // Resolve a recorded merge conflict: a revisit session briefed to merge the
      // base into this branch in the talk worktree — the same launch the conflict
      // card offers, promoted to the bar's primary while the conflict stands.
      // With a terminal already live this is the compound the bar's label
      // promises: end that one first, because only one runs per feature.
      case 'resolveConflict':
        if (conflict) void resolveConflict.resolve(conflict, liveSession?.id)
        break
      // A kind with no case above is a button that does nothing on click, and
      // nothing says so — the bug this switch shipped with. `never` makes the
      // omission a typecheck error instead of a dead button.
      default:
        kind satisfies never
    }
  }

  // The dialog closes on a Go that was TAKEN. A refusal — the feature planning
  // itself, or an unfinished plan with no override reason — raises its toast
  // with the dialog still up, because closing it would take the reading away
  // and leave nothing on screen the human can act on.
  const runBurn = (overrideReason?: string) => {
    burn.mutate(
      { featureId, ...(overrideReason ? { overrideReason } : {}) },
      { onSuccess: () => setConfirmBurn(false) },
    )
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

  // ---- the frame (DESIGN.md §Frame, §Page anatomy) ----

  const ticketsIsBody = ticketsAreBody({ full, phase: bodyPhase, readonly, hasRun: !!run })
  // Pinning a phase is a different body; it always opens it — the human's click.
  const viewPhase = (p: Phase | null) => {
    panel.dispatch({ type: 'open', view: 'body', origin: 'human' })
    onViewPhase(p)
  }
  const shown = panel.state.view
  const labelOf = (v: PanelView) =>
    v === 'body' ? bodyLabel(bodyPhase, { ticketsIsBody, hasRun: !!run }) : PANEL_VIEW_LABEL[v]

  // Live planning's artifact scrolls itself, so it fills the body; every other
  // body is a document in the page column, the header scrolling away with it.
  // The data-heavy ones (the run's lanes, the review's evidence, the ledger)
  // take the wide column.
  const fill = !isDraft && planningFills({ phase: bodyPhase, readonly, ticketsIsBody })
  // Per phase: every working phase (planning's panes included) shares the wide
  // column; the shipped record and a draft read as documents.
  const wide = !isDraft && bodyPhase !== 'shipped'

  // Rises in once per navigation — feature, pinned phase — never on a refetch.
  const routeKey = `${featureId}:${isDraft ? 'draft' : bodyPhase}`

  const shipped = feature.status === 'shipped' ? shippedAt([...events]) : null
  const factList: Array<MetaItem | false> = [
    isDraft
      ? { phase: 'draft', text: `Added to backlog ${relTimeAgo(feature.createdAt)}` }
      : shipped
        ? { tone: 'success', text: `Merged ${relTimeAgo(shipped)}` }
        : { text: `Started ${relTimeAgo(feature.createdAt)}` },
    // No ticket count here (d6e): the ticket ledger's own count line, next to
    // the tickets, states it in planning; the status rows state it after.
    feature.status === 'archived' && { tone: 'neutral', text: 'Archived' },
  ]
  const facts = factList.filter((f): f is MetaItem => !!f)

  const menuActions: FeatureAction[] = [
    {
      key: 'copy-link',
      label: 'Copy link',
      onSelect: () =>
        copyText(
          window.location.origin +
            pathFor({ kind: 'feature', projectId: feature.projectId, featureSlug: feature.slug }),
          toast,
        ),
    },
    ...(!isDraft && feature.branch
      ? [{ key: 'copy-branch', label: 'Copy branch name', onSelect: () => copyText(feature.branch, toast) }]
      : []),
    // A draft is never offered Archive (decision 8) — it is refused server-side.
    ...(feature.status === 'archived'
      ? [{ key: 'unarchive', label: 'Unarchive', onSelect: () => unarchive.mutate({ featureId }) }]
      : feature.status !== 'draft'
        ? [{ key: 'archive', label: 'Archive', onSelect: () => archive.mutate({ featureId }) }]
        : []),
    // Delete is non-shipped only, and only where the page can leave the
    // feature it just deleted (the shell's `onDeleted`).
    ...(onDeleted && feature.status !== 'shipped'
      ? [
          {
            key: 'delete',
            label: 'Delete…',
            danger: true,
            onSelect: (ref: RefObject<HTMLButtonElement | null>) => setDeleteOpener(ref),
          },
        ]
      : []),
  ]

  // The one status line (decisions 21, 24) takes the row's left column on every
  // started feature, and picks the row's one primary; a parked draft keeps the
  // bar's own sentence, since nothing has been planned with anyone yet.
  const status = isDraft
    ? undefined
    : featureStatus({
        feature,
        rounds: roundsQ.data ?? [],
        declarations: declarationsQ.data ?? [],
        agentWorking: !!liveSession && !liveSession.awaitingInput,
        driving: isDriving,
        // A draft's start turns it into a planning feature before the run is
        // even launched, so the start counts as planning by itself too.
        selfPlanning:
          (!!liveSession && isSelfPlanRun(liveSession)) || startSelfPlan.isPending || launchSelfPlan.isPending,
        leadWake,
        uncommittedDesign: full.uncommittedDesign,
        now,
      })
  const actionsBusy = busy || stopAgent.isPending
  const testDriveSplit = {
    kind: 'testDriveStart' as const,
    label: testDriveLabel(startMenu.defaultScenario, 'Start test drive'),
    menuLabel: 'Choose a scenario',
    menu: <ScenarioMenuItems menu={startMenu} onPick={startDrive} />,
  }
  // The one header row's share of the status line's actions (decision 12):
  // one button, Go for the tickets view, the rest for "⋯". A pinned phase is
  // a frozen record, so it offers none of them.
  const headerRow: HeaderActions = status && !readonly ? headerActions(ns, status) : { overflow: [] }

  // A parked draft keeps its next-step bar in its header, where its body is the page.
  const draftRow = isDraft && (
    <NextStepBar
      ns={ns}
      guidance={guidance}
      busy={actionsBusy}
      onAction={runAction}
      split={testDriveSplit}
      draftBranch={{
        branches: branchesQ.data?.branches,
        value: effectiveDraftBase || null,
        detected: branchesQ.data?.detected,
        missing: draftBaseMissing === 'unpicked',
        onPick: (base) => setDraftPick({ featureId, base }),
      }}
    />
  )
  // A pinned phase says so atop its body, with the way back.
  const readonlyBanner = readonly && (
    <ReadonlyBanner
      phase={effective}
      livePhase={feature.phase}
      facts={phaseFacts({ phase: effective, full, events, decisions })}
      onBack={() => viewPhase(null)}
    />
  )

  const resumeAlert = resumeFailed.message && (
    <div className="flex items-start gap-3 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger" role="alert">
      <span className="min-w-0 flex-1">
        <span className="font-medium">Resume failed.</span> {resumeFailed.message}
      </span>
      <IconButton label="Dismiss" size="sm" icon={<IconX />} onClick={resumeFailed.dismiss} />
    </div>
  )
  // Said where a drive starts, and only when it applies (decision 24).
  const drivePrereqsNotice = !readonly && status?.primary === 'testDriveStart' && (
    <DrivePrerequisitesNotice missing={drivePrereqs.data?.missing ?? []} />
  )
  // What the strip used to stack under the header goes atop the chat column
  // instead (decision 12): notices, not another bar.
  const chatAlerts = (resumeAlert || drivePrereqsNotice || status?.whatToTest) && (
    <>
      {resumeAlert}
      {status && <WhatToTest status={status} />}
      {drivePrereqsNotice}
    </>
  )

  // The title and its facts head the body. A draft's next step stays in its
  // header, where its body is the page.
  const bodyHeader = (
    <FeatureHeader feature={feature} isDraft={isDraft} facts={facts}>
      {isDraft && resumeAlert}
      {readonlyBanner}
      <DependenciesRow
        isDraft={isDraft}
        dependsOn={full.dependsOn}
        candidates={dependencyCandidates(projectList.data ?? [], feature, full.dependsOn)}
        onChange={(dependsOn) => setDependencies.mutateAsync({ featureId, dependsOn })}
      />
      <BlocksLine projectId={feature.projectId} blocks={full.blocks} />
      {draftRow}
    </FeatureHeader>
  )

  const body = isDraft ? (
    // Status wins over phase here (decision 9): a draft is created at
    // `ideation`, and the grill body would offer a terminal on a feature
    // that has no branch to open one against.
    <DraftBody full={full} />
  ) : (
    <PhaseBody
      effective={bodyPhase}
      full={full}
      events={events}
      driving={driving}
      conflict={conflict}
      runId={run?.id ?? null}
      ticketsIsBody={ticketsIsBody}
      readonly={readonly}
      onViewPhase={viewPhase}
      {...(views.includes('drive') ? { onOpenDrive: () => panel.dispatch({ type: 'open', view: 'drive', origin: 'human' }) } : {})}
      {...(headerRow.go ? { go: { action: headerRow.go, busy: actionsBusy, onGo: () => runAction('burn') } } : {})}
    />
  )

  // The body view: live planning's panes fill it and scroll themselves (decisions
  // 6, 11); every other body is a document in the page column.
  const bodyView = fill ? (
    <div key={routeKey} className="flex min-h-0 min-w-0 flex-1 flex-col px-8 pt-8 animate-rise-in">
      <div className="shrink-0 pb-5">{bodyHeader}</div>
      <div className="flex min-h-0 min-w-0 flex-1 pb-6">{body}</div>
    </div>
  ) : (
    <Page width={wide ? 'wide' : 'default'} routeKey={routeKey}>
      {bodyHeader}
      <div className="mt-10">{body}</div>
    </Page>
  )

  const panelView = (v: PanelView) => {
    switch (v) {
      case 'body':
        return bodyView
      case 'preview':
        return full.preview ? (
          <div className="px-6 pb-8">
            <PreviewPanel
              featureId={featureId}
              preview={full.preview}
              onOpenDesign={(path) => {
                // The human's own click inside the preview; the design view starts the server.
                if (views.includes('design')) panel.dispatch({ type: 'open', view: 'design', path, origin: 'human' })
              }}
            />
          </div>
        ) : null
      case 'design':
        return (
          <DesignView
            featureId={featureId}
            {...(panel.state.path ? { path: panel.state.path } : {})}
            {...(panel.state.width !== undefined ? { width: panel.state.width } : {})}
          />
        )
      case 'drive':
        return <FeatureDriveView full={full} />
      case 'details':
        return <DetailsView featureId={featureId} />
    }
  }
  const chatHidden = !!shown && !panel.state.collapsed && panel.state.share >= 1
  // The header's "⋯": what the status line's row offered beyond its one
  // button, then the feature's own actions.
  const overflowActions: FeatureAction[] = headerRow.overflow.map((a) => ({
    key: `next-${a.kind}`,
    label: a.kind === testDriveSplit.kind ? testDriveSplit.label : a.label,
    icon: ACTION_ICON[a.kind],
    ...(a.disabled ? { disabled: a.disabled } : {}),
    ...(a.hint ? { hint: a.hint } : {}),
    onSelect: () => runAction(a.kind),
  }))

  return (
    // `overflow-clip`, not `hidden`: the feature view is the app's one unbounded
    // render surface, and anything that does escape its column must not become
    // the frame's scrollable overflow. `clip` refuses the scroll instead of
    // hiding it, and creates no scroll container, so the page below keeps
    // scrolling itself and the next step's branch menu still opens over it.
    <section className={cx(FRAME, 'overflow-clip')} aria-label={feature.title}>
      {/* The page's one header row (decision 12): title · status, then the
          switcher, at most one action, "⋯" and the panel toggle. */}
      <PageTopbar
        crumbs={[
          {
            label: feature.title,
            icon: <PhaseIcon phase={isDraft ? 'draft' : feature.phase} size={14} label="" />,
          },
        ]}
        status={status && <FeatureStatusLine status={status} />}
        actions={
          <>
            {offline && (
              <StatusLabel tone="warning" className="mr-2" title="The server is unreachable — retrying">
                Offline, retrying
              </StatusLabel>
            )}
            {!isDraft && (
              <span className="mr-1 flex min-w-0">
                <FeatureSessionSwitcher
                  column={column}
                  featureId={featureId}
                  {...(liveSession ? { liveSessionId: liveSession.id } : {})}
                />
              </span>
            )}
            {headerRow.action && (
              <span className="mr-1 flex">
                <HeaderAction
                  action={headerRow.action}
                  busy={actionsBusy}
                  onAction={runAction}
                  split={testDriveSplit}
                />
              </span>
            )}
            <FeatureActionsMenu actions={[...overflowActions, ...menuActions]} size="md" />
            <PanelToggle open={!!shown} views={views} onToggle={() => panel.dispatch({ type: 'toggle', views })} />
          </>
        }
      />
      {isDraft ? (
        <Page routeKey={routeKey}>
          {bodyHeader}
          <div className="mt-10">{body}</div>
        </Page>
      ) : (
        <>
          {/* The drive's errands open their chat in this page's column. */}
          <ScenarioChatContext.Provider value={column.scenario}>
            <PanelSplit
              chat={
                // The same elements whatever the panel does: xterm keeps its
                // buffer. The switcher picks which is in front; the column is
                // hidden only while the panel has the whole row.
                <>
                  <FeatureChat
                    full={full}
                    events={events}
                    alerts={chatAlerts}
                    hidden={chatHidden || column.inFront !== FEATURE_CHAT}
                    launching={launch.isPending}
                    launchError={launch.error?.message}
                    onLaunch={launchChat}
                    onView={(target) => {
                      if (views.includes(target)) panel.dispatch({ type: 'open', view: target, origin: 'human' })
                    }}
                  />
                  <ScenarioChatView
                    chat={column.scenario}
                    hidden={chatHidden || column.inFront !== column.scenario.sessionId}
                  />
                  <SideSessionsView sides={column.sides} inFront={column.inFront} hidden={chatHidden} />
                </>
              }
              panel={
                shown && (
                  <FeaturePanel
                    view={shown}
                    views={views}
                    label={labelOf}
                    path={designPath}
                    onSwitch={(v) => panel.dispatch({ type: 'switch', view: v })}
                    onCollapse={() => panel.dispatch({ type: 'collapse' })}
                    onClose={() => panel.dispatch({ type: 'close' })}
                  >
                    {panelView(shown)}
                  </FeaturePanel>
                )
              }
              share={panel.state.share}
              collapsed={panel.state.collapsed}
              strip={
                shown && (
                  <PanelStrip
                    label={labelOf(shown)}
                    onExpand={() => panel.dispatch({ type: 'expand' })}
                    onClose={() => panel.dispatch({ type: 'close' })}
                  />
                )
              }
              onResize={(share) => panel.dispatch({ type: 'setWidth', share })}
              onToggleFull={() => panel.dispatch({ type: 'toggleFull' })}
            />
          </ScenarioChatContext.Provider>
        </>
      )}

      {confirmBurn && (
        <GoFeatureDialog
          title={feature.title}
          branch={feature.branch}
          summary={goSummary({
            branch: feature.branch,
            pendingTickets: pendingTickets(full.tickets),
            ...(defaultBurnModel ? { defaultModel: defaultBurnModel } : {}),
            warnings: burnWarningsQ.data,
          })}
          busy={burn.isPending}
          warningsPending={!burnWarningsQ.data}
          // The row's gated Go opened this: the confirmation is its override.
          {...(status?.primary === 'goGated' ? { gate: PLAN_UNFINISHED } : {})}
          onConfirm={runBurn}
          onCancel={() => setConfirmBurn(false)}
        />
      )}

      <StopAgentDialog
        open={confirmStop}
        busy={stopAgent.isPending}
        onStop={() => stopAgent.mutate({ featureId })}
        onClose={() => setConfirmStop(false)}
      />

      {confirmMerge && (
        <MergeFeatureDialog
          title={feature.title}
          branch={feature.branch}
          base={delta.data?.base}
          summary={mergeSummary({
            branch: feature.branch,
            ...(delta.data?.base ? { base: delta.data.base } : {}),
            ...(delta.data ? { delta: delta.data } : {}),
            tickets: full.tickets,
            lap: feature.lap,
            driveLap,
            openNotes,
            // A project drive of this project serves from the checkout the
            // merge commits in, so the server stops it first (decision 6).
            ...(driveQ.data?.projectDrive
              ?{ projectDrive: { holderLabel: driveQ.data.holderLabel } }
              : {}),
            freshness: reviewFreshness,
            conflict,
            laterLaps,
            burning: run?.status === 'running',
          })}
          busy={merge.isPending}
          resolving={resolveConflict.pending}
          onConfirm={runMerge}
          // The same act as the conflict card's button, through the same hook —
          // the dialog cannot brief the resolve agent differently (decision 29).
          onResolve={
            conflict
              ? () => void resolveConflict.resolve(conflict, liveSession?.id ?? undefined)
              : undefined
          }
          onCancel={() => setConfirmMerge(false)}
        />
      )}

      {deleteOpener && (
        <DeleteFeatureDialog
          title={feature.title}
          slug={feature.slug}
          busy={del.isPending}
          onConfirm={() => del.mutate({ featureId })}
          onCancel={() => setDeleteOpener(null)}
          returnFocusRef={deleteOpener}
        />
      )}
    </section>
  )
}

export function PhaseBody({
  effective,
  full,
  events,
  driving,
  conflict,
  runId,
  ticketsIsBody,
  readonly,
  onViewPhase,
  onOpenDrive,
  go,
}: {
  effective: Phase
  full: FeatureFull
  events: readonly EventRow[]
  driving: DriveState | null
  conflict: MergeConflictState | null
  runId: string | null
  /** The ledger is this body — see `ticketsAreBody`. */
  ticketsIsBody: boolean
  readonly: boolean
  onViewPhase: (phase: Phase | null) => void
  /** Open the panel's drive view — the one place a live drive shows. */
  onOpenDrive?: () => void
  /** Go, which planning's tickets view carries above the list (design-mode decision 12). */
  go?: GoProps
}) {
  // A pinned phase this flow owns is a frozen record, not the live body with its
  // buttons hidden (decision 10) — a different body altogether. The plan
  // preview is not in any body: it is a panel view of its own (design-mode
  // decision 5).
  if (readonly && effective === 'planning') {
    return <PinnedBody full={full} effective={effective} events={events} />
  }
  switch (effective) {
    case 'planning':
      // Planning's own body is the conversation that shapes the idea; once this
      // lap has tickets, they are what the human reviews and corrects before
      // Burn — and a quick change never had a conversation to show.
      return ticketsIsBody ? (
        <TicketsBody featureId={full.feature.id} {...(go ? { go } : {})} />
      ) : (
        <GrillBody full={full} />
      )
    case 'building':
      // Before the first burn there is no run to narrate, so an empty run pane
      // is the wrong thing to show — the tickets about to burn are. This is the
      // resting state of a feature created with its tickets already written
      // (decision 21: review the one card, then Burn), and it also rescues a
      // feature whose G3 was overridden.
      return runId ? (
        <RunBody featureId={full.feature.id} runId={runId} readonly={readonly} />
      ) : (
        <TicketsBody featureId={full.feature.id} />
      )
    case 'review':
      return (
        <ReviewBody
          full={full}
          driving={driving}
          conflict={conflict}
          readonly={readonly}
          // A defect being fixed links to its lane, which lives in the run view
          // one phase back (decision 18c).
          onViewPhase={onViewPhase}
          onOpenDrive={onOpenDrive}
        />
      )
    case 'shipped':
      return <ShippedBody full={full} />
  }
}
