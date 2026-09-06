import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PROJECT_NAME_MAX } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import type { ProjectHealth, ProjectStats } from '../lib/projects'
import type { Project } from '../lib/api'
import { Button, Spinner } from '../ui'
import { FeatureActionsMenu } from './FeatureActionsMenu'

/**
 * One project on the portfolio home (decision 7): name, repo path, the three
 * stats and the health label, with the whole face a button into the project.
 *
 * Its two actions used to be a pair of small buttons that only appeared on
 * hover — undiscoverable, and one of them said "Close", which reads like a
 * delete of the repo itself and was a single irreversible click (findings
 * F17.8). They now live behind an always-visible `⋯` menu, and removal asks on
 * the card, in a sentence that says what it does not do.
 */

const HEALTH_LABEL: Record<ProjectHealth, string> = {
  attention: 'Needs you',
  working: 'Agent working',
  steady: 'Steady',
  empty: 'No features yet',
}

/** Whole literal classes per health, so Tailwind's scanner can see them. */
const HEALTH_DOT: Record<ProjectHealth, string> = {
  attention: 'bg-needs',
  working: 'bg-ph-implementation animate-pulse',
  steady: 'bg-ok',
  empty: 'bg-text-4',
}

/** The card's inner surface — the same box whether it is a button or not. */
const FACE = 'flex flex-1 flex-col gap-1.5 p-4 text-left'

/**
 * The face when it *is* the button into the project. The app ships no CSS reset
 * while the legacy sheet is alive (STYLE.md: "do not assume a reset: style what
 * you render"), so without these three the whole card body paints in the user
 * agent's `buttonface` grey, behind the dark theme's near-white text, inside a
 * 2px outset border. `.pc-main` used to say exactly this in the stylesheet.
 */
const FACE_BUTTON = `${FACE} cursor-pointer border-0 bg-transparent`

const CARD =
  'relative flex flex-col rounded-lg border border-hairline bg-panel ' +
  'transition-[border-color] duration-(--dur-2) ease-app hover:border-hairline-strong'

const RENAME_INPUT =
  'h-6 min-w-0 flex-1 rounded-sm border border-accent-line bg-panel-inset px-1.5 ' +
  'text-base text-text focus:outline-none'

/** The reason removal is refused while the project still has a run going. */
const IN_FLIGHT_REASON = 'A run is in flight — it has to finish before this project can go.'

export function ProjectCard({
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
  const [confirming, setConfirming] = useState(false)
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
      toast.push(`removed ${project.name}`, 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  // Escape backs out of the confirmation. The question replaces the card face,
  // so the focus may be on either of its two buttons or on nothing at all
  // (the menu item that raised it is gone) — the window is the one listener
  // that answers wherever it landed.
  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  const runsInFlight = stats.activeRuns > 0
  const submitRename = () => {
    const n = name.trim()
    if (n && n !== project.name) rename.mutate({ projectId: project.id, name: n })
    else setRenaming(false)
  }

  const face = (
    <CardFace
      project={project}
      stats={stats}
      loading={loading}
      name={
        renaming ? (
          <input
            className={RENAME_INPUT}
            value={name}
            aria-label="Project name"
            // Same cap the server enforces (findings F20) — refusing the 81st
            // keystroke beats a rejection toast after the fact.
            maxLength={PROJECT_NAME_MAX}
            autoFocus
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
          <span className="min-w-0 flex-1 truncate text-lg font-semibold text-text">
            {project.name}
          </span>
        )
      }
    />
  )

  return (
    <div className={CARD}>
      {confirming ? (
        <div className={FACE}>
          <p className="text-base text-text-2">
            Remove <span className="font-semibold text-text">{project.name}</span>? The repo on disk
            is untouched.
          </p>
          <div className="mt-auto flex gap-2 pt-3">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={runsInFlight || close.isPending}
              onClick={() => close.mutate({ projectId: project.id })}
            >
              {close.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
          {runsInFlight && <p className="pt-2 text-sm text-text-3">{IN_FLIGHT_REASON}</p>}
        </div>
      ) : renaming ? (
        <div className={FACE}>{face}</div>
      ) : (
        <button className={FACE_BUTTON} onClick={onOpen} title={`Open ${project.name}`}>
          {face}
        </button>
      )}

      {!confirming && (
        <div className="absolute top-2 right-2 z-10">
          <FeatureActionsMenu
            label={`${project.name} actions`}
            actions={[
              {
                key: 'rename',
                label: 'Rename',
                onSelect: () => {
                  setName(project.name)
                  setRenaming(true)
                },
              },
              {
                key: 'remove',
                label: 'Remove from list',
                danger: true,
                onSelect: () => setConfirming(true),
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}

/**
 * What a card says about its project. Split out because it is rendered inside a
 * button (the whole face opens the project) and, while the name is being
 * edited, inside a plain div — a text input nested in a button is neither valid
 * nor clickable.
 */
function CardFace({
  project,
  stats,
  loading,
  name,
}: {
  project: Project
  stats: ProjectStats
  loading: boolean
  name: ReactNode
}) {
  const runsInFlight = stats.activeRuns > 0
  return (
    <>
      {/* right padding clears the ⋯ menu floating over this corner */}
      <div className="flex min-w-0 items-center gap-2 pr-7">
        {name}
        <span
          className={`size-2 shrink-0 rounded-pill ${HEALTH_DOT[stats.health]}`}
          title={HEALTH_LABEL[stats.health]}
        />
      </div>
      {/* `dir="rtl"` truncates from the left — where a repo path is least
          interesting — and <bdi> keeps the path itself left-to-right inside it. */}
      <div
        className="truncate text-left font-mono text-xs text-text-4"
        dir="rtl"
        title={project.repoPath}
      >
        <bdi>{project.repoPath}</bdi>
      </div>

      <div className="mt-2.5 flex gap-4">
        <Stat n={stats.total} label={stats.total === 1 ? 'feature' : 'features'} />
        <Stat
          n={stats.activeRuns}
          label="running"
          tone={runsInFlight ? 'text-ph-implementation' : undefined}
          spin={runsInFlight}
        />
        <Stat
          n={stats.needsYou}
          label="needs you"
          tone={stats.needsYou > 0 ? 'text-needs' : undefined}
        />
      </div>
      <div className="mt-3 text-xs tracking-[0.06em] text-text-4 uppercase">
        {loading ? 'loading…' : HEALTH_LABEL[stats.health]}
      </div>
    </>
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
  /** A whole literal text colour class, or the default emphasis. */
  tone?: string
  spin?: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-text-3">
      {spin && <Spinner className="self-center" />}
      <span className={`font-mono text-lg ${tone ?? 'text-text'}`}>{n}</span>
      <span className="text-xs">{label}</span>
    </span>
  )
}
