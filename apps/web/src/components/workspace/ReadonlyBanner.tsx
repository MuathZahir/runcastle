import type { Phase } from '@runcastle/core'
import { PHASE_NAME, IconArrowLeft } from '../../icons'
import { Button } from '../../ui'

/**
 * What the next-step row becomes while an earlier phase is pinned (decision
 * 10). The stepper already marks the step being viewed, so this is no badge and
 * no band: one quiet line saying what that phase produced, and the one way
 * back as a ghost button.
 */
export function ReadonlyBanner({
  phase,
  livePhase,
  facts,
  onBack,
}: {
  phase: Phase
  livePhase: Phase
  /** The phase's one-line record (`2d · 3 sessions · 12 decisions`), if derivable. */
  facts: string | null
  onBack: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 animate-fade-in" role="status">
      <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-text-secondary">
        <span className="font-medium text-text">Viewing {PHASE_NAME[phase].toLowerCase()}</span>
        {facts ? <span className="text-text-tertiary"> — {facts}</span> : null}
      </p>
      <Button variant="ghost" icon={<IconArrowLeft />} onClick={onBack}>
        Back to {PHASE_NAME[livePhase].toLowerCase()}
      </Button>
    </div>
  )
}
