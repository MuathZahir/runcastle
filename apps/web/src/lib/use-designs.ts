import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { useLivePoll } from './live'
import { nextWaiting, type DesignEntry } from './feature-ui/designs'
import { useToast } from './toast'

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
 * Approve on an open design (decision 24), the desktop's and the phone's:
 * where to go next is read before the approval changes the record, then, once
 * the server has it, `onNext` opens the next design still waiting or `onDone`
 * leaves after the last. A failure is said by a toast and the human stays put.
 */
export function useApproveAndNext(
  featureId: string,
  designs: readonly DesignEntry[] | undefined,
  { onNext, onDone }: { onNext: (path: string) => void; onDone: () => void },
): { approve: (design: DesignEntry) => void; approving: boolean } {
  const toast = useToast()
  const utils = trpc.useUtils()
  const approve = trpc.design.approve.useMutation({ onError: (e) => toast.push(e.message) })
  const [approving, setApproving] = useState(false)
  const run = async (design: DesignEntry) => {
    if (approving || !designs) return
    const next = nextWaiting(designs, design.id)
    setApproving(true)
    try {
      await approve.mutateAsync({ designId: design.id })
      await utils.design.list.invalidate({ featureId })
      if (next) onNext(next.path)
      else onDone()
    } catch {
      // Said by the mutation's toast.
    } finally {
      setApproving(false)
    }
  }
  return { approve: (design) => void run(design), approving }
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
