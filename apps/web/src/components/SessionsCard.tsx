import type { SessionRow } from '@runcastle/core'
import { shortId } from '../lib/format'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button } from '../ui'

export function SessionsCard({
  featureId,
  sessions,
}: {
  featureId: string
  sessions: SessionRow[]
}) {
  const utils = trpc.useUtils()
  const toast = useToast()

  const launch = trpc.feature.launchSession.useMutation({
    onError: (e) => toast.push(e.message),
    onSuccess: (res) => {
      toast.push(`session ${shortId(res.sessionId)} launched`, 'success')
      utils.feature.get.invalidate({ id: featureId })
    },
  })

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Sessions</h2>
      </div>
      <div className="card-body">
        <div className="row-actions">
          <Button
            variant="primary"
            disabled={launch.isPending}
            onClick={() => launch.mutate({ featureId, kind: 'ideation' })}
          >
            Open ideation terminal
          </Button>
          <Button
            variant="ghost"
            disabled={launch.isPending}
            onClick={() => launch.mutate({ featureId, kind: 'qa' })}
          >
            Open Q&amp;A terminal
          </Button>
        </div>
        {sessions.length === 0 ? (
          <p className="muted">No sessions yet.</p>
        ) : (
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                <span className="mono">{shortId(s.id)}</span>
                <span className="badge">{s.kind}</span>
                <span className={`badge sess-${s.status}`}>{s.status}</span>
                {s.ccSessionId && (
                  <span className="mono muted">cc:{shortId(s.ccSessionId)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
