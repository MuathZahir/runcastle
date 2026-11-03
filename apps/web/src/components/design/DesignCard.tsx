import type { CSSProperties } from 'react'
import { IconChevronRight, IconEye, IconPen } from '../../icons'
import { cx } from '../../ui'
import { StatusDot, type StatusTone } from '../../ui/status'
import {
  DESIGN_STATE_WORD,
  approvalProgress,
  designWidthLabel,
  orderDesigns,
  type DesignEntry,
  type DesignState,
} from '../../lib/feature-ui/designs'
import { NewMark, OlderMark } from '../chat/thread/PlanCard'
import { WELL } from '../chat/thread/surfaces'

/** A state's dot: waiting is the amber of "waiting on you" everywhere else. */
export const DESIGN_STATE_TONE: Record<DesignState, StatusTone> = {
  waiting: 'warning',
  approved: 'success',
  dropped: 'neutral',
}

/** A design's state as words beside a dot (DESIGN.md: shape before hue, facts are text). */
export function DesignStateLabel({ state }: { state: DesignState }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-secondary">
      <StatusDot tone={DESIGN_STATE_TONE[state]} />
      {DESIGN_STATE_WORD[state]}
    </span>
  )
}

/**
 * How far the human is through a feature's designs: one segment per design in
 * the list's order, filled as each is approved, and the count in words beside
 * it. The words carry the fact; the segments only confirm it.
 */
export function ApprovalMeter({ designs, className }: { designs: readonly DesignEntry[]; className?: string }) {
  const { approved, total, done } = approvalProgress(designs)
  return (
    <span className={cx('flex min-w-0 items-center gap-3', className)}>
      <span className="flex h-1.5 min-w-0 flex-1 gap-0.5" aria-hidden>
        {/* Approved first, so the bar fills from the left as the human goes. */}
        {orderDesigns(designs)
          .filter((d) => d.state !== 'dropped')
          .sort((a, b) => Number(b.state === 'approved') - Number(a.state === 'approved'))
          .map((d) => (
            <span
              key={d.id}
              className={cx(
                'h-full min-w-1.5 flex-1 rounded-full transition-colors duration-(--dur-3)',
                d.state === 'approved' ? 'bg-success' : 'bg-fill-well',
              )}
            />
          ))}
      </span>
      <span className={cx('shrink-0 text-xs tabular-nums', done ? 'text-text-secondary' : 'text-text-tertiary')}>
        {done ? `All ${total} approved` : `${approved} of ${total} approved`}
      </span>
    </span>
  )
}

/** A design's picture, or the pen on an inset ground when the agent passed none. */
export function DesignPicture({ design, className }: { design: Pick<DesignEntry, 'picture' | 'title'>; className?: string }) {
  return design.picture ? (
    <img
      src={design.picture}
      alt={design.title}
      className={cx('block aspect-[16/10] w-full bg-surface-inset object-cover object-top', className)}
    />
  ) : (
    <span className={cx('grid aspect-[16/10] w-full place-items-center bg-surface-inset text-icon', className)}>
      <IconPen size={18} />
    </span>
  )
}

/**
 * A design's picture in its frame: a hairline that brightens on hover and an
 * "Open" veil that fades in over it, so the picture itself reads as the door.
 */
function FramedPicture({ design }: { design: DesignEntry }) {
  return (
    <span className="relative block overflow-hidden rounded-md ring-1 ring-border-subtle transition-shadow duration-(--dur-1) group-hover/card:ring-border-strong">
      <DesignPicture design={design} />
      <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,black_40%,transparent)] opacity-0 transition-opacity duration-(--dur-2) group-hover/card:opacity-100">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white">
          <IconEye size={14} />
          Open
        </span>
      </span>
    </span>
  )
}

/**
 * One design, as an attachment in a chat (decisions 1, 4, 19): its picture,
 * title, width and where it stands with the human. Anywhere on it opens that
 * design in the Design tab. With no picture and alone it is one row, like a
 * file card; as a tile beside others it keeps the picture's shape.
 */
export function DesignCard({
  design,
  older,
  tile,
  index,
  onOpen,
}: {
  design: DesignEntry
  older?: boolean
  /** Drawn as a tile beside others: always the picture's shape, a placeholder when there is none. */
  tile?: boolean
  /** Its place among its siblings, for the staggered rise (DESIGN.md: first ≤8 by 20ms). */
  index?: number
  onOpen: () => void
}) {
  const mark = older ? <OlderMark /> : design.isNew ? <NewMark /> : null
  const rise = index !== undefined && index < 8 ? { '--i': index } : undefined
  if (!design.picture && !tile) {
    return (
      <button
        type="button"
        aria-label={`Open the design ${design.title}`}
        onClick={onOpen}
        className={cx(
          WELL,
          'group/card flex w-full max-w-[520px] min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-(--dur-1) hover:bg-surface-hover animate-rise-in',
        )}
      >
        <IconPen size={16} className="shrink-0 text-accent" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-text">{design.title}</span>
          <span className="truncate text-xs text-text-tertiary">Design · {designWidthLabel(design.width)}</span>
        </span>
        {mark}
        <DesignStateLabel state={design.state} />
        <IconChevronRight size={14} className="shrink-0 text-icon" />
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-label={`Open the design ${design.title}`}
      onClick={onOpen}
      style={rise as CSSProperties | undefined}
      className={cx(
        WELL,
        'group/card flex w-full max-w-[520px] min-w-0 cursor-pointer flex-col gap-2 p-2 text-left transition-colors duration-(--dur-1) hover:bg-surface-hover animate-rise-in [animation-delay:calc(var(--i,0)*20ms)]',
      )}
    >
      <FramedPicture design={design} />
      <span className="flex min-w-0 flex-col gap-0.5 px-1 pb-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{design.title}</span>
          {mark}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary">
          <span className="truncate">{designWidthLabel(design.width)}</span>
          <span aria-hidden>·</span>
          <StatusDot tone={DESIGN_STATE_TONE[design.state]} />
          <span className="shrink-0 text-text-secondary">{DESIGN_STATE_WORD[design.state]}</span>
        </span>
      </span>
    </button>
  )
}

/**
 * Designs shown one after another in a turn, side by side: two to a row under
 * one line saying how far the human is through them, so a planning run that
 * designed four screens leaves one block, not a tall stack. A lone design is a
 * full-width card.
 */
export function DesignCards({
  designs,
  older,
  onOpen,
  onOpenList,
}: {
  designs: readonly DesignEntry[]
  /** The ids of designs a newer card in the chat has replaced. */
  older?: ReadonlySet<string>
  onOpen: (id: string) => void
  /** Opens the Design tab's list. */
  onOpenList?: () => void
}) {
  if (designs.length === 1) {
    const only = designs[0]!
    return <DesignCard design={only} older={older?.has(only.id)} onOpen={() => onOpen(only.id)} />
  }
  return (
    <div className="flex w-full max-w-[520px] flex-col gap-2">
      <div className="flex min-w-0 items-center gap-3 px-0.5">
        <span className="shrink-0 text-xs font-medium text-text-secondary">{designs.length} designs</span>
        <ApprovalMeter designs={designs} className="flex-1" />
        {onOpenList && (
          <button
            type="button"
            onClick={onOpenList}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 text-xs text-text-tertiary transition-colors duration-(--dur-1) hover:text-text"
          >
            Design tab
            <IconChevronRight size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {designs.map((design, i) => (
          <DesignCard key={design.id} design={design} older={older?.has(design.id)} tile index={i} onOpen={() => onOpen(design.id)} />
        ))}
      </div>
    </div>
  )
}
