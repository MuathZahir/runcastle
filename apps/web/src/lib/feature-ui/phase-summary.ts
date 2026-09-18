import type { EventRow, Phase } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { countDecisions } from './artifact'

export type SummaryPhase = Extract<Phase, 'planning'>
export function isSummaryPhase(phase: Phase): phase is SummaryPhase { return phase === 'planning' }

export interface PhaseSummaryInput {
  phase: Phase
  full: Pick<FeatureFull, 'feature' | 'sessions' | 'tickets' | 'waypoints' | 'docs'>
  events: readonly EventRow[]
  decisions?: string
}

export function phaseSummary(input: PhaseSummaryInput): string | null {
  const facts = phaseFacts(input)
  return isSummaryPhase(input.phase) ? `Planning${facts ? ` · ${facts}` : ''}` : null
}

export function phaseFacts({ phase, full, decisions }: PhaseSummaryInput): string | null {
  if (!isSummaryPhase(phase)) return null
  const facts = [`${full.tickets.length} tickets`]
  if (decisions !== undefined) facts.unshift(`${countDecisions(decisions)} decisions`)
  if (full.feature.mapped) facts.push(`${full.waypoints.length} waypoints`)
  return facts.join(' · ')
}

export interface PhaseWindow { from?: number; to?: number }
export function phaseWindow(_phase: SummaryPhase, full: Pick<FeatureFull, 'feature'>, events: readonly EventRow[]): PhaseWindow {
  const to = events.find((event) => (event.data as { to?: unknown } | null)?.to === 'building')?.ts
  return { from: full.feature.createdAt, to }
}
