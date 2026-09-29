import { useState } from 'react'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { useEventLog } from '../../lib/events'
import {
  deferredScope,
  lapAccount,
  lapChip,
  lastTestDriveLap,
  latestRun,
  outcomeDocPath,
  shippedChatSessions,
  specDocPath,
  stampedOutcome,
  stampedReview,
} from '../../lib/feature-ui'
import { relTimeAgo } from '../../lib/format'
import { useReviewArtifacts } from '../../lib/reviews'
import { IconDoc, IconMessage } from '../../icons'
import { Button, Disclosure, List, ListRow } from '../../ui'
import { DriveInstructions } from '../review/drive-parts'
import { EvidenceStage } from '../review/EvidenceStage'
import { FullAccounts } from '../review/FullAccounts'
import { ReferenceTier } from '../review/ReferenceTier'
import { ReviewTrail } from '../review/ReviewTrail'
import { LapStory, StatusStrip } from '../review/StatusStrip'
import { ConversationTranscript } from '../ConversationTranscript'
import { DocPeek } from '../DocPeek'

/**
 * The shipped phase body: the record of a feature that landed (decisions 32c and
 * 33), under the feature page's header — which already says, once, that it
 * shipped and when (DESIGN.md principle 5). So there is no second header band
 * and no centred hero here: the facts as a property list, "What shipped" with
 * the outcome doc and the final walkthrough if one was recorded, then the
 * reference — the laps, every question anyone asked about it, and the long
 * text, all closed.
 *
 * Nothing here acts. `readonly` is passed to the bands the review page shares
 * with this one, which is what keeps a history view from offering to launch an
 * agent (decision 33a); the stage plays with Annotate gone, and the facts state
 * what WAS done (Test drive "Lap 2") rather than instructing anyone to do it.
 */
export function ShippedBody({ full }: { full: FeatureFull }) {
  const { feature, tickets, runs } = full
  const events = useEventLog(feature.id)
  const [peekingOutcome, setPeekingOutcome] = useState(false)
  const outcomeRelPath = outcomeDocPath(full)

  // What the reviews left on disk. Same query key the review page reads, so a
  // feature looked at both ways plays the same recording.
  const artifacts = useReviewArtifacts(feature.id)
  const rows = artifacts.data ?? []
  const recordings = rows.filter((a) => a.hasVideo && a.videoUrl)
  const stamped = stampedReview(rows, tickets)
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
  const run = latestRun(runs)
  const account = lapAccount(tickets, feature.lap)
  const observations = (findings.data?.findings ?? []).filter((f) => f.kind === 'observation')
  const [staged, setStaged] = useState<string | null>(null)
  // "What shipped" heads the record and the Outcome doc; with neither there is
  // nothing for the heading to stand over.
  const hasWork = !!outcomeRelPath || recordings.length > 0

  return (
    // The four tiers (simplify-the-pages decision 7), with the header above as
    // Now: the status rows, what shipped, then the reference at lighter weight.
    <div className="flex flex-col gap-10">
      <div data-tier="status">
        <StatusStrip
          artifact={stamped}
          outcome={stampedOutcome({ passes: rows, tickets })}
          currentLap={feature.lap}
          landedSince={stamped?.landedSince ?? 0}
          tickets={tickets}
          runState={run?.status ?? 'no run recorded'}
          shipped
          driveLap={lastTestDriveLap(events)}
          noWalkthrough={recordings.length === 0}
        />
      </div>

      {/* The heading sits close to what it heads; the parts under it keep the
          page's 40px between them. */}
      {hasWork && (
        <section data-tier="work" className="flex flex-col gap-3 [&>*+*+*]:mt-7">
          <div className="flex min-h-7 items-center gap-3">
            <h2 className="m-0 min-w-0 flex-1 text-lg font-semibold text-text">What shipped</h2>
            {/* The synthesized account the merge wrote to the base branch —
                the permanent record, beside the heading of what it records
                (decision 9c). */}
            {outcomeRelPath && (
              <Button variant="ghost" size="sm" icon={<IconDoc />} onClick={() => setPeekingOutcome(true)}>
                Outcome doc
              </Button>
            )}
          </div>
          {/* Nothing recorded and nothing here can ever record one, so there is
              no stage at all — the Test drive row above already says why. */}
          {recordings.length > 0 && (
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
          )}
        </section>
      )}

      <ReferenceTier
        history={
          <ReviewTrail
            passes={rows}
            tickets={tickets}
            findings={findings.data?.findings ?? []}
            notes={notes.data ?? []}
            currentLap={feature.lap}
            staged={recordings.length > 0 ? staged : null}
            onStage={setStaged}
          />
        }
      >
        <QaHistory sessions={chats} />
        <DriveInstructions text={project?.driveInstructions} />
        <FullAccounts account={account} tickets={tickets} observations={observations} />
        <LapStory
          lap={lapChip(tickets, { lap: feature.lap, lapSessionRan: true })}
          laterLaps={deferredScope(specQ.data?.content)}
          currentLap={feature.lap}
          readonly
        />
      </ReferenceTier>

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
 *
 * Reference, not work (simplify-the-pages decision 7): one closed row with the
 * count beside it, every conversation still one click away (flow d33b).
 */
function QaHistory({ sessions }: { sessions: FeatureFull['sessions'] }) {
  if (sessions.length === 0) return null

  return (
    <Disclosure
      title="Questions asked"
      icon={<IconMessage />}
      aside={`${sessions.length} conversation${sessions.length === 1 ? '' : 's'}`}
    >
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
    </Disclosure>
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
