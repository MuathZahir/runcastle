import * as z from 'zod'

/**
 * A feature's designs as runcastle records them (designs-and-the-plan-get-their-own-place
 * decisions 1, 8, 10, 18): one entry per page on the feature's design server,
 * recorded by the agent's `show_design`. The wire shape the chat's cards and the
 * Design tab read.
 */

/** Where a design stands with the human. */
export const DesignState = z.enum(['waiting', 'approved', 'dropped'])
export type DesignState = z.infer<typeof DesignState>

/** Who approved a design: the human's own click, or the lead marking a yes the human gave in words. */
export const DesignApprover = z.enum(['human', 'lead'])
export type DesignApprover = z.infer<typeof DesignApprover>

/** One recorded design: one page on the feature's design server. */
export interface DesignEntry {
  id: string
  title: string
  /** The page on the design server, e.g. `/preview/designs.html` (bare: its states live on a switcher inside it). */
  path: string
  /** The screen width it is laid out at; unset, the human's own choice (Desktop). */
  width?: number
  /** A picture of it, as a URL the web loads, when the agent passed one. */
  picture?: string
  state: DesignState
  /** Shown since the human last opened it (decision 10). */
  isNew: boolean
  /** When it was last shown. */
  shownAt: number
  /** The page's last report (agents-see-the-tweaks-you-picked decision 6); null until it sent one. */
  report: DesignReport | null
}

/** The longest key, value or state a design report keeps (agents-see-the-tweaks-you-picked). */
export const DESIGN_REPORT_MAX_CHARS = 80
/** The most tweaks a design report keeps. */
export const DESIGN_REPORT_MAX_TWEAKS = 12

/**
 * What a design page posts to the window around it (agents-see-the-tweaks-you-picked
 * decisions 5, 10), with `window.parent.postMessage(report, '*')`, on load and on
 * every change of state or tweak. `tweaks` is keyed by the label the menu shows;
 * `{}` means the page has no Tweaks menu, a missing field means it did not say.
 */
export const DesignReport = z.object({
  type: z.literal('runcastle:design'),
  /** The switcher's current state; null for a single-state page. */
  state: z.string().nullable(),
  tweaks: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})
export type DesignReport = z.infer<typeof DesignReport>

const cut = (s: string): string => s.slice(0, DESIGN_REPORT_MAX_CHARS)

/**
 * A message as a design report, capped: at most 12 tweaks; keys, string values
 * and the state at most 80 characters. Over the cap it is trimmed, never
 * dropped; a foreign or malformed message is null.
 */
export function parseDesignReport(message: unknown): DesignReport | null {
  const parsed = DesignReport.safeParse(message)
  if (!parsed.success) return null
  const { state, tweaks } = parsed.data
  const report: DesignReport = { type: 'runcastle:design', state: state === null ? null : cut(state) }
  if (tweaks) {
    report.tweaks = Object.fromEntries(
      Object.entries(tweaks)
        .slice(0, DESIGN_REPORT_MAX_TWEAKS)
        .map(([key, value]) => [cut(key), typeof value === 'string' ? cut(value) : value]),
    )
  }
  return report
}
