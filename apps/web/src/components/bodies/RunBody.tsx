import { useMemo, useState } from 'react'
import type { Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { SettingsView } from '../../lib/api'
import { effectiveStepModel, rosterFromView } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import {
  groupByLap,
  laneBands,
  laneFacts,
  sessionActive,
  soloRetrySeq,
  ticketConflictKickoff,
  ticketDurations,
  ticketModelChip,
  runHeadline,
  summaryCounts,
} from '../../lib/feature-ui'
import { fmtDuration, shortSha } from '../../lib/format'
import { BURN_EXPLAINER } from '../../lib/vocabulary'
import { EmptyState, LapSections, SectionTitle } from '../../ui'
import { IconTerminal } from '../../icons'
import { ErrorBoundary } from '../ErrorBoundary'
import { Markdown } from '../Markdown'
import { SessionPanel } from '../SessionPanel'
import { Lane } from '../run/Lane'
import { LaneTranscript } from '../run/LaneTranscript'
import { RunHeader } from '../run/RunHeader'
import { RunTimeline } from '../run/RunTimeline'

/**
 * Run / implementation phase-body, lanes-first (decisions #10–#16).
 *
 * The lanes ARE the page: a run header over them, each lane expanding in place
 * to its own boot narrative and agent transcript, the run timeline collapsed
 * underneath. The shared Agent|Events pane this used to be built around is
 * gone — it pinned one ticket's transcript beside every ticket's lane, and the
 * transcript was the least trustworthy thing on the page while the lanes
 * carried the actual state and controls.
 *
 * Every read lives here and every lane is handed what it shows, so `Lane` stays
 * statically testable (`test/run-lanes.test.ts`).
 */
export function RunBody({
  featureId,
  runId,
  readonly = false,
}: {
  featureId: string
  runId: string | null
  readonly?: boolean
}) {
  const poll = useLivePoll()
  const toast = useToast()
  const utils = trpc.useUtils()
  const feature = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: poll })
  const run = trpc.run.get.useQuery(
    { runId: runId as string },
    { refetchInterval: poll, enabled: !!runId },
  )
  const events = useEventLog(featureId)
  const projectId = feature.data?.feature.projectId
  // Where a model's runtime is declared (decisions.md #3) — a lane says which
  // runtime it burns on, and runs can genuinely mix them.
  const settings = trpc.settings.get.useQuery(
    { projectId: projectId as string },
    { enabled: !!projectId },
  )
  // Only for the defect title a review-fix lane is badged with; the findings
  // themselves are the review page's business, so this one does not poll.
  const findings = trpc.findings.listByFeature.useQuery({ featureId })

  const onMutated = {
    onSuccess: () => utils.feature.get.invalidate({ id: featureId }),
    onError: (e: { message: string }) => toast.push(e.message),
  }
  const retry = trpc.ticket.retry.useMutation(onMutated)
  const stop = trpc.ticket.stop.useMutation(onMutated)
  const waive = trpc.ticket.cancel.useMutation(onMutated)
  const launch = trpc.feature.launchSession.useMutation(onMutated)
  const cancelRun = trpc.run.cancel.useMutation(onMutated)
  const busy =
    retry.isPending || stop.isPending || waive.isPending || launch.isPending || cancelRun.isPending

  const tickets = feature.data?.tickets ?? []
  const featureBranch = feature.data?.feature.branch ?? ''
  const lap = feature.data?.feature.lap ?? 1
  const runEvents = useMemo(() => events.filter((e) => e.runId === runId), [events, runId])
  const durations = useMemo(() => ticketDurations(runEvents), [runEvents])
  const facts = useMemo(() => laneFacts(runEvents), [runEvents])

  // Untouched, the expansion follows the burn: the lane with a live agent is
  // the one being watched. A click takes it over from there.
  const [opened, setOpened] = useState<Set<string> | null>(null)
  const burningId = tickets.find((t) => t.status === 'burning')?.id
  const expanded = opened ?? new Set(burningId ? [burningId] : [])
  const toggle = (id: string) =>
    setOpened(() => {
      const next = new Set(expanded)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const roster = rosterFromView(settings.data as SettingsView | undefined)
  const defectTitles = useMemo(
    () => new Map((findings.data?.findings ?? []).map((f) => [f.id, f.title])),
    [findings.data],
  )
  // An unassigned ticket burns on the project's step model, which is what its
  // lane names — a lane with no runtime at all would be the one thing on the
  // page that could not say what is running it.
  const laneModel = (ticket: Ticket) =>
    ticketModelChip(ticket, roster) ??
    ticketModelChip(
      {
        model: effectiveStepModel(
          settings.data as SettingsView | undefined,
          ticket.kind === 'review' ? 'review' : 'implement',
        ),
      },
      roster,
    )

  const sessions = feature.data?.sessions ?? []
  const live = sessions.some(sessionActive)
  // A conflict lane's "Resolve in terminal" spawns an HITL session, which the
  // launcher refuses while a run holds the feature branch or another terminal
  // is open — so the lane greys the button rather than offering a certain error.
  const terminalBlocked = live || run.data?.status === 'running'

  if (!runId && !live) {
    return (
      <div className="surface">
        <EmptyState
          icon={<IconTerminal size={16} />}
          title="No run yet"
          hint={`${BURN_EXPLAINER} Every ticket gets its own lane here.`}
        />
      </div>
    )
  }

  const counts = summaryCounts(tickets)
  const burning = tickets.filter((t) => t.status === 'burning').length
  const copySha = (sha: string) => {
    navigator.clipboard?.writeText(sha).then(
      () => toast.push(`copied ${shortSha(sha)}`, 'info'),
      () => toast.push('copy failed'),
    )
  }

  const lane = (ticket: Ticket) => {
    const fact = facts.get(ticket.id)
    const duration = durations.get(ticket.id)
    const conflict = ticket.status === 'failed' ? ticket.conflictFiles : undefined
    return (
      <Lane
        key={ticket.id}
        ticket={ticket}
        featureBranch={featureBranch}
        readonly={readonly}
        expanded={expanded.has(ticket.id)}
        onToggle={() => toggle(ticket.id)}
        hadOutput={fact?.hadOutput}
        elapsed={fact ? fmtDuration(fact.startedAt, Date.now()) : undefined}
        duration={duration === undefined ? undefined : fmtDuration(0, duration)}
        model={laneModel(ticket)}
        defectTitle={
          ticket.originFindingId ? defectTitles.get(ticket.originFindingId) : undefined
        }
        busy={busy}
        terminalBlocked={terminalBlocked}
        onCopySha={copySha}
        onRetry={() =>
          retry.mutate(
            { ticketId: ticket.id },
            {
              onSuccess: (r) => {
                if (r.resolvingConflict) {
                  toast.push(`resolving ticket #${ticket.seq}'s conflict with an agent`, 'info')
                } else if (r.resumedFrom) {
                  toast.push(
                    `resuming ticket #${ticket.seq} from ${r.preservedCommits} preserved commit(s)`,
                    'info',
                  )
                }
              },
            },
          )
        }
        onRetryFresh={() => retry.mutate({ ticketId: ticket.id, fresh: true })}
        onWaive={() =>
          waive.mutate(
            { ticketId: ticket.id, reason: 'waived from the run view' },
            {
              onSuccess: () =>
                toast.push(
                  `ticket #${ticket.seq} set aside — it stays visible as unfinished work at review`,
                  'info',
                ),
            },
          )
        }
        onStop={() =>
          stop.mutate(
            { ticketId: ticket.id },
            {
              onSuccess: (r) => {
                if (r.swept) {
                  toast.push(
                    'no live agent — the lane was orphaned; marked failed, retry to resume it',
                    'info',
                  )
                } else if (!r.stopped) {
                  toast.push('no live agent for this ticket (already finishing?)', 'info')
                }
              },
            },
          )
        }
        onResolveInTerminal={
          conflict
            ? () =>
                launch.mutate({
                  featureId,
                  kind: 'revisit',
                  kickoffLine: ticketConflictKickoff({
                    seq: ticket.seq,
                    title: ticket.title,
                    branch: ticket.attemptBranch ?? '',
                    featureBranch,
                    files: conflict,
                  }),
                  // Same exemption as the review card's resolve, about the other
                  // merge: this one lands the ticket branch on the feature branch.
                  purpose: 'resolve-conflict',
                  purposeData: {
                    mergeFrom: ticket.attemptBranch ?? '',
                    mergeInto: featureBranch,
                  },
                })
            : undefined
        }
      >
        <ErrorBoundary label="agent transcript">
          <LaneTranscript
            ticketId={ticket.id}
            bootEvents={runEvents.filter((e) => e.ticketId === ticket.id)}
          />
        </ErrorBoundary>
      </Lane>
    )
  }

  return (
    <div>
      {/* A read-only retrospective view is history: it must not offer to reopen
          a conversation from a phase the feature has already left (F10.6). */}
      <SessionPanel
        featureId={featureId}
        sessions={sessions}
        className="tickets-session"
        showResume={!readonly}
      />

      <RunHeader
        headline={runHeadline(
          tickets.map((t) => ({ ...t, hadOutput: facts.get(t.id)?.hadOutput, reviewFix: !!t.originFindingId })),
          {},
          soloRetrySeq(tickets, runEvents),
        )}
        elapsed={
          run.data ? fmtDuration(run.data.startedAt, run.data.endedAt ?? Date.now()) : ''
        }
        status={run.data?.status}
        burning={burning}
        busy={busy}
        onCancelRun={
          readonly || !runId ? undefined : () => cancelRun.mutate({ runId })
        }
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon={<IconTerminal size={16} />}
          title="No ticket lanes"
          hint="This run has nothing to burn — a session breaks the work into tickets, and they appear here as lanes."
        />
      ) : (
        <LapSections
          groups={groupByLap(tickets, lap)}
          currentLap={lap}
          meta={(g) => `${g.rows.length} lane${g.rows.length === 1 ? '' : 's'}`}
        >
          {(rows) => (
            <div className="flex flex-col gap-2">
              {laneBands(rows).map((band) => (
                <div key={band.kind} className="flex flex-col gap-2">
                  {band.title && (
                    <div className="mt-2 border-l-2 border-ph-review/40 pl-3">
                      <SectionTitle>{band.title}</SectionTitle>
                    </div>
                  )}
                  <div
                    className={`flex flex-col gap-2${band.kind === 'plain' ? '' : ' pl-3'}`}
                  >
                    {band.rows.map(lane)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </LapSections>
      )}

      <RunTimeline events={runEvents} />
      {run.data?.digest && <RunDigest digest={run.data.digest} />}
      {counts.waived > 0 && (
        <p className="mt-3 text-sm text-text-3">
          {counts.waived} ticket{counts.waived === 1 ? '' : 's'} set aside — carried into review as
          unfinished work.
        </p>
      )}
    </div>
  )
}

/**
 * What this attempt actually produced, in the burners' own words — the run's
 * harvested ticket digests concatenated at finalize. Collapsed and below the
 * lanes (evidence and state first, prose last), and rendered only when the run
 * has one, so a run whose tickets wrote no digest shows nothing.
 */
function RunDigest({ digest }: { digest: string }) {
  return (
    <details className="mt-3 rounded-md border border-hairline bg-panel-2">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold tracking-[0.07em] text-text-3 uppercase [&::-webkit-details-marker]:hidden">
        What this run produced
      </summary>
      <div className="border-t border-hairline-soft px-3 py-2">
        <Markdown source={digest} />
      </div>
    </details>
  )
}
