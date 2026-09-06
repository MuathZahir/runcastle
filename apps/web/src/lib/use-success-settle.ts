import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '@runcastle/core'

/** How long the all-green beat holds before the review page takes over. */
export const SETTLE_MS = 900

/**
 * Hold the run view on screen for a beat when a watched run succeeds
 * (decision #15a).
 *
 * The burn finalizer advances implementation → review itself, so a run watched
 * to its end used to vanish at the instant it landed: the lanes never played
 * their done-settle and the human's page became the review page mid-blink, with
 * no moment at which the run was seen to succeed. A terminal success state with
 * a "Go to review" button was rejected — that is a click on the happy path of
 * every run — so the beat is time, not input.
 *
 * Returns the id of the run being settled, or null. Only a run this hook saw
 * RUNNING can settle: opening a feature whose burn finished an hour ago is not
 * a success being watched, and holding the run view over it would be a delay
 * with nothing to show.
 */
export function useSuccessSettle(run: { id: string; status: RunStatus } | undefined): string | null {
  const [settlingRunId, setSettlingRunId] = useState<string | null>(null)
  const watched = useRef<string | null>(null)
  const runId = run?.id
  const status = run?.status

  useEffect(() => {
    if (!runId) return
    if (status === 'running') {
      watched.current = runId
      return
    }
    if (status !== 'succeeded' || watched.current !== runId) return
    // Consumed: a re-render (or a return to this feature) must not replay it.
    watched.current = null
    setSettlingRunId(runId)
    const timer = setTimeout(() => setSettlingRunId(null), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [runId, status])

  return settlingRunId === runId ? settlingRunId : null
}
