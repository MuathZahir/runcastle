/**
 * The stages the first-run intro walks a new user through. Product copy, not
 * state: no feature stores where it is among them.
 */
export type PipelineStage = 'planning' | 'building' | 'review' | 'shipped'

export const PHASE_ORDER: PipelineStage[] = ['planning', 'building', 'review', 'shipped']

export const PHASE_TIP: Record<PipelineStage, string> = {
  planning: 'Shape the feature, write its spec, and emit tickets',
  building: 'Agents implement each ticket in a sandbox',
  review: 'Test-drive the branch, plan more work, or merge',
  shipped: 'Merged to main',
}

export { nextStep } from './next-step'
export type { ActionKind, NextStep } from './next-step'
export type { NextStepContext } from './next-step/resolver-input'
