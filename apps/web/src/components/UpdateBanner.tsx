import { useState } from 'react'
import { trpc } from '../trpc'
import { bannerVisible, DISMISS_KEY } from '../lib/update'

/**
 * Dismissible update notice (issue #51). Queries the server's npm update check
 * once (it's a process fact — no polling), and when a newer version is published
 * floats a bar naming the exact update command. It never installs anything; the
 * dismissal is remembered per-version in localStorage so a later release resurfaces.
 */
export function UpdateBanner() {
  const q = trpc.system.checkUpdate.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY)
    } catch {
      return null
    }
  })

  const info = q.data
  if (!info || !info.latest || !bannerVisible(info, dismissed)) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, info.latest as string)
    } catch {
      // A blocked localStorage just means the banner reappears next load — fine.
    }
    setDismissed(info.latest)
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-dot" aria-hidden="true" />
      <span className="update-banner-text">
        runcastle <strong>{info.latest}</strong> is available
        <span className="update-banner-sep"> · </span>
        <span className="update-banner-dim">you're on {info.current}</span>
      </span>
      <code className="update-banner-cmd">{info.command}</code>
      <button
        className="update-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
