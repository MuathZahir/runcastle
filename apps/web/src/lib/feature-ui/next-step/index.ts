import type { FeatureFull } from '../../api'
import { activeSession } from '../gates'
import { hasResumable } from '../internal'
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
  const lapTickets = tickets.filter((ticket) => ticket.lap === feature.lap)
  const lapTicketCount = lapTickets.filter((ticket) => ticket.status !== 'cancelled').length
  const ticketCount = tickets.length
  const done = tickets.filter((ticket) => ticket.status === 'done').length
  const failed = tickets.filter((ticket) => ticket.status === 'failed').length
  // Non-terminal tickets the burner still has to run — matches the server's
  // `burn` acceptance check (features.ts). Fix tickets from an Iterate session
  // land here as `pending`, driving the review → burn loop-back.
  const pending = tickets.filter(
    (ticket) =>
      ticket.status !== 'done' && ticket.status !== 'failed' && ticket.status !== 'cancelled',
  ).length
  const run = latestRun(runs)
  const running = run?.status === 'running'
  const input: ResolverInput = {
    full,
    ctx,
    live,
    resumableGrill,
    lapTickets,
    lapTicketCount,
    ticketCount,
    done,
    failed,
    pending,
    run,
    running,
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
