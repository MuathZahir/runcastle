import type { Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import { DimLine, SectionTitle, SessionStatusDot } from '../../ui'
import type { FeatureFull } from '../../lib/api'
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
        <SectionTitle>{feature.size === 'collapsed' ? 'Session' : 'Grill session'}</SectionTitle>
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

      <WaypointGroups waypoints={full.waypoints} frontierIds={full.frontierIds} />
    </div>
  )
}

/**
 * The four waypoint status groups (SPEC §13.6). Frontier (open + all blockers
 * terminal; resume hint when a prior release left a `lastSessionId`), blocked
 * (greyed, blocker *names*), claimed (live pulse), and a collapsed
 * resolved/dropped tail. Lineage is one "surfaced by <name>" line per waypoint
 * carrying an `originWaypointId`.
 */
function WaypointGroups({
  waypoints,
  frontierIds,
}: {
  waypoints: Waypoint[]
  frontierIds: string[]
}) {
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
          {frontier.map((w) => (
            <div className="wp wp-frontier" key={w.id}>
              <span className="wp-type">{w.type}</span>
              <span className="wp-title">{w.title}</span>
              {w.lastSessionId && <span className="wp-resume">resume</span>}
              <Lineage w={w} />
            </div>
          ))}
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
          {claimed.map((w) => (
            <div className="wp wp-claimed" key={w.id}>
              <span className="wp-pulse" aria-hidden="true" />
              <span className="wp-type">{w.type}</span>
              <span className="wp-title">{w.title}</span>
              <Lineage w={w} />
            </div>
          ))}
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
