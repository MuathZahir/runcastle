import * as z from 'zod'
import type { DecidedWithoutYou } from './review-package'

/**
 * How involved the human is in one feature (docs/features/how-involved-am-i):
 * one setting, "Involve me in", with four nested levels. Each level names
 * every moment it still stops for, so the nesting reads at a glance
 * (decision 5):
 *
 * - `everything`: the lead asks the decisions, shows the designs, and the
 *   human tries it and merges. The default.
 * - `designsAndResult`: the lead decides the small things; the human approves
 *   screens, tries it and merges.
 * - `resultOnly`: the lead plans and builds it all, designs included
 *   (decision 6); the human tries it and merges.
 * - `nothing`: runcastle merges once the lead says ready and the review is
 *   clean.
 *
 * At every level work still stops before money, accounts or anything outside
 * git that cannot be undone, and for anything the brief names as the human's.
 */
export const INVOLVEMENT_LEVELS = ['everything', 'designsAndResult', 'resultOnly', 'nothing'] as const

export type Involvement = (typeof INVOLVEMENT_LEVELS)[number]

export const InvolvementSchema = z.enum(INVOLVEMENT_LEVELS)

/** A new feature's level when nobody chose one. */
export const DEFAULT_INVOLVEMENT: Involvement = 'everything'

/** The setting's own name, as every control labels it. */
export const INVOLVEMENT_NAME = 'Involve me in'

/** Each level's name, as the controls show it. */
export const INVOLVEMENT_LABEL: Record<Involvement, string> = {
  everything: 'Everything',
  designsAndResult: 'Designs and result',
  resultOnly: 'Result only',
  nothing: 'Nothing',
}

/** What each level means for the human, in one line under its name. */
export const INVOLVEMENT_HINT: Record<Involvement, string> = {
  everything: 'You answer its questions, approve its screens, try it and merge.',
  designsAndResult: 'It decides the small things. You approve its screens, try it and merge.',
  resultOnly: 'It plans and builds it all. You try it and merge.',
  nothing: 'It merges by itself once it is ready and the review is clean.',
}

/** Whether a level still stops for the human's answers to its questions. */
export const asksDecisions = (level: Involvement): boolean => level === 'everything'

/** Whether a level still stops for the human to approve a screen's design. */
export const showsDesigns = (level: Involvement): boolean => level === 'everything' || level === 'designsAndResult'

/** Whether a level leaves the merge to the human. */
export const humanMerges = (level: Involvement): boolean => level !== 'nothing'

/**
 * The mark a lead puts on a decision it settled without the human (decision
 * 2): on its own line inside the entry, like the other marks.
 */
export const DECIDED_WITHOUT_YOU_MARK = '**Decided without you.**'

/**
 * Every decision carrying {@link DECIDED_WITHOUT_YOU_MARK}, by its number and
 * title, in file order: `### 4. Expired cards stay` under a `brief.md`'s
 * `## Decisions`, or `## 4. …` in an older feature's `decisions.md`. An entry
 * without a number is skipped: the human overturns one by its number.
 */
export function decidedWithoutYou(markdown: string): DecidedWithoutYou[] {
  const found: DecidedWithoutYou[] = []
  const sections = markdown.split(/^(?=#{2,3} )/m)
  for (const section of sections) {
    const head = /^#{2,3} +(\d+)\.\s*(.+?)\s*$/m.exec(section)
    if (!head || !section.includes(DECIDED_WITHOUT_YOU_MARK)) continue
    found.push({ n: Number(head[1]), title: head[2]! })
  }
  return found
}
