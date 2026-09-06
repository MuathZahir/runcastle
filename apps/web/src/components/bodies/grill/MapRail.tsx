import { useState } from 'react'
import { trpc } from '../../../trpc'
import { DimLine, SectionTitle } from '../../../ui'
import type { FeatureFull } from '../../../lib/api'
import { liveSessionBlocker, mapProgress, parseMapSections, waypointGroups, type LiveSessionBlocker, type WaypointGroup } from '../../../lib/feature-ui'
import { WAYPOINT_EXPLAINER } from '../../../lib/vocabulary'
import { IconDoc } from '../../../icons'
import { DocsMenu } from '../../DocsMenu'
import { DocPeek } from '../../DocPeek'
import { Markdown } from '../../Markdown'
import { WaypointCard } from './WaypointCard'

// Core owns the map.md headings but does not currently export their names.
const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const

export function MapRail({ full, relPath, collapsed, onToggle, readonly = false }: { full: FeatureFull; relPath?: string; collapsed: boolean; onToggle: () => void; readonly?: boolean }) {
  const featureId = full.feature.id
  const [peekPath, setPeekPath] = useState<string>()
  const q = trpc.docs.read.useQuery({ featureId, relPath: relPath ?? 'map.md' }, { enabled: !!relPath })
  const sections = q.data ? parseMapSections(q.data.content) : {}
  const groups = waypointGroups(full.waypoints, full.frontierIds, readonly)
  const progress = mapProgress(full.waypoints, full.frontierIds)
  const charted = !!relPath || full.waypoints.length > 0
  const percent = progress.total === 0 ? 0 : (progress.done / progress.total) * 100
  return (
    <aside className={`flex min-h-0 flex-none flex-col rounded-lg border border-hairline bg-panel-2 ${collapsed ? 'w-10' : 'w-(--maprail-w)'}`}>
      {collapsed ? (
        <button type="button" className="flex min-h-0 flex-1 flex-col items-center gap-3 py-3 font-mono text-xs text-text-3 hover:bg-panel-3 hover:text-text" title="Expand the map rail" onClick={onToggle}>
          <span>{progress.done}/{progress.total}</span><span className="[writing-mode:vertical-rl]">map</span><span aria-hidden="true">›</span>
        </button>
      ) : <>
        <div className="flex min-h-12 items-center gap-2 border-b border-hairline px-3">
          <SectionTitle>Map</SectionTitle>
          <span className="font-mono text-xs text-text-3">· {progress.done}/{progress.total} done</span>
          <button type="button" className="flex size-3.5 items-center justify-center rounded-full text-[11px] text-text-3 hover:text-text" title={WAYPOINT_EXPLAINER} aria-label="What is a waypoint?">ⓘ</button>
          <DocsMenu docs={full.docs} value={relPath} onPick={setPeekPath} />
          <button type="button" className="size-8 rounded-md text-text-3 hover:bg-panel-3 hover:text-text" aria-expanded="true" title="Collapse the map rail" onClick={onToggle}>‹</button>
        </div>
        <div className="h-0.75 bg-panel-3" aria-label={`${progress.done} of ${progress.total} waypoints done`}><div className="h-full bg-accent" style={{ width: `${percent}%` }} /></div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {q.isLoading && <DimLine>loading map…</DimLine>}
          {charted ? <><WaypointGroupList featureId={featureId} groups={groups} blocker={liveSessionBlocker(full.sessions, full.waypoints)} readonly={readonly} />{relPath && <MapDoc sections={sections} />}</> : (
            <div className="flex items-center gap-2 rounded-md border border-hairline bg-panel-3 p-3 text-text-3"><IconDoc size={14} /><span className="font-semibold text-text-2">Not charted yet</span><span className="text-sm">the session writes the map as you explore the idea</span></div>
          )}
        </div>
      </>}
      {peekPath && peekPath !== relPath && <DocPeek featureId={featureId} relPath={peekPath} title={full.docs.find((doc) => doc.relPath === peekPath)?.title || peekPath.split(/[\\/]/).pop() || 'Document'} onClose={() => setPeekPath(undefined)} />}
    </aside>
  )
}

function MapDoc({ sections }: { sections: Record<string, string> }) {
  const written = MAP_SECTIONS.filter((name) => (sections[name]?.trim() ?? '') !== '')
  return <details className="mt-4 border-t border-hairline-soft pt-3"><summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-text-3 hover:text-text-2">Map document</summary>{written.length === 0 ? <div className="mt-3"><DimLine>Nothing written yet — the session fills this in as it explores the idea.</DimLine></div> : written.map((name) => <section className="mt-3" key={name}><div className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-text-3">{name}</div><Markdown source={sections[name].trim()} /></section>)}</details>
}

function WaypointGroupList({ featureId, groups, blocker, readonly }: { featureId: string; groups: WaypointGroup[]; blocker?: LiveSessionBlocker; readonly: boolean }) {
  if (groups.length === 0) return <div className="rounded-md border border-dashed border-hairline p-3"><DimLine>No waypoints yet — they appear here as the map takes shape.</DimLine></div>
  return <div className="flex flex-col gap-4">{groups.map((group) => {
    const rows = <div className="mt-2 flex flex-col gap-2">{group.waypoints.map((item) => <WaypointCard key={item.waypoint.id} featureId={featureId} group={group.key} item={item} blocker={blocker} readonly={readonly} />)}</div>
    const title = <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-text-3">{group.label} · {group.waypoints.length}</span>
    if (group.key === 'done' && !readonly) return <details key={group.key} className="border-t border-hairline-soft pt-3"><summary className="cursor-pointer list-none">{title}</summary>{rows}</details>
    return <section key={group.key}><div>{title}</div>{rows}</section>
  })}</div>
}
