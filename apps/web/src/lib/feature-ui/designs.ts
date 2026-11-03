/**
 * A feature's designs, as the chat's cards and the Design tab read them
 * (designs-and-the-plan-get-their-own-place decisions 1, 4, 6, 10, 18). Pure:
 * the record comes from the server, this module says how it reads.
 *
 * Design-time shape: the record's wire type moves to `@runcastle/core` when the
 * server side is built; the words and the order here are what was designed.
 */

/** Where a design stands with the human. */
export type DesignState = 'waiting' | 'approved' | 'dropped'

/** One recorded design: one page on the feature's design server. */
export interface DesignEntry {
  id: string
  title: string
  /** The page on the design server, e.g. `/preview/designs.html?state=list`. */
  path: string
  /** The screen width it is laid out at; unset, the human's own choice (Desktop). */
  width?: number
  /** A picture of it, when the agent passed one. */
  picture?: string
  state: DesignState
  /** Shown since the human last opened it (decision 10). */
  isNew: boolean
  /** When it was last shown. */
  shownAt: number
}

/** What a width reads as: "Mobile · 390", "Tablet · 768", "Desktop". */
export function designWidthLabel(width: number | undefined): string {
  if (width === undefined || width >= 1024) return width === undefined ? 'Desktop' : `Desktop · ${width}`
  return width < 600 ? `Mobile · ${width}` : `Tablet · ${width}`
}

export const DESIGN_STATE_WORD: Record<DesignState, string> = {
  waiting: 'Waiting for you',
  approved: 'Approved',
  dropped: 'Dropped',
}

/** The list's order: what waits for the human first, then approved, then dropped; newest first within each. */
export function orderDesigns(designs: readonly DesignEntry[]): DesignEntry[] {
  const rank: Record<DesignState, number> = { waiting: 0, approved: 1, dropped: 2 }
  return [...designs].sort((a, b) => rank[a.state] - rank[b.state] || b.shownAt - a.shownAt)
}

/** The list's one summary line: "4 designs · 2 waiting for you". */
export function designsSummary(designs: readonly DesignEntry[]): string {
  const waiting = designs.filter((d) => d.state === 'waiting').length
  const count = `${designs.length} ${designs.length === 1 ? 'design' : 'designs'}`
  return waiting > 0 ? `${count} · ${waiting} waiting for you` : count
}

/** What the plan card counts (decision 5). `tickets` null means the agent builds it itself. */
export interface PlanCounts {
  decisions: number
  checkFirst: number
  tickets: number | null
  designs: number
}

/** The plan card's line of counts: "22 decisions · 5 to check first · 5 tickets · 4 designs". */
export function planCountsLine(counts: PlanCounts): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    plural(counts.decisions, 'decision', 'decisions'),
    counts.checkFirst > 0 ? `${counts.checkFirst} to check first` : null,
    counts.tickets === null ? 'built by the agent' : plural(counts.tickets, 'ticket', 'tickets'),
    counts.designs > 0 ? plural(counts.designs, 'design', 'designs') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Where Approve takes the human (decision 24): the next design still waiting
 * after `currentId` in the list's order, wrapping round to the first; null
 * when no other design waits, so the view goes back to the list.
 */
export function nextWaiting(designs: readonly DesignEntry[], currentId: string): DesignEntry | null {
  const ordered = orderDesigns(designs)
  const at = ordered.findIndex((d) => d.id === currentId)
  const rest = [...ordered.slice(at + 1), ...ordered.slice(0, Math.max(0, at))]
  return rest.find((d) => d.state === 'waiting' && d.id !== currentId) ?? null
}

/** How far the human is through the designs: approved of those not dropped. */
export function approvalProgress(designs: readonly DesignEntry[]): { approved: number; total: number; done: boolean } {
  const counted = designs.filter((d) => d.state !== 'dropped')
  const approved = counted.filter((d) => d.state === 'approved').length
  return { approved, total: counted.length, done: counted.length > 0 && approved === counted.length }
}
