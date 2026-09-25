import type { KeyboardEvent, ReactNode } from 'react'
import { IconArrowLeft } from '../../icons'
import { Button, cx } from '../../ui'

/**
 * The chrome every first-contact screen shares (decision 1): the frame the
 * wizard and the open-a-project screen sit in, the heading at the top of a
 * step, and the footer with Back on the left and the step's one primary on the
 * right.
 *
 * They live here rather than in each step so the steps and the open-a-project
 * screen they end on share one rhythm; a step that set its own margins is how
 * the loose spacing this redesign fixes got there.
 */

/**
 * The calm centred column a first-contact screen sits in, inside the content
 * panel the app shell draws around it (DESIGN.md §Frame) — the step `rail` on
 * its left when there is one. `stepKey` re-keys the content so each step enters on its own: sliding in
 * from the right going forward, rising in place going back.
 */
export function SetupFrame({
  rail,
  stepKey,
  direction = 'forward',
  onKeyDown,
  children,
}: {
  rail?: ReactNode
  stepKey?: string
  direction?: 'forward' | 'back'
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full" onKeyDown={onKeyDown}>
      <div
        className={cx(
          'm-auto grid w-full gap-12 px-8 py-12',
          rail ? 'max-w-[860px] grid-cols-[176px_minmax(0,1fr)]' : 'max-w-[560px]',
        )}
      >
        {rail && <div className="pt-1">{rail}</div>}
        <div
          key={stepKey}
          className={cx(
            'min-w-0',
            direction === 'forward' ? 'animate-slide-in-right' : 'animate-rise-in',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The top of a step: its title (22/28, once) and the one-line lead beneath it.
 * No kicker — the rail beside it says where in setup you are.
 */
export function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header>
      <h1 className="m-0 text-xl font-semibold tracking-tight text-pretty text-text">{title}</h1>
      <p className="mt-2 mb-0 text-base text-pretty text-text-secondary">{children}</p>
    </header>
  )
}

/**
 * The footer. `onBack` is omitted on the intro, which is the one screen with
 * nothing behind it; everywhere else Back sits at the left and the step's own
 * actions — one primary, last — are pushed to the right. `note` is a caption
 * under the actions: why the primary is disabled.
 */
export function StepActions({
  onBack,
  note,
  children,
}: {
  onBack?: () => void
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <footer className="mt-10 border-t border-border-subtle pt-5">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" icon={<IconArrowLeft />} onClick={onBack}>
            Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
      {note && <p className="mt-2 mb-0 text-right text-xs text-text-tertiary">{note}</p>}
    </footer>
  )
}
