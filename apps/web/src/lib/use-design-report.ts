import { useEffect, useRef, type RefObject } from 'react'
import { parseDesignReport, type DesignReport } from '@runcastle/core'
import { trpc } from '../trpc'

/** How long a design page's reports settle before the last one goes to the server. */
export const DESIGN_REPORT_DEBOUNCE_MS = 300

/** Per design shown: send its pending report now, resolving once the server has every report sent. */
const flushers = new Map<string, () => Promise<void>>()

/**
 * Settle a design's reports before its approval (review finding: a tweak picked
 * just before Approve was lost to the debounce). Resolves at once for a design
 * not shown; a report that fails to send never blocks the approval.
 */
export function flushDesignReport(designId: string): Promise<void> {
  return flushers.get(designId)?.() ?? Promise.resolve()
}

/**
 * Relay what the design frame reports to the server, for the design it shows
 * (agents-see-the-tweaks-you-picked decision 5). Only a message from this
 * frame's own window is heard, and only one that parses as a design report
 * (capped); a burst of them sends the last, ~300 ms after it settles. A report
 * still pending when the design changes or the view goes is sent at once, and
 * Approve sends it first through `flushDesignReport`.
 * Without a recorded design at the page there is nothing to keep it on.
 */
export function useDesignReport(frame: RefObject<HTMLIFrameElement | null>, designId: string | undefined): void {
  const { mutateAsync: report } = trpc.design.report.useMutation()
  const pending = useRef<DesignReport | null>(null)

  useEffect(() => {
    if (!designId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight: Promise<unknown> = Promise.resolve()
    const flush = (): Promise<void> => {
      clearTimeout(timer)
      timer = undefined
      const next = pending.current
      pending.current = null
      if (next) inFlight = report({ designId, report: next }).catch(() => undefined)
      return inFlight.then(() => undefined)
    }
    const onMessage = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return
      const parsed = parseDesignReport(event.data)
      if (!parsed) return
      pending.current = parsed
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), DESIGN_REPORT_DEBOUNCE_MS)
    }
    window.addEventListener('message', onMessage)
    flushers.set(designId, flush)
    return () => {
      window.removeEventListener('message', onMessage)
      if (flushers.get(designId) === flush) flushers.delete(designId)
      void flush()
    }
  }, [frame, designId, report])
}
