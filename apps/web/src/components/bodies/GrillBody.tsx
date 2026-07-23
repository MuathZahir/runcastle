import { useState } from 'react'
import type { Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import { DimLine, SectionTitle, SessionStatusDot } from '../../ui'
import type { FeatureFull } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

type Waypoint = FeatureFull['waypoints'][number]

/**
 * The ideation / spec phase body (app-redesign). Embeds the real live Claude
 * Code grill session as an inline terminal (over the /ws PTY stream); in the
 * `spec` phase the written spec doc is rendered above the conversation. When no
 * session is live the panel is a quiet empty state — the next-step bar owns the
 * "start a session" action.
 */
export function GrillBody({ full, effective }: { full: FeatureFull; effective: Phase }) {
  const { feature, sessions, docs } = full
  // Prefer a live/launching session; otherwise the most recent one.
  const ordered = [...sessions].reverse()
  const session = ordered.find((s) => s.status === 'live' || s.status === 'launching') ?? ordered[0]
  const specDoc = docs.find((d) => d.relPath.endsWith('spec.md'))
  const mapDoc = feature.mapped ? docs.find((d) => d.relPath.endsWith('map.md')) : undefined
  // Converge re-entry (recovery path): a mapped feature stranded at `spec` with
  // no live session and zero tickets means the converge session died after
  // crossing G1 — offer a subtle restart (feature.converge re-enters here).
  const hasLive = sessions.some((s) => s.status === 'live' || s.status === 'launching')
  const showConvergeResume =
    feature.mapped &&
    feature.phase === 'spec' &&
    effective === 'spec' &&
    !hasLive &&
    full.tickets.length === 0

  return (
    <div className="grill">
      {feature.mapped && <MapPanel full={full} relPath={mapDoc?.relPath} />}

      {effective === 'spec' &&
        (specDoc ? (
          <DocPanel featureId={feature.id} relPath={specDoc.relPath} />
        ) : (
          <div className="spec-doc">
            <DimLine>spec not written yet — continue the grill to draft it</DimLine>
          </div>
        ))}

      <div className="body-title" style={{ marginTop: effective === 'spec' ? 18 : 0 }}>
        <SectionTitle>Grill session</SectionTitle>
        <span className="body-hint">— shape the idea with Claude; promote it when it feels concrete</span>
      </div>

      <div className="grill-panel">
        {session ? (
          <>
            <div className="grill-strip">
              <span className="grill-kind">{session.kind}</span>
              <span className="grill-sid">{session.ccSessionId ?? session.id}</span>
              <SessionStatusDot status={session.status} />
              <span className="grill-strip-spacer" />
              {(session.status === 'live' || session.status === 'launching') && (
                <EndSessionButton featureId={feature.id} sessionId={session.id} />
              )}
            </div>
            <div className="grill-term" id="grill-term">
              {session.status === 'ended' ? (
                <div className="grill-empty">
                  <DimLine>session ended — its decisions live in Knowledge</DimLine>
                </div>
              ) : (
                <ErrorBoundary label="terminal">
                  <TerminalView sessionId={session.id} />
                </ErrorBoundary>
              )}
            </div>
          </>
        ) : (
          <div className="grill-empty">
            <DimLine>no grill session yet</DimLine>
            <span className="body-hint">
              Start a session from the next step to shape the idea with Claude before any code.
            </span>
          </div>
        )}
      </div>

      {showConvergeResume && <ConvergeResume featureId={feature.id} />}
    </div>
  )
}

/**
 * Subtle recovery affordance, not a primary CTA: restart the converge session
 * for a mapped feature that crossed G1 but lost its converge session before any
 * tickets were emitted (crash / kill). The server accepts `feature.converge`
 * again at phase `spec` with no live session and zero tickets.
 */
function ConvergeResume({ featureId }: { featureId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const converge = trpc.feature.converge.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  return (
    <div className="converge-resume">
      <DimLine>the converge session ended before tickets were emitted</DimLine>
      <button
        type="button"
        className="btn btn-xs btn-ghost"
        disabled={converge.isPending}
        title="restart the converge session over map.md + decisions.md"
        onClick={() => converge.mutate({ featureId })}
      >
        {converge.isPending ? 'Resuming…' : 'Resume converge'}
      </button>
    </div>
  )
}

/**
 * The four `map.md` sections, in destination-first order (SPEC §13.4). Kept in
 * sync with the server's `MAP_SECTIONS` scaffold; duplicated here rather than
 * imported so the web bundle stays free of the server's node-only knowledge
 * module.
 */
const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const

/**
 * The mapped-ideation variant of the ideation body (ADR-0001 §13.6): the map
 * doc's prose sections above, the waypoint status groups below (frontier,
 * blocked, claimed, resolved/dropped). The frontier is server-derived and
 * cascades as blockers resolve.
 */
function MapPanel({ full, relPath }: { full: FeatureFull; relPath?: string }) {
  const featureId = full.feature.id
  const q = trpc.docs.read.useQuery(
    { featureId, relPath: relPath ?? 'map.md' },
    { enabled: !!relPath },
  )
  const sections = q.data ? parseMapSections(q.data.content) : {}

  return (
    <div className="map-panel">
      <div className="body-title">
        <SectionTitle>Map</SectionTitle>
        <span className="body-hint">— chart the destination and open questions before diving in</span>
      </div>

      {q.isLoading && <DimLine>loading map…</DimLine>}
      {!relPath && !q.isLoading && (
        <DimLine>map not scaffolded yet</DimLine>
      )}

      {relPath && (
        <div className="map-sections">
          {MAP_SECTIONS.map((name) => {
            const body = sections[name]?.trim()
            return (
              <section className="map-section" key={name}>
                <div className="map-section-title">{name}</div>
                {body ? (
                  <div className="map-section-body">{body}</div>
                ) : (
                  <DimLine>—</DimLine>
                )}
              </section>
            )
          })}
        </div>
      )}

      <WaypointGroups
        featureId={featureId}
        waypoints={full.waypoints}
        frontierIds={full.frontierIds}
        sessions={full.sessions}
      />

      <ConvergeBar full={full} fog={sections['Not yet specified']?.trim()} />
    </div>
  )
}

/**
 * The convergence control (ADR-0001 §13.6). Only shown on a mapped feature still
 * guarded by G1 (`all-waypoints-terminal`). When the gate is satisfiable the
 * Converge button crosses G1 and spawns a fresh converge session; while any
 * waypoint is open or claimed the button is replaced by the blocking reason and
 * an override-with-reason affordance (the seatbelt, not the cage). Remaining fog
 * (the map's "Not yet specified" prose) renders as a soft warning beside it —
 * shown, never enforced.
 */
function ConvergeBar({ full, fog }: { full: FeatureFull; fog?: string }) {
  const { feature, gate } = full
  const utils = trpc.useUtils()
  const toast = useToast()
  const [overriding, setOverriding] = useState(false)
  const [reason, setReason] = useState('')

  const converge = trpc.feature.converge.useMutation({
    onSuccess: () => {
      setOverriding(false)
      setReason('')
      void utils.feature.get.invalidate({ id: feature.id })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  // Convergence only applies while the mapped feature is still at G1 (ideation).
  if (feature.phase !== 'ideation' || gate.next?.id !== 'G1') return null

  return (
    <section className="converge-bar">
      {fog && (
        <div className="converge-fog" role="note">
          <span className="converge-fog-icon" aria-hidden="true">
            ⚑
          </span>
          <span className="converge-fog-text">
            Fog remains — still not specified: {fog}. You can converge anyway.
          </span>
        </div>
      )}

      {gate.satisfied ? (
        <button
          type="button"
          className="btn btn-solid converge-btn"
          disabled={converge.isPending}
          onClick={() => converge.mutate({ featureId: feature.id })}
        >
          {converge.isPending ? 'Converging…' : 'Converge'}
        </button>
      ) : overriding ? (
        <div className="converge-override">
          <input
            className="override-input"
            placeholder="reason to converge past open waypoints"
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-xs btn-solid"
            disabled={!reason.trim() || converge.isPending}
            onClick={() => converge.mutate({ featureId: feature.id, overrideReason: reason.trim() })}
          >
            Converge anyway
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => {
              setOverriding(false)
              setReason('')
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="converge-blocked">
          <DimLine>{gate.reason ?? 'resolve the open waypoints to converge'}</DimLine>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => setOverriding(true)}
          >
            Override & converge…
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * The four waypoint status groups (SPEC §13.6). Frontier (open + all blockers
 * terminal; every type gets a Work button — research starts an AFK run through
 * `workWaypoint`, the rest spawn a terminal; resume hint when a prior release
 * left a `lastSessionId`), blocked (greyed, blocker *names*), claimed (live
 * pulse; run-claims read "researching…"), and a collapsed resolved/dropped
 * tail. Lineage is one "surfaced by <name>" line per waypoint carrying an
 * `originWaypointId`.
 */
function WaypointGroups({
  featureId,
  waypoints,
  frontierIds,
  sessions,
}: {
  featureId: string
  waypoints: Waypoint[]
  frontierIds: string[]
  sessions: FeatureFull['sessions']
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const work = trpc.feature.workWaypoint.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  // Serial HITL per feature (ADR-0001): only a live/launching SESSION blocks
  // spawning another terminal. A waypoint claimed by an AFK research RUN
  // (`claimedBy` = run_…) must not disable anything — research runs in parallel.
  const liveHitl = sessions.some((s) => s.status === 'live' || s.status === 'launching')

  if (waypoints.length === 0) {
    return (
      <div className="map-waypoints">
        <DimLine>no waypoints yet — the frontier fills in as the map is charted</DimLine>
      </div>
    )
  }

  const front = new Set(frontierIds)
  const byId = new Map(waypoints.map((w) => [w.id, w]))
  const bySeq = new Map(waypoints.map((w) => [w.seq, w]))
  const nameOf = (w: Waypoint) => w.title
  const surfacedBy = (w: Waypoint) =>
    w.originWaypointId ? byId.get(w.originWaypointId)?.title : undefined
  const isTerminal = (w: Waypoint) => w.status === 'resolved' || w.status === 'dropped'

  const frontier = waypoints.filter((w) => front.has(w.id))
  const blocked = waypoints.filter((w) => w.status === 'open' && !front.has(w.id))
  const claimed = waypoints.filter((w) => w.status === 'claimed')
  const done = waypoints.filter(isTerminal)

  const Lineage = ({ w }: { w: Waypoint }) => {
    const origin = surfacedBy(w)
    return origin ? <div className="wp-lineage">surfaced by {origin}</div> : null
  }

  return (
    <div className="map-waypoints">
      {frontier.length > 0 && (
        <section className="wp-group wp-group-frontier">
          <div className="wp-group-title">Frontier · {frontier.length}</div>
          {frontier.map((w) => {
            // Research is worked AFK (a run, spawned by the same workWaypoint
            // mutation) — a live HITL session doesn't block it. HITL types
            // (grilling/prototype/task) spawn a terminal, so they wait for the
            // live session to end first.
            const research = w.type === 'research'
            const resuming = !research && !!w.lastSessionId
            const blockedBySession = !research && liveHitl
            return (
              <div className="wp wp-frontier" key={w.id}>
                <span className="wp-type">{w.type}</span>
                <span className="wp-title">{w.title}</span>
                <button
                  type="button"
                  className="btn btn-xs btn-solid wp-work"
                  disabled={blockedBySession || work.isPending}
                  title={
                    research
                      ? 'start an AFK research run on this waypoint'
                      : blockedBySession
                        ? 'a session is already live on this feature — end or finish it before starting another'
                        : resuming
                          ? 'resume the previous session on this waypoint'
                          : 'claim this waypoint and open a session'
                  }
                  onClick={() => work.mutate({ featureId, waypointId: w.id })}
                >
                  {resuming ? 'Resume' : 'Work'}
                </button>
                <Lineage w={w} />
              </div>
            )
          })}
        </section>
      )}

      {blocked.length > 0 && (
        <section className="wp-group wp-group-blocked">
          <div className="wp-group-title">Blocked · {blocked.length}</div>
          {blocked.map((w) => {
            const blockers = w.blockedBy
              .map((seq) => bySeq.get(seq))
              .filter((b): b is Waypoint => !!b && !isTerminal(b))
              .map(nameOf)
            return (
              <div className="wp wp-blocked" key={w.id}>
                <span className="wp-type">{w.type}</span>
                <span className="wp-title">{w.title}</span>
                {blockers.length > 0 && (
                  <span className="wp-blockers">blocked by {blockers.join(', ')}</span>
                )}
                <Lineage w={w} />
              </div>
            )
          })}
        </section>
      )}

      {claimed.length > 0 && (
        <section className="wp-group wp-group-claimed">
          <div className="wp-group-title">Claimed · {claimed.length}</div>
          {claimed.map((w) => {
            // A run-claim is an AFK research run in flight — say so, instead of
            // presenting a dead row that looks like a hung session.
            const byRun = w.claimedBy?.startsWith('run_') ?? false
            return (
              <div className="wp wp-claimed" key={w.id}>
                <span className="wp-pulse" aria-hidden="true" />
                <span className="wp-type">{w.type}</span>
                <span className="wp-title">{w.title}</span>
                {byRun && <span className="wp-run-note">researching…</span>}
                <Lineage w={w} />
              </div>
            )
          })}
        </section>
      )}

      {done.length > 0 && (
        <details className="wp-group wp-group-done">
          <summary className="wp-group-title">
            Resolved / dropped · {done.length}
          </summary>
          {done.map((w) => (
            <div className={`wp wp-done wp-${w.status}`} key={w.id}>
              <span className="wp-type">{w.status}</span>
              <span className="wp-title">{w.title}</span>
              {w.summary && <span className="wp-summary">{w.summary}</span>}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

/** Split `map.md` into a `{ heading: body }` map keyed by its `## ` sections. */
function parseMapSections(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current: string | null = null
  const buf: string[] = []
  const flush = () => {
    if (current !== null) out[current] = buf.join('\n')
    buf.length = 0
  }
  for (const line of content.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      flush()
      current = heading[1]
    } else if (current !== null) {
      buf.push(line)
    }
  }
  flush()
  return out
}

/** Inline render of a knowledge doc (spec.md) beside the conversation. */
function DocPanel({ featureId, relPath }: { featureId: string; relPath: string }) {
  const q = trpc.docs.read.useQuery({ featureId, relPath })
  return (
    <div className="spec-doc">
      <div className="spec-meta">{relPath}</div>
      {q.isLoading && <DimLine>loading {relPath}…</DimLine>}
      {q.error && <DimLine>could not read {relPath}</DimLine>}
      {q.data && <div className="spec-body">{q.data.content}</div>}
    </div>
  )
}
