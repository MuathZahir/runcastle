import { useEffect, useReducer, useState, type ReactNode } from 'react'
import type { RefObject } from 'react'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { relTimeAgo } from '../lib/format'
import { pathFor, type FeatureView } from '../lib/routes'
import { useLandOnChat } from '../lib/land-on-chat'
import { availableViews, hasPlan, PANEL_VIEW_LABEL, reviewRan, type PanelView } from '../lib/feature-ui/panel'
import {
  DimLine,
  IconButton,
  Page,
  PageTopbar,
  StatusLabel,
  cx,
  type MetaItem,
} from '../ui'
import { IconX, ProgressIcon } from '../icons'
import { settingsLocationFromMessage } from '../lib/settings'
import { useOpenSettings } from './settings/MessageWithSettingsLink'
import type { DriveState } from '../lib/workspace'
import {
  activeSession,
  defaultBaseBranch,
  deferredScope,
  dependencyCandidates,
  freshness,
  isSelfPlanRun,
  lastTestDriveAt,
  latestRun,
  mergeSummary,
  nextStep,
  shippedAt,
  specDocPath,
  stampedReview,
  landedShare,
  unresolvedMergeConflict,
  upNextBasesDiffer,
  verificationState,
  type ActionKind,
  type DraftBaseMissing,
} from '../lib/feature-ui'
import { useReviewArtifacts } from '../lib/reviews'
import { useResolveConflict } from '../lib/use-resolve-conflict'
import { useThreadMenu } from '../lib/use-thread'
import { DeleteFeatureDialog } from './DeleteFeatureDialog'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { MergeFeatureDialog } from './MergeFeatureDialog'
import { DraftBody } from './bodies/DraftBody'
import { PlanBody } from './bodies/PlanBody'
import { ReviewBody } from './bodies/ReviewBody'
import { ShippedBody } from './bodies/ShippedBody'
import { TicketsBody } from './bodies/tickets/TicketsBody'
import { RunBody } from './bodies/RunBody'
import { DesignView, useDesignPath } from './design/DesignView'
import { DetailsView } from './inspector/Inspector'
import { FeatureDriveView } from './review/FeatureDriveView'
import { copyText } from './workspace/copy-text'
import { FeatureChat } from './workspace/FeatureChat'
import { ScenarioChatContext, ScenarioChatMenu } from './chat/ScenarioChat'
import { ThreadSwitcher } from './chat/thread/ThreadSwitcher'
import { useFeatureChatColumn } from './chat/use-feature-chat-column'
import { FeaturePanel, PanelSplit, PanelStrip, PanelToggle, usePanel } from './workspace/FeaturePanel'
import { HeaderAction } from './workspace/HeaderAction'
import { usePanelShow } from './workspace/use-panel-show'
import { BlocksLine, DependenciesRow } from './workspace/FeatureDependencies'
import { FeatureHeader } from './workspace/FeatureHeader'
import { FeatureSkeleton } from './workspace/FeatureSkeleton'
import { ACTION_ICON, NextStepBar } from './workspace/NextStepBar'
import { FeatureStatusLine, StopAgentDialog } from './workspace/FeatureStatusLine'
import { DrivePrerequisitesNotice } from './review/DrivePrerequisitesNotice'
import {
  featureStatus,
  LEAD_WAKE_GRACE_MS,
  headerActions,
  leadWakeOf,
  mainChatWorking,
  type HeaderActions,
} from '../lib/feature-ui/status-line'
import { ScenarioMenuItems } from './review/ScenarioMenuItems'
import { scenarioMenu, testDriveLabel } from '../lib/feature-ui/scenarios'
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
 *   the one header row (decision 12) — progress glyph + title · the quiet
 *              status line, then the session switcher, at most one action
 *              (the status's primary), "…" with everything else — Merge &
 *              ship among it — and the panel toggle
 *   the chat — the feature's live session (`FeatureChat`), filling the page,
 *              with the page's notices atop it
 *   one panel — on the right when open, one view at a time: Plan, Work,
 *              Review, Details, and Design or Drive while they run
 *              (tickets-and-review-are-tools-not-phases decision 8)
 *
 * There is no Go and no phase: the agent starts rounds from the chat. The
 * panel opens from the header's toggle (at its last view), from the agent's
 * `panel.show` (`show_panel`, `emit_tickets`), and from runcastle only as the
 * result of the human's own Test drive click. A draft has no chat, so its body
 * is the page, its next step in its header.
 */
export function Workspace({
  featureId,
  view: viewProp,
  onViewChange,
  guidance,
  driving,
  onDriveChange,
  onDeleted,
}: {
  featureId: string
  /** The panel view beside the chat, or `chat` for none — the shell's, so the address bar can name it. */
  view: FeatureView
  onViewChange: (view: FeatureView) => void
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
  // The merge confirmation has to know two things the feature row cannot tell
  // it: whether a merge conflict is standing (findings F8) and when this
  // branch was last test-driven (F21, decision 8a). Both live in the event
  // feed, same query key as every other reader, so this shares one poll.
  const events = useEventLog(featureId)
  const conflict = unresolvedMergeConflict(events)
  const drivenAt = lastTestDriveAt(events)
  // The status line reads Working on a pending wake only inside its grace, so
  // the clock is re-read once that grace runs out.
  const leadWake = leadWakeOf(events)
  const now = useNowPast(leadWake.pendingSince === undefined ? undefined : leadWake.pendingSince + LEAD_WAKE_GRACE_MS)
  const poll = useLivePoll()
  // What the merge confirmation reports, read only while it is open: commit
  // and file scale from git for its "what lands" row (decision 31a), the
  // human's open notes, the review's freshness (decision 19d) and the scope the
  // spec deliberately deferred (decisions #7). The same query keys the review
  // view reads, so a dialog over that view shares its fetches.
  const [confirmMerge, setConfirmMerge] = useState(false)
  const delta = trpc.feature.mergeDelta.useQuery(
    { featureId },
    { refetchInterval: useLivePoll(5000), enabled: confirmMerge },
  )
  const notes = trpc.notes.list.useQuery({ featureId }, { enabled: confirmMerge })
  const openNotes = notes.data ? notes.data.filter((n) => n.status === 'open').length : undefined
  const artifacts = useReviewArtifacts(featureId, confirmMerge)
  const stamped = stampedReview(artifacts.data ?? [], q.data?.tickets ?? [])
  const reviewFreshness = freshness(
    stamped,
    { landedSince: stamped?.landedSince ?? 0 },
    verificationState(q.data?.tickets ?? []),
  )
  const specRelPath = q.data ? specDocPath(q.data) : undefined
  const specQ = trpc.docs.read.useQuery(
    { featureId, relPath: specRelPath ?? 'spec.md' },
    { enabled: confirmMerge && !!specRelPath },
  )
  const laterLaps = deferredScope(specQ.data?.content)
  // A preparation dry run or another feature's drive can hold this project's
  // drive slot (decision 9), which only the server's drive info knows; the
  // review view polls the same key, so this is one fetch.
  const projectId = q.data?.feature.projectId
  const driveQ = trpc.feature.driveInfo.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, refetchInterval: poll },
  )
  // The status line's inputs (`the-feature-lead-runs-rounds` decision 21): the
  // rounds and the agent's ready declarations.
  const roundsQ = trpc.feature.rounds.useQuery({ featureId }, { refetchInterval: poll })
  const declarationsQ = trpc.feature.readyDeclarations.useQuery({ featureId }, { refetchInterval: poll })
  const declared = (declarationsQ.data?.length ?? 0) > 0
  // What a drive of this feature can land on (drive-scenarios decision 7), for
  // the Test drive split button. A drive is offered once the agent declared
  // ready, and the list is two git reads, so it waits for a declaration.
  const scenariosQ = trpc.feature.driveScenarios.useQuery(
    { projectId: projectId ?? '', featureId },
    { enabled: !!projectId && declared, refetchInterval: useLivePoll(5000) },
  )
  const startMenu = scenarioMenu(scenariosQ.data?.scenarios ?? [], {
    withOwnSection: true,
    runnerConfigured: scenariosQ.data?.runnerConfigured ?? false,
  })
  // What this host is missing to record a drive's walkthrough — said where a
  // drive starts, and only then (decision 24). The server caches the probe.
  const drivePrereqs = trpc.project.drivePrerequisites.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  )
  // A parked draft picks its base at Start, not at creation (decision 3), so the
  // branch list is read HERE — Start fires from the next-step bar, and the base
  // has to be readable at that click, not buried in the body that shows the
  // picker beside it. Only fetched for a draft; every other feature already has a branch.
  const isDraft = q.data?.feature.status === 'draft'
  const shipped = q.data?.feature.status === 'shipped'
  const branchesQ = trpc.project.branches.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && isDraft },
  )
  // An explicit pick from the bar's branch menu, stamped with the
  // feature it was made on — this component is not remounted between features,
  // so an unstamped pick would follow the user to the next draft and quietly
  // fork it off a branch they chose for a different idea. No pick (or a stale
  // one) means the client default: the current checkout, and nothing at all when
  // that checkout is not a base a feature can fork from (decision 8). An
  // up-next draft whose dependencies merged into different branches gets no
  // default either: there is no safe guess (waiting-is-not-backlog decision 4).
  const [draftPick, setDraftPick] = useState<{ featureId: string; base: string } | null>(null)
  const noDefaultBase = upNextBasesDiffer(q.data?.upNextProblem ?? null)
  const effectiveDraftBase =
    (draftPick?.featureId === featureId ? draftPick.base : '') ||
    (branchesQ.data && !noDefaultBase ? defaultBaseBranch(branchesQ.data) : '')
  // Why Start has no base to send, when it has none — read by the bar, which
  // warns on the picker and says so on the disabled button.
  const draftBaseMissing: DraftBaseMissing | undefined =
    !isDraft || effectiveDraftBase ? undefined : branchesQ.data ? 'unpicked' : 'loading'
  // Whether the feature's design server runs — the Design view is offered
  // only then. The design view polls the same key.
  const designQ = trpc.design.status.useQuery({ featureId }, { enabled: !!q.data && !isDraft, refetchInterval: poll })

  // The panel (decision 8): the views the feature's facts offer, and the one
  // open — the shell's, shown only while it is still offered (a drive that
  // stopped takes its view with it). Design stays offered while it is the open
  // view: the agent's `show_panel` and the preview's Open in design open it
  // before its server is up, and the view itself starts the server.
  const isDriving = driving?.featureId === featureId
  const requested = viewProp === 'chat' ? null : viewProp
  const designOpenable = !!q.data && !isDraft && !shipped
  const views = q.data
    ? availableViews({
        isDraft,
        hasPlan: hasPlan(q.data),
        hasTickets: q.data.tickets.length > 0,
        hasReview: declared || reviewRan(q.data.tickets),
        shipped,
        designRunning: !!designQ.data?.running || (designOpenable && requested === 'design'),
        driveActive: isDriving || (driveQ.data?.featureId === featureId && driveQ.data.state !== 'idle'),
      })
    : []
  const panel = usePanel(requested && views.includes(requested) ? requested : null, onViewChange)
  // The agent's `show_panel` and `emit_tickets`, for a view this feature offers.
  // Work is taken on trust: `emit_tickets` opens it the moment it stores them,
  // and the panel shows it once the refetched feature has the tickets.
  usePanelShow(events, featureId, (request) => {
    const offered =
      views.includes(request.view) ||
      (request.view === 'work' && !!q.data && !isDraft) ||
      (request.view === 'design' && designOpenable)
    if (offered) panel.dispatch({ type: 'open', ...request, origin: 'agent' })
  })
  // The page the design view loads, for the panel header to name.
  const designPath = useDesignPath(featureId, panel.state.path, panel.state.view === 'design')
  // The chat column (chat-as-web-components decision 7): every thread of the
  // feature, one in front — the drive errand's scenario chat comes to the
  // front when an errand opens it.
  const column = useFeatureChatColumn({
    featureId,
    sessions: q.data?.sessions ?? [],
    driveSessionId: driveQ.data?.featureId === featureId ? driveQ.data.scenarioSessionId : undefined,
  })
  // The switcher's Rename and Export, for a thread in front that has begun.
  const threadMenu = useThreadMenu(column.inFront)

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
  // The main chat's first message starts it (chat-as-web-components decision
  // 7). Already on the chat, so nothing lands; the thread says why it failed.
  const startChat = trpc.feature.launchSession.useMutation({ onSuccess: invalidate, onError: () => undefined })
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
  // query, and a refusal is rejected back to the row, which says it inline. The
  // Starts-when-this-ships line reads it too, for what else each up-next
  // dependent waits on.
  const startsUpNext = !!q.data?.blocks.some((b) => b.upNext)
  const projectList = trpc.feature.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && (isDraft || startsUpNext) },
  )
  const setDependencies = trpc.feature.setDependencies.useMutation({
    onSuccess: invalidate,
    // No toast: the row already says the refusal inline, and without a handler
    // here the MutationCache safety net would repeat it raw (backticks and all).
    onError: () => undefined,
  })
  // Start when ready / Move to backlog (waiting-is-not-backlog decision 8): the
  // mark only — nothing starts on this click.
  const setUpNext = trpc.feature.setUpNext.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.push(e.message),
  })
  const start = trpc.feature.start.useMutation({
    onSuccess: (_res, vars) => {
      invalidate()
      launch.mutate({ featureId: vars.featureId, kind: 'chat' })
    },
    onError: (e) => toast.push(e.message),
  })
  // Plan it yourself (features-plan-themselves decisions 5, 9): the same start
  // and launch as above, but the session is unattended, so neither lands on
  // the chat — the plan is watched from the body.
  // It stays pending until the feature is refetched with the new run on it, so
  // the row reads Planning by itself from the click on, never idle in between.
  const launchSelfPlan = trpc.feature.launchSession.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.push(e.message),
  })
  const startSelfPlan = trpc.feature.start.useMutation({
    onSuccess: (_res, vars) => {
      invalidate()
      launchSelfPlan.mutate({ featureId: vars.featureId, kind: 'chat', purpose: 'self-plan' })
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
  const run = latestRun(full.runs)
  const ns = nextStep(full, { ...(draftBaseMissing ? { draftBaseMissing } : {}) })
  // The terminal the resolve compound has to close on its way in — one read, so
  // the bar's "End session & resolve" and the click that follows it can never be
  // about different sessions.
  const liveSession = activeSession(full.sessions)
  const busy =
    start.isPending ||
    launch.isPending ||
    startSelfPlan.isPending ||
    launchSelfPlan.isPending ||
    testDrive.isPending ||
    merge.isPending ||
    fixDrive.isPending ||
    unarchive.isPending ||
    setUpNext.isPending ||
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
   * The bar's constant Chat door: it lands on the feature's main thread
   * (one-chat-layout-everywhere decision 5). Opening a thread launches nothing
   * (chat-as-web-components decision 7): its first message starts the agent.
   */
  const openChat = () => landOnChat()

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
      case 'markUpNext':
        setUpNext.mutate({ featureId, upNext: true })
        break
      case 'moveToBacklog':
        setUpNext.mutate({ featureId, upNext: false })
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
      // Stop is ending the run: nobody is attending it (decision 9). Only the
      // self-planning run it was offered for — never a lead woken in its place.
      case 'stopSelfPlan':
        if (liveSession && isSelfPlanRun(liveSession)) void endLiveSession()
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

  const shown = panel.state.view
  const labelOf = (v: PanelView) => PANEL_VIEW_LABEL[v]

  const mergedAt = shipped ? shippedAt([...events]) : null
  const factList: Array<MetaItem | false> = [
    isDraft
      ? { phase: 'draft', text: `Added to backlog ${relTimeAgo(feature.createdAt)}` }
      : mergedAt
        ? { tone: 'success', text: `Merged ${relTimeAgo(mergedAt)}` }
        : { text: `Started ${relTimeAgo(feature.createdAt)}` },
    // No ticket count here (d6e): the ticket ledger's own count line, next to
    // the tickets, states it; the status rows state it after.
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
        agentWorking: mainChatWorking(column.mainState, liveSession),
        agentStateKnown: column.mainState !== undefined,
        driving: isDriving,
        // A draft's start turns it into a planning feature before the run is
        // even launched, so the start counts as planning by itself too.
        selfPlanning:
          (!!liveSession && isSelfPlanRun(liveSession)) || startSelfPlan.isPending || launchSelfPlan.isPending,
        leadWake,
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
  // one button, the rest for "⋯".
  const headerRow: HeaderActions = status ? headerActions(ns, status) : { overflow: [] }

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
  const resumeAlert = resumeFailed.message && (
    <div className="flex items-start gap-3 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text" role="alert">
      <span className="min-w-0 flex-1">
        <span className="font-medium">Resume failed.</span> {resumeFailed.message}
      </span>
      <IconButton label="Dismiss" size="sm" icon={<IconX />} onClick={resumeFailed.dismiss} />
    </div>
  )
  // Said where a drive starts, and only when it applies (decision 24).
  const drivePrereqsNotice = status?.primary === 'testDriveStart' && (
    <DrivePrerequisitesNotice missing={drivePrereqs.data?.missing ?? []} />
  )
  // What the strip used to stack under the header goes atop the chat column
  // instead (decision 12): notices, not another bar.
  const chatAlerts = (resumeAlert || drivePrereqsNotice) && (
    <>
      {resumeAlert}
      {drivePrereqsNotice}
    </>
  )

  // The title and its facts head the body. A draft's next step stays in its
  // header, where its body is the page.
  const bodyHeader = (
    <FeatureHeader feature={feature} isDraft={isDraft} facts={facts}>
      {isDraft && resumeAlert}
      <DependenciesRow
        isDraft={isDraft}
        dependsOn={full.dependsOn}
        candidates={dependencyCandidates(projectList.data ?? [], feature, full.dependsOn)}
        onChange={(dependsOn) => setDependencies.mutateAsync({ featureId, dependsOn })}
      />
      <BlocksLine
        projectId={feature.projectId}
        featureId={feature.id}
        blocks={full.blocks}
        features={projectList.data ?? []}
      />
      {draftRow}
    </FeatureHeader>
  )

  // Plan, Work and Review are documents under the title and its facts; the
  // decisions and spec pane fills its view and scrolls itself, and the
  // data-heavy ones (the run's lanes, the review's evidence, the ledger) take
  // the wide column — save the shipped record, which reads as a document.
  const documentView = (v: PanelView, content: ReactNode) => {
    // Rises in once per navigation — feature, view — never on a refetch.
    const routeKey = `${featureId}:${v}`
    if (v === 'plan' && !full.preview)
      return (
        <div key={routeKey} className="flex min-h-0 min-w-0 flex-1 flex-col px-8 pt-8 animate-rise-in">
          <div className="shrink-0 pb-5">{bodyHeader}</div>
          <div className="flex min-h-0 min-w-0 flex-1 pb-6">{content}</div>
        </div>
      )
    return (
      <Page width={v === 'review' && shipped ? 'default' : 'wide'} routeKey={routeKey}>
        {bodyHeader}
        <div className="mt-10">{content}</div>
      </Page>
    )
  }
  const openView = (view: PanelView) => panel.dispatch({ type: 'open', view, origin: 'human' })

  const panelView = (v: PanelView) => {
    switch (v) {
      case 'plan':
        return documentView(
          v,
          <PlanBody
            full={full}
            // The human's own click inside the preview; the design view starts the server.
            onOpenDesign={(path) => {
              if (designOpenable) panel.dispatch({ type: 'open', view: 'design', path, origin: 'human' })
            }}
          />,
        )
      case 'work':
        // The run's live lanes above the ledger, which groups every ticket under
        // the round that ran it.
        return documentView(
          v,
          <div className="flex flex-col gap-10">
            {run && <RunBody featureId={featureId} runId={run.id} />}
            <TicketsBody featureId={featureId} />
          </div>,
        )
      case 'review':
        // Once merged, the record of what shipped (today's Outcome) is the review.
        return documentView(
          v,
          shipped ? (
            <ShippedBody full={full} />
          ) : (
            <ReviewBody
              full={full}
              driving={driving}
              conflict={conflict}
              {...(views.includes('work') ? { onOpenWork: () => openView('work') } : {})}
              {...(views.includes('drive') ? { onOpenDrive: () => openView('drive') } : {})}
            />
          ),
        )
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
            icon: (
              <ProgressIcon
                state={isDraft ? 'draft' : shipped ? 'shipped' : 'active'}
                progress={landedShare(full.tickets)}
                size={14}
                label=""
              />
            ),
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
              // The actions keep their width, so the switcher's is capped: a
              // thread named by a long first message truncates instead of
              // pushing over the status (900px leaves it ~144px).
              <span className="mr-1 flex max-w-[clamp(6rem,16vw,18rem)] min-w-0">
                <ThreadSwitcher
                  threads={column.threads}
                  current={column.current}
                  onPick={column.pick}
                  onNew={column.newThread}
                  {...threadMenu}
                >
                  {column.scenario.listed && column.inFront === column.scenario.sessionId && (
                    <ScenarioChatMenu chat={column.scenario} />
                  )}
                </ThreadSwitcher>
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
        <Page routeKey={`${featureId}:draft`}>
          {bodyHeader}
          <div className="mt-10">
            <DraftBody full={full} />
          </div>
        </Page>
      ) : (
        <>
          {/* The drive's errands open their chat in this page's column. */}
          <ScenarioChatContext.Provider value={column.scenario}>
            <PanelSplit
              chat={
                // The switcher picks which thread is in front; the column is
                // hidden only while the panel has the whole row.
                <FeatureChat
                  full={full}
                  column={column}
                  events={events}
                  alerts={chatAlerts}
                  hidden={chatHidden}
                  start={async () => {
                    // The opening waits for the message that started it: one prompt, one answer.
                    const res = await startChat.mutateAsync({ featureId, kind: 'chat', holdOpening: true })
                    return res.sessionId
                  }}
                  onView={(target) => {
                    if (views.includes(target)) panel.dispatch({ type: 'open', view: target, origin: 'human' })
                  }}
                />
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
            drivenAt,
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
