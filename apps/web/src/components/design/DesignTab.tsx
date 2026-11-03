import { trpc } from '../../trpc'
import { useApproveAndNext, useDesignRecord, useMarkSeen } from '../../lib/use-designs'
import { orderDesigns } from '../../lib/feature-ui/designs'
import { IconArrowLeft } from '../../icons'
import { Button, Skeleton, SkeletonBar } from '../../ui'
import { PanelViewBar } from '../workspace/PanelViewBar'
import { DesignBar, DesignList } from './DesignList'
import { DesignView } from './DesignView'

/**
 * The panel's Design view (designs-and-the-plan-get-their-own-place decisions
 * 6, 7, 8, 24, 25): at home, the list of every design the agent recorded; with
 * a design open (`path`), the bar — All designs, the arrows, Approve — over
 * that design live. Approve is only ever on an open design, and moves straight
 * on to the next design still waiting, or back to the list after the last one.
 * The server tells the lead once, when the last waiting design is approved.
 *
 * A path that is no recorded design is a design server from before the list
 * (decision 7): it shows live with only the way back.
 */
export function DesignTab({
  featureId,
  path,
  onOpen,
  onList,
}: {
  featureId: string
  /** The open design's page, or none for the list. */
  path?: string
  /** Open the design at this page. */
  onOpen: (path: string) => void
  /** Back to the list. */
  onList: () => void
}) {
  const utils = trpc.useUtils()
  const { designs } = useDesignRecord(featureId)
  const status = trpc.design.status.useQuery({ featureId })
  const { mutate: markSeen } = trpc.design.seen.useMutation({ onSettled: () => utils.design.list.invalidate({ featureId }) })
  const { approve } = useApproveAndNext(featureId, designs, { onNext: onOpen, onDone: onList })

  const ordered = designs ? orderDesigns(designs) : []
  const open = path === undefined ? undefined : ordered.find((d) => d.path === path)
  useMarkSeen(open?.id, open?.isNew === true, () => open && markSeen({ designId: open.id }))

  if (!designs) {
    return (
      <Skeleton label="Loading the designs" className="px-5 py-4">
        <SkeletonBar className="h-4 w-1/2" />
        <SkeletonBar className="mt-3 h-16 w-full" />
      </Skeleton>
    )
  }

  if (path !== undefined && !open) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelViewBar className="border-b border-border-subtle">
          <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onList}>
            All designs
          </Button>
        </PanelViewBar>
        <div className="min-h-0 flex-1">
          <DesignView featureId={featureId} path={path} />
        </div>
      </div>
    )
  }

  if (!open) {
    const server = status.data
    return (
      <DesignList
        designs={designs}
        onOpen={(id) => {
          const design = designs.find((d) => d.id === id)
          if (design) onOpen(design.path)
        }}
        {...(designs.length === 0 && server?.hasRecordedCommand ? { onOpenServer: () => onOpen(server.lastPath ?? '/') } : {})}
      />
    )
  }

  const index = ordered.indexOf(open)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DesignBar
        design={open}
        index={index}
        count={ordered.length}
        othersWaiting={designs.filter((d) => d.state === 'waiting' && d.id !== open.id).length}
        onBack={onList}
        onStep={(to) => {
          const step = ordered[to]
          if (step) onOpen(step.path)
        }}
        onApprove={() => approve(open)}
      />
      <div className="min-h-0 flex-1">
        <DesignView featureId={featureId} path={open.path} {...(open.width !== undefined ? { width: open.width } : {})} />
      </div>
    </div>
  )
}
