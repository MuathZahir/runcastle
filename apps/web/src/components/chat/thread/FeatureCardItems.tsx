import { createContext, useContext } from 'react'
import type { ThreadItem } from '../../../lib/chat-thread'
import type { FeatureListItem } from '../../../lib/api'
import { relTimeAgo } from '../../../lib/format'
import { FeaturesCard, NewsBlock, OrchestratorMessage, RuncastleNote } from './FeatureCards'

/**
 * What the feature rows in a chat read and open
 * (orchestrator-actions-show-as-cards decisions 3, 14): the project's feature
 * list the sidebar reads, for each row's live state, and the sidebar's own way
 * of opening a feature. The project shell provides it, so the Orchestrator's
 * column, a feature's chat and the phone all share it. A chat outside a shell
 * (a scenario chat) has none, and its rows neither show a live state nor open.
 */
export interface FeatureLinks {
  features: readonly FeatureListItem[]
  openFeature: (featureId: string) => void
}

export const FeatureLinksContext = createContext<FeatureLinks | null>(null)

/** The live feature a row names, or null when there is no list or it no longer holds it. */
function useLiveFeature(): { find: (featureId: string) => FeatureListItem | null; open: (featureId: string) => void; linked: boolean } {
  const links = useContext(FeatureLinksContext)
  return {
    linked: links !== null,
    find: (featureId) => links?.features.find((f) => f.id === featureId) ?? null,
    open: (featureId) => links?.openFeature(featureId),
  }
}

/** A turn's features card, its rows read against the live feature list. */
export function FeaturesCardItem({ rows }: { rows: Extract<ThreadItem, { kind: 'features_card' }>['rows'] }) {
  const { find, open, linked } = useLiveFeature()
  return <FeaturesCard rows={rows.map((row) => ({ ...row, feature: find(row.featureId) }))} onOpen={open} linked={linked} />
}

/**
 * Runcastle's own line to the agent, drawn from what the human reads of it:
 * news as a block of feature rows, a kickoff as one plain line, the
 * Orchestrator's messages in full. `agentText` is the line as the agent got it.
 */
export function RuncastleDisplay({
  display,
  agentText,
  at,
}: {
  display: NonNullable<Extract<ThreadItem, { kind: 'user' }>['display']>
  agentText: string
  /** When the line arrived, for the news block's "6m ago". */
  at?: number
}) {
  const { find, open, linked } = useLiveFeature()
  if ('news' in display) {
    return (
      <NewsBlock
        rows={display.news.map((row) => ({ ...row, feature: find(row.featureId) }))}
        agentText={agentText}
        onOpen={open}
        linked={linked}
        {...(at !== undefined ? { when: relTimeAgo(at) } : {})}
      />
    )
  }
  if ('summary' in display) return <RuncastleNote summary={display.summary} agentText={agentText} />
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {display.orchestrator.map((message, i) => (
        <OrchestratorMessage key={i} text={message.text} relayed={message.relayed} />
      ))}
    </div>
  )
}
