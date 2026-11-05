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
}
