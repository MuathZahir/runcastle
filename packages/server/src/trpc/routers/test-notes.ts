import * as z from 'zod'
import {
  addNote,
  deleteNote,
  editNote,
  listByFeature,
  promoteMany,
  promoteNote,
  reopenNote,
  triageNotes,
  triagePreview,
  toggleNote,
} from '../../services/test-notes'
import { publicProcedure, router } from '../context'
import { InvalidInputError } from '../../errors'

/**
 * Test-drive notes (SPEC test-drive-improvements): what the human observed while
 * clicking through the feature branch. Thin pass-throughs — the service owns the
 * lifecycle (open ⇄ done, promoted frozen), the events, and the regenerated
 * `test-notes.md`; refusals come back from it as domain errors the context
 * middleware maps.
 *
 * `remove` rather than `delete` because `delete` is a reserved word, and the
 * generated client would read `trpc.notes.delete` as a property access on a
 * keyword.
 */
export const testNotesRouter = router({
  list: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => listByFeature(ctx, input.featureId)),

  // `videoTimestamp` comes from the annotation player and nowhere else — a note
  // typed into the plain input omits it. The PNG that usually goes with it is a
  // separate upload over HTTP (`/api/reviews/note/:noteId/screenshot`), because
  // tRPC's JSON wire is the wrong shape for image bytes.
  add: publicProcedure
    .input(
      z.object({
        featureId: z.string(),
        text: z.string().min(1),
        videoTimestamp: z.number().nonnegative().optional(),
        reviewTicketId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.videoTimestamp !== undefined && !input.reviewTicketId)
        throw new InvalidInputError('a video timestamp must identify its review ticket')
      return addNote(ctx, input.featureId, input.text, 'human', input.videoTimestamp, input.reviewTicketId)
    }),

  edit: publicProcedure
    .input(z.object({ noteId: z.string(), text: z.string().min(1) }))
    .mutation(({ ctx, input }) => editNote(ctx, input.noteId, input.text)),

  remove: publicProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => deleteNote(ctx, input.noteId)),

  toggle: publicProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => toggleNote(ctx, input.noteId)),

  // Returns the frozen note AND its new ticket: the UI needs the ticket to show
  // the reference without waiting for the feature refetch. Kept for the MCP wire
  // and back-compat — the review panel promotes in batches (decisions.md #11).
  promote: publicProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => promoteNote(ctx, input.noteId)),

  // The Address-notes triage: one mutation for the whole selection, because the
  // panel disables every row while any note mutation is in flight — a promotion
  // per checked note would freeze the list for the length of the batch.
  promoteMany: publicProcedure
    .input(z.object({ noteIds: z.array(z.string()).min(1) }))
    .mutation(({ ctx, input }) => promoteMany(ctx, input.noteIds)),

  reopen: publicProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(({ ctx, input }) => reopenNote(ctx, input.noteId)),

  triage: publicProcedure
    .input(z.object({ featureId: z.string(), quickFixIds: z.array(z.string()), quickFixFindingIds: z.array(z.string()), dismissIds: z.array(z.string()), carry: z.boolean() }))
    .mutation(({ ctx, input }) => triageNotes(ctx, input.featureId, input)),

  triagePreview: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => triagePreview(ctx, input.featureId)),
})
