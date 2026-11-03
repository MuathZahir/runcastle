import type { CSSProperties } from 'react'
import { IconArrowLeft, IconCheck, IconChevronLeft, IconChevronRight, IconPen } from '../../icons'
import { Button, EmptyState, IconButton, cx } from '../../ui'
import { SectionLabel } from '../../ui/list'
import { relTimeAgo } from '../../lib/format'
import {
  DESIGN_STATE_WORD,
  approvalProgress,
  designWidthLabel,
  orderDesigns,
  type DesignEntry,
  type DesignState,
} from '../../lib/feature-ui/designs'
import { NewMark } from '../chat/thread/PlanCard'
import { ApprovalMeter, DesignPicture, DesignStateLabel } from './DesignCard'

/** The list's groups, in order (decision 6): what waits for the human leads. */
const GROUPS: readonly DesignState[] = ['waiting', 'approved', 'dropped']

/** One design in the list: its picture, title, width and age. */
function DesignRow({ design, now, index, onOpen }: { design: DesignEntry; now: number; index: number; onOpen: () => void }) {
  return (
    <div
      style={(index < 8 ? { '--i': index } : undefined) as CSSProperties | undefined}
      className="group/row relative flex min-w-0 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-(--dur-1) hover:bg-surface-hover animate-rise-in [animation-delay:calc(var(--i,0)*20ms)]"
    >
      {/* The whole row opens the design. Approve lives only on the open design (decision 8): nothing is approved unseen. */}
      <button type="button" aria-label={`Open the design ${design.title}`} onClick={onOpen} className="absolute inset-0 cursor-pointer rounded-md" />
      <span
        className={cx(
          'pointer-events-none w-28 shrink-0 overflow-hidden rounded-md ring-1 ring-border-subtle transition-shadow duration-(--dur-1) group-hover/row:ring-border-strong',
          design.state === 'dropped' && 'opacity-50',
        )}
      >
        <DesignPicture design={design} />
      </span>
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cx('min-w-0 truncate text-sm font-medium', design.state === 'dropped' ? 'text-text-tertiary' : 'text-text')}>
            {design.title}
          </span>
          {design.isNew && <NewMark />}
        </span>
        <span className="truncate text-xs text-text-tertiary">
          {designWidthLabel(design.width)} · shown {relTimeAgo(design.shownAt, now)}
        </span>
      </span>
      {/* Its state is the group's heading, said once (DESIGN.md principle 5). */}
      <IconChevronRight
        size={14}
        className="pointer-events-none shrink-0 text-icon transition-transform duration-(--dur-1) group-hover/row:translate-x-0.5"
      />
    </div>
  )
}

/**
 * The Design tab's home (decisions 6, 7, 8, 12, 25): every design the
 * feature's agent recorded, those waiting for the human first, under one line
 * saying how far through them the human is. A row opens its design live, where
 * it can be approved; the list itself approves nothing. Once every design is
 * approved the head says so, and that the agent was told. With none recorded
 * the tab says so, and still reaches a design server from before the record.
 */
export function DesignList({
  designs,
  now = Date.now(),
  onOpen,
  onOpenServer,
}: {
  designs: readonly DesignEntry[]
  now?: number
  onOpen: (id: string) => void
  /** The feature has a recorded design-server command but no recorded designs (decision 7). */
  onOpenServer?: () => void
}) {
  if (designs.length === 0) {
    return (
      <EmptyState
        className="py-16"
        icon={<IconPen />}
        title="No designs yet"
        hint={
          onOpenServer
            ? 'The agent’s designs appear here as it shows them. This feature’s design server is from before the list, so its pages are not listed.'
            : 'The agent’s designs appear here as it shows them in the chat.'
        }
        action={
          onOpenServer && (
            <Button icon={<IconPen />} onClick={onOpenServer}>
              Open the design server
            </Button>
          )
        }
      />
    )
  }
  const ordered = orderDesigns(designs)
  const { done, total } = approvalProgress(designs)
  return (
    <div className="flex flex-col gap-5 px-3 py-4">
      <div className="flex flex-col gap-2 px-2">
        {done ? (
          <p className="m-0 flex items-center gap-2 text-sm text-text animate-rise-in">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-surface">
              <IconCheck size={12} />
            </span>
            {total === 1 ? 'The design is approved.' : `All ${total} designs approved.`}
            <span className="text-text-tertiary">The agent was told.</span>
          </p>
        ) : (
          <p className="m-0 text-sm text-text-secondary">Open a design to look at it live and approve it.</p>
        )}
        {!done && <ApprovalMeter designs={designs} />}
      </div>
      {GROUPS.map((state) => {
        const group = ordered.filter((d) => d.state === state)
        if (group.length === 0) return null
        return (
          <section key={state} aria-label={DESIGN_STATE_WORD[state]} className="flex flex-col">
            <SectionLabel count={group.length} className="px-2">
              {DESIGN_STATE_WORD[state]}
            </SectionLabel>
            {group.map((design) => (
              <DesignRow key={design.id} design={design} now={now} index={ordered.indexOf(design)} onOpen={() => onOpen(design.id)} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

/**
 * The bar over an open design (decisions 6, 8, 24): the way back to the list,
 * which design this is, the step to its neighbours, and Approve while it
 * waits. Approve says where it goes next: "Approve & next" while other designs
 * wait, plain "Approve" on the last one, after which the view returns to the
 * list. The live page with its own toolbar sits under it.
 */
export function DesignBar({
  design,
  index,
  count,
  othersWaiting,
  onBack,
  onStep,
  onApprove,
}: {
  design: DesignEntry
  /** Its place in the list's order, from 0. */
  index: number
  count: number
  /** How many other designs still wait: Approve moves on to the next of them. */
  othersWaiting: number
  onBack: () => void
  onStep: (to: number) => void
  onApprove: () => void
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-2">
      <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBack}>
        All designs
      </Button>
      <span className="h-4 w-px shrink-0 bg-border-subtle" />
      <span key={design.id} className="flex min-w-0 items-baseline gap-2 animate-fade-in">
        <span className="min-w-0 truncate text-sm font-medium text-text">{design.title}</span>
        <span className="hidden shrink-0 text-xs text-text-tertiary @min-[560px]/panel:inline">{designWidthLabel(design.width)}</span>
      </span>
      <span className="flex-1" />
      <span className="flex shrink-0 items-center">
        <IconButton size="sm" label="Previous design" icon={<IconChevronLeft />} disabled={index <= 0} onClick={() => onStep(index - 1)} />
        <span className="px-1 text-xs text-text-tertiary tabular-nums">
          {index + 1} of {count}
        </span>
        <IconButton size="sm" label="Next design" icon={<IconChevronRight />} disabled={index >= count - 1} onClick={() => onStep(index + 1)} />
      </span>
      {design.state === 'waiting' ? (
        <Button
          size="sm"
          variant="primary"
          icon={<IconCheck />}
          onClick={onApprove}
          {...(othersWaiting > 0 ? { title: `${othersWaiting} more waiting` } : {})}
        >
          {othersWaiting > 0 ? 'Approve & next' : 'Approve'}
        </Button>
      ) : (
        <DesignStateLabel state={design.state} />
      )}
    </div>
  )
}
