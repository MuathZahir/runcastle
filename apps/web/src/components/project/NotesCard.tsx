import { useState, type ReactNode } from 'react'
import type { ProjectNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import type { FeatureListItem } from '../../lib/api'
import { relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { pathFor } from '../../lib/routes'
import { useToast } from '../../lib/toast'
import { Button, DimLine, SectionTitle } from '../../ui'
import { Lightbox } from '../review/Lightbox'

/**
 * The project's note inbox (decisions.md #10) — the pile, and the door that
 * triages it.
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
 * Hidden entirely until the project has had a note — an empty inbox on a project
 * that has never used one is a control explaining itself to nobody.
 */
export function NotesCard({
  projectId,
  onTriage,
  triaging,
}: {
  projectId: string
  /** Open a chat briefed to triage. The workspace owns the already-open case. */
  onTriage: () => void
  triaging: boolean
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

  if (notes.length === 0) return null

  const save = (noteId: string): void => {
    if (draft.trim() && !edit.isPending) edit.mutate({ noteId, text: draft })
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Notes</SectionTitle>
      <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-panel px-6 py-5">
        <div className="flex items-center gap-6">
          <p className="m-0 max-w-[46ch] flex-1 text-sm text-text-2">
            What you jotted while working. The chat clusters them, grills you on what they meant,
            and routes each one.
          </p>
          <Button
            className="shrink-0"
            disabled={open.length === 0 || triaging}
            title={open.length === 0 ? 'nothing is open to triage' : undefined}
            onClick={onTriage}
          >
            {triaging ? 'Opening…' : `Triage ${countOf(open.length, 'note')}`}
          </Button>
        </div>

        {open.length === 0 ? (
          <DimLine>Nothing open — every note has been triaged.</DimLine>
        ) : (
          <div className="flex flex-col">
            {open.map((note) => (
              <NoteLine key={note.id} note={note} onOpenImage={setPicture}>
                {editing === note.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      aria-label="edit this note"
                      className={NOTE_TEXTAREA}
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditing(null)
                          return
                        }
                        if (e.key !== 'Enter' || e.shiftKey) return
                        e.preventDefault()
                        save(note.id)
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        disabled={!draft.trim() || edit.isPending}
                        onClick={() => save(note.id)}
                      >
                        Save
                      </Button>
                      <Button size="xs" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="m-0 text-sm text-pretty whitespace-pre-wrap text-text">
                      {note.text}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        onClick={() => {
                          setEditing(note.id)
                          setDraft(note.text)
                        }}
                      >
                        Edit
                      </Button>
                      {/* Waving a note away without opening a chat for it — the
                          same triage the session does, with outcome "dismissed". */}
                      <Button
                        size="xs"
                        disabled={busy}
                        onClick={() => dismiss.mutate({ noteId: note.id })}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        disabled={busy}
                        onClick={() => remove.mutate({ noteId: note.id })}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </NoteLine>
            ))}
          </div>
        )}

        {triaged.length > 0 && (
          <details className="border-t border-hairline-soft pt-3">
            <summary className="cursor-pointer list-none text-sm text-text-3">
              Triaged ({triaged.length})
            </summary>
            <div className="mt-2 flex flex-col">
              {triaged.map((note) => (
                <NoteLine key={note.id} note={note} onOpenImage={setPicture}>
                  <p className="m-0 text-sm text-pretty whitespace-pre-wrap text-text-2">
                    {note.text}
                  </p>
                  {/* Where it went, as the record rather than as a control — a
                      triaged note is frozen, so this outlives every action. */}
                  <div className="font-mono text-xs text-text-3">{note.outcome}</div>
                  <div className="flex items-center gap-2">
                    <FeatureLink
                      projectId={projectId}
                      feature={featuresQ.data?.find((f) => f.id === note.featureId)}
                    />
                    <Button
                      size="xs"
                      disabled={busy}
                      onClick={() => reopen.mutate({ noteId: note.id })}
                    >
                      Reopen
                    </Button>
                  </div>
                </NoteLine>
              ))}
            </div>
          </details>
        )}
      </div>
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </section>
  )
}

const NOTE_TEXTAREA =
  'min-h-16 w-full resize-y rounded-md border border-hairline bg-panel-inset px-3 py-2 ' +
  'font-mono text-sm text-text placeholder:text-text-4 focus:border-accent-line focus:outline-none'

/** Newest first — the pile is read from the top, where the last thing you saw is. */
function byNewest(notes: ProjectNote[]): ProjectNote[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt)
}

/** `1 note` / `4 notes` — the button's count, spelled so it stays grammatical. */
function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * One row: the picture that justifies the note beside whatever the section makes
 * of it. Evidence-forward, on the anatomy the review notes list already uses —
 * the thumbnail is big enough to read and opens in the app rather than in a bare
 * browser tab.
 */
function NoteLine({
  note,
  onOpenImage,
  children,
}: {
  note: ProjectNote
  onOpenImage: (url: string) => void
  children: ReactNode
}) {
  const picture = note.screenshotUrl
  return (
    <div className="flex gap-3 border-t border-hairline-soft py-3 first:border-t-0">
      {picture && (
        <button
          type="button"
          className="h-[54px] w-24 shrink-0 overflow-hidden rounded-sm border border-hairline bg-black p-0 hover:border-accent-line"
          title="see the whole picture"
          onClick={() => onOpenImage(picture)}
        >
          <img
            src={picture}
            alt="the picture attached to this note"
            className="h-full w-full object-cover"
          />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-mono text-xs text-text-3">{relTime(note.createdAt)}</span>
        {children}
      </div>
    </div>
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
      className="text-sm text-accent underline decoration-dotted"
      href={pathFor({ kind: 'feature', projectId, featureSlug: feature.slug })}
    >
      {feature.title}
    </a>
  )
}
