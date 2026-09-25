import type { ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { driveTag } from '../../lib/project-drive'
import { cx } from '../../ui'

/**
 * One note: picture (or its absence), the text, and — at rest — the time. The
 * verbs sit beside the time and take its place under the pointer or the
 * keyboard's focus; they are always in the tab order, so focusing one is what
 * reveals it.
 *
 * It is `ListRow`'s anatomy (leading · title · trailing meta, hover ground,
 * `surface-hover`) with one difference ListRow does not offer: a note is prose,
 * so its text wraps instead of truncating. Shared by the two lists of project
 * notes — the Notes aside on the project page and the project drive's — so a
 * note reads the same in both.
 */
export function NoteRow({
  lead,
  when,
  actions,
  className,
  children,
}: {
  lead: ReactNode
  when?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <li
      className={cx(
        'group grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md px-3 py-2',
        'transition-colors duration-(--dur-1) ease-app focus-within:bg-surface-hover hover:bg-surface-hover',
        'animate-rise-in',
        className,
      )}
    >
      <div className="flex min-h-6 items-center">{lead}</div>
      <div className="flex min-h-6 min-w-0 flex-col justify-center text-sm wrap-anywhere">{children}</div>
      <div className="flex min-h-6 items-center gap-0.5">
        {when && (
          <span
            className={cx(
              'pl-1 text-xs text-text-tertiary tabular-nums',
              actions ? 'group-focus-within:hidden group-hover:hidden' : undefined,
            )}
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
 * The leading mark of a note without a picture: a quiet dot in the thumbnail's
 * column, so the text lines up whether or not a picture came with it.
 */
export function NoteDot() {
  return (
    <span className="grid w-10 place-items-center" aria-hidden>
      <i className="size-1.5 rounded-full bg-text-disabled" />
    </span>
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
    <span className="mt-0.5 font-mono text-xs text-text-tertiary" title={tag.title}>
      {tag.label}
    </span>
  )
}
