import { useEffect, useRef, useState } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureListItem } from '../../lib/api'
import { relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { pathFor } from '../../lib/routes'
import { useToast } from '../../lib/toast'
import { IconCheck, IconInbox, IconPencil, IconSparkle, IconTrash, IconUndo } from '../../icons'
import { Button, Disclosure, EmptyState, IconButton, LINK, NoteThumbnail, TEXT_INPUT } from '../../ui'
import { Lightbox } from '../review/Lightbox'
import { DriveTag, NoteDot, NoteRow } from './NoteRow'

/**
 * The project's note inbox (decisions.md #10, presentation #17) — the pile, and
 * the door that triages it.
 *
 * Notes are never cards in the rail: a jotted observation is not a third kind of
 * thing beside drafts and features, it is raw material. So the inbox is the
 * project page's one aside (DESIGN.md: one aside, opened on demand), read right
 * before triage starts and in the same place triage starts from — a separate
 * route would split one job across two screens. This component is the aside's
 * body; the page owns the Aside frame and its toggle.
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

  const lead = (note: ProjectNote) =>
    note.screenshotUrl ? (
      <NoteThumbnail size="sm" url={note.screenshotUrl} onOpen={setPicture} />
    ) : (
      <NoteDot />
    )

  return (
    <section ref={section} aria-label="Notes" className="flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span className="min-w-0 flex-1 text-xs text-pretty text-text-tertiary">
          Grouped, questioned and routed in a triage chat.
        </span>
        <Button
          size="sm"
          icon={<IconSparkle />}
          className="shrink-0"
          loading={triaging}
          disabled={open.length === 0 || triaging}
          title={open.length === 0 ? 'nothing is open to triage' : undefined}
          onClick={onTriage}
        >
          {`Triage ${open.length}`}
        </Button>
      </div>

      {open.length === 0 ? (
        <EmptyState
          compact
          icon={<IconInbox />}
          title="Inbox clear"
          hint="Every note has been triaged."
        />
      ) : (
        <ul className={LIST}>
          {open.map((note) => (
            <NoteRow
              key={note.id}
              lead={lead(note)}
              when={relTime(note.createdAt)}
              actions={
                <>
                  <IconButton
                    size="sm"
                    label="Edit"
                    icon={<IconPencil />}
                    onClick={() => {
                      setEditing(note.id)
                      setDraft(note.text)
                    }}
                  />
                  {/* Waving a note away without opening a chat for it — the
                      same triage the session does, with outcome "dismissed". */}
                  <IconButton
                    size="sm"
                    label="Dismiss"
                    icon={<IconCheck />}
                    disabled={busy}
                    onClick={() => dismiss.mutate({ noteId: note.id })}
                  />
                  <IconButton
                    size="sm"
                    label="Delete"
                    icon={<IconTrash />}
                    variant="danger-ghost"
                    disabled={busy}
                    onClick={() => remove.mutate({ noteId: note.id })}
                  />
                </>
              }
            >
              {editing === note.id ? (
                <input
                  aria-label="edit this note"
                  className={TEXT_INPUT}
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
                <>
                  <span className="text-text">{note.text}</span>
                  <DriveTag note={note} />
                </>
              )}
            </NoteRow>
          ))}
        </ul>
      )}

      {triaged.length > 0 && (
        <Disclosure title={`${triaged.length} triaged`} className="mx-4 mt-2">
          <ul className="m-0 flex list-none flex-col p-0">
            {triaged.map((note) => (
              <NoteRow
                key={note.id}
                lead={note.screenshotUrl ? lead(note) : null}
                actions={
                  <IconButton
                    size="sm"
                    label="Reopen"
                    icon={<IconUndo />}
                    disabled={busy}
                    onClick={() => reopen.mutate({ noteId: note.id })}
                  />
                }
              >
                <span className="text-text-secondary">{note.text}</span>
                <DriveTag note={note} />
                {/* Where it went, as the record rather than as a control — a
                    triaged note is frozen, so this outlives every action. */}
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-text-tertiary">
                  <span>{note.outcome}</span>
                  <FeatureLink
                    projectId={projectId}
                    feature={featuresQ.data?.find((f) => f.id === note.featureId)}
                  />
                </span>
              </NoteRow>
            ))}
          </ul>
        </Disclosure>
      )}
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </section>
  )
}

/** No preflight (apps/web/STYLE.md): a list states its own reset. */
const LIST = 'm-0 flex list-none flex-col px-1 py-1'

/** Newest first — the pile is read from the top, where the last thing you saw is. */
function byNewest(notes: ProjectNote[]): ProjectNote[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt)
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
      className={LINK}
      href={pathFor({ kind: 'feature', projectId, featureSlug: feature.slug })}
    >
      {feature.title}
    </a>
  )
}
