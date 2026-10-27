import type { FeatureFull } from '../../api'
import type { DraftBaseMissing } from './types'

export interface NextStepContext {
  draftBaseMissing?: DraftBaseMissing
}

export interface ResolverInput {
  full: FeatureFull
  ctx: NextStepContext
  live: FeatureFull['sessions'][number] | undefined
}
