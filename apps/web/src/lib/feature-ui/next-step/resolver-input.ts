import type { FeatureFull } from '../../api'
import type { MergeConflictState } from '../gates'
import type { DraftBaseMissing } from './types'

export interface NextStepContext {
  driving: boolean
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
  lapTickets: FeatureFull['tickets']
  lapTicketCount: number
  ticketCount: number
  done: number
  failed: number
  pending: number
  run: FeatureFull['runs'][number] | undefined
  running: boolean
}
