import type { ProjectNote, TestNote } from '@runcastle/core'
import { trpc } from '../../trpc'
import { relTime } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { splitDriveNotes } from '../../lib/project-drive'
import { uploadProjectNoteScreenshot } from '../../lib/project-notes'
import { toPngBlob, uploadScreenshot } from '../../lib/reviews'
import { useToast } from '../../lib/toast'
import type { DriveNote } from './DriveNotes'
import type { DriveNoteStore } from './DrivePage'
import { unsentNotes } from './SendToAgent'

/**
 * The two places a drive's notes live, as the one shape the drive page reads
 * (test-drive-looks-the-part decision 14): a feature's test notes, which go to
 * its agent, and the project's notes, which wait in its Notes inbox.
 */

const oldestFirst = <T extends { createdAt: number }>(notes: readonly T[]): T[] =>
  [...notes].sort((a, b) => a.createdAt - b.createdAt)

function driveNote(note: TestNote | ProjectNote): DriveNote {
  return {
    id: note.id,
    text: note.text,
    when: relTime(note.createdAt),
    ...(note.screenshotUrl ? { picture: note.screenshotUrl } : {}),
    ...('author' in note && note.author === 'agent' ? { by: 'Review agent' } : {}),
  }
}

/** A feature's notes: its open ones, what went to the agent, and the Send that goes there. */
export function featureNoteList(notes: readonly TestNote[]): { open: TestNote[]; sent: TestNote[] } {
  const live = oldestFirst(notes).filter((n) => n.status === 'open' || n.status === 'carried')
  return { open: live.filter((n) => n.sentAt === undefined), sent: live.filter((n) => n.sentAt !== undefined) }
}

export function useFeatureDriveNotes(featureId: string, onSent: () => void): DriveNoteStore {
  const utils = trpc.useUtils()
  const toast = useToast()
  const list = trpc.notes.list.useQuery({ featureId })
  const refresh = () => void utils.notes.list.invalidate({ featureId })
  const fail = (e: { message: string }) => toast.push(e.message)
  const add = trpc.notes.add.useMutation()
  const edit = trpc.notes.edit.useMutation({ onSuccess: refresh, onError: fail })
  const remove = trpc.notes.remove.useMutation({ onSuccess: refresh, onError: fail })
  const send = trpc.notes.send.useMutation({
    onSuccess: () => {
      refresh()
      void utils.notes.delivery.invalidate({ featureId })
    },
    onError: fail,
  })
  const notes = list.data ?? []
  const { open, sent } = featureNoteList(notes)
  return {
    notes: open.map(driveNote),
    sent: sent.map(driveNote),
    send: {
      count: unsentNotes(notes).length,
      // Sending hands the work over, so the human goes where the answer comes
      // (test-drive-looks-the-part decision 19), without waiting for the send.
      run: () => {
        send.mutate({ featureId })
        onSent()
      },
    },
    add: async (text, picture) => {
      const note = await add.mutateAsync({ featureId, text })
      if (picture) {
        await uploadScreenshot(note.id, picture).catch((e: unknown) =>
          toast.push(`the note was saved, but its picture was not: ${e instanceof Error ? e.message : String(e)}`),
        )
      }
      refresh()
    },
    onEdit: (noteId, text) => edit.mutate({ noteId, text }),
    onDelete: (noteId) => remove.mutate({ noteId }),
    onPicture: (noteId, file) => {
      toPngBlob(file)
        .then((png) => uploadScreenshot(noteId, png))
        .then(refresh)
        .catch((e: unknown) => toast.push(e instanceof Error ? e.message : 'that picture could not be attached'))
    },
  }
}

export function useProjectDriveNotes(projectId: string, startedAt: number | undefined): DriveNoteStore {
  const utils = trpc.useUtils()
  const toast = useToast()
  const list = trpc.projectNotes.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const refresh = () => void utils.projectNotes.invalidate()
  const fail = (e: { message: string }) => toast.push(e.message)
  const add = trpc.projectNotes.add.useMutation()
  const edit = trpc.projectNotes.edit.useMutation({ onSuccess: refresh, onError: fail })
  const remove = trpc.projectNotes.delete.useMutation({ onSuccess: refresh, onError: fail })
  const { thisDrive, alreadyOpen } = splitDriveNotes(list.data ?? [], startedAt)
  return {
    notes: oldestFirst(thisDrive).map(driveNote),
    earlier: { title: 'Already open', notes: oldestFirst(alreadyOpen).map(driveNote) },
    add: async (text, picture) => {
      const note = await add.mutateAsync({ projectId, text })
      if (picture) {
        await uploadProjectNoteScreenshot(note.id, picture).catch((e: unknown) =>
          toast.push(`the note was saved, but its picture was not: ${e instanceof Error ? e.message : String(e)}`),
        )
      }
      refresh()
    },
    onEdit: (noteId, text) => edit.mutate({ noteId, text }),
    onDelete: (noteId) => remove.mutate({ noteId }),
    onPicture: (noteId, file) => {
      toPngBlob(file)
        .then((png) => uploadProjectNoteScreenshot(noteId, png))
        .then(refresh)
        .catch((e: unknown) => toast.push(e instanceof Error ? e.message : 'that picture could not be attached'))
    },
  }
}
