import type { ReactNode } from 'react'

export interface TabItem {
  /** Stable id reported to `onSelect` / `onClose`. */
  id: string
  /** Primary label — usually a mono slug. */
  label: ReactNode
  /** Optional leading glyph. */
  icon?: ReactNode
  /** Optional dim type suffix, e.g. "overview", "term", "run". */
  type?: string
}

export interface TabsProps {
  /** Ordered tabs, left to right. */
  tabs: TabItem[]
  /** id of the active tab. */
  activeId?: string
  /** Called with a tab id when it is focused. */
  onSelect?: (id: string) => void
  /** When provided, each tab shows a ✕ close affordance. */
  onClose?: (id: string) => void
}

/**
 * A VS-Code-style typed tab strip. The active tab gains a violet top rule and
 * the darkest background; tabs can carry a leading glyph and a dim type suffix,
 * and become closable when `onClose` is set.
 */
export function Tabs({ tabs, activeId, onSelect, onClose }: TabsProps) {
  return (
    <div className="tabstrip" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            className={`tab${active ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(tab.id)}
          >
            {tab.icon != null && <span className="tab-icon mono">{tab.icon}</span>}
            <span className="tab-label">
              <span className="mono">{tab.label}</span>
              {tab.type && (
                <>
                  <span className="tab-dot"> · </span>
                  <span className="tab-type">{tab.type}</span>
                </>
              )}
            </span>
            {onClose && (
              <button
                className="tab-close"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
