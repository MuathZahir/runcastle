import { useEffect, useState } from 'react'
import { PROJECT_NAME_MAX } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import type { ProjectStats } from '../lib/projects'
import type { Project } from '../lib/api'
import { Button, ListRow, MetaLine, TEXT_INPUT } from '../ui'
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

const RENAME_INPUT = `${TEXT_INPUT} h-7 w-full font-medium`

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

  const nameCell = renaming ? (
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
    <span className="block truncate font-medium">{project.name}</span>
  )

  if (confirming) {
    return (
      <ListRow
        className="animate-fade-in"
        wrap
        title={
          <span className="text-text-secondary">
            Remove <span className="font-medium text-text">{project.name}</span>? The repo on disk is untouched.
            {runsInFlight && <span className="block text-xs text-text-tertiary">{IN_FLIGHT_REASON}</span>}
          </span>
        }
        control={
          <span className="flex shrink-0 gap-2 pr-3">
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
          </span>
        }
      />
    )
  }

  return (
    <ListRow
      index={index}
      leading={<IconFolder />}
      title={nameCell}
      // `dir="rtl"` truncates from the left — where a repo path is least
      // interesting — and <bdi> keeps the path itself left-to-right.
      description={
        <span className="block truncate text-left font-mono" dir="rtl" title={project.repoPath}>
          <bdi>{project.repoPath}</bdi>
        </span>
      }
      meta={
        loading ? (
          'Loading…'
        ) : (
          <MetaLine
            className="flex-nowrap"
            items={[
              { strong: stats.total, text: stats.total === 1 ? 'feature' : 'features' },
              stats.activeRuns > 0 && { tone: 'live', strong: stats.activeRuns, text: 'running' },
              stats.needsYou > 0 && { tone: 'warning', strong: stats.needsYou, text: 'needs you' },
            ]}
          />
        )
      }
      // A text input nested in a button is neither valid nor clickable, so
      // while the name is being edited the row is not the button into the
      // project.
      onClick={renaming ? undefined : onOpen}
      tooltip={`Open ${project.name}`}
      actionsOverlay
      actions={
        !renaming && (
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
        )
      }
    />
  )
}
