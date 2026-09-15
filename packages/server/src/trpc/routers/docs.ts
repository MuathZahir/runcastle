import * as z from 'zod'
import { readDoc } from '../../services/knowledge'
import { getFeatureRow } from '../../services/repo'
import { readDocsDigest } from '../../workflows/ticket-burner'
import { publicProcedure, router } from '../context'

export const docsRouter = router({
  read: publicProcedure
    .input(z.object({ featureId: z.string(), relPath: z.string() }))
    .query(({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      return readDoc(ctx, feature, input.relPath)
    }),

  /**
   * What the next burn's docs digest costs EVERY ticket in it, in bytes.
   *
   * The burner's own `readDocsDigest`, not a second count over the same files:
   * the build phase's bar warns over this number and the run timeline's event
   * reports it, and a card that estimated it separately could warn about a size
   * no burn was ever handed.
   */
  digestSize: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      return { bytes: readDocsDigest(feature.projectId, feature.slug).bytes }
    }),
})
