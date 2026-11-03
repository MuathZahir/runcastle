import { PANEL_VIEW_LABEL, type PanelView } from '../../lib/feature-ui/panel'
import type { FeatureStatus } from '../../lib/feature-ui/status-line'
import { ticketCount, ticketCountText } from '../../lib/feature-ui/tickets'
import type { DesignEntry } from '../../lib/feature-ui/designs'
import type { ThreadState } from '../../lib/chat-thread'
import type { PhoneChatStatus, PhoneViewChoice } from './PhoneChatBar'

/** The views a phone opens from a chat, read-only and full screen (decision 3): never Details, never a drive. */
export const PHONE_VIEWS: readonly PanelView[] = ['plan', 'work', 'design']

/** The phone shows `view` full screen, or null: Details and a drive show the chat. */
export function phoneViewOf(view: PanelView | null): PanelView | null {
  return view && PHONE_VIEWS.includes(view) ? view : null
}

/** What the phone's Design line says it holds: the designs waiting, else how many there are. */
export function phoneDesignHint(designs: readonly DesignEntry[]): string {
  const waiting = designs.filter((d) => d.state === 'waiting').length
  if (waiting > 0) return `${waiting} waiting for you`
  return designs.length === 1 ? '1 design' : `${designs.length} designs`
}

/**
 * The "…" sheet's lines: of the views a feature offers, the ones a phone shows,
 * each with what it holds. The phone has no design list (decision 16), so
 * Design is offered only once the feature has a recorded design to open.
 */
export function phoneViewChoices(
  views: readonly PanelView[],
  tickets: Parameters<typeof ticketCount>[0],
  designs: readonly DesignEntry[] = [],
): PhoneViewChoice[] {
  const hint: Partial<Record<PanelView, string>> = {
    plan: 'Decisions and spec, to read',
    work: ticketCountText(ticketCount(tickets)),
    design: phoneDesignHint(designs),
  }
  return views
    .filter((v) => PHONE_VIEWS.includes(v))
    .filter((v) => v !== 'design' || designs.length > 0)
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
