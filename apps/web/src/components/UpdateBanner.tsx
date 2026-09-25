import { useState } from 'react'
import type { ReactNode } from 'react'
import { trpc } from '../trpc'
import { bannerVisible, DISMISS_KEY } from '../lib/update'
import { useToast } from '../lib/toast'
import { Button, cx, IconButton } from '../ui'
import { IconArrowRight, IconCopy, IconX } from '../icons'

/**
 * One quiet line at the top of the content panel (DESIGN.md: a notice, not a
 * band): a glyph, one sentence, at most one action and a dismiss. `tone`
 * `danger` takes the `danger-subtle` ground — only for something that truly
 * needs attention; everything else sits on the panel's own surface.
 *
 * It is a row in the panel's normal flow, never a floating bar: fixed and
 * top-center it used to sit over doc peek, Settings headers, the palette and
 * feature titles (findings F7). A long line clips rather than pushing the frame
 * wider (the breadcrumb's lesson, F20).
 */
export function Notice({
  tone = 'neutral',
  icon,
  children,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
}: {
  tone?: 'neutral' | 'danger'
  icon: ReactNode
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
}) {
  return (
    <div
      role="status"
      className={cx(
        'flex h-10 shrink-0 animate-fade-in items-center gap-2.5 overflow-hidden border-b border-border-subtle pr-2 pl-4 text-sm',
        tone === 'danger' ? 'bg-danger-subtle' : 'bg-surface',
      )}
    >
      <span className={cx('inline-flex shrink-0 [&>svg]:size-4', tone === 'danger' ? 'text-danger' : 'text-accent')}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-text-secondary">{children}</span>
      {action}
      {onDismiss && <IconButton size="sm" label={dismissLabel} icon={<IconX />} onClick={onDismiss} />}
    </div>
  )
}

/**
 * Dismissible update notice (issue #51). Queries the server's npm update check
 * once (it's a process fact — no polling), and when a newer version is published
 * says so with the exact update command. It never installs anything; the
 * dismissal is remembered per-version in localStorage so a later release
 * resurfaces.
 */
export function UpdateBanner() {
  const toast = useToast()
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
      // A blocked localStorage just means the notice reappears next load — fine.
    }
    setDismissed(info.latest)
  }

  const copy = () =>
    navigator.clipboard.writeText(info.command).then(
      () => toast.push('Update command copied', 'info'),
      () => toast.push('Copy failed'),
    )

  return (
    <Notice
      icon={<IconArrowRight />}
      onDismiss={dismiss}
      dismissLabel="Dismiss update notice"
      action={
        <Button size="sm" variant="ghost" icon={<IconCopy />} onClick={copy}>
          Copy command
        </Button>
      }
    >
      <span className="shrink-0 text-text">runcastle {info.latest} is available</span>
      <span className="shrink-0 text-text-tertiary">you're on {info.current}</span>
      <code className="min-w-0 truncate font-mono text-xs text-text-tertiary select-all">{info.command}</code>
    </Notice>
  )
}
