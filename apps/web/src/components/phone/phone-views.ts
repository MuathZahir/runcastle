import { PANEL_VIEW_LABEL, type PanelView } from '../../lib/feature-ui/panel'
import type { FeatureStatus } from '../../lib/feature-ui/status-line'
import { ticketCount, ticketCountText } from '../../lib/feature-ui/tickets'
import type { ThreadState } from '../../lib/chat-thread'
import type { PhoneChatStatus, PhoneViewChoice } from './PhoneChatBar'

/** The views a phone opens from a chat, read-only and full screen (decision 3): never Details, never a drive. */
export const PHONE_VIEWS: readonly PanelView[] = ['plan', 'work', 'design']

/** The phone shows `view` full screen, or null: Details and a drive show the chat. */
export function phoneViewOf(view: PanelView | null): PanelView | null {
  return view && PHONE_VIEWS.includes(view) ? view : null
}

/** The "…" sheet's lines: of the views a feature offers, the ones a phone shows, each with what it holds. */
export function phoneViewChoices(views: readonly PanelView[], tickets: Parameters<typeof ticketCount>[0]): PhoneViewChoice[] {
  const hint: Partial<Record<PanelView, string>> = {
    plan: 'Decisions and spec, to read',
    work: ticketCountText(ticketCount(tickets)),
    design: 'Running now',
  }
  return views
    .filter((v) => PHONE_VIEWS.includes(v))
    .map((view) => ({ view, label: PANEL_VIEW_LABEL[view], ...(hint[view] ? { hint: hint[view] } : {}) }))
}

/** A feature's status line in the chat bar's terms: Ready waits on you as Waiting does (the preview's amber dot). */
export function featurePhoneStatus(status: FeatureStatus | undefined): PhoneChatStatus | undefined {
  if (!status) return undefined
  const tone = status.held ? 'quiet' : status.kind === 'waiting' || status.kind === 'ready' ? 'waiting' : status.kind === 'working' ? 'working' : 'quiet'
  return { words: status.label, tone }
}

/** A thread's state in the chat bar's terms, in the words every thread list uses. */
export function threadPhoneStatus(state: ThreadState | undefined): PhoneChatStatus | undefined {
  if (state === 'waiting') return { words: 'Waiting for you', tone: 'waiting' }
  if (state === 'working') return { words: 'Working', tone: 'working' }
  return undefined
}
