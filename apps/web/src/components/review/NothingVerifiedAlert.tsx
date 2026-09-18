import { Button, SectionTitle } from '../../ui'
import type { UnverifiedLap } from '../../lib/feature-ui'

/**
 * "Nothing verified this lap" — the page's top line when the current lap's
 * review pass ran and verified nothing (decision 5).
 *
 * This is the whole point of the feature: a pass that could not attach a
 * browser used to land as a clean bill of health, and the human planned the
 * next lap off an empty defects list. So it arrives loudly — an alert band,
 * above the stage, before anything else on the page — and blocks nothing:
 * auto-advance already happened, the findings are stored, and Merge is still
 * one click away in the bar. What it changes is which click is the obvious one.
 *
 * The words are runcastle's own: the templated line the harvester composed into
 * the pass's digest, and the reason the pass declared. The agent's prose is in
 * the Full account, where a report that verified nothing belongs.
 *
 * The action slot favours Agentic review (decision 5) — the one thing that
 * turns "nothing verified" into evidence — and says why it cannot fire when a
 * burn is already holding the feature, exactly as the strip's control does.
 */
export function NothingVerifiedAlert({
  lap,
  outcome,
  agenticReview,
}: {
  lap: number
  outcome: UnverifiedLap
  /** Mint another review pass, or null where nothing on the page acts. */
  agenticReview: { onStart: () => void; blocked?: string } | null
}) {
  return (
    <div className="rounded-lg border border-warn/45 bg-panel p-4" role="alert">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Nothing verified this lap</SectionTitle>
        <span className="font-mono text-xs text-text-3">lap {lap}</span>
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-2">
        The review pass ran and produced no evidence, so nothing on this branch has been checked
        this lap. Nothing is blocked — run another review, or drive it yourself, before you ship.
      </p>
      {outcome.line && (
        <p className="mt-3 mb-0 font-mono text-xs break-words text-warn">{outcome.line}</p>
      )}
      {outcome.reason && (
        <p className="mt-2 mb-0 font-mono text-xs break-words text-text-3">{outcome.reason}</p>
      )}
      {agenticReview && (
        <div className="mt-4">
          <Button
            variant="solid"
            disabled={!!agenticReview.blocked}
            {...(agenticReview.blocked ? { title: agenticReview.blocked } : {})}
            onClick={agenticReview.onStart}
          >
            Agentic review
          </Button>
        </div>
      )}
    </div>
  )
}
