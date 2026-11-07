import { useCallback, useEffect, useState } from 'react'

/**
 * Where a design opens (designs-and-the-plan-get-their-own-place decisions 23,
 * 26): through the design pass-through, on the page's own host and protocol at
 * the pass-through's port — never the design server's own `localhost`
 * address, which is the runcastle host's and not the browser's. So a design
 * opens wherever runcastle itself opens: the same machine, a phone over
 * Tailscale, or a browser on another computer through an SSH tunnel that
 * forwards the pass-through's port too.
 *
 * The pass-through routes by one cookie per origin, so two features' designs
 * open in two tabs at once share it: the last one opened wins.
 */

/** The page's own address, as `window.location` gives it. */
export interface PageAddress {
  protocol: string
  hostname: string
}

/** The pass-through's entry path; the feature id follows it. */
const OPEN_PREFIX = '/__runcastle/open/'
/** The pass-through's reachability probe. */
const PING_PATH = '/__runcastle/ping'

/** `host:port`, an IPv6 literal bracketed (a browser's `location.hostname` already is). */
function hostPort(hostname: string, port: number): string {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  return `${host}:${port}`
}

function passOrigin(page: PageAddress, passPort: number): string {
  return `${page.protocol}//${hostPort(page.hostname, passPort)}`
}

/** The address a design loads at: the pass-through's entry for this feature, then `path` (default `/`). */
export function designAddress(page: PageAddress, passPort: number, featureId: string, path?: string): string {
  return `${passOrigin(page, passPort)}${OPEN_PREFIX}${encodeURIComponent(featureId)}?path=${encodeURIComponent(path || '/')}`
}

/**
 * A worker's preview (interactive-workers decision 15): its entry path on the
 * pass-through (`worker.list`'s `previewPath`), on the page's own host, so it
 * opens from the laptop, the VPS and the phone alike.
 */
export function workerPreviewAddress(page: PageAddress, passPort: number, previewPath: string): string {
  return `${passOrigin(page, passPort)}${previewPath}`
}

/** The pass-through's probe, on the same host and port a design would load from. */
export function designPingAddress(page: PageAddress, passPort: number): string {
  return `${passOrigin(page, passPort)}${PING_PATH}`
}

/** How long the probe waits before it calls the port unreachable. */
export const PASS_PROBE_TIMEOUT_MS = 3000

export type PassReach = 'checking' | 'reachable' | 'unreachable'

/**
 * Whether this browser can reach the pass-through, asked before a design's
 * frame loads, so a port the tunnel does not forward is said in words rather
 * than as a browser's "refused to connect". `retry` asks again. Undefined
 * `passPort` (the status not read yet) stays `checking`.
 */
export function usePassReachable(passPort: number | undefined): { reach: PassReach; retry: () => void } {
  const [reach, setReach] = useState<PassReach>('checking')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (passPort === undefined) return
    let live = true
    setReach('checking')
    fetch(designPingAddress(window.location, passPort), { signal: AbortSignal.timeout(PASS_PROBE_TIMEOUT_MS), cache: 'no-store' })
      .then((res) => {
        if (live) setReach(res.ok ? 'reachable' : 'unreachable')
      })
      .catch(() => {
        if (live) setReach('unreachable')
      })
    return () => {
      live = false
    }
  }, [passPort, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { reach, retry }
}
