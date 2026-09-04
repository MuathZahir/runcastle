import { trpc } from '../../../trpc'
import { DimLine, SectionTitle } from '../../../ui'
import type { FeatureFull } from '../../../lib/api'
import { liveSessionBlocker, parseMapSections, waypointGroups, type LiveSessionBlocker, type WaypointGroup } from '../../../lib/feature-ui'
import { IconDoc } from '../../../icons'
import { Markdown } from '../../Markdown'
import { WaypointCard } from './WaypointCard'

const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const

export function MapRail({ full, relPath, collapsed, onToggle }: { full: FeatureFull; relPath?: string; collapsed: boolean; onToggle: () => void }) {
  const featureId = full.feature.id
  const q = trpc.docs.read.useQuery({ featureId, relPath: relPath ?? 'map.md' }, { enabled: !!relPath })
  const sections = q.data ? parseMapSections(q.data.content) : {}
  const groups = waypointGroups(full.waypoints, full.frontierIds)
  const frontierCount = groups.find((group) => group.key === 'frontier')?.waypoints.length ?? 0
  const charted = !!relPath || full.waypoints.length > 0
  return (
    <aside className={`maprail${collapsed ? ' is-collapsed' : ''}`}>
      <div className="mr-head">
        {!collapsed && <SectionTitle>Map</SectionTitle>}
        <button type="button" className="mr-toggle" aria-expanded={!collapsed} title={collapsed ? 'Expand the map rail' : 'Collapse the map rail'} onClick={onToggle}>{collapsed ? '›' : '‹'}</button>
      </div>
      {collapsed ? (
        <button type="button" className="mr-stub" title={`${frontierCount} waypoint${frontierCount === 1 ? '' : 's'} on the frontier — expand the map rail`} onClick={onToggle}>
          <span className="mr-stub-count">{frontierCount}</span><span className="mr-stub-label">Frontier</span>
        </button>
      ) : (
        <div className="mr-scroll">
          {q.isLoading && <DimLine>loading map…</DimLine>}
          {charted ? <><WaypointGroupList featureId={featureId} groups={groups} blocker={liveSessionBlocker(full.sessions, full.waypoints)} />{relPath && <MapDoc sections={sections} />}</> : (
            <div className="doc-card is-empty"><IconDoc size={14} /><span className="doc-card-title">Not charted yet</span><span className="doc-card-hint">the session writes the map as you explore the idea</span></div>
          )}
        </div>
      )}
    </aside>
  )
}

function MapDoc({ sections }: { sections: Record<string, string> }) {
  const written = MAP_SECTIONS.filter((name) => (sections[name]?.trim() ?? '') !== '')
  return <details className="mapdoc"><summary className="mapdoc-summary">Map document</summary>{written.length === 0 ? <DimLine>Nothing written yet — the session fills this in as it explores the idea.</DimLine> : written.map((name) => <section className="map-section" key={name}><div className="map-section-title">{name}</div><Markdown source={sections[name].trim()} /></section>)}</details>
}

function WaypointGroupList({ featureId, groups, blocker }: { featureId: string; groups: WaypointGroup[]; blocker?: LiveSessionBlocker }) {
  if (groups.length === 0) return <div className="map-waypoints"><DimLine>No waypoints yet — they appear here as the map takes shape.</DimLine></div>
  return <div className="map-waypoints">{groups.map((group) => {
    const rows = group.waypoints.map((item) => <WaypointCard key={item.waypoint.id} featureId={featureId} group={group.key} item={item} blocker={blocker} />)
    const title = `${group.label} · ${group.waypoints.length}`
    return group.key === 'done' ? <details className="wp-group wp-group-done" key={group.key}><summary className="wp-group-title">{title}</summary>{rows}</details> : <section className={`wp-group wp-group-${group.key}`} key={group.key}><div className="wp-group-title">{title}</div>{rows}</section>
  })}</div>
}
