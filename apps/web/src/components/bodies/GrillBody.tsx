import { useState } from 'react'
import type { Phase } from '@runcastle/core'
import { trpc } from '../../trpc'
import { DimLine, EmptyState, SectionTitle } from '../../ui'
import type { FeatureFull } from '../../lib/api'
import {
  parseMapSections,
  waypointGroups,
  type RailWaypoint,
  type WaypointGroup,
  type WaypointGroupKey,
} from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { IconChevronRight, IconDoc, IconTerminal } from '../../icons'
import { DocPeek } from '../DocPeek'
import { Markdown } from '../Markdown'
import { SessionPanel } from '../SessionPanel'

/**
 * The ideation / spec phase body (app-redesign). Two panes side by side that
 * scroll independently, never one long column: a mapped feature gets the map
 * rail on the left, and the terminal — the thing the human actually types into —
 * fills everything to its right at full height. An unmapped feature is the
 * terminal pane alone (with the spec doc-card above it in the `spec` phase).
 *
 * The terminal is the real live Claude Code session, inline over the /ws PTY
 * stream. An ended session renders as the quiet ended card, which offers Resume
 * when its conversation is still on disk (see {@link SessionPanel}). With no
 * session at all the panel is an empty state — the next-step bar owns starting
 * one.
 */
export function GrillBody({
  full,
  effective,
  mapRailCollapsed,
  onToggleMapRail,
}: {
  full: FeatureFull
  effective: Phase
  mapRailCollapsed: boolean
  onToggleMapRail: () => void
}) {
  const { feature, sessions, docs } = full
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
      {feature.mapped && (
        <MapRail
          full={full}
          relPath={mapDoc?.relPath}
          collapsed={mapRailCollapsed}
          onToggle={onToggleMapRail}
        />
      )}

      <div className="termpane">
        {effective === 'spec' && (
          <SpecCard featureId={feature.id} relPath={specDoc?.relPath} />
        )}

        {sessions.length > 0 ? (
          // The ended card's own Resume stands down while the converge-recovery
          // bar is showing — that bar relaunches the same conversation with the
          // phase framing the human needs there.
          <SessionPanel
            featureId={feature.id}
            sessions={sessions}
            full={full}
            showResume={!showConvergeResume}
          />
        ) : (
          <div className="grill-panel">
            <EmptyState
              icon={<IconTerminal size={16} />}
              title="No session yet"
              hint="Start a session from the bar above — you and Claude shape the idea here before any code is written."
            />
          </div>
        )}

        {showConvergeResume && <ConvergeResume featureId={feature.id} />}
      </div>
    </div>
  )
}

/**
 * Compact spec pointer: the written spec opens in a peek overlay instead of
 * dumping its full mono text into the page. Keeps the session the hero.
 */
function SpecCard({ featureId, relPath }: { featureId: string; relPath?: string }) {
  const [open, setOpen] = useState(false)
  if (!relPath) {
    return (
      <div className="doc-card is-empty">
        <IconDoc size={14} />
        <span className="doc-card-title">Spec not written yet</span>
        <span className="doc-card-hint">continue the session to draft it</span>
      </div>
    )
  }
  return (
    <>
      <button className="doc-card" onClick={() => setOpen(true)} title="View the spec">
        <IconDoc size={14} />
        <span className="doc-card-title">Specification</span>
        <span className="doc-card-meta">{relPath.split(/[\\/]/).pop()}</span>
        <span className="doc-card-open">
          View
          <IconChevronRight size={11} />
        </span>
      </button>
      {open && (
        <DocPeek featureId={featureId} relPath={relPath} title="Specification" onClose={() => setOpen(false)} />
      )}
    </>
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
      <span className="converge-resume-text">
        The converge session ended before tickets were emitted.
      </span>
      <button
        type="button"
        className="btn btn-xs btn-ghost"
        disabled={converge.isPending}
        title="Restart the converge session over map.md + decisions.md"
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
 * The mapped-ideation left rail (decision #1/#4): a fixed-width column that is
 * always visible and scrolls on its own, holding the waypoint status groups
 * first and the map doc's prose sections below them behind a disclosure that is
 * closed by default — the waypoints are the point of a map, the prose is
 * orientation you read once. The collapse toggle lives in the rail's own header
 * and shrinks it to a stub showing the frontier count; the flag is workspace
 * state, persisted globally.
 */
function MapRail({
  full,
  relPath,
  collapsed,
  onToggle,
}: {
  full: FeatureFull
  relPath?: string
  collapsed: boolean
  onToggle: () => void
}) {
  const featureId = full.feature.id
  const q = trpc.docs.read.useQuery(
    { featureId, relPath: relPath ?? 'map.md' },
    { enabled: !!relPath },
  )
  const sections = q.data ? parseMapSections(q.data.content) : {}
  const groups = waypointGroups(full.waypoints, full.frontierIds)
  const frontierCount = groups.find((g) => g.key === 'frontier')?.waypoints.length ?? 0
  // Nothing charted at all yet — one quiet card instead of stacked placeholders.
  const charted = !!relPath || full.waypoints.length > 0

  return (
    <aside className={`maprail${collapsed ? ' is-collapsed' : ''}`}>
      <div className="mr-head">
        {!collapsed && <SectionTitle>Map</SectionTitle>}
        <button
          type="button"
          className="mr-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand the map rail' : 'Collapse the map rail'}
          onClick={onToggle}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {collapsed ? (
        <button
          type="button"
          className="mr-stub"
          title={`${frontierCount} waypoint${frontierCount === 1 ? '' : 's'} on the frontier — expand the map rail`}
          onClick={onToggle}
        >
          <span className="mr-stub-count">{frontierCount}</span>
          <span className="mr-stub-label">Frontier</span>
        </button>
      ) : (
        <div className="mr-scroll">
          {q.isLoading && <DimLine>loading map…</DimLine>}

          {charted ? (
            <>
              <WaypointGroupList
                featureId={featureId}
                groups={groups}
                sessions={full.sessions}
              />
              {relPath && <MapDoc sections={sections} />}
              <ConvergeBar full={full} fog={sections['Not yet specified']?.trim()} />
            </>
          ) : (
            <div className="doc-card is-empty">
              <IconDoc size={14} />
              <span className="doc-card-title">Not charted yet</span>
              <span className="doc-card-hint">the session writes the map as you explore the idea</span>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

/** The map doc's prose, behind a disclosure that starts closed (decision #4). */
function MapDoc({ sections }: { sections: Record<string, string> }) {
  return (
    <details className="mapdoc">
      <summary className="mapdoc-summary">Map document</summary>
      {MAP_SECTIONS.map((name) => {
        const body = sections[name]?.trim()
        return (
          <section className="map-section" key={name}>
            <div className="map-section-title">{name}</div>
            {body ? <Markdown source={body} /> : <DimLine>—</DimLine>}
          </section>
        )
      })}
    </details>
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
 * The waypoint status groups (SPEC §13.6), rendered straight from the
 * `waypointGroups` derivation — membership, ordering, blocker names and lineage
 * are all decided there, so this is only markup. The resolved/dropped tail stays
 * a collapsed disclosure.
 */
function WaypointGroupList({
  featureId,
  groups,
  sessions,
}: {
  featureId: string
  groups: WaypointGroup[]
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

  if (groups.length === 0) {
    return (
      <div className="map-waypoints">
        <DimLine>No waypoints yet — they appear here as the map takes shape.</DimLine>
      </div>
    )
  }

  return (
    <div className="map-waypoints">
      {groups.map((g) => {
        const rows = g.waypoints.map((item) => (
          <WaypointRow
            key={item.waypoint.id}
            group={g.key}
            item={item}
            liveHitl={liveHitl}
            working={work.isPending}
            onWork={(waypointId) => work.mutate({ featureId, waypointId })}
          />
        ))
        const title = `${g.label} · ${g.waypoints.length}`
        return g.key === 'done' ? (
          <details className="wp-group wp-group-done" key={g.key}>
            <summary className="wp-group-title">{title}</summary>
            {rows}
          </details>
        ) : (
          <section className={`wp-group wp-group-${g.key}`} key={g.key}>
            <div className="wp-group-title">{title}</div>
            {rows}
          </section>
        )
      })}
    </div>
  )
}

/**
 * One waypoint, still a flat row: type badge, title, and — on the frontier — the
 * Work button (every type gets one; research starts an AFK run through the same
 * `workWaypoint` mutation, the rest spawn a terminal, and a prior release that
 * left a `lastSessionId` reads as Resume). Blocked rows name their blockers,
 * claimed rows pulse, and lineage is one "surfaced by <name>" line.
 */
function WaypointRow({
  group,
  item,
  liveHitl,
  working,
  onWork,
}: {
  group: WaypointGroupKey
  item: RailWaypoint
  liveHitl: boolean
  working: boolean
  onWork: (waypointId: string) => void
}) {
  const w = item.waypoint
  // Research is worked AFK (a run, not a terminal) — a live HITL session doesn't
  // block it. HITL types (grilling/prototype/task) spawn a terminal, so they wait
  // for the live session to end first.
  const research = w.type === 'research'
  const resuming = !research && !!w.lastSessionId
  const blockedBySession = !research && liveHitl
  // A run-claim is an AFK research run in flight — say so, instead of presenting
  // a dead row that looks like a hung session.
  const byRun = w.claimedBy?.startsWith('run_') ?? false

  return (
    <div className={`wp wp-${group}${group === 'done' ? ` wp-${w.status}` : ''}`}>
      {group === 'claimed' && <span className="wp-pulse" aria-hidden="true" />}
      <span className="wp-type">{group === 'done' ? w.status : w.type}</span>
      <span className="wp-title">{w.title}</span>

      {group === 'blocked' && item.blockerTitles.length > 0 && (
        <span className="wp-blockers">blocked by {item.blockerTitles.join(', ')}</span>
      )}
      {group === 'claimed' && byRun && <span className="wp-run-note">researching…</span>}
      {group === 'done' && w.summary && <span className="wp-summary">{w.summary}</span>}

      {group === 'frontier' && (
        <button
          type="button"
          className="btn btn-xs btn-solid wp-work"
          disabled={blockedBySession || working}
          title={
            research
              ? 'start an AFK research run on this waypoint'
              : blockedBySession
                ? 'a session is already live on this feature — end or finish it before starting another'
                : resuming
                  ? 'resume the previous session on this waypoint'
                  : 'claim this waypoint and open a session'
          }
          onClick={() => onWork(w.id)}
        >
          {resuming ? 'Resume' : 'Work'}
        </button>
      )}

      {group !== 'done' && item.originTitle && (
        <div className="wp-lineage">surfaced by {item.originTitle}</div>
      )}
    </div>
  )
}
