import { IconChevronRight, IconDoc } from '../../../icons'
import { cx } from '../../../ui'
import { StatusDot } from '../../../ui/status'
import type { PlanCounts } from '../../../lib/feature-ui/designs'
import { WELL } from './surfaces'

/** The mark a card or a row wears until the human has opened what it shows (decision 11). */
export function NewMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-text">
      <StatusDot tone="accent" />
      New
    </span>
  )
}

/** The words an older card carries in place of New (decision 19). */
export function OlderMark() {
  return <span className="shrink-0 text-xs text-text-tertiary">Older version</span>
}

/** One figure on the plan card: a number over what it counts. */
function Figure({ value, label, tone }: { value: string; label: string; tone?: 'accent' }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 first:pl-0">
      <span className={cx('text-lg leading-6 font-medium tabular-nums', tone === 'accent' ? 'text-accent-text' : 'text-text')}>{value}</span>
      <span className="truncate text-xs text-text-tertiary">{label}</span>
    </span>
  )
}

/**
 * The plan, as one attachment in a chat (decisions 2, 5): what the feature is
 * in a line, and how big a read the plan is, as a row of figures read at a
 * glance — "to check first" in the accent, since that is where a returning
 * human starts. Anywhere on it opens the Plan tab. In the Review Package's
 * family: the same well, the same width, one click.
 */
export function PlanCard({
  oneLiner,
  counts,
  isNew,
  older,
  onOpen,
}: {
  /** The plan's "what this is", in a line. */
  oneLiner: string
  counts: PlanCounts
  /** The human has not opened the plan since it was last shown. */
  isNew: boolean
  /** A newer plan card follows this one in the chat; this one still opens the current plan. */
  older?: boolean
  onOpen: () => void
}) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  return (
    <button
      type="button"
      aria-label="Open the plan"
      onClick={onOpen}
      className={cx(
        WELL,
        'group/card flex w-full max-w-[520px] min-w-0 cursor-pointer flex-col gap-3 p-3.5 text-left transition-colors duration-(--dur-1) hover:bg-surface-hover animate-rise-in',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-text">
          <IconDoc size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-md font-medium text-text">Plan</span>
        {older ? <OlderMark /> : isNew && <NewMark />}
        <IconChevronRight size={14} className="shrink-0 text-icon transition-transform duration-(--dur-1) group-hover/card:translate-x-0.5" />
      </span>
      <span className="text-sm text-pretty text-text-secondary">{oneLiner}</span>
      <span className="flex min-w-0 divide-x divide-border-subtle border-t border-border-subtle pt-3">
        <Figure value={String(counts.decisions)} label={plural(counts.decisions, 'decision', 'decisions')} />
        {counts.checkFirst > 0 && <Figure value={String(counts.checkFirst)} label="to check first" tone="accent" />}
        {counts.tickets === null ? (
          <Figure value="—" label="built by the agent" />
        ) : (
          <Figure value={String(counts.tickets)} label={plural(counts.tickets, 'ticket', 'tickets')} />
        )}
        {counts.designs > 0 && <Figure value={String(counts.designs)} label={plural(counts.designs, 'design', 'designs')} />}
      </span>
    </button>
  )
}
