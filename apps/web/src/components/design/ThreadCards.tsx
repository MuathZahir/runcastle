import { createContext, useContext, useState } from 'react'
import { trpc } from '../../trpc'
import { useLivePoll } from '../../lib/live'
import { useDesignRecord } from '../../lib/use-designs'
import { PlanCard } from '../chat/thread/PlanCard'
import { PlanPageDialog } from '../PreviewFrame'
import { DesignCards } from './DesignCard'
import { FeatureLinksContext } from '../chat/thread/FeatureCardItems'

/**
 * What the plan and design cards in a feature's chat open
 * (designs-and-the-plan-get-their-own-place decisions 2, 4, 19): the feature
 * whose record they read, and the panel views a click opens. A thread outside
 * a feature page provides none: its cards open the feature they name instead.
 */
export interface ThreadCardsTarget {
  featureId: string
  /** Open the Details view: an old plan card's way in when the feature has no plan page. */
  onOpenDetails: () => void
  /** Open this design (its page) in the Design view. */
  onOpenDesign: (path: string) => void
  /** Open the Design view's list; none where there is no list (the phone). */
  onOpenDesignList?: () => void
}

export const ThreadCardsContext = createContext<ThreadCardsTarget | null>(null)

/**
 * What a card opens: its feature's page when the thread is on it, else, in an
 * orchestrator chat (every-feature-has-one-owner decision 3), the feature the
 * card names, opened from the project's list on its Details or Design view.
 */
function useCardsTarget(featureId: string | undefined): ThreadCardsTarget | null {
  const page = useContext(ThreadCardsContext)
  const links = useContext(FeatureLinksContext)
  if (page && (!featureId || featureId === page.featureId)) return page
  const feature = featureId ? links?.features.find((f) => f.id === featureId) : undefined
  if (!links || !feature) return null
  return {
    featureId: feature.id,
    onOpenDetails: () => links.openFeature(feature.id, 'details'),
    onOpenDesign: () => links.openFeature(feature.id, 'design'),
  }
}

/**
 * A plan card an older chat holds (building-starts-without-a-plan-approval
 * decision 6): it opens the feature's current plan page full window, or its
 * Details view when the feature has no page. Nothing shows until the feature
 * reads.
 */
export function PlanCardItem({ older, featureId: named }: { older?: boolean; featureId?: string }) {
  const target = useCardsTarget(named)
  const featureId = target?.featureId ?? ''
  const full = trpc.feature.get.useQuery({ id: featureId }, { enabled: !!target, refetchInterval: useLivePoll() })
  const [open, setOpen] = useState(false)
  if (!target || !full.data) return null
  const preview = full.data.preview
  return (
    <>
      <PlanCard {...(older ? { older } : {})} onOpen={() => (preview ? setOpen(true) : target.onOpenDetails())} />
      {open && preview && <PlanPageDialog featureId={featureId} preview={preview} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * A group of design cards in a thread, each reading its design's state live
 * from the record (decision 19), so every card for a design agrees. A design
 * the record no longer holds is left out.
 */
export function DesignCardsItem({
  designIds,
  older,
  featureId: named,
}: {
  designIds: readonly string[]
  older: readonly string[]
  featureId?: string
}) {
  const target = useCardsTarget(named)
  const { designs } = useDesignRecord(target?.featureId ?? '', !!target)
  if (!target || !designs) return null
  const shown = designIds.flatMap((id) => designs.filter((d) => d.id === id))
  if (shown.length === 0) return null
  return (
    <DesignCards
      designs={shown}
      older={new Set(older)}
      onOpen={(id) => {
        const design = shown.find((d) => d.id === id)
        if (design) target.onOpenDesign(design.path)
      }}
      {...(target.onOpenDesignList ? { onOpenList: target.onOpenDesignList } : {})}
    />
  )
}
