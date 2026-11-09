import type { ReactNode } from 'react'
import { IconButton } from '../../src/ui'
import { PageTopbar } from '../../src/ui/page'
import { CreateMenu } from '../../src/components/Sidebar'
import { CollapseSidebarButton } from '../../src/components/Frame'
import { OrchestratorCard, Shelf, SidebarFeatureRow, SidebarStatusLine, WorkingShelf } from '../../src/components/SidebarParts'
import type { FeatureAction } from '../../src/components/FeatureActionsMenu'
import { IconArchive, IconGitMerge, IconList, IconMore, IconOrchestrator, IconPanelRight, IconSearch } from '../../src/icons'
import { sidebarLanes } from '../../src/lib/feature-ui'
import type { FeatureListItem } from '../../src/lib/api'
import { shortcut } from '../../src/lib/platform'
import { useTheme } from '../../src/lib/theme'
import { statsOf, type MockProject } from './data'

/**
 * The project's usual sidebar pieces, composed from the real parts in
 * SidebarParts over a mock project: the head's buttons, the Orchestrator card,
 * the lanes (Needs you, Working, Backlog, Shipped, Archived) and the status
 * line. The rail's page puts them beside the rail.
 */

export const noop = () => {}

const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]

/** The head's three buttons, right of whatever names the project. */
export function HeadButtons() {
  return (
    <>
      <IconButton label="Search or jump to" kbd={shortcut('K')} size="sm" icon={<IconSearch />} tooltipSide="bottom" />
      <CreateMenu onNewChat={noop} onDraft={noop} onOpenNote={noop} />
      <CollapseSidebarButton />
    </>
  )
}

export function ProjectOrchestrator({ project }: { project: MockProject }) {
  const waiting = statsOf(project).needsYou > 0 && project.name === 'runcastle'
  return (
    <OrchestratorCard
      status={waiting ? 'Waiting for you · 2 notes' : 'Plan, cut and ask'}
      state={waiting ? 'waiting' : 'idle'}
      active={false}
      onOpen={noop}
      actions={[]}
    />
  )
}

/** The project's features in the sidebar's lanes. */
export function Lanes({ features }: { features: FeatureListItem[] }) {
  const { inbox, lanes } = sidebarLanes(features)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const archived = features.filter((f) => f.status === 'archived')
  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={noop} actions={rowActions} nested={nested} />
  )
  const needs = [...inbox, ...pick('inProgress')]
  return (
    <div className="flex flex-col gap-5">
      {needs.length > 0 && (
        <section aria-label="Needs you" className="flex flex-col gap-1">
          {needs.map((f) => row(f))}
        </section>
      )}
      <WorkingShelf features={pick('agentWorking')} renderRow={row} />
      <div className="flex flex-col divide-y divide-border-subtle">
        <Shelf icon={<IconList />} label="Backlog" features={pick('drafts')} renderRow={(f) => row(f)} />
        <Shelf icon={<IconGitMerge />} label="Shipped" features={pick('shipped')} renderRow={(f) => row(f)} cap={5} />
        <Shelf icon={<IconArchive />} label="Archived" features={archived} renderRow={(f) => row(f)} />
      </div>
    </div>
  )
}

export function StatusLine() {
  const theme = useTheme()
  return (
    <div className="flex shrink-0 flex-col gap-2 pt-2">
      <SidebarStatusLine
        healthTone="success"
        healthTip="Server ok — live updates streaming"
        sandbox="docker"
        notify={{ state: 'on', title: '', onToggle: noop }}
        theme={theme.resolved}
        onToggleTheme={theme.toggle}
        onOpenSettings={noop}
      />
    </div>
  )
}

export const SCROLL =
  '-mx-2 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]'

/** The content panel, a plain stand-in: this feature does not change it. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PageTopbar
        crumbs={[{ label: 'Orchestrator', icon: <IconOrchestrator size={14} /> }]}
        actions={
          <>
            <IconButton size="md" label="More" icon={<IconMore />} />
            <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-text-tertiary">{children}</div>
    </section>
  )
}
