import type { ReactNode } from 'react'
import type { FeatureFull } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { MetaLine, PageHeader, cx, type MetaItem } from '../../ui'
import { IconBranch } from '../../icons'
import { copyText } from './copy-text'

/**
 * The top of the feature page (`the-feature-lead-runs-rounds` decision 24):
 * the title once (22/28), one meta line — the branch (a click copies
 * it), then the age — and the status line's action row passed as `children`.
 * Nothing else: the status line says where the feature is, so there is no
 * phase stepper.
 *
 * Everything here fits the column it is handed: the title wraps (it is the
 * page's one heading, and the topbar crumb already carries the truncated
 * copy), and the branch ellipsizes rather than widening the page.
 */
export function FeatureHeader({
  feature,
  isDraft,
  facts = [],
  className,
  children,
}: {
  feature: FeatureFull['feature']
  isDraft: boolean
  /** The facts after the branch: when it started (or was parked, or merged). */
  facts?: Array<MetaItem | false | null | undefined>
  className?: string
  /** The status line's action row (or, pinned, the way back). */
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
    <PageHeader
      title={feature.title}
      meta={meta}
      className={className}
    >
      {children && <div className="flex flex-col gap-5">{children}</div>}
    </PageHeader>
  )
}
