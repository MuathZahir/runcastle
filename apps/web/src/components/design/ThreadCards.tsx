import { createContext, useContext } from 'react'
import { trpc } from '../../trpc'
import { useDesignRecord } from '../../lib/use-designs'
import { PlanCard } from '../chat/thread/PlanCard'
import { DesignCards } from './DesignCard'

/**
 * What the plan and design cards in a feature's chat open
 * (designs-and-the-plan-get-their-own-place decisions 2, 4, 19): the feature
 * whose record they read, and the panel views a click opens. A thread outside
 * a feature page provides none, and its cards draw nothing.
 */
export interface ThreadCardsTarget {
  featureId: string
  /** The plan card's line: the feature's "what this is". */
  oneLiner: string
  onOpenPlan: () => void
  /** Open this design (its page) in the Design view. */
  onOpenDesign: (path: string) => void
  /** Open the Design view's list; none where there is no list (the phone). */
  onOpenDesignList?: () => void
}

export const ThreadCardsContext = createContext<ThreadCardsTarget | null>(null)

/**
 * A plan card in a thread: the feature's line and the plan's figures, read
 * from the server. Nothing shows until both read. Opening the Plan view is
 * what marks the plan seen.
 */
export function PlanCardItem({ older }: { older?: boolean }) {
  const target = useContext(ThreadCardsContext)
  const featureId = target?.featureId ?? ''
  const { designs, planIsNew } = useDesignRecord(featureId, !!target)
  const figures = trpc.design.planFigures.useQuery({ featureId }, { enabled: !!target })
  if (!target || !designs || !figures.data) return null
  return <PlanCard oneLiner={target.oneLiner} counts={figures.data} isNew={planIsNew} {...(older ? { older } : {})} onOpen={target.onOpenPlan} />
}

/**
 * A group of design cards in a thread, each reading its design's state live
 * from the record (decision 19), so every card for a design agrees. A design
 * the record no longer holds is left out.
 */
export function DesignCardsItem({ designIds, older }: { designIds: readonly string[]; older: readonly string[] }) {
  const target = useContext(ThreadCardsContext)
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
