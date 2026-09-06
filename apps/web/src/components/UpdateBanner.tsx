import { useState } from 'react'
import { trpc } from '../trpc'
import { bannerVisible, DISMISS_KEY } from '../lib/update'
import { BARE_BUTTON } from '../ui'

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
    // A row in normal flow, never a floating bar: fixed and top-center it sat
    // over doc peek, Settings headers, the palette and feature titles (F7). It
    // is also as wide as the window, so a long line clips instead of pushing
    // the frame wider (the breadcrumb's lesson, F20).
    <div
      className="flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-accent-line bg-accent/12 px-3.5 py-1.5 text-sm text-text"
      role="status"
    >
      <span className="size-1.75 shrink-0 animate-dot-glow rounded-pill bg-accent-hi" aria-hidden="true" />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        runcastle <strong className="font-semibold text-accent-hi">{info.latest}</strong> is
        available
        <span className="text-text-4"> · </span>
        <span className="text-text-3">you're on {info.current}</span>
      </span>
      <code className="rounded-sm border border-hairline bg-panel-inset px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-accent-hi select-all">
        {info.command}
      </code>
      <button
        className={`${BARE_BUTTON} ml-auto grid size-5.5 shrink-0 cursor-pointer place-items-center rounded-sm text-lg leading-none text-text-3 hover:bg-panel-3 hover:text-text`}
        onClick={dismiss}
        aria-label="Dismiss update notice"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
