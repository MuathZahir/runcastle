import { useState } from 'react'
import { trpc } from '../../../trpc'
import { DimLine, Disclosure, EmptyState, IconButton, SectionLabel, cx } from '../../../ui'
import type { FeatureFull } from '../../../lib/api'
import {
  liveSessionBlocker,
  mapProgress,
  parseMapSections,
  waypointGroups,
  type LiveSessionBlocker,
  type WaypointGroup,
} from '../../../lib/feature-ui'
import { WAYPOINT_EXPLAINER } from '../../../lib/vocabulary'
import { IconDoc, IconInfo, IconPanelLeft } from '../../../icons'
import { DocsMenu } from '../../DocsMenu'
import { DocPeek } from '../../DocPeek'
import { Markdown } from '../../Markdown'
import { WaypointCard } from './WaypointCard'

// Core owns the map.md headings but does not currently export their names.
const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const

/**
 * A mapped feature's waypoints, grouped by what they are waiting on. `rail`
 * (default) is the column beside the live session: its own header, its own
 * scroll, collapsible to a strip. `section` is the same map as a section of a
 * pinned page: no header of its own (the page section titles it), no scroll,
 * no collapse.
 */
export function MapRail({
  full,
  relPath,
  collapsed,
  onToggle,
  readonly = false,
  layout = 'rail',
}: {
  full: FeatureFull
  relPath?: string
  collapsed: boolean
  onToggle: () => void
  readonly?: boolean
  layout?: 'rail' | 'section'
}) {
  const featureId = full.feature.id
  const [peekPath, setPeekPath] = useState<string>()
  const q = trpc.docs.read.useQuery({ featureId, relPath: relPath ?? 'map.md' }, { enabled: !!relPath })
  const sections = q.data ? parseMapSections(q.data.content) : {}
  const groups = waypointGroups(full.waypoints, full.frontierIds, readonly)
  const progress = mapProgress(full.waypoints, full.frontierIds)
  const charted = !!relPath || full.waypoints.length > 0
  const rail = layout === 'rail'
  const progressText = `${progress.done}/${progress.total} done`

  if (rail && collapsed)
    return (
      <div className="flex w-9 flex-none flex-col items-center gap-2 pt-0.5">
        <IconButton label="Expand the map" icon={<IconPanelLeft />} onClick={onToggle} tooltipSide="right" />
        <span className="text-xs text-text-tertiary tabular-nums">
          {progress.done}/{progress.total}
        </span>
        <span className="text-xs text-text-tertiary [writing-mode:vertical-rl]">Map</span>
      </div>
    )

  const content = (
    <>
      {q.isLoading && <DimLine>Loading the map…</DimLine>}
      {charted ? (
        <>
          <WaypointGroupList
            featureId={featureId}
            groups={groups}
            blocker={liveSessionBlocker(full.sessions, full.waypoints)}
            readonly={readonly}
          />
          {relPath && <MapDoc sections={sections} />}
        </>
      ) : (
        <EmptyState
          compact
          icon={<IconDoc />}
          title="Not charted yet"
          hint="The session writes the map as you explore the idea."
        />
      )}
    </>
  )

  return (
    <section
      aria-label="Map"
      className={cx('flex min-h-0 flex-col', rail ? 'w-(--maprail-w) flex-none' : 'min-w-0')}
    >
      {rail ? (
        <>
          <div className="flex h-8 shrink-0 items-center gap-2">
            <h2 className="m-0 text-sm font-medium text-text">Map</h2>
            <span
              className="text-xs text-text-tertiary tabular-nums"
              aria-label={`${progress.done} of ${progress.total} waypoints done`}
            >
              {progressText}
            </span>
            <IconButton label={WAYPOINT_EXPLAINER} size="sm" icon={<IconInfo />} className="-ml-1" />
            <span className="ml-auto flex items-center gap-0.5">
              <DocsMenu docs={full.docs} value={relPath} onPick={setPeekPath} />
              <IconButton
                label="Collapse the map"
                size="sm"
                icon={<IconPanelLeft />}
                onClick={onToggle}
              />
            </span>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-2">{content}</div>
        </>
      ) : (
        <>
          <p className="mt-0 mb-3 text-xs text-text-tertiary">{progressText}</p>
          {content}
        </>
      )}
      {peekPath && peekPath !== relPath && (
        <DocPeek
          featureId={featureId}
          relPath={peekPath}
          title={full.docs.find((doc) => doc.relPath === peekPath)?.title || peekPath.split(/[\\/]/).pop() || 'Document'}
          onClose={() => setPeekPath(undefined)}
        />
      )}
    </section>
  )
}

function MapDoc({ sections }: { sections: Record<string, string> }) {
  const written = MAP_SECTIONS.filter((name) => (sections[name]?.trim() ?? '') !== '')
  return (
    <Disclosure title="Map document" icon={<IconDoc />} className="mt-4" bodyClassName="pl-6 pr-1">
      {written.length === 0 ? (
        <DimLine>Nothing written yet — the session fills this in as it explores the idea.</DimLine>
      ) : (
        written.map((name) => (
          <section className="mt-3 first:mt-0" key={name}>
            <div className="mb-1 text-xs font-medium text-text-tertiary">{name}</div>
            <Markdown source={sections[name].trim()} />
          </section>
        ))
      )}
    </Disclosure>
  )
}

function WaypointGroupList({
  featureId,
  groups,
  blocker,
  readonly,
}: {
  featureId: string
  groups: WaypointGroup[]
  blocker?: LiveSessionBlocker
  readonly: boolean
}) {
  if (groups.length === 0)
    return <DimLine>No waypoints yet — they appear here as the map takes shape.</DimLine>
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const rows = (
          <div className="flex flex-col">
            {group.waypoints.map((item) => (
              <WaypointCard
                key={item.waypoint.id}
                featureId={featureId}
                group={group.key}
                item={item}
                blocker={blocker}
                readonly={readonly}
              />
            ))}
          </div>
        )
        if (group.key === 'done' && !readonly)
          return (
            <Disclosure key={group.key} title={group.label} aside={group.waypoints.length}>
              {rows}
            </Disclosure>
          )
        return (
          <section key={group.key}>
            <SectionLabel count={group.waypoints.length} className="px-2">
              {group.label}
            </SectionLabel>
            {rows}
          </section>
        )
      })}
    </div>
  )
}
