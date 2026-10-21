import { useEffect, useRef } from 'react'
import type { EventRow } from '@runcastle/core'
import { panelShowRequest, type PanelShowRequest } from '../../lib/feature-ui/panel'

/**
 * The agent opening the panel (design-mode decision 5): each NEW `panel.show`
 * for this feature in its event log calls `onShow` once. The batch the log
 * loads on mount is history — a reload must not replay what the agent showed
 * an hour ago — so it is skipped, as `useResumeFailedBanner` skips it.
 */
export function usePanelShow(
  events: readonly EventRow[],
  featureId: string,
  onShow: (request: PanelShowRequest) => void,
): void {
  // null until the first batch lands — everything in that batch is history.
  const lastSeen = useRef<number | null>(null)
  const show = useRef(onShow)
  show.current = onShow

  useEffect(() => {
    const newest = events[events.length - 1]
    if (!newest) return
    const cutoff = lastSeen.current
    lastSeen.current = newest.id
    if (cutoff === null) return
    for (const event of events) {
      if (event.id <= cutoff) continue
      const request = panelShowRequest(event, featureId)
      if (request) show.current(request)
    }
  }, [events, featureId])
}
