import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { TerminalView } from '../TerminalView'
import { ErrorBoundary } from '../ErrorBoundary'
import { DimLine, SessionStatusDot } from '../../ui'

/**
 * Terminal tab (UI-SPEC §3): a thin wrapper around W1's <TerminalView> with a
 * 28px top strip (kind badge, cc session id, status dot, Pop out / End session).
 * TerminalView is imported only via its pinned props and wrapped in an error
 * boundary so a terminal failure never takes down the shell (UI-SPEC §6).
 *
 * `wsBase` is intentionally omitted — the vite dev server proxies `/ws` to the
 * runcastle server on 4512, so W1's default same-origin socket works in dev.
 */
export function TerminalTab({
  featureId,
  sessionId,
}: {
  featureId: string
  sessionId: string
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const session = full.data?.sessions.find((s) => s.id === sessionId)

  const endSession = trpc.feature.endSession.useMutation({
    onSuccess: () => {
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  // Pop out = relaunch via the external Windows Terminal path (UI-SPEC §5). No
  // embedded tab is opened; the user stays where they are.
  const popOut = trpc.feature.launchSession.useMutation({
    onSuccess: () => {
      utils.feature.get.invalidate({ id: featureId })
      toast.push('relaunched in a new window', 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  const status = session?.status ?? 'launching'

  return (
    <div className="terminal-tab">
      <div className="term-strip">
        <span className="term-kind">{session?.kind ?? 'session'}</span>
        <span className="term-cc mono dim">{session?.ccSessionId ?? sessionId}</span>
        <SessionStatusDot status={status} />
        <span className="term-status-label mono dim">{status}</span>
        <span className="term-strip-spacer" />
        <button
          className="btn btn-ghost btn-xs"
          disabled={popOut.isPending || !session}
          onClick={() => session && popOut.mutate({ featureId, kind: session.kind })}
        >
          Pop out ↗
        </button>
        <button
          className="btn btn-ghost btn-xs"
          disabled={endSession.isPending || status === 'ended'}
          onClick={() => endSession.mutate({ sessionId })}
        >
          {endSession.isPending ? 'Ending…' : 'End session'}
        </button>
      </div>

      <div className="term-body">
        {endSession.error && (
          <DimLine>could not end session: {endSession.error.message}</DimLine>
        )}
        <ErrorBoundary label="terminal">
          <TerminalView sessionId={sessionId} />
        </ErrorBoundary>
      </div>
    </div>
  )
}
