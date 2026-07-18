import { SettingsUpdateInput } from '@runcastle/core'
import * as z from 'zod'
import { getSettings, updateSettings } from '../../services/settings'
import { publicProcedure, router } from '../context'

/**
 * Settings router (SPEC §4, issue #46). `get` resolves the scope-aware settings
 * surface (globals without a project id, `project ?? global` with one); `update`
 * writes a global default or a per-project override. Env-locked fields and
 * type-invalid values are rejected by the service.
 */
export const settingsRouter = router({
  get: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(({ ctx, input }) => getSettings(ctx, input?.projectId)),

  update: publicProcedure
    .input(SettingsUpdateInput)
    .mutation(({ ctx, input }) => updateSettings(ctx, input)),
})
