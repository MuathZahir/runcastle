import type { ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { driveTag } from '../../lib/project-drive'

/**
 * One dense row: picture (or its absence), the text, and — at rest — the time.
 * The verbs sit beside the time and take its place under the pointer or the
 * keyboard's focus; they are always in the tab order, so focusing one is what
 * reveals it.
 *
 * Shared by the two lists of project notes — the Notes card and the project
 * drive's rail — so a note reads the same in both.
 */
export function NoteRow({
  lead,
  when,
  actions,
  className = 'py-1.5 pr-3 pl-4.5',
  children,
}: {
  lead: ReactNode
  when?: string
  actions?: ReactNode
  /** The row's padding: the rail is narrower than the card. */
  className?: string
  children: ReactNode
}) {
  return (
    <li
      className={`group grid min-h-10.5 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline-soft first:border-t-0 focus-within:bg-panel-3 hover:bg-panel-3 ${className}`}
    >
      {lead}
      <div className="flex min-w-0 flex-col text-base wrap-anywhere">{children}</div>
      <div className="flex items-center gap-0.5">
        {when && (
          <span
            className={`pr-1.5 font-mono text-xs text-text-3 tabular-nums ${
              actions ? 'group-focus-within:hidden group-hover:hidden' : ''
            }`}
          >
            {when}
          </span>
        )}
        {actions && (
          <span className="flex gap-0.5 opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100">
            {actions}
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * `drive · <branch>` under a note taken during a project drive, the commit it
 * was seen on as its tooltip (project-level-test-drive decision 5). Nothing on
 * any other note.
 */
export function DriveTag({ note }: { note: Pick<ProjectNote, 'driveBranch' | 'driveCommit'> }) {
  const tag = driveTag(note)
  if (!tag) return null
  return (
    <span className="mt-px font-mono text-xs text-drive" title={tag.title}>
      {tag.label}
    </span>
  )
}
