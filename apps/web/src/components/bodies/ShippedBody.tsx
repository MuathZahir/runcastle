import { useState } from 'react'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { useEventLog } from '../../lib/events'
import {
  deferredScope,
  lapChip,
  lastTestDriveLap,
  latestRun,
  outcomeDocPath,
  reviewChecks,
  sessionActive,
  shippedAt,
  shippedQaSessions,
  specDocPath,
  stampedReview,
} from '../../lib/feature-ui'
import { relTimeAgo } from '../../lib/format'
import { useReviewArtifacts } from '../../lib/reviews'
import { IconBranch, IconCheck } from '../../icons'
import { Button, SectionTitle } from '../../ui'
import { EvidenceStage } from '../review/EvidenceStage'
import { StatusStrip } from '../review/StatusStrip'
import { ConversationTranscript } from '../ConversationTranscript'
import { DocPeek } from '../DocPeek'
import { SessionPanel } from '../SessionPanel'

/**
 * The shipped phase body: the record of a feature that landed (decisions 32c and
 * 33). A calm confirmation, then the evidence — the final walkthrough on a
 * read-only stage, the strip's account of what shipped — then every question
 * anyone ever asked about it.
 *
 * Nothing here acts. `readonly` is passed to the bands the review page shares
 * with this one, which is what keeps a history view from offering to launch an
 * agent (decision 33a); the stage plays with Annotate gone, and the strip states
 * what WAS done ("test drive taken · lap 2") rather than instructing anyone to
 * do it. The "merged when" reads `relTimeAgo`, which is why the hero no longer
 * says "merged now ago" (decision 30c).
 */
export function ShippedBody({ full }: { full: FeatureFull }) {
  const { feature, tickets, runs } = full
  const events = useEventLog(feature.id)
  const merged = shippedAt(events)
  const [peekingOutcome, setPeekingOutcome] = useState(false)
  const outcomeRelPath = outcomeDocPath(full)

  // What the reviews left on disk. Same query key the review page reads, so a
  // feature looked at both ways plays the same recording.
  const artifacts = useReviewArtifacts(feature.id)
  const rows = artifacts.data ?? []
  const recordings = rows.filter((a) => a.hasVideo && a.videoUrl)
  const stamped = stampedReview(rows)
  // Shipped is terminal, so none of these reads polls: the SSE feed invalidates
  // their keys, and nothing on this page changes without one.
  const findings = trpc.findings.listByFeature.useQuery({ featureId: feature.id })
  const specRelPath = specDocPath(full)
  const specQ = trpc.docs.read.useQuery(
    { featureId: feature.id, relPath: specRelPath ?? 'spec.md' },
    { enabled: !!specRelPath },
  )

  const qa = shippedQaSessions(full.sessions)
  const run = latestRun(runs)

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto mt-9 max-w-140 animate-[fadeUp_var(--dur-3)_ease-out] text-center">
        <div className="mx-auto flex size-10 animate-[popIn_var(--dur-3)_ease-out] items-center justify-center rounded-pill border border-ok/45 text-ok">
          <IconCheck size={17} />
        </div>
        <div className="mt-3.5 text-lg font-semibold">Shipped to main</div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-sm text-text-2">
          <IconBranch size={12} />
          {feature.branch}
          {merged === null ? '' : ` · merged ${relTimeAgo(merged)}`}
        </div>
        <div className="mt-2.5 text-sm leading-relaxed text-text-3">
          The branch is merged and the pipeline is complete. The full history lives in the Activity
          tab.
        </div>
        {/* The synthesized account the merge wrote to the base branch — the
            permanent record, one click from the feature it is about. */}
        {outcomeRelPath && (
          <Button className="mt-4" onClick={() => setPeekingOutcome(true)}>
            Read the outcome doc
          </Button>
        )}
      </div>

      <EvidenceStage
        featureId={feature.id}
        branch={feature.branch}
        recordings={recordings}
        // No open-work band on this page, so no marker on the scrub bar has a
        // row to jump to; the recording plays as the record it is.
        notes={[]}
        readonly
        driveState="idle"
        dryRun={false}
        failure={null}
        devConfigured={false}
        starting={false}
        onStartDrive={() => undefined}
      />

      <StatusStrip
        artifact={stamped}
        currentLap={feature.lap}
        landedSince={stamped?.landedSince ?? 0}
        tickets={tickets}
        // The commit row is dropped on purpose: it counts what the branch is
        // ahead of its base, which is zero once the branch has landed. The scale
        // of what shipped lives in the outcome doc.
        checks={reviewChecks({
          tickets,
          run,
          findings: findings.data?.findings.length,
        }).filter((row) => row.key !== 'changes')}
        runState={run?.status ?? 'no run recorded'}
        lap={lapChip(tickets, { lap: feature.lap, lapSessionRan: true })}
        laterLaps={deferredScope(specQ.data?.content)}
        readonly
        shipped
        driveLap={lastTestDriveLap(events)}
      />

      {/* A live Q&A terminal is the one thing on this page that is not history,
          so it keeps the panel; every ended conversation is a row below. */}
      <SessionPanel
        featureId={feature.id}
        sessions={qa.filter(sessionActive)}
        className="shipped-session"
      />

      <QaHistory sessions={qa} />

      {peekingOutcome && outcomeRelPath && (
        <DocPeek
          featureId={feature.id}
          relPath={outcomeRelPath}
          title="outcome"
          onClose={() => setPeekingOutcome(false)}
        />
      )}
    </div>
  )
}

/**
 * Every question ever asked about this feature (decision 33b).
 *
 * A conversation that ended without its runtime capturing a transcript still
 * gets a row: the walk found such a session vanish on reload, leaving no record
 * that anything had been asked at all, and nothing on a shipped feature's record
 * may silently disappear.
 */
function QaHistory({ sessions }: { sessions: FeatureFull['sessions'] }) {
  if (sessions.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Questions asked</SectionTitle>
      <ul className="flex list-none flex-col gap-2 p-0">
        {sessions.map((session) => (
          <li key={session.id}>
            <QaRow session={session} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function QaRow({ session }: { session: FeatureFull['sessions'][number] }) {
  const [open, setOpen] = useState(false)
  const when = session.createdAt === undefined ? null : relTimeAgo(session.createdAt)

  // Nothing to open: the row IS the record, so it is a statement rather than a
  // control that refuses to do anything (decisions #10 — no disabled affordances).
  if (session.transcriptMissing) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-hairline bg-panel px-3 py-2.5">
        <span className="flex-1 text-base text-text-3">session opened · nothing recorded</span>
        {when && <span className="font-mono text-xs text-text-3">{when}</span>}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-hairline bg-panel">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="flex-1 text-base text-text">{session.title ?? 'Conversation'}</span>
        {when && <span className="font-mono text-xs text-text-3">{when}</span>}
        <span className="font-mono text-xs text-text-3" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline p-3">
          <ConversationTranscript sessionId={session.id} />
        </div>
      )}
    </div>
  )
}
