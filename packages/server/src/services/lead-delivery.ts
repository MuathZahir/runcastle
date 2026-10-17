import type { Feature, ReviewGateRun } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { writeToLiveTerminal } from '../launcher/launcher'
import { activeSessionsForFeature } from '../launcher/sessions'
import { emit } from './events'
import { markHumanMessage } from './lead-status'
import { bracketedPaste } from './orchestrator-delivery'
import { getRunRow } from './repo'
import { listByFeature as listFindings } from './review-findings'
import { listRounds, runClaimedTicketIds } from './runs'
import { listByIds } from './tickets'

/**
 * The one way anything reaches a feature's lead (`the-feature-lead-runs-rounds`
 * spec, "Waking the lead"): runcastle's own wakes (Go, a round's end, Stop) and
 * the human's messages (Send to agent, the orchestrator's `send_to_feature`).
 *
 * `source` is what tells the two apart for the Ask-mode dispatch check: only a
 * `human` message stamps the feature's last-human-message mark.
 */
export interface LeadMessage {
  text: string
  source: 'human' | 'runcastle'
}

/**
 * Deliver `msg` to the feature's lead. The SIGNATURE is the contract — the
 * waiter, `codex queue` and headless-resume paths replace the internals, never
 * the shape.
 *
 * For now: a live chat terminal gets the message typed in, as one bracketed
 * paste so its lines stay lines; with no live chat the message is recorded as
 * `lead.message_pending`, where the timeline shows it.
 */
export async function deliverToLead(ctx: AppCtx, feature: Feature, msg: LeadMessage): Promise<void> {
  if (msg.source === 'human') markHumanMessage(ctx, feature.id)
  const live = activeSessionsForFeature(ctx, feature.id).find(
    (s) => s.kind === 'chat' && s.status === 'live' && !s.headless,
  )
  if (live && writeToLiveTerminal(live.id, bracketedPaste(msg.text))) {
    emit(ctx, feature.id, {
      type: 'lead.message_delivered',
      message: `message delivered to the agent (${msg.source})`,
      data: { source: msg.source, sessionId: live.id, text: msg.text },
    })
    return
  }
  emit(ctx, feature.id, {
    type: 'lead.message_pending',
    message: `message waiting for the agent (${msg.source})`,
    data: { source: msg.source, text: msg.text },
  })
}

/** One line on a round's verify gates, for the wake message. */
function gatesLine(gates: ReviewGateRun | undefined): string {
  if (!gates || gates.status === 'none_configured') return 'Gates: no verify commands are configured.'
  if (gates.status === 'couldnt_run') return `Gates: could not run — ${gates.reason}`
  const failed = gates.commands.filter((c) => c.outcome !== 'passed')
  if (failed.length === 0) return `Gates: all ${gates.commands.length} verify command(s) passed.`
  return `Gates: FAILED — ${failed.map((c) => `\`${c.command}\` (${c.outcome})`).join(', ')}.`
}

/**
 * The single message a returning round wakes its lead with (decision 12): the
 * round's outcome, each ticket it held with its status, the gate result, what a
 * review in the round found, and where the digests are. The record, not prose —
 * the lead reads the digests itself.
 */
export function composeRoundWake(ctx: AppCtx, featureId: string, runId: string): string {
  const run = getRunRow(ctx, runId)
  const round = listRounds(ctx, featureId).find((r) => r.runId === runId)
  const held = listByIds(ctx, runClaimedTicketIds(ctx, runId)).sort((a, b) => a.seq - b.seq)
  const heldIds = new Set(held.map((t) => t.id))
  const findings = listFindings(ctx, featureId).filter((f) => heldIds.has(f.reviewTicketId))

  const lines = [
    `[runcastle] Round ${round?.round ?? '?'} returned: ${run.status}${run.summary ? ` — ${run.summary}` : ''}`,
    ...(held.length > 0
      ? ['Tickets:', ...held.map((t) => `- #${t.seq} ${t.title}: ${t.status}${t.error ? ` (${t.error.split(/\r?\n/, 1)[0]})` : ''}`)]
      : ['Tickets: none']),
    gatesLine(run.gates),
    ...(findings.length > 0
      ? [
          'Review findings:',
          ...findings.map((f) => `- [${f.severity} ${f.kind}] ${f.title} — ${f.location} (${f.status})`),
        ]
      : []),
    'Read each ticket’s digest with get_ticket({ seq }), then fix it yourself, dispatch the next ' +
      'round, ask the human, or declare ready.',
  ]
  return lines.join('\n')
}
