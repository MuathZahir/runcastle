import { trpc } from '../trpc'
import type { Tab } from '../lib/tabs'
import { tabId } from '../lib/tabs'

/**
 * Typed tab strip (UI-SPEC §2). Tabs are per-feature and typed: overview / term
 * / tickets / run, labelled `<slug> · <type>`. Close with ✕ (terminal close =
 * detach only — PTY lifecycle is W1's; no kill on close).
 */
const ICON: Record<Tab['kind'], string> = {
  overview: '▤',
  terminal: '▸_',
  tickets: '☰',
  run: '⚙',
}
const TYPE_LABEL: Record<Tab['kind'], string> = {
  overview: 'overview',
  terminal: 'term',
  tickets: 'tickets',
  run: 'run',
}

export function TabStrip({
  tabs,
  activeId,
  onFocus,
  onClose,
}: {
  tabs: Tab[]
  activeId: string | null
  onFocus: (id: string) => void
  onClose: (id: string) => void
}) {
  const list = trpc.feature.list.useQuery(undefined, { refetchInterval: 1500 })
  const slugOf = (featureId: string): string =>
    list.data?.find((f) => f.id === featureId)?.slug ?? featureId

  return (
    <div className="tabstrip" role="tablist">
      {tabs.map((tab) => {
        const id = tabId(tab)
        const active = id === activeId
        return (
          <div
            key={id}
            className={`tab${active ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active}
            onClick={() => onFocus(id)}
          >
            <span className="tab-icon mono">{ICON[tab.kind]}</span>
            <span className="tab-label">
              <span className="mono">{slugOf(tab.featureId)}</span>
              <span className="tab-dot"> · </span>
              <span className="tab-type">{TYPE_LABEL[tab.kind]}</span>
            </span>
            <button
              className="tab-close"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                onClose(id)
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
