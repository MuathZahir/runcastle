import { useState } from 'react'
import { trpc } from '../../trpc'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import { DimLine } from '../../ui'
import { Activity } from './Activity'
import { CurrentGate } from './GateCard'
import { Knowledge } from './Knowledge'

type Tab = 'details' | 'activity'

/** The rail's own frame, so every state (loading, error, loaded) sits in it. */
const RAIL = 'flex min-h-0 flex-col overflow-hidden border-l border-hairline bg-panel-2'

/**
 * Right rail for the pipeline-first shell, tabbed so the working surface stays
 * calm: Details (current gate + knowledge docs) is the default; the raw event
 * feed lives behind the Activity tab instead of scrolling permanently beside
 * the workspace.
 *
 * Feature-scoped for real (decision 5): every panel in here is about one
 * feature, so on chat, preparation, create and empty views the shell drops the
 * whole grid column rather than mounting this and hiding its content — the old
 * arrangement left a dead ~300px strip beside those bodies.
 */
export function Inspector({ featureId }: { featureId: string }) {
  const [tab, setTab] = useState<Tab>('details')
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  // One feed for both tabs, mounted here rather than inside Activity so
  // switching tabs doesn't re-accumulate it.
  const events = useEventLog(featureId)

  if (full.isLoading)
    return (
      <aside className={RAIL}>
        <DimLine>loading…</DimLine>
      </aside>
    )
  // Hard error only when there was NEVER data — a refetch failure after data
  // exists (server restart) keeps the last-good rail rendered instead of
  // blanking it; the workspace's OFFLINE banner covers the outage story.
  if (!full.data)
    return (
      <aside className={RAIL}>
        <DimLine>{full.error?.message ?? 'could not load inspector'}</DimLine>
      </aside>
    )

  return (
    <aside className={RAIL}>
      <div className="flex shrink-0 items-center gap-0.5 px-4 pt-3" role="tablist">
        <InspectorTab label="Details" tab="details" active={tab} onSelect={setTab} />
        <InspectorTab label="Activity" tab="activity" active={tab} onSelect={setTab} />
      </div>

      <div
        key={tab}
        className="flex min-h-0 flex-1 animate-[fadeUp_var(--dur-2)_var(--ease-out-app)] flex-col gap-6 overflow-y-auto px-4 py-5"
      >
        {tab === 'details' ? (
          <>
            <CurrentGate gate={full.data.gate} phase={full.data.feature.phase} />
            <Knowledge featureId={featureId} docs={full.data.docs} />
          </>
        ) : (
          <Activity events={events} />
        )}
      </div>
    </aside>
  )
}

function InspectorTab({
  label,
  tab,
  active,
  onSelect,
}: {
  label: string
  tab: Tab
  active: Tab
  onSelect: (tab: Tab) => void
}) {
  const on = tab === active
  return (
    // No preflight (apps/web/STYLE.md): the tab states its own face and size
    // rather than inheriting the UA button's 13.33px Arial.
    <button
      role="tab"
      aria-selected={on}
      className={`cursor-pointer border-0 border-b-2 bg-transparent px-3 py-1.5 font-sans text-sm font-medium ${
        on ? 'border-b-accent text-text' : 'border-b-transparent text-text-3 hover:text-text-2'
      }`}
      onClick={() => onSelect(tab)}
    >
      {label}
    </button>
  )
}
