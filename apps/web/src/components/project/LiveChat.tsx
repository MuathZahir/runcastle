import type { ReactNode } from 'react'
import type { ProjectSession } from '../../lib/api'
import { sessionStatusLabel } from '../../lib/feature-ui'
import { Button, SessionStatusDot } from '../../ui'

/** The live project conversation: one compact strip over the terminal. */
export function LiveChat({
  session,
  title,
  branch,
  hidden,
  onBack,
  endControl,
  children,
}: {
  session: NonNullable<ProjectSession>
  title: string
  branch: string | null
  hidden: boolean
  onBack: () => void
  endControl: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}
      data-live-chat
      aria-hidden={hidden}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline-soft bg-panel px-4">
        <Button className="border-transparent text-text-2" onClick={onBack}>
          ← Conversations
        </Button>
        <span className="max-w-[36ch] truncate rounded-pill border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent-hi">
          {title}
        </span>
        <span className="flex items-center gap-2 text-sm text-text-3">
          <SessionStatusDot status={session.status} />
          {sessionStatusLabel(session)}
        </span>
        <span className="rounded-pill border border-hairline px-2 py-0.5 font-mono text-xs text-text-2">
          → {branch ?? '…'}
        </span>
        <span
          className="ml-auto font-mono text-xs text-text-3"
          title={session.ccSessionId ?? session.id}
        >
          {(session.ccSessionId ?? session.id).slice(0, 8)}
        </span>
        {endControl}
      </div>
      <div className="min-h-0 flex-1 bg-panel-inset">{children}</div>
    </div>
  )
}
