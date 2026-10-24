import * as z from 'zod'
import {
  addNote,
  deleteNote,
  editNote,
  listByFeature,
  sendNotes,
} from '../../services/test-notes'
import { leadDeliveryState } from '../../services/lead-delivery'
import { publicProcedure, router } from '../context'
import { InvalidInputError } from '../../errors'

/**
 * Test-drive notes (SPEC test-drive-improvements): what the human observed while
 * clicking through the feature branch. Thin pass-throughs — the service owns the
 * events; refusals come back from it as domain errors the context
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

  // Send to agent (decision 18): every unsent note, as one human message to the
  // feature's lead; an empty send says the drive went fine.
  send: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => sendNotes(ctx, input.featureId)),

  // Whether what was sent has reached an agent yet (decision 28): a sent note
  // is only "Sent to the agent" once nothing older still waits for one.
  delivery: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ input }) => leadDeliveryState(input.featureId)),
})
