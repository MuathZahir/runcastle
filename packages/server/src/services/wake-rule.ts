/**
 * The one wake rule (`agents-are-woken-only-when-it-matters` decision 1): a
 * parent agent is woken only by a **handback** (work it handed out came back)
 * or a **question** (something only it can answer or act on). Everything else
 * is **news**: logged in its chat at once and held for its next prompt,
 * whoever sends that, so it costs no turn and is never lost.
 *
 * Every runcastle message to an agent is tagged with one of the three where it
 * is composed — the orchestrator's news lines (`orchestrator-notify.ts`), a
 * lead's messages (`lead-delivery.ts`) — and this decides what happens to it.
 * Workers adopt the same tags.
 */
export type WakeReason = 'handback' | 'question' | 'news'

/** Whether a message tagged `reason` starts a turn (or queues one behind a running turn); news is held instead. */
export function wakes(reason: WakeReason): boolean {
  return reason !== 'news'
}
