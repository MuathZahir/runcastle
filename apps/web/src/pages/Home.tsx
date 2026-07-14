import { useState } from 'react'
import { NewFeatureDialog } from '../components/NewFeatureDialog'
import { navigate } from '../lib/router'
import { useToast } from '../lib/toast'
import { trpc } from '../trpc'
import { Button, PhaseBadge } from '../ui'

export function Home() {
  const projectQuery = trpc.project.get.useQuery(undefined, {
    refetchInterval: 5000,
  })

  if (projectQuery.isLoading) return <div className="empty">Loading…</div>
  if (!projectQuery.data) return <InitProject />
  return <FeatureList project={projectQuery.data} />
}

function InitProject() {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [repoPath, setRepoPath] = useState('')

  const init = trpc.project.init.useMutation({
    onError: (e) => toast.push(e.message),
    onSuccess: () => {
      utils.project.get.invalidate()
      toast.push('project initialised', 'success')
    },
  })

  return (
    <div className="init-form card">
      <div className="card-head">
        <h2 className="section-title">Initialise project</h2>
      </div>
      <div className="card-body">
        <p className="muted">
          Point runcastle at a local git repository to begin.
        </p>
        <div className="field">
          <label>Repository path</label>
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="C:\\Users\\you\\Projects\\my-app"
          />
        </div>
        <Button
          variant="primary"
          disabled={!repoPath.trim() || init.isPending}
          onClick={() => init.mutate({ repoPath: repoPath.trim() })}
        >
          {init.isPending ? 'Initialising…' : 'Initialise'}
        </Button>
      </div>
    </div>
  )
}

function FeatureList({
  project,
}: {
  project: { name: string; repoPath: string; mainBranch: string }
}) {
  const [dialog, setDialog] = useState(false)
  const featuresQuery = trpc.feature.list.useQuery(undefined, {
    refetchInterval: 1500,
  })
  const features = featuresQuery.data ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <div className="feature-meta mono muted">
            {project.repoPath} · {project.mainBranch}
          </div>
        </div>
        <Button variant="primary" onClick={() => setDialog(true)}>
          New feature
        </Button>
      </div>

      {features.length === 0 ? (
        <div className="empty">
          No features yet. Create one to start the pipeline.
        </div>
      ) : (
        <div className="feature-grid">
          {features.map((f) => (
            <button
              key={f.id}
              className="feature-card"
              onClick={() => navigate({ name: 'feature', id: f.id })}
            >
              <div className="feature-card-head">
                <span className="feature-card-title">{f.title}</span>
                {f.activeRun && <span className="pulse" title="run active" />}
              </div>
              <div className="feature-card-oneliner muted">{f.oneLiner}</div>
              <div className="feature-card-foot">
                <PhaseBadge phase={f.phase} />
                <span className="mono muted">{f.branch}</span>
                <span className="ticket-counts mono">
                  {f.ticketCounts.total} tickets · {f.ticketCounts.done} done
                  {f.ticketCounts.failed > 0
                    ? ` · ${f.ticketCounts.failed} failed`
                    : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {dialog && <NewFeatureDialog onClose={() => setDialog(false)} />}
    </div>
  )
}
