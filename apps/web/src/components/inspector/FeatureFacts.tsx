import type { BlockRef, DependencyRef } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import { dependencyState } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { IconBranch } from '../../icons'
import { PropertyList, cx, type PropertyItem, type StatusTone } from '../../ui'
import { copyText } from '../workspace/copy-text'

function stateTone(d: DependencyRef): StatusTone {
  if (d.satisfied) return 'success'
  return d.status === 'archived' || d.status === 'draft' ? 'neutral' : 'accent'
}

/**
 * The feature's facts at the top of Details (the-feature-s-right-panel
 * decision 9): what the views' old page header carried and the page's header
 * row does not. The branch (a click copies it), when it started or merged,
 * and the features on either side of it, each with its state.
 */
export function FeatureFacts({
  feature,
  when,
  dependsOn,
  blocks,
}: {
  feature: FeatureFull['feature']
  /** "Started 1d ago", "Merged 3h ago". */
  when: { label: string; value: string }
  dependsOn: DependencyRef[]
  blocks: BlockRef[]
}) {
  const toast = useToast()
  const items: PropertyItem[] = [
    {
      label: 'Branch',
      leading: <IconBranch />,
      value: (
        <button
          type="button"
          title="Copy branch name"
          onClick={() => copyText(feature.branch, toast)}
          className={cx(
            'max-w-full cursor-pointer truncate rounded-sm font-mono text-xs text-text-secondary',
            'transition-colors duration-(--dur-1) ease-app hover:text-text',
          )}
        >
          {feature.branch}
        </button>
      ),
    },
    { label: when.label, value: when.value },
    ...dependsOn.map((d, i) => ({
      label: i === 0 ? 'Waits on' : '',
      tone: stateTone(d),
      value: d.title,
      sub: dependencyState(d),
    })),
    ...blocks.map((b, i) => ({
      label: i === 0 ? 'Waited on by' : '',
      value: b.title,
      sub: b.upNext ? 'starts when this ships' : 'in the backlog',
    })),
  ]
  return <PropertyList items={items} />
}
