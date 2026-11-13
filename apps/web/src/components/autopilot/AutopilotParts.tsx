import type { ReactNode } from 'react'
import { Button, cx, Dialog, DialogBody, DialogFooter, DialogHeader, LINK } from '../../ui'
import { IconArrowRight, IconAutopilot } from '../../icons'
import { epicStyle, type EpicColor } from '../../lib/epic-look'
import { RAISED } from '../chat/thread/surfaces'

/**
 * Epics on autopilot (docs/features/epics-on-autopilot): the pieces every
 * autopilot surface shares — the "Autopilot" mark an epic's card head and a
 * locked feature's header wear, the lock note that stands in a locked chat's
 * message box (decisions 3, 8, 16), and the confirm "End autopilot" opens
 * (decision 20). Markup over resolved values: the caller says which epic, which
 * features it holds, and what the links do.
 */

/** The epic a locked feature belongs to, as the autopilot pieces name it. */
export interface AutopilotEpic {
  title: string
  color?: EpicColor | null | undefined
}

/**
 * The mark: the autopilot glyph and the word, in the epic's colour (`--epic-text`,
 * which an epic's card sets; the accent's text outside one). While the epic
 * works the glyph's orbit turns, slowly; it rests when the epic waits on you.
 */
export function AutopilotMark({
  working = false,
  word = true,
  size = 'xs',
  className,
}: {
  working?: boolean
  word?: boolean
  /** `xs` on a card head, `sm` in a page header. */
  size?: 'xs' | 'sm'
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 font-medium text-[var(--epic-text,var(--color-accent-text))]',
        size === 'sm' ? 'text-sm' : 'text-xs',
        working && '[&_[data-orbit]]:animate-[spin_6s_linear_infinite]',
        className,
      )}
      title={word ? undefined : 'On autopilot'}
    >
      <IconAutopilot size={size === 'sm' ? 13 : 12} />
      {word && <span>Autopilot</span>}
    </span>
  )
}

/**
 * A locked feature's header crumb label, in place of the owner crumb:
 * "<epic> · Autopilot". The name opens the epic's chat and gives way first;
 * the mark after it never does. The caller puts the epic's glyph before it.
 */
export function AutopilotTrail({ epic, working = false, onOpenEpic }: { epic: AutopilotEpic; working?: boolean; onOpenEpic: () => void }) {
  return (
    <span className="inline-flex min-w-0 items-center" style={epicStyle(epic.color)}>
      <button
        type="button"
        onClick={onOpenEpic}
        title={`Epic: ${epic.title}`}
        className="block max-w-44 min-w-0 cursor-pointer truncate rounded-md hover:text-text"
      >
        {epic.title}
      </button>
      <span aria-hidden="true" className="px-1 text-text-tertiary">
        ·
      </span>
      <AutopilotMark working={working} size="sm" />
    </span>
  )
}

/**
 * In place of a locked chat's message box (decisions 3, 8, 16): the epic runs
 * this feature, so the epic's chat is the one place to talk. It goes to the
 * epic, and "End autopilot" takes every locked feature back — the escape hatch
 * that works even when the epic's agent cannot take a turn.
 */
export function AutopilotLockNote({
  epic,
  working = false,
  onOpenEpic,
  onEndAutopilot,
}: {
  epic: AutopilotEpic
  /** The epic is at work: the glyph's orbit turns. */
  working?: boolean
  onOpenEpic: () => void
  onEndAutopilot: () => void
}) {
  return (
    <div
      role="note"
      aria-label={`On autopilot: ${epic.title}`}
      style={epicStyle(epic.color)}
      className={cx(
        RAISED,
        'relative isolate flex items-center gap-3 overflow-hidden py-3 pr-3 pl-3.5 text-sm',
        // The epic's colour, faint, from the glyph's side: the same light its card head wears.
        'bg-[linear-gradient(100deg,color-mix(in_oklab,var(--epic)_12%,var(--color-surface-raised)),var(--color-surface-raised)_70%)]',
        'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--epic)_32%,transparent),var(--shadow-popover)]',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--epic-text) ring-1 ring-inset',
          'bg-[color-mix(in_oklab,var(--epic)_18%,transparent)] ring-[color-mix(in_oklab,var(--epic)_40%,transparent)]',
          working && '[&_[data-orbit]]:animate-[spin_6s_linear_infinite]',
        )}
      >
        <IconAutopilot size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-text">
          <span className="font-medium">{epic.title}</span> runs this feature on autopilot
        </span>
        <span className="text-pretty text-text-tertiary">
          Talk to it in the epic’s chat; it passes your words on.{' '}
          <button type="button" onClick={onEndAutopilot} className={cx(LINK, 'border-0 bg-transparent p-0')}>
            End autopilot
          </button>
        </span>
      </span>
      <Button size="sm" icon={<IconArrowRight />} onClick={onOpenEpic} className="shrink-0">
        Open the epic
      </Button>
    </div>
  )
}

/** "3 features", "1 feature". */
export function featuresWord(n: number): string {
  return n === 1 ? '1 feature' : `${n} features`
}

/**
 * The confirm "End autopilot" opens (decision 20): it names the epic and what
 * it gives back. Ending stops nothing: the features' agents carry on, and
 * each asks the human again whatever it had open.
 */
export function EndAutopilotDialog({
  open,
  epic,
  features,
  busy = false,
  onEnd,
  onClose,
}: {
  open: boolean
  epic: string
  /** The locked features it gives back, by title. */
  features: readonly string[]
  busy?: boolean
  onEnd: () => void
  onClose: () => void
}) {
  const title = `End autopilot for “${epic}”?`
  return (
    <Dialog open={open} onClose={onClose} size="sm" label={title}>
      <DialogHeader
        title={title}
        description={`You get ${featuresWord(features.length)} back. Nothing stops: their agents carry on, and ask you again anything still open.`}
      />
      {features.length > 0 && (
        <DialogBody>
          <FeatureNames names={features} />
        </DialogBody>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Keep autopilot
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            onClose()
            onEnd()
          }}
        >
          End autopilot
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** The features named as a quiet list, one per line. */
function FeatureNames({ names }: { names: readonly string[] }): ReactNode {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-text-secondary">
      {names.map((n) => (
        <li key={n} className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-1 shrink-0 rounded-full bg-text-tertiary" />
          <span className="truncate">{n}</span>
        </li>
      ))}
    </ul>
  )
}
