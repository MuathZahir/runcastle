import type { FeatureFull } from '../../api'
import type { DraftBaseMissing } from './types'

export interface NextStepContext {
  draftBaseMissing?: DraftBaseMissing
  /** The headless runs the server said stopped before they were finished (`unfinishedRuns`). */
  unfinishedRuns?: readonly string[]
}

export interface ResolverInput {
  full: FeatureFull
  ctx: NextStepContext
  live: FeatureFull['sessions'][number] | undefined
}
