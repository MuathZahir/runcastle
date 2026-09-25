import type { ReactNode } from 'react'
import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { PipelineStep } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { MetaLine, PageHeader, cx, type MetaItem } from '../../ui'
import { IconBranch } from '../../icons'
import { copyText } from './copy-text'
import { PipelineStepper } from './PipelineStepper'

/**
 * The top of the feature page (DESIGN.md §Page anatomy): the title once
 * (22/28), one meta line — the branch (a click copies it), then 2–3 facts —
 * the pipeline stepper, and the next-step row passed as `children`.
 *
 * Everything here fits the column it is handed: the title wraps (it is the
 * page's one heading, and the topbar crumb already carries the truncated
 * copy), the branch ellipsizes rather than widening the page, and the stepper
 * wraps onto a second line in a narrow column.
 */
export function FeatureHeader({
  feature,
  isDraft,
  steps,
  onViewPhase,
  readonly = false,
  facts = [],
  className,
  children,
}: {
  feature: FeatureFull['feature']
  isDraft: boolean
  steps: PipelineStep[]
  onViewPhase: (phase: Phase | null) => void
  /** An earlier phase is pinned (the stepper marks the one being viewed). */
  readonly?: boolean
  /** The facts after the branch: age, ticket count, lap. */
  facts?: Array<MetaItem | false | null | undefined>
  className?: string
  /** The next-step row (or, pinned, the way back). */
  children?: ReactNode
}) {
  const toast = useToast()

  const meta = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
      {/* A draft has no branch yet — it picks its base at Start (decision 3). */}
      {!isDraft && feature.branch && (
        <button
          type="button"
          className={cx(
            'inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm bg-transparent p-0',
            'font-mono text-xs text-text-tertiary transition-colors duration-(--dur-1) ease-app hover:text-text',
          )}
          title="Copy branch name"
          onClick={() => copyText(feature.branch, toast)}
        >
          <IconBranch size={14} className="shrink-0 text-icon" />
          <span className="truncate">{feature.branch}</span>
        </button>
      )}
      <MetaLine items={facts} />
    </div>
  )

  return (
    <PageHeader title={feature.title} meta={meta} className={className}>
      {(!isDraft || children) && (
      <div className="flex flex-col gap-5">
        {/* A draft has no meaningful pipeline position (decision 9): it is
            created at `ideation` like everything else, and a stepper lit at
            that first step would claim work has begun on a feature with no
            branch. The meta line says "Draft" instead. */}
        {!isDraft && (
          <PipelineStepper
            steps={steps}
            readonly={readonly}
            onView={(p) => onViewPhase(p === feature.phase ? null : p)}
          />
        )}
        {children}
      </div>
      )}
    </PageHeader>
  )
}
