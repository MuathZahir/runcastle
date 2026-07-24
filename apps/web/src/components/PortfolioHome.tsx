import { useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { projectStats, type ProjectStats } from '../lib/projects'
import type { ProjectNavApi } from '../lib/use-project-nav'
import type { Project } from '../lib/api'
import { IconBranch, IconPlus } from '../icons'

/**
 * The portfolio home (issue #45): the canonical cross-project surface. One card
 * per open project, each reflecting live pipeline health, active-run count, and
 * needs-you count, and clicking through into the project. Rename and close are
 * reachable per card; close refuses (surfacing the server error) while any run
 * is in flight. An "Open a project" card is always present.
 */
export function PortfolioHome({ nav }: { nav: ProjectNavApi }) {
  const projects = nav.projects ?? []

  // One feature.list per project — the cards' health/runs/needs-you are derived
  // client-side, and the same polling powers the aggregate runs pill upstairs.
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: 1500 })),
  )

  return (
    <div className="home-frame">
      <header className="home-topbar">
        <span className="tb-home">
          <span className="tb-logo mono">r</span>
          <span className="tb-app">runcastle</span>
        </span>
        <span className="tb-spacer" />
        <button className="btn btn-ghost btn-xs" onClick={nav.showOpen}>
          <IconPlus size={11} />
          Open a project
        </button>
      </header>

      <div className="home">
        <header className="home-head">
          <div className="home-title">
            <span className="home-title-text">Projects</span>
            <span className="home-count">{projects.length}</span>
          </div>
          <p className="home-sub">
            Every open project and where it stands — runs keep going in the
            background while you switch.
          </p>
        </header>

        <div className="home-grid">
          {projects.map((p, i) => {
            const features = featureQueries[i]?.data
            const stats = projectStats(features ?? [])
            return (
              <ProjectCard
                key={p.id}
                project={p}
                stats={stats}
                loading={features === undefined}
                onOpen={() => nav.enterProject(p.id)}
              />
            )
          })}

          <button className="open-card" onClick={nav.showOpen}>
            <span className="open-card-plus">
              <IconPlus size={16} />
            </span>
            <span className="open-card-label">Open a project</span>
            <span className="open-card-sub">Point runcastle at a local git repo</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const HEALTH_LABEL: Record<ProjectStats['health'], string> = {
  attention: 'Needs you',
  working: 'Agent working',
  steady: 'Steady',
  empty: 'No features yet',
}

function ProjectCard({
  project,
  stats,
  loading,
  onOpen,
}: {
  project: Project
  stats: ProjectStats
  loading: boolean
  onOpen: () => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)

  const rename = trpc.project.rename.useMutation({
    onSuccess: async () => {
      await utils.project.list.invalidate()
      setRenaming(false)
    },
    onError: (e) => toast.push(e.message),
  })
  const close = trpc.project.close.useMutation({
    onSuccess: async () => {
      await utils.project.list.invalidate()
      toast.push(`closed ${project.name}`, 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  const runsInFlight = stats.activeRuns > 0
  const submitRename = () => {
    const n = name.trim()
    if (n && n !== project.name) rename.mutate({ projectId: project.id, name: n })
    else setRenaming(false)
  }

  return (
    <div className={`project-card health-${stats.health}`}>
      <button className="pc-main" onClick={onOpen} title={`Open ${project.name}`}>
        <div className="pc-head">
          {renaming ? (
            <input
              className="pc-rename mono"
              value={name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') {
                  setName(project.name)
                  setRenaming(false)
                }
              }}
              onBlur={submitRename}
            />
          ) : (
            <span className="pc-name">{project.name}</span>
          )}
          <span className={`pc-health-dot health-dot-${stats.health}`} title={HEALTH_LABEL[stats.health]} />
        </div>
        <span className="pc-path mono">{project.repoPath}</span>
        <span className="pc-branch">
          <IconBranch size={11} />
          {project.mainBranch}
        </span>

        <div className="pc-stats">
          <Stat n={stats.total} label={stats.total === 1 ? 'feature' : 'features'} />
          <Stat n={stats.activeRuns} label="running" tone={runsInFlight ? 'run' : undefined} spin={runsInFlight} />
          <Stat n={stats.needsYou} label="needs you" tone={stats.needsYou > 0 ? 'needs' : undefined} />
        </div>
        <span className="pc-health-label">{loading ? 'loading…' : HEALTH_LABEL[stats.health]}</span>
      </button>

      <div className="pc-actions">
        <button
          className="pc-action"
          onClick={() => {
            setName(project.name)
            setRenaming(true)
          }}
        >
          Rename
        </button>
        <button
          className="pc-action pc-action-danger"
          disabled={runsInFlight || close.isPending}
          title={runsInFlight ? 'a run is in flight — cannot close' : 'Close project'}
          onClick={() => close.mutate({ projectId: project.id })}
        >
          Close
        </button>
      </div>
    </div>
  )
}

function Stat({
  n,
  label,
  tone,
  spin,
}: {
  n: number
  label: string
  tone?: 'run' | 'needs'
  spin?: boolean
}) {
  return (
    <span className={`pc-stat${tone ? ` pc-stat-${tone}` : ''}`}>
      {spin && <span className="spin-ring" />}
      <span className="pc-stat-n">{n}</span>
      <span className="pc-stat-label">{label}</span>
    </span>
  )
}
