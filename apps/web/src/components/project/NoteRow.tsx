import type { ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { driveTag } from '../../lib/project-drive'
import { ListRow, cx } from '../../ui'

/**
 * One note: picture (or its absence), the text, and — at rest — the time. The
 * verbs float over the time and take its place under the pointer or the
 * keyboard's focus; they are always in the tab order, so focusing one is what
 * reveals it.
 *
 * A `ListRow` (`as="li"`, `wrap` — a note is prose, so its text wraps instead
 * of truncating — and `actionsOverlay`), with the hover ground a static row
 * does not otherwise take, so the verbs read as this note's. Shared by the two
 * lists of project notes — the Notes aside on the project page and the project
 * drive's — so a note reads the same in both.
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
    <ListRow
      as="li"
      animate
      wrap
      leading={lead}
      title={<span className="flex flex-col">{children}</span>}
      meta={when}
      actions={actions}
      actionsOverlay
      className={cx('focus-within:bg-surface-hover hover:bg-surface-hover', className)}
    />
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
