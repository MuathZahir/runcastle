import { createContext, useContext } from 'react'
import type { PromptDisplay, WorkerRow } from '@runcastle/core'
import type { ThreadItem } from '../../../lib/chat-thread'
import { FeatureHandbackCard, HandbackCard, WorkerFailedCard, type HandbackOutcome } from '../../workers/WorkerParts'
import type { FeatureListItem } from '../../../lib/api'
import { relTimeAgo } from '../../../lib/format'
import { FeaturesCard, NewsBlock, OrchestratorMessage, RuncastleNote } from './FeatureCards'
import { ReviewPackageItem } from '../../review/ReviewPackageItem'

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

/**
 * What a worker's handback and failure cards in the lead's chat read and open
 * (interactive-workers decisions 4, 16, 21): the feature's workers, for what the
 * lead did with each handback, and the page's way of bringing a worker's chat to
 * the front. The feature's chat column provides it; without it the cards still
 * draw, with no outcome line and a link that does nothing.
 */
export interface WorkerLinks {
  workers: readonly WorkerRow[]
  openWorker: (workerId: string) => void
}

export const WorkerLinksContext = createContext<WorkerLinks | null>(null)

type HandbackDisplay = Extract<PromptDisplay, { handback: unknown }>['handback']

/**
 * What the lead did with a handback, read off its worker's row. The row holds
 * only the latest handback's outcome, so an earlier handback of the same worker
 * (its summary is no longer the row's) shows none rather than a later one's.
 */
export function handbackOutcome(handback: Pick<HandbackDisplay, 'summary'>, row: WorkerRow | undefined): HandbackOutcome | undefined {
  if (!row || row.handbackSummary !== handback.summary) return undefined
  switch (row.outcome) {
    case 'landed':
      return { kind: 'landed', into: row.featureBranch }
    case 'sent-back':
      return { kind: 'sent-back', note: row.outcomeNote ?? '' }
    case 'dropped':
      return { kind: 'dropped' }
    default:
      return undefined
  }
}

/** A worker's handback, as the approved card with the lead's outcome beneath it. */
function HandbackItem({ handback }: { handback: HandbackDisplay }) {
  const links = useContext(WorkerLinksContext)
  const outcome = handbackOutcome(handback, links?.workers.find((w) => w.id === handback.workerId))
  return (
    <HandbackCard
      handback={{
        workerId: handback.threadId,
        workerLabel: handback.label,
        kind: handback.kind === 'unassigned' ? null : handback.kind,
        summary: handback.summary,
        commits: handback.commits.length,
        files: handback.files.map((path) => ({ path })),
        ...(outcome ? { outcome } : {}),
      }}
      onOpenWorker={(id) => links?.openWorker(id)}
    />
  )
}

/** A worker that failed, as the approved one-line notice. */
function WorkerFailedItem({ failed }: { failed: Extract<PromptDisplay, { workerFailed: unknown }>['workerFailed'] }) {
  const links = useContext(WorkerLinksContext)
  return (
    <WorkerFailedCard
      workerId={failed.workerId}
      workerLabel={failed.label}
      reason={failed.failure}
      onOpenWorker={(id) => links?.openWorker(id)}
    />
  )
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
  if ('handback' in display) return <HandbackItem handback={display.handback} />
  if ('workerFailed' in display) return <WorkerFailedItem failed={display.workerFailed} />
  // A Review worker's handback is its Review Package card (burns-become-workers decision 4).
  if ('reviewPackage' in display) return <ReviewPackageItem ticketId={display.reviewPackage.workerId} />
  if ('featureHandback' in display) {
    const h = display.featureHandback
    return <FeatureHandbackCard title={find(h.featureId)?.title ?? h.title} state={h.state} summary={h.summary} onOpenFeature={() => open(h.featureId)} />
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {display.orchestrator.map((message, i) => (
        <OrchestratorMessage key={i} text={message.text} relayed={message.relayed} />
      ))}
    </div>
  )
}
