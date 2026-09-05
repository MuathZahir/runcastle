export interface LaneTicketFigure {
  seq: number
  status: string
  error?: string | null
  hadOutput?: boolean
  orphaned?: boolean
  kind?: string
  reviewFix?: boolean
}

export type LaneState = 'pending' | 'burning' | 'done' | 'failed' | 'stopped' | 'launch-failed' | 'waived'

const stopped = (ticket: LaneTicketFigure) => ticket.error?.toLowerCase().startsWith('stopped by user') || ticket.orphaned || ticket.error?.toLowerCase().includes('orphaned')
const launchError = (error = '') => /\b(?:git|docker|podman|mount|sandbox)\b/i.test(error)

export function laneState(ticket: LaneTicketFigure): LaneState {
  if (ticket.status === 'cancelled') return 'waived'
  if (ticket.status === 'failed') {
    if (stopped(ticket)) return 'stopped'
    if (ticket.hadOutput === false && launchError(ticket.error ?? '')) return 'launch-failed'
    return 'failed'
  }
  if (ticket.status === 'done') return 'done'
  if (ticket.status === 'burning' || ticket.status === 'running') return 'burning'
  return 'pending'
}

export function verdictStrip(ticket: LaneTicketFigure): { text: string; hint?: string } | null {
  if (!['failed', 'launch-failed'].includes(laneState(ticket))) return null
  const error = ticket.error?.trim() || 'The ticket did not complete.'
  const text = /agent made no commits/i.test(error)
    ? 'The burner verifies commits landed on the ticket branch — none did'
    : laneState(ticket) === 'launch-failed' ? 'The agent sandbox never started.' : error
  const hint = /windows|path too long|long path/i.test(error) ? 'A long Windows path may have prevented the sandbox mount.' : undefined
  return { text, ...(hint ? { hint } : {}) }
}

export function summaryCounts(tickets: readonly LaneTicketFigure[]) {
  return {
    done: tickets.filter((t) => laneState(t) === 'done').length,
    failed: tickets.filter((t) => ['failed', 'launch-failed'].includes(laneState(t))).length,
    stopped: tickets.filter((t) => laneState(t) === 'stopped').length,
    waived: tickets.filter((t) => laneState(t) === 'waived').length,
  }
}

export function runHeadline(tickets: readonly LaneTicketFigure[], _run: object = {}, retryOf?: number): string {
  if (retryOf !== undefined) return `Retrying #${retryOf}`
  const implementation = tickets.filter((t) => t.kind !== 'review' && !t.reviewFix).length
  const fixes = tickets.filter((t) => t.reviewFix).length
  const counts = summaryCounts(tickets)
  const parts = [`Burning ${implementation} ticket${implementation === 1 ? '' : 's'}`]
  if (fixes) parts.push(`+${fixes} fixes from review`)
  if (counts.done) parts.push(`${counts.done} done`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.stopped) parts.push(`${counts.stopped} stopped`)
  if (counts.waived) parts.push(`${counts.waived} waived`)
  return parts.join(' · ')
}

export function stripProtocolTokens(text: string): string {
  return text.replace(/<promise>\s*COMPLETE\s*<\/promise>/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function repoRelative(path: string): string {
  return path.replace(/^.*?(?:\/|\\)repo(?:\/|\\)/, '')
}
