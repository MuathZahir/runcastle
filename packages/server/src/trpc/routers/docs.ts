import * as z from 'zod'
import { readDoc } from '../../services/knowledge'
import { getFeatureRow } from '../../services/repo'
import { publicProcedure, router } from '../context'

export const docsRouter = router({
  read: publicProcedure
    .input(z.object({ featureId: z.string(), relPath: z.string() }))
    .query(({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      return readDoc(ctx, feature, input.relPath)
    }),
})
