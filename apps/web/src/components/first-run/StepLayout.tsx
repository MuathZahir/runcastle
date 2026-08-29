import type { ReactNode } from 'react'
import { Button } from '../../ui'

/**
 * The two pieces of chrome every wizard step repeats (decision 1): the type
 * hierarchy at the top — kicker → heading → one-line lead — and the actions row
 * at the bottom, with Back on the left and the step's own continue on the right.
 *
 * They live here rather than in each step so the four steps and the
 * open-a-project screen they end on share one rhythm; a step that set its own
 * margins is how the loose spacing this redesign fixes got there.
 */

/** Kicker, heading, and the one-line lead beneath them. */
export function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="text-xs font-semibold tracking-[0.09em] text-accent-hi uppercase">
        Welcome to runcastle
      </div>
      <h1 className="mt-2 text-xl font-semibold text-text">{title}</h1>
      <p className="mt-2 text-base text-text-2">{children}</p>
    </>
  )
}

/**
 * The actions row. `onBack` is omitted on the intro, which is the one screen
 * with nothing behind it; everywhere else Back sits at the left and the step's
 * own actions are pushed to the right.
 */
export function StepActions({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="mt-7 flex items-center gap-2">
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}
