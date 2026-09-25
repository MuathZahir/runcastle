import { useState } from 'react'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { useEventLog } from '../../lib/events'
import {
  bodySessions,
  deferredScope,
  findingCountsLine,
  lapAccount,
  lapAccountLine,
  lapChip,
  lastTestDriveLap,
  latestRun,
  outcomeDocPath,
  reviewChecks,
  sessionActive,
  shippedChatSessions,
  specDocPath,
  stampedReview,
} from '../../lib/feature-ui'
import { relTimeAgo } from '../../lib/format'
import { useReviewArtifacts } from '../../lib/reviews'
import { IconDoc, IconMessage } from '../../icons'
import { Button, Disclosure, List, ListRow } from '../../ui'
import { DriveInstructions } from '../review/drive-parts'
import { EvidenceStage } from '../review/EvidenceStage'
import { FullAccounts } from '../review/FullAccounts'
import { ReviewTrail } from '../review/ReviewTrail'
import { CheckDetails, LapStory, StatusStrip } from '../review/StatusStrip'
import { ConversationTranscript } from '../ConversationTranscript'
import { DocPeek } from '../DocPeek'
import { SessionPanel } from '../SessionPanel'

/**
 * The shipped phase body: the record of a feature that landed (decisions 32c and
 * 33), under the feature page's header — which already says, once, that it
 * shipped and when (DESIGN.md principle 5). So there is no second header band
 * and no centred hero here: the facts as a property list, the final
 * walkthrough if one was recorded, the lap as a heading, a paragraph and its
 * tickets, every question anyone asked about it, and the long text closed.
 *
 * Nothing here acts. `readonly` is passed to the bands the review page shares
 * with this one, which is what keeps a history view from offering to launch an
 * agent (decision 33a); the stage plays with Annotate gone, and the facts state
 * what WAS done ("Taken · lap 2") rather than instructing anyone to do it.
 */
export function ShippedBody({
  full,
  chatDocked = false,
}: {
  full: FeatureFull
  /** The chat panel holds the chat's terminal, so this body does not (decision 16). */
  chatDocked?: boolean
}) {
  const { feature, tickets, runs } = full
  const events = useEventLog(feature.id)
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
  const notes = trpc.notes.list.useQuery({ featureId: feature.id })
  const specRelPath = specDocPath(full)
  const specQ = trpc.docs.read.useQuery(
    { featureId: feature.id, relPath: specRelPath ?? 'spec.md' },
    { enabled: !!specRelPath },
  )
  const projects = trpc.project.list.useQuery()
  const project = projects.data?.find((p) => p.id === feature.projectId)

  const chats = shippedChatSessions(full.sessions)
  const liveChats = bodySessions(chats.filter(sessionActive), chatDocked)
  const run = latestRun(runs)
  // The commit row is dropped on purpose: it counts what the branch is ahead
  // of its base, which is zero once the branch has landed. The scale of what
  // shipped lives in the outcome doc.
  const checks = reviewChecks({
    tickets,
    run,
    findings: findings.data?.findings.length,
  }).filter((row) => row.key !== 'changes')
  const account = lapAccount(tickets, feature.lap)
  const accountLine = lapAccountLine(account) ?? findingCountsLine(findings.data?.summary)
  const observations = (findings.data?.findings ?? []).filter((f) => f.kind === 'observation')
  const [staged, setStaged] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1">
          <StatusStrip
            artifact={stamped}
            currentLap={feature.lap}
            landedSince={stamped?.landedSince ?? 0}
            tickets={tickets}
            checks={checks}
            runState={run?.status ?? 'no run recorded'}
            shipped
            driveLap={lastTestDriveLap(events)}
            noWalkthrough={recordings.length === 0}
          />
        </div>
        {/* The synthesized account the merge wrote to the base branch — the
            permanent record, one click from the feature it is about. */}
        {outcomeRelPath && (
          <Button variant="ghost" icon={<IconDoc />} onClick={() => setPeekingOutcome(true)}>
            Outcome doc
          </Button>
        )}
      </div>

      {/* Nothing recorded and nothing here can ever record one, so there is
          no stage at all — the Test drive row above already says why. */}
      {recordings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-text">Walkthrough</h2>
          <EvidenceStage
            featureId={feature.id}
            branch={feature.branch}
            recordings={recordings}
            picked={staged}
            // No open-work band on this page, so no marker on the scrub bar has
            // a row to jump to; the recording plays as the record it is.
            notes={[]}
            readonly
            driveState="idle"
            dryRun={false}
            failure={null}
          />
        </section>
      )}

      <ReviewTrail
        passes={rows}
        tickets={tickets}
        findings={findings.data?.findings ?? []}
        notes={notes.data ?? []}
        currentLap={feature.lap}
        account={accountLine}
        staged={recordings.length > 0 ? staged : null}
        onStage={setStaged}
      />

      {/* A live chat terminal is the one thing on this page that is not history,
          so it keeps the panel; every ended conversation is a row below. In
          the page's flow the wrapper is what gives the terminal its height. */}
      {liveChats.length > 0 && (
        <div className="flex h-[clamp(300px,calc(100dvh-420px),1200px)] flex-col">
          <SessionPanel featureId={feature.id} sessions={liveChats} />
        </div>
      )}

      <QaHistory sessions={chats} />

      <div className="flex flex-col [&>*:last-child]:border-b [&>*:last-child]:border-border-subtle">
        <DriveInstructions text={project?.driveInstructions} />
        <FullAccounts account={account} tickets={tickets} observations={observations} />
        <CheckDetails checks={checks} />
        <LapStory
          lap={lapChip(tickets, { lap: feature.lap, lapSessionRan: true })}
          laterLaps={deferredScope(specQ.data?.content)}
          currentLap={feature.lap}
          readonly
        />
      </div>

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
      <h2 className="m-0 text-lg font-semibold text-text">Questions asked</h2>
      <List divided label="Questions asked">
        {sessions.map((session, i) => {
          const when = session.createdAt === undefined ? undefined : relTimeAgo(session.createdAt)
          // Nothing to open: the row IS the record, so it is a statement rather
          // than a control that refuses to do anything (decisions #10).
          if (session.transcriptMissing) {
            return (
              <ListRow
                key={session.id}
                index={i}
                leading={<IconMessage />}
                title={<span className="text-text-tertiary">Session opened, nothing recorded</span>}
                meta={when}
              />
            )
          }
          return <QaRow key={session.id} title={session.title ?? 'Conversation'} when={when} sessionId={session.id} />
        })}
      </List>
    </section>
  )
}

/**
 * One conversation, its transcript one click away. The transcript mounts only
 * once the row is opened — a shipped feature can carry many conversations, and
 * each transcript is a read of its own.
 */
function QaRow({ title, when, sessionId }: { title: string; when?: string; sessionId: string }) {
  const [opened, setOpened] = useState(false)
  return (
    <div data-list-row="" className="px-3">
      <Disclosure
        bare
        icon={<IconMessage />}
        title={<span className="font-normal text-text">{title}</span>}
        aside={when}
        onToggle={(open) => open && setOpened(true)}
      >
        {opened && <ConversationTranscript sessionId={sessionId} />}
      </Disclosure>
    </div>
  )
}
