import type { DriveState } from '@runcastle/core'
import type { FeatureFull } from '../../api'
import type { MergeConflictState } from '../gates'
import type { BurnDurationStats } from '../run'
import type { DraftBaseMissing } from './types'

export interface NextStepContext {
  driving: boolean
  /**
   * This feature's drive as the SERVER sees it (decision 20) — the same value
   * the evidence stage renders from, so the bar and the stage cannot disagree
   * about what a drive is doing. `driving` above is only this browser's record
   * of a drive it started itself, which is what the bar falls back to while the
   * poll catches up.
   */
  driveState?: DriveState
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
  lapTickets: FeatureFull['tickets']
  lapTicketCount: number
  ticketCount: number
  done: number
  failed: number
  pending: number
  /** The pending rows themselves, for the Burn label's lap breakdown (#28a). */
  pendingTickets: FeatureFull['tickets']
  run: FeatureFull['runs'][number] | undefined
  running: boolean
}
