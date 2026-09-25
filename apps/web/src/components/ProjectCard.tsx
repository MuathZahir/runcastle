import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { PROJECT_NAME_MAX } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import type { ProjectStats } from '../lib/projects'
import type { Project } from '../lib/api'
import { Button, cx, MetaLine, TEXT_INPUT } from '../ui'
import { IconFolder, IconTrash } from '../icons'
import { FeatureActionsMenu } from './FeatureActionsMenu'

/**
 * One project on the portfolio home (decision 7): a row with the project's
 * name, its repo path, and a line of facts — features, runs in flight, what
 * needs you — with the whole face a button into the project.
 *
 * Its two actions (Rename, Remove from list) sit behind the row's "…", revealed
 * on hover or focus like every row menu (DESIGN.md). "Close" used to read like
 * a delete of the repo itself and was one irreversible click (findings F17.8):
 * removal asks, on the row, in a sentence that says what it does not do.
 */

/** The row's inner surface — the same box whether it is a button or not. */
const FACE = 'flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left'

/**
 * The face when it *is* the button into the project. There is no preflight
 * (STYLE.md), so a button that names no background or border paints in the user
 * agent's `buttonface` grey inside a 2px outset border.
 */
const FACE_BUTTON = `${FACE} cursor-pointer rounded-md border-0 bg-transparent`

const RENAME_INPUT = `${TEXT_INPUT} h-7 flex-1 font-medium`

/** The reason removal is refused while the project still has a run going. */
const IN_FLIGHT_REASON = 'A run is in flight — it has to finish before this project can go.'

export function ProjectCard({
  project,
  stats,
  loading,
  onOpen,
  index,
}: {
  project: Project
  stats: ProjectStats
  loading: boolean
  onOpen: () => void
  /** Position on first render — the first rows rise in with a short stagger. */
  index?: number
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
          <span className="min-w-0 truncate text-sm font-medium text-text">{project.name}</span>
        )
      }
    />
  )

  const staggered = index !== undefined && index < 8
  return (
    <div
      data-list-row=""
      style={staggered ? ({ '--i': index } as CSSProperties) : undefined}
      className={cx(
        'group/row relative flex min-w-0 items-center rounded-md transition-colors duration-(--dur-1) ease-app',
        !confirming && !renaming && 'hover:bg-surface-hover',
        staggered && 'animate-rise-in [animation-delay:calc(var(--i)*20ms)]',
      )}
    >
      {confirming ? (
        <div className={cx(FACE, 'flex-wrap animate-fade-in')}>
          <p className="m-0 min-w-0 flex-1 text-sm text-text-secondary">
            Remove <span className="font-medium text-text">{project.name}</span>? The repo on disk
            is untouched.
            {runsInFlight && <span className="block text-xs text-text-tertiary">{IN_FLIGHT_REASON}</span>}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<IconTrash />}
              disabled={runsInFlight || close.isPending}
              onClick={() => close.mutate({ projectId: project.id })}
            >
              {close.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      ) : renaming ? (
        <div className={FACE}>{face}</div>
      ) : (
        <button className={FACE_BUTTON} onClick={onOpen} title={`Open ${project.name}`}>
          {face}
        </button>
      )}

      {!confirming && !renaming && (
        <div className="absolute top-1/2 right-2 z-10 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100">
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
 * What a row says about its project. Split out because it is rendered inside a
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
  return (
    <>
      <span className="inline-flex size-4 shrink-0 items-center justify-center self-start pt-0.5 text-icon">
        <IconFolder />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center">{name}</span>
        {/* `dir="rtl"` truncates from the left — where a repo path is least
            interesting — and <bdi> keeps the path itself left-to-right. */}
        <span className="truncate text-left font-mono text-xs text-text-tertiary" dir="rtl" title={project.repoPath}>
          <bdi>{project.repoPath}</bdi>
        </span>
      </span>
      {/* Right padding clears the "…" that appears over this end on hover. */}
      <span className="shrink-0 pr-8">
        {loading ? (
          <span className="text-xs text-text-tertiary">Loading…</span>
        ) : (
          <MetaLine
            className="flex-nowrap"
            items={[
              { strong: stats.total, text: stats.total === 1 ? 'feature' : 'features' },
              stats.activeRuns > 0 && { tone: 'live', strong: stats.activeRuns, text: 'running' },
              stats.needsYou > 0 && { tone: 'warning', strong: stats.needsYou, text: 'needs you' },
            ]}
          />
        )}
      </span>
    </>
  )
}
