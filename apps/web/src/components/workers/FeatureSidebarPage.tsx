import type { FeatureListItem } from '../../lib/api'
import type { ThreadEntry } from '../../lib/chat-thread'
import { workerGroups } from '../../lib/workers'
import type { WorkerEntry } from '../../lib/workers'
import { IconCheck, IconChevronLeft, IconMessage, IconPlus } from '../../icons'
import { IconButton, cx } from '../../ui'
import type { FeatureAction } from '../FeatureActionsMenu'
import { FeatureProgressIcon, ItemShelf, ItemWorkingShelf, OrchestratorCard, SidebarWorkerItem } from '../SidebarParts'

/**
 * The drill-in sidebar (interactive-workers, the placement the human picked):
 * opening a feature swaps the left sidebar to the feature's own page, one level
 * down, built exactly as the features list is one level up:
 *
 * - the feature's header — back, its progress glyph and title, "+" (New
 *   worker) — where the project's head sits above the list;
 * - the **Lead** card, the Orchestrator card's shape: the lead is to its
 *   workers what the Orchestrator is to the features;
 * - the workers that need the human as plain rows at the top, the **Working**
 *   shelf with its lit bay, then **Done** folded like Shipped.
 *
 * Every row is a feature row (`SidebarWorkerItem`), at the list's paddings,
 * heights and gaps, so going down a level feels like the same sidebar. No
 * right-hand rail: the panel stays the page's one right column.
 */

/**
 * The feature's header: back and the feature's progress glyph and title on
 * one 40px row — the head row's height and its icon buttons — with "+" (New
 * worker) at its end. The title is the page's heading.
 */
export function FeatureSidebarHeader({
  feature,
  onBack,
  onNewWorker,
}: {
  feature: FeatureListItem
  onBack: () => void
  onNewWorker: () => void
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-0.5">
      <IconButton size="sm" label="Back to the features" icon={<IconChevronLeft />} onClick={onBack} tooltipSide="bottom" />
      <h2 title={feature.title} className="m-0 flex min-w-0 flex-1 items-center gap-2 pl-1 text-md font-semibold tracking-tight text-text">
        <FeatureProgressIcon f={feature} size={14} label="" />
        <span className="min-w-0 truncate">{feature.title}</span>
      </h2>
      <IconButton size="sm" label="New worker" icon={<IconPlus />} onClick={onNewWorker} tooltipSide="bottom" />
    </header>
  )
}

/** The feature's sidebar page: its header, the Lead card, then its workers in the features list's lanes. */
export function FeatureSidebarPage({
  feature,
  leadStatus,
  onBack,
  onNewWorker,
  lead,
  workers,
  current,
  onOpen,
  leadActions,
  actionsFor,
  defaultDoneOpen = false,
  className,
}: {
  feature: FeatureListItem
  /** The Lead card's second line: the feature's status as the lead holds it ("Talking with you"). */
  leadStatus: string
  onBack: () => void
  onNewWorker: () => void
  lead: ThreadEntry
  workers: readonly WorkerEntry[]
  /** The thread or worker in front. */
  current: string | null
  onOpen: (id: string) => void
  leadActions: FeatureAction[]
  actionsFor: (w: WorkerEntry) => FeatureAction[]
  defaultDoneOpen?: boolean
  /** Placement only. */
  className?: string
}) {
  const { needsYou, working, done } = workerGroups(workers)
  const row = (w: WorkerEntry, nested = false) => (
    <SidebarWorkerItem key={w.id} worker={w} active={w.id === current} onSelect={onOpen} actions={actionsFor(w)} nested={nested} />
  )
  return (
    <section aria-label={feature.title} className={cx('flex min-h-0 flex-1 flex-col', className)}>
      <FeatureSidebarHeader feature={feature} onBack={onBack} onNewWorker={onNewWorker} />
      <div className="mt-2">
        <OrchestratorCard
          name="Lead"
          tile={<IconMessage size={18} />}
          status={leadStatus}
          state={lead.state}
          active={lead.id === current}
          onOpen={() => onOpen(lead.id)}
          actions={leadActions}
          title={lead.title}
        />
      </div>
      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        {needsYou.length > 0 && (
          <section aria-label="Needs you" className="flex flex-col gap-1">
            {needsYou.map((w) => row(w))}
          </section>
        )}
        <ItemWorkingShelf features={working} renderRow={row} />
        {done.length > 0 && (
          <div className="flex flex-col divide-y divide-border-subtle">
            <ItemShelf icon={<IconCheck />} label="Done" features={done} renderRow={(w) => row(w)} defaultOpen={defaultDoneOpen} />
          </div>
        )}
      </div>
    </section>
  )
}
