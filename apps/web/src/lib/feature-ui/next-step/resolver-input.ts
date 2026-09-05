import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../../api'
import type { MergeConflictState } from '../gates'
import type { BurnDurationStats } from '../run'
import type { DraftBaseMissing } from './types'

export interface NextStepContext {
  driving: boolean
  /** This project's own ticket history, for the pre-burn time expectation (#16b). */
  burnStats?: BurnDurationStats
  mapContent?: string
  conflict?: MergeConflictState | null
  unverifiedDriveKeys?: string[]
  dryRunActive?: boolean
  draftBaseMissing?: DraftBaseMissing
  openNotes?: number
  openDefects?: number
  laterLaps?: string | null
}

export interface ResolverInput {
  full: FeatureFull
  ctx: NextStepContext
  live: FeatureFull['sessions'][number] | undefined
  resumableGrill: boolean
  ticketCount: number
  done: number
  failed: number
  pending: number
  run: FeatureFull['runs'][number] | undefined
  running: boolean
  nextName: Phase | null
  canAdvance: boolean
  promoteLabel: string
}
