import type { Phase } from '@runcastle/core'
import { PHASE_LABELS } from '../../lib/feature-ui'

/**
 * What the next-step bar is replaced by while an earlier phase is pinned
 * (decision 10). A pinned phase is a frozen record, so the banner does not
 * describe what to do — it names the phase, states in one line what that phase
 * produced, and offers the one way back.
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
    <div className="flex min-h-14 flex-wrap items-center gap-3 border-b border-hairline bg-panel-2 px-6 py-3">
      <span className="rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] tracking-wider text-text-3 uppercase">
        READ-ONLY
      </span>
      <span className="font-semibold text-text capitalize">{PHASE_LABELS[phase]}</span>
      {facts && <span className="min-w-0 truncate text-sm text-text-3">· {facts}</span>}
      <button
        type="button"
        className="ml-auto bg-transparent p-0 text-sm text-accent-hi hover:text-accent-2"
        onClick={onBack}
      >
        Back to {PHASE_LABELS[livePhase]} →
      </button>
    </div>
  )
}
