import type { MapHistoryEntry } from '@runcastle/core'
import { historyCredit, historyDay } from '../../lib/map'
import { Disclosure, LINK } from '../../ui'

/** Open a feature's page by id: where a history credit's title leads. */
export type OpenFeature = (featureId: string) => void

/**
 * One history entry in words (decision 6): "Changed by <feature>, Oct 12", the
 * title linking to its feature page, or "Changed on main, "<subject>", Sep 30"
 * for a commit made straight to main.
 */
function HistoryEntry({ entry, onOpenFeature }: { entry: MapHistoryEntry; onOpenFeature?: OpenFeature }) {
  const credit = historyCredit(entry)
  const day = historyDay(entry.at)
  if (credit.kind === 'main') return <>Changed on main, “{credit.subject}”, {day}</>
  const { featureId } = credit
  return (
    <>
      Changed by{' '}
      {featureId && onOpenFeature ? (
        <button type="button" className={LINK} onClick={() => onOpenFeature(featureId)}>
          {credit.title}
        </button>
      ) : (
        credit.title
      )}
      , {day}
    </>
  )
}

/** The latest change, inline; nothing for an entry with no history. */
export function HistoryLatest({ history, onOpenFeature }: { history: MapHistoryEntry[]; onOpenFeature?: OpenFeature }) {
  const latest = history[0]
  if (!latest) return null
  return (
    <span className="text-xs text-text-tertiary">
      <HistoryEntry entry={latest} onOpenFeature={onOpenFeature} />
    </span>
  )
}

/** The changes before the latest, newest first, behind a "3 earlier" disclosure. */
export function HistoryEarlier({
  history,
  onOpenFeature,
  className,
}: {
  history: MapHistoryEntry[]
  onOpenFeature?: OpenFeature
  className?: string
}) {
  const earlier = history.slice(1)
  if (earlier.length === 0) return null
  return (
    <Disclosure size="sm" title={`${earlier.length} earlier`} className={className}>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {earlier.map((entry) => (
          <li key={entry.commit}>
            <HistoryEntry entry={entry} onOpenFeature={onOpenFeature} />
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
