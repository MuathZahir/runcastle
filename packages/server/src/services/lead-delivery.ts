import { type Feature, LEAD_WAKE_FAILED, type LeadWakeFailedData, type ReviewGateRun, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { launchSession } from '../launcher/launcher'
import { newestThread } from '../launcher/sessions'
import { hasThreadLog } from '../threads/log'
import { agentHost } from '../threads/types'
import { emit } from './events'
import { tagRuncastlePrompt } from './lead-prompt'
import { markHumanMessage } from './lead-status'
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
 * `human` message stamps the feature's last-human-message mark. Either way the
 * prompt that reaches the lead carries runcastle's tag, so the
 * `UserPromptSubmit` hook does not count it again as a typed one.
 */
export interface LeadMessage {
  text: string
  source: 'human' | 'runcastle'
}

/**
 * Deliver `msg` to the feature's lead (decision 12; chat-as-web-components
 * decision 6): a runcastle prompt into the feature's main-chat thread, queued
 * to the end of a running turn and starting the chat when no process runs —
 * the human sees it work and can answer or type. A feature with no chat thread
 * yet gets one opened from the docs first.
 *
 * A delivery that fails to reach the thread (the runtime cannot run, the chat
 * cannot be opened) keeps its message: it goes ahead of the next one, and
 * `lead.wake_failed` says why meanwhile.
 */
export async function deliverToLead(ctx: AppCtx, feature: Feature, msg: LeadMessage): Promise<void> {
  if (msg.source === 'human') markHumanMessage(ctx, feature.id)
  const lines = [...(held.get(feature.id) ?? []), tagRuncastlePrompt(msg.text)]
  try {
    const threadId = await leadThread(ctx, feature)
    await agentHost(ctx).prompt(threadId, { text: lines.join('\n\n') }, { source: 'runcastle' })
    held.delete(feature.id)
    failures.delete(feature.id)
    emit(ctx, feature.id, {
      type: 'lead.message_queued',
      message: `message sent to the agent's chat (${msg.source})`,
      data: { source: msg.source, sessionId: threadId, route: 'prompt', text: msg.text },
    })
  } catch (err) {
    held.set(feature.id, lines)
    const reason = err instanceof Error ? err.message : String(err)
    const at = Date.now()
    failures.set(feature.id, { reason, at, since: failures.get(feature.id)?.since ?? at })
    const data: LeadWakeFailedData & LeadMessage = { exitCode: null, tail: reason, messages: lines.length, ...msg }
    emit(ctx, feature.id, { type: LEAD_WAKE_FAILED, message: `could not reach the agent's chat: ${reason}`, data })
  }
}

/** The feature's main-chat thread, opened from the docs when it has none with a conversation yet. */
async function leadThread(ctx: AppCtx, feature: Feature): Promise<string> {
  const chat = newestThread(ctx, { featureId: feature.id }, 'chat')
  if (chat && (chat.ccSessionId || hasThreadLog(chat.id))) return chat.id
  return (await launchSession(ctx, { featureId: feature.id, kind: 'chat' })).sessionId
}

/** Whether `session` is a feature's lead: its main chat. */
export function isLeadSession(session: Pick<SessionRow, 'kind' | 'featureId'>): boolean {
  return session.kind === 'chat' && !!session.featureId
}

/** Messages a failed delivery kept, per feature, oldest first. */
const held = new Map<string, string[]>()

/** The last failed delivery per feature, and when the oldest kept message was sent. */
const failures = new Map<string, { reason: string; at: number; since: number }>()

/** What the drive panel shows about a feature's messages to the agent. */
export interface LeadDeliveryState {
  /** When the oldest message still waiting for the agent was sent; null when nothing waits. */
  waitingSince: number | null
  /** The last delivery that could not reach the agent, while its messages still wait. */
  lastFailure: { reason: string; at: number } | null
}

export function leadDeliveryState(featureId: string): LeadDeliveryState {
  const failure = failures.get(featureId)
  return failure
    ? { waitingSince: failure.since, lastFailure: { reason: failure.reason, at: failure.at } }
    : { waitingSince: null, lastFailure: null }
}

/** One line on a round's verify gates, for the wake message. */
function gatesLine(gates: ReviewGateRun | undefined): string {
  if (!gates || gates.status === 'none_configured') return 'Gates: no verify commands are configured.'
  if (gates.status === 'couldnt_run') return `Gates: could not run — ${gates.reason}`
  const failed = gates.commands.filter((c) => c.outcome !== 'passed')
  const reused = gates.reusedFrom
    ? ` (not re-run: the branch had not moved since commit ${gates.commit.slice(0, 7)}, where they ran)`
    : ''
  if (failed.length === 0) return `Gates: all ${gates.commands.length} verify command(s) passed${reused}.`
  return `Gates: FAILED${reused} — ${failed.map((c) => `\`${c.command}\` (${c.outcome})`).join(', ')}.`
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
