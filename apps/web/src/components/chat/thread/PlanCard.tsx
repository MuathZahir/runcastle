import { IconChevronRight, IconDoc } from '../../../icons'
import { ListRow, cx } from '../../../ui'
import { OlderMark } from '../../design/marks'
import { WELL } from './surfaces'

/**
 * A plan card an older chat still holds (building-starts-without-a-plan-approval
 * decision 6): the Plan tab is gone, so it is a small card that opens the
 * feature's plan page, as a shown file's card opens its file.
 */
export function PlanCard({
  older,
  feature,
  onOpen,
}: {
  /** A newer plan card follows this one in the chat; this one still opens the current page. */
  older?: boolean
  /** The feature's title, where the chat is not that feature's own: an orchestrator chat holds several. */
  feature?: string
  onOpen: () => void
}) {
  return (
    <div className={cx(WELL, 'max-w-[520px] overflow-hidden')}>
      <ListRow
        leading={<IconDoc />}
        title="Plan page"
        {...(feature ? { subtitle: feature } : {})}
        meta={
          <span className="inline-flex items-center gap-2 text-icon">
            {older && <OlderMark />}
            <IconChevronRight />
          </span>
        }
        label={feature ? `Open the plan page of ${feature}` : 'Open the plan page'}
        onClick={onOpen}
      />
    </div>
  )
}
