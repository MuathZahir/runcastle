import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { PipelineStep } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { PhaseTag } from '../../ui'
import { IconBranch } from '../../icons'
import { copyText } from './copy-text'
import { PipelineStepper } from './PipelineStepper'

/**
 * The feature view's header: what this feature is, where it is in the pipeline,
 * and the branch it lives on.
 *
 * Every part of it is written to FIT the column it is handed. A feature title
 * and a branch name are both arbitrarily long, and the row that let them size
 * themselves pushed the branch chip past the right edge of the workspace — where
 * `body { overflow: hidden }` clips it away with no scrollbar to find it again.
 * So the title takes the leftover room and ellipsizes into it (`flex-1` +
 * `truncate`, which is also what makes the phase tag and the chip stop being
 * squeezed), and the chip ellipsizes rather than escaping if even that is not
 * enough. The `ws-title-spacer` the row used to carry is gone with it: a title
 * that claims the middle already pushes the chip to the right edge.
 */
export function FeatureHeader({
  feature,
  isDraft,
  steps,
  onViewPhase,
}: {
  feature: FeatureFull['feature']
  isDraft: boolean
  steps: PipelineStep[]
  onViewPhase: (phase: Phase | null) => void
}) {
  const toast = useToast()

  return (
    <div className="ws-head">
      <div className="ws-title-row min-w-0">
        {/* Same reason the stepper is hidden below: a draft's phase is
            `ideation` by construction, and naming it here reads as progress. */}
        {isDraft ? (
          <span className="shrink-0 font-mono text-sm font-semibold lowercase text-text-4">
            draft
          </span>
        ) : (
          <PhaseTag phase={feature.phase} />
        )}
        <span className="ws-title min-w-0 flex-1 truncate" title={feature.title}>
          {feature.title}
        </span>
        <button
          className="inline-flex min-w-0 items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-xs text-text-3 transition-colors duration-(--dur-1) hover:text-text"
          title="Copy branch name"
          onClick={() => copyText(feature.branch, toast)}
        >
          <IconBranch size={11} className="shrink-0" />
          <span className="truncate">{feature.branch}</span>
        </button>
      </div>
      {/* A draft has no meaningful pipeline position (decision 9): it is
          created at `ideation` like everything else, and a stepper lit at that
          first step would claim work has begun on a feature with no branch. */}
      {!isDraft && (
        <PipelineStepper
          steps={steps}
          lap={feature.lap}
          onView={(p) => onViewPhase(p === feature.phase ? null : p)}
        />
      )}
    </div>
  )
}
