import type { FeatureFull } from '../../api'
import { activeSession } from '../gates'
import { hasResumable } from '../internal'
import { pendingTickets } from '../laps'
import { latestRun } from '../sidebar'
import { resolveBuilding } from './building'
import { resolveDraft } from './draft'
import { resolvePlanning } from './planning'
import { resolveReview } from './review'
import { resolveShipped } from './shipped'
import type { NextStepContext, ResolverInput } from './resolver-input'
import type { NextStep } from './types'

export * from './chat'
export * from './types'

export function nextStep(full: FeatureFull, ctx: NextStepContext): NextStep {
  const { feature, tickets, sessions, runs } = full
  const live = activeSession(sessions)
  const resumableChat = hasResumable(sessions, 'chat')
  const lapTickets = tickets.filter((ticket) => ticket.lap === feature.lap)
  const lapTicketCount = lapTickets.filter((ticket) => ticket.status !== 'cancelled').length
  const ticketCount = tickets.length
  const done = tickets.filter((ticket) => ticket.status === 'done').length
  const failed = tickets.filter((ticket) => ticket.status === 'failed').length
  const burnable = pendingTickets(tickets)
  const pending = burnable.length
  const run = latestRun(runs)
  const running = run?.status === 'running'
  const input: ResolverInput = {
    full,
    ctx,
    live,
    resumableChat,
    lapTickets,
    lapTicketCount,
    ticketCount,
    done,
    failed,
    pending,
    pendingTickets: burnable,
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

  // One resolver per state (decision 3): the six the pipeline used to need
  // collapsed with it, and the three planning sub-steps are derived inside
  // `resolvePlanning` from the artifacts rather than dispatched to from here.
  switch (feature.phase) {
    case 'planning':
      return resolvePlanning(input)
    case 'building':
      return resolveBuilding(input)
    case 'review':
      return resolveReview(input)
    case 'shipped':
      return resolveShipped(input)
  }
}
