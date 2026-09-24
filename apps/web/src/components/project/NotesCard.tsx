import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureListItem } from '../../lib/api'
import { relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { pathFor } from '../../lib/routes'
import { useToast } from '../../lib/toast'
import { IconCheck, IconChevronRight, IconPencil, IconTrash, IconUndo } from '../../icons'
import { BARE_BUTTON, Button, NoteThumbnail } from '../../ui'
import { Lightbox } from '../review/Lightbox'

/**
 * The project's note inbox (decisions.md #10, presentation #17) — the pile, and
 * the door that triages it.
 *
 * Notes are never cards in the rail: a jotted observation is not a third kind of
 * thing beside drafts and features, it is raw material. So the inbox is a card
 * on the project workspace's resting page, read right before triage starts and
 * in the same place triage starts from — a separate route would split one job
 * across two screens.
 *
 * What the card offers is deliberately short of creating work (the Quick form's
 * lesson, `replace-the-quick-door-with-a-draft-door`): edit, delete, dismiss and
 * reopen, and nothing that cuts a feature or a ticket. Routing a note is the
 * project session's job, because it is the only surface that can consult the
 * portfolio first.
 *
 * It reads as a list of one-liners, not a form: each row's verbs are icons that
 * surface on hover and on keyboard focus, in place of the row's time.
 *
 * Hidden entirely until the project has had a note — an empty inbox on a project
 * that has never used one is a control explaining itself to nobody.
 */
export function NotesCard({
  projectId,
  onTriage,
  triaging,
  reveal = false,
  onRevealed,
}: {
  projectId: string
  /** Open a chat briefed to triage. The workspace owns the already-open case. */
  onTriage: () => void
  triaging: boolean
  /**
   * Bring the card into view — capture's View asked for the inbox (decisions
   * #16), and landing on the workspace with the card scrolled off is no answer.
   */
  reveal?: boolean
  /** The reveal has happened; the asker clears its request. */
  onRevealed?: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const notesQ = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // The same key the rail already polls, so the feature a note was routed into
  // can be named without a second fetch.
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [picture, setPicture] = useState<string | null>(null)

  const onError = (e: { message: string }): void => toast.push(e.message)
  // One invalidation for the whole router: the badge's count and this list move
  // together, and every mutation here changes both.
  const refresh = (): void => void utils.projectNotes.invalidate()
  const edit = trpc.projectNotes.edit.useMutation({
    onSuccess: () => {
      refresh()
      setEditing(null)
    },
    onError,
  })
  const remove = trpc.projectNotes.delete.useMutation({ onSuccess: refresh, onError })
  const dismiss = trpc.projectNotes.dismiss.useMutation({ onSuccess: refresh, onError })
  const reopen = trpc.projectNotes.reopen.useMutation({ onSuccess: refresh, onError })

  const notes = notesQ.data ?? []
  // One mutation at a time: the list is about to be refetched, so a second click
  // would act on a row the server is already moving.
  const busy = edit.isPending || remove.isPending || dismiss.isPending || reopen.isPending
  const open = byNewest(notes.filter((n) => n.status === 'open'))
  const triaged = byNewest(notes.filter((n) => n.status === 'triaged'))

  // Keyed on the notes arriving too: the card renders nothing until the list
  // answers, and a request made before then waits for the section to exist.
  const section = useRef<HTMLElement>(null)
  const hasNotes = notes.length > 0
  useEffect(() => {
    if (!reveal || !section.current) return
    section.current.scrollIntoView?.({ block: 'center' })
    onRevealed?.()
  }, [reveal, hasNotes, onRevealed])

  if (!hasNotes) return null

  const save = (noteId: string): void => {
    if (draft.trim() && !edit.isPending) edit.mutate({ noteId, text: draft })
  }

  return (
    <section ref={section} aria-label="Notes" className="rounded-lg border border-hairline bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline-soft py-3 pr-3 pl-4.5">
        <h3 className="m-0 text-base font-semibold text-text">Notes</h3>
        {open.length > 0 && (
          <span
            className="inline-grid h-4.5 min-w-4.5 place-items-center rounded-pill border border-accent-line bg-accent-soft px-1.5 text-xs font-semibold text-accent-hi tabular-nums"
            title={`${open.length} open`}
          >
            {open.length}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-text-3">
          Grouped, questioned and routed in a triage chat.
        </span>
        <Button
          variant="accent"
          className="shrink-0"
          disabled={open.length === 0 || triaging}
          title={open.length === 0 ? 'nothing is open to triage' : undefined}
          onClick={onTriage}
        >
          {triaging ? 'Opening…' : `Triage ${open.length}`}
        </Button>
      </div>

      <ul className={LIST}>
        {open.length === 0 ? (
          <li className="px-4.5 py-3 text-sm text-text-3">
            Nothing open — every note has been triaged.
          </li>
        ) : (
          open.map((note) => (
            <NoteRow
              key={note.id}
              lead={
                note.screenshotUrl ? (
                  <NoteThumbnail size="sm" url={note.screenshotUrl} onOpen={setPicture} />
                ) : (
                  <span className="grid w-10 place-items-center" aria-hidden>
                    <i className="size-1.25 rounded-pill bg-accent-line" />
                  </span>
                )
              }
              when={relTime(note.createdAt)}
              actions={
                <>
                  <RowAction
                    label="Edit"
                    onClick={() => {
                      setEditing(note.id)
                      setDraft(note.text)
                    }}
                  >
                    <IconPencil size={14} />
                  </RowAction>
                  {/* Waving a note away without opening a chat for it — the
                      same triage the session does, with outcome "dismissed". */}
                  <RowAction
                    label="Dismiss"
                    disabled={busy}
                    onClick={() => dismiss.mutate({ noteId: note.id })}
                  >
                    <IconCheck size={14} />
                  </RowAction>
                  <RowAction
                    label="Delete"
                    tone="danger"
                    disabled={busy}
                    onClick={() => remove.mutate({ noteId: note.id })}
                  >
                    <IconTrash size={14} />
                  </RowAction>
                </>
              }
            >
              {editing === note.id ? (
                <input
                  aria-label="edit this note"
                  className={NOTE_INPUT}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditing(null)
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      save(note.id)
                    }
                  }}
                />
              ) : (
                <span className="text-text">{note.text}</span>
              )}
            </NoteRow>
          ))
        )}
      </ul>

      {triaged.length > 0 && (
        <details className="group/tri border-t border-hairline-soft">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4.5 py-2.5 text-sm text-text-3 hover:text-text-2 [&::-webkit-details-marker]:hidden">
            <IconChevronRight
              size={12}
              className="transition-transform duration-(--dur-1) group-open/tri:rotate-90"
            />
            {triaged.length} triaged
          </summary>
          <ul className={LIST}>
            {triaged.map((note) => (
              <NoteRow
                key={note.id}
                lead={
                  note.screenshotUrl ? (
                    <NoteThumbnail size="sm" url={note.screenshotUrl} onOpen={setPicture} />
                  ) : (
                    <span className="w-10" aria-hidden />
                  )
                }
                actions={
                  <RowAction
                    label="Reopen"
                    disabled={busy}
                    onClick={() => reopen.mutate({ noteId: note.id })}
                  >
                    <IconUndo size={14} />
                  </RowAction>
                }
              >
                <span className="text-text-3">{note.text}</span>
                {/* Where it went, as the record rather than as a control — a
                    triaged note is frozen, so this outlives every action. */}
                <span className="mt-px flex flex-wrap items-baseline gap-x-2 text-sm text-text-3">
                  <span>{note.outcome}</span>
                  <FeatureLink
                    projectId={projectId}
                    feature={featuresQ.data?.find((f) => f.id === note.featureId)}
                  />
                </span>
              </NoteRow>
            ))}
          </ul>
        </details>
      )}
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </section>
  )
}

/** No preflight (apps/web/STYLE.md): a list states its own reset. */
const LIST = 'm-0 list-none py-1 pl-0'

const NOTE_INPUT =
  'h-7 w-full min-w-0 rounded-sm border border-accent-line bg-panel-inset px-2 ' +
  'text-base text-text focus:outline-none'

/** Newest first — the pile is read from the top, where the last thing you saw is. */
function byNewest(notes: ProjectNote[]): ProjectNote[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * One dense row: picture (or its absence), the text, and — at rest — the time.
 * The verbs sit beside the time and take its place under the pointer or the
 * keyboard's focus; they are always in the tab order, so focusing one is what
 * reveals it.
 */
function NoteRow({
  lead,
  when,
  actions,
  children,
}: {
  lead: ReactNode
  when?: string
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <li className="group grid min-h-10.5 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline-soft py-1.5 pr-3 pl-4.5 first:border-t-0 focus-within:bg-panel-3 hover:bg-panel-3">
      {lead}
      <div className="flex min-w-0 flex-col text-base wrap-anywhere">{children}</div>
      <div className="flex items-center gap-0.5">
        {when && (
          <span className="pr-1.5 font-mono text-xs text-text-3 tabular-nums group-focus-within:hidden group-hover:hidden">
            {when}
          </span>
        )}
        <span className="flex gap-0.5 opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </span>
      </div>
    </li>
  )
}

type RowActionTone = 'plain' | 'danger'

// Delete names its danger only under the pointer: repeated down a list at rest,
// a red control per row shouts over the notes themselves. The row is already
// the unnamed `group`, so the button's own hover is the named `group/act`.
const ROW_ACTION_HOVER: Record<RowActionTone, string> = {
  plain: 'group-hover/act:text-text',
  danger: 'group-hover/act:text-danger',
}

/**
 * A row's verb as an icon. The label is both its name and its tooltip. The
 * tone sits on a span inside: the unlayered `button { color: inherit }` beats a
 * `text-*` utility written on the button itself (apps/web/STYLE.md).
 */
function RowAction({
  label,
  tone = 'plain',
  disabled,
  onClick,
  children,
}: {
  label: string
  tone?: RowActionTone
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`${BARE_BUTTON} group/act grid size-6.5 cursor-pointer place-items-center rounded-sm p-0 hover:bg-hairline disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className={`flex text-text-3 ${ROW_ACTION_HOVER[tone]}`}>{children}</span>
    </button>
  )
}

/**
 * The feature a note was routed into, as an address. It is an ordinary link
 * rather than a selection callback because the workspace this card sits in has
 * no feature to select — the shell resolves the slug when the address lands.
 */
function FeatureLink({
  projectId,
  feature,
}: {
  projectId: string
  feature: FeatureListItem | undefined
}) {
  if (!feature) return null
  return (
    <a
      className="text-accent-hi underline decoration-dotted"
      href={pathFor({ kind: 'feature', projectId, featureSlug: feature.slug })}
    >
      {feature.title}
    </a>
  )
}
