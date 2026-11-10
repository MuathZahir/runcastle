import { useEffect, useState, type ReactNode } from 'react'
import { PROJECT_NAME_MAX } from '@runcastle/core'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { useIsPhone } from '../lib/use-phone'
import { cardLines, projectInitials, type PortfolioEntry } from '../lib/portfolio'
import type { Project } from '../lib/api'
import { Button, cx, ListRow, MetaLine, StatusDot, TEXT_INPUT } from '../ui'
import { IconTrash } from '../icons'
import { FeatureActionsMenu } from './FeatureActionsMenu'

/**
 * One project on the All projects page (a-better-way-to-move-between-projects,
 * decision 4), in the approved design's two forms:
 *
 * - {@link ProjectCard}, for a project something waits or runs in: its tile,
 *   name and repo path, what waits on the human (each on its own line with the
 *   one amber dot), what runs where nothing waits, and a foot of counts. The
 *   card enters the project; a feature line opens that feature.
 * - {@link QuietProject}, for a quiet one: one line, its tile and name, that
 *   enters the project.
 *
 * Both keep the project's two actions (Rename, Remove from list) behind a "…"
 * revealed on hover or focus, as every row menu is (DESIGN.md); removal asks on
 * the row, in a sentence that says what it does not do (findings F17.8).
 */

const RENAME_INPUT = `${TEXT_INPUT} h-7 w-full font-medium`

const SIZE = {
  /** Beside a name in a quiet line: 20px. */
  sm: 'size-5 rounded-sm text-xs',
  /** In a card's head: 36px. */
  md: 'size-9 rounded-md text-sm',
} as const

/**
 * A project's mark: its initials in a quiet square, monochrome like the rail.
 * `outline` sits in a line beside the name; `well` inside a card that already
 * has an edge.
 */
export function ProjectTile({ name, size, tone }: { name: string; size: keyof typeof SIZE; tone: 'outline' | 'well' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium tracking-tight select-none',
        SIZE[size],
        tone === 'outline' && 'text-text-tertiary ring-1 ring-border ring-inset',
        tone === 'well' && 'bg-fill-well text-text-secondary',
      )}
    >
      {projectInitials(name)}
    </span>
  )
}

/** Rename in place and remove-with-a-question, shared by the card and the line. */
function useProjectActions(project: Project) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const phone = useIsPhone()
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

  // Escape backs out of the confirmation. The question replaces the face, so
  // the focus may be on either of its two buttons or on nothing at all (the
  // menu item that raised it is gone) — the window is the one listener that
  // answers wherever it landed.
  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  const submitRename = () => {
    const n = name.trim()
    if (n && n !== project.name) rename.mutate({ projectId: project.id, name: n })
    else setRenaming(false)
  }

  const nameInput = (
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
  )

  const question = confirming && (
    <ListRow
      className="animate-fade-in"
      wrap
      title={
        <span className="text-text-secondary">
          Remove <span className="font-medium text-text">{project.name}</span>? The repo on disk is untouched.
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
            disabled={close.isPending}
            onClick={() => close.mutate({ projectId: project.id })}
          >
            {close.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </span>
      }
    />
  )

  // Revealed by hover, which a phone has not got: there a project only opens.
  const menu = !renaming && !phone && (
    <span
      className={cx(
        'flex items-center rounded-md opacity-0 transition-opacity duration-(--dur-1)',
        'group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100',
      )}
    >
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
          { key: 'remove', label: 'Remove from list', danger: true, onSelect: () => setConfirming(true) },
        ]}
      />
    </span>
  )

  return { renaming, nameInput, question, menu }
}

/** The menu's corner, per form. */
function MenuSlot({ children, className }: { children: ReactNode; className: string }) {
  return <span className={cx('absolute', className)}>{children}</span>
}

/**
 * A busy project's card. The face is one button over the whole card (entering
 * the project); the feature lines are buttons of their own above it, so a
 * feature opens straight onto its page.
 */
export function ProjectCard({
  entry,
  onOpen,
  onOpenFeature,
}: {
  entry: PortfolioEntry
  onOpen: () => void
  onOpenFeature: (featureSlug: string) => void
}) {
  const { project, stats } = entry
  const { renaming, nameInput, question, menu } = useProjectActions(project)
  if (question) return question
  const lines = cardLines(entry)

  return (
    <div className="card group/row relative flex min-w-0 flex-col gap-3 rounded-lg p-3.5 text-left transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover">
      {/* A text input inside the card's button is neither valid nor clickable,
          so while the name is edited the card is not the way into the project. */}
      {!renaming && (
        <button
          type="button"
          title={`Open ${project.name}`}
          aria-label={`Open ${project.name}`}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer rounded-[inherit]"
        />
      )}
      <span className="pointer-events-none relative flex min-w-0 items-center gap-3 pr-6">
        <ProjectTile name={project.name} size="md" tone="well" />
        <span className="min-w-0 flex-1">
          {renaming ? (
            <span className="pointer-events-auto block">{nameInput}</span>
          ) : (
            <span className="block truncate text-md font-medium text-text">{project.name}</span>
          )}
          {/* `dir="rtl"` truncates from the left — where a repo path is least
              interesting — and <bdi> keeps the path itself left-to-right. */}
          <span className="block truncate text-left font-mono text-xs text-text-tertiary" dir="rtl" title={project.repoPath}>
            <bdi>{project.repoPath}</bdi>
          </span>
        </span>
      </span>
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1">
        {lines.waiting.map(({ feature, words }) => (
          <button
            key={feature.id}
            type="button"
            title={`Open ${feature.title}`}
            onClick={() => onOpenFeature(feature.slug)}
            className="group/line pointer-events-auto flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm"
          >
            <StatusDot tone="warning" />
            <span className="min-w-0 truncate text-text-secondary group-hover/line:text-text">{feature.title}</span>
            <span className="ml-auto shrink-0 text-xs text-text-tertiary">{words}</span>
          </button>
        ))}
        {lines.moreWaiting > 0 && (
          <span className="pointer-events-none text-xs text-text-tertiary">and {lines.moreWaiting} more</span>
        )}
        {lines.running.map((f) => (
          <button
            key={f.id}
            type="button"
            title={`Open ${f.title}`}
            onClick={() => onOpenFeature(f.slug)}
            className="pointer-events-auto min-w-0 cursor-pointer truncate text-left text-sm text-text-tertiary hover:text-text-secondary"
          >
            {f.title}
          </button>
        ))}
      </span>
      <MetaLine
        className="pointer-events-none relative"
        items={[
          stats.working > 0 && { tone: 'live', strong: stats.working, text: 'running' },
          { strong: stats.total, text: stats.total === 1 ? 'feature' : 'features' },
        ]}
      />
      {menu && <MenuSlot className="top-3 right-2.5">{menu}</MenuSlot>}
    </div>
  )
}

/** A quiet project's one line: its tile and name, entering the project. */
export function QuietProject({ entry, onOpen }: { entry: PortfolioEntry; onOpen: () => void }) {
  const { project } = entry
  const { renaming, nameInput, question, menu } = useProjectActions(project)
  if (question) return question
  if (renaming) {
    return (
      <div className="flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-lg px-3">
        <ProjectTile name={project.name} size="sm" tone="outline" />
        <span className="min-w-0 flex-1">{nameInput}</span>
      </div>
    )
  }
  return (
    <div className="group/row relative flex min-w-0">
      <button
        type="button"
        title={`Open ${project.name}`}
        onClick={onOpen}
        className="flex h-(--row-h) min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-md text-text-secondary transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text"
      >
        <ProjectTile name={project.name} size="sm" tone="outline" />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
      </button>
      {menu && <MenuSlot className="top-1/2 right-1.5 -translate-y-1/2">{menu}</MenuSlot>}
    </div>
  )
}
