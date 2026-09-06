import { nextPhase } from '@runcastle/core'
import type { FeatureFull } from '../../api'
import { activeSession } from '../gates'
import { hasResumable } from '../internal'
import { PHASE_LABELS } from '../pipeline'
import { latestRun } from '../sidebar'
import { resolveDraft } from './draft'
import { resolveIdeation } from './ideation'
import { resolveImplementation } from './implementation'
import { resolveReview } from './review'
import { resolveShipped } from './shipped'
import { resolveSpec } from './spec'
import { resolveTickets } from './tickets'
import type { NextStepContext, ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export * from './types'

export function nextStep(full: FeatureFull, ctx: NextStepContext): NextStep {
  const { feature, tickets, sessions, runs, gate } = full
  const live = activeSession(sessions)
  const resumableGrill = hasResumable(sessions, 'ideation')
  const ticketCount = tickets.length
  const done = tickets.filter((ticket) => ticket.status === 'done').length
  const failed = tickets.filter((ticket) => ticket.status === 'failed').length
  // Non-terminal tickets the burner still has to run — matches the server's
  // `burn` acceptance check (features.ts). Fix tickets from an Iterate session
  // land here as `pending`, driving the review → burn loop-back.
  const pendingTickets = tickets.filter(
    (ticket) =>
      ticket.status !== 'done' && ticket.status !== 'failed' && ticket.status !== 'cancelled',
  )
  const pending = pendingTickets.length
  const run = latestRun(runs)
  const running = run?.status === 'running'
  const nextName = nextPhase(feature)
  const canAdvance =
    !!gate.next && gate.satisfied && gate.next.id !== 'G3' && gate.next.id !== 'G5'
  const promoteLabel = nextName ? `Promote to ${PHASE_LABELS[nextName]}` : 'Promote'
  const input: ResolverInput = {
    full,
    ctx,
    live,
    resumableGrill,
    ticketCount,
    done,
    failed,
    pending,
    pendingTickets,
    run,
    running,
    nextName,
    canAdvance,
    promoteLabel,
  }

  // A parked draft and an archived feature are outside the phase pipeline.
  if (feature.status === 'draft') return resolveDraft(input)
  if (feature.status === 'archived') {
    return {
      kick: 'ARCHIVED',
      title: 'Feature archived',
      desc: 'This feature is archived and out of the pipeline. Unarchive it to pick the work back up.',
      primary: { label: 'Unarchive', kind: 'unarchive' },
      secondary: [],
      busy: false,
    }
  }

  switch (feature.phase) {
    case 'ideation':
      return resolveIdeation(input)
    case 'spec':
      return resolveSpec(input)
    case 'tickets':
      return resolveTickets(input)
    case 'implementation':
      return resolveImplementation(input)
    case 'review':
      return resolveReview(input)
    case 'shipped':
      return resolveShipped(input)
  }
}
