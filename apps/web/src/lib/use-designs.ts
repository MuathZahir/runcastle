import { useEffect, useRef } from 'react'
import { trpc } from '../trpc'
import { useLivePoll } from './live'
import type { DesignEntry } from './feature-ui/designs'

/**
 * A feature's design record as the web reads it
 * (designs-and-the-plan-get-their-own-place decisions 6, 10, 11): its designs
 * and whether its plan is new to the human. One query key, shared by the
 * cards, the Design list and the dots; every `design.*` / `plan.*` event
 * invalidates it.
 */
export function useDesignRecord(featureId: string, enabled = true): { designs?: DesignEntry[]; planIsNew: boolean } {
  const list = trpc.design.list.useQuery({ featureId }, { enabled, refetchInterval: useLivePoll() })
  return {
    ...(list.data ? { designs: list.data.designs } : {}),
    planIsNew: list.data?.plan.isNew === true,
  }
}

/**
 * Tells the server, once, that the human has `what` on screen while it is new
 * to them: the open design, or the Plan view. Showing it again makes it new
 * again, and a fresh `key` asks again.
 */
export function useMarkSeen(key: string | undefined, isNew: boolean, mark: () => void): void {
  const sent = useRef<string | null>(null)
  const markRef = useRef(mark)
  markRef.current = mark
  useEffect(() => {
    if (!key || !isNew) {
      if (!isNew) sent.current = null
      return
    }
    if (sent.current === key) return
    sent.current = key
    markRef.current()
  }, [key, isNew])
}
