import * as z from 'zod'
import {
  addNote, deleteNote, dismissNote, editNote, listNotes, openCount, reopenNote, triageNotes,
} from '../../services/project-notes'
import { publicProcedure, router } from '../context'

export const projectNotesRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => listNotes(ctx, input.projectId)),
  openCount: publicProcedure.input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => openCount(ctx, input.projectId)),
  add: publicProcedure.input(z.object({ projectId: z.string(), text: z.string() }))
    .mutation(({ ctx, input }) => addNote(ctx, input.projectId, input.text)),
  edit: publicProcedure.input(z.object({ noteId: z.string(), text: z.string() }))
    .mutation(({ ctx, input }) => editNote(ctx, input.noteId, input.text)),
  delete: publicProcedure.input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => deleteNote(ctx, input.noteId)),
  dismiss: publicProcedure.input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => dismissNote(ctx, input.noteId)),
  reopen: publicProcedure.input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => reopenNote(ctx, input.noteId)),
  triage: publicProcedure.input(z.object({
    noteIds: z.array(z.string()).min(1), outcome: z.string(), featureId: z.string().optional(),
  })).mutation(({ ctx, input }) => triageNotes(ctx, input.noteIds, input.outcome, input.featureId)),
})
