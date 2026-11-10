/**
 * An epic's look (docs/features/epics-that-look-alive, decisions 1–3, 6): one
 * of eight colours, given when its chat is first saved, and one of a fixed list
 * of icons, picked by the orchestrator when it names the epic (`name_epic`) or
 * by the human in the picker. IO-free: the server validates against these, the
 * web maps them to tokens and Lucide components, the project skill names them.
 *
 * The keys are stored on the session row; never rename one.
 */

/** The eight epic colours, in the order the picker shows them, ties break and the migration spreads them. */
export const EPIC_COLORS = ['blue', 'teal', 'green', 'olive', 'amber', 'rust', 'rose', 'violet'] as const
export type EpicColor = (typeof EPIC_COLORS)[number]

/** The icons an epic may wear, each with the kind of work it stands for (decision 1). */
export const EPIC_ICON_IDS = [
  'rocket',
  'layers',
  'palette',
  'layout',
  'smartphone',
  'sparkles',
  'bot',
  'workflow',
  'database',
  'chart',
  'gauge',
  'shield',
  'plug',
  'credit-card',
  'users',
  'bell',
  'terminal',
  'git-branch',
  'package',
  'wrench',
  'bug',
  'flask',
  'compass',
  'book',
] as const
export type EpicIconId = (typeof EPIC_ICON_IDS)[number]

/** What each icon stands for: the picker's tooltip, and the hint the orchestrator picks by. */
export const EPIC_ICON_LABEL: Record<EpicIconId, string> = {
  rocket: 'Launch',
  layers: 'Platform',
  palette: 'Design',
  layout: 'Interface',
  smartphone: 'Mobile',
  sparkles: 'AI',
  bot: 'Agents',
  workflow: 'Workflow',
  database: 'Data',
  chart: 'Analytics',
  gauge: 'Performance',
  shield: 'Security',
  plug: 'Integrations',
  'credit-card': 'Billing',
  users: 'People',
  bell: 'Notifications',
  terminal: 'Tooling',
  'git-branch': 'Git',
  package: 'Release',
  wrench: 'Maintenance',
  bug: 'Bugs',
  flask: 'Experiment',
  compass: 'Exploration',
  book: 'Docs',
}

export function isEpicColor(x: unknown): x is EpicColor {
  return typeof x === 'string' && (EPIC_COLORS as readonly string[]).includes(x)
}

export function isEpicIconId(x: unknown): x is EpicIconId {
  return typeof x === 'string' && (EPIC_ICON_IDS as readonly string[]).includes(x)
}

/**
 * The colour a new epic takes (decision 2): the one least used among `taken`
 * (the colours of the epics listed now), ties broken by palette order.
 */
export function leastUsedEpicColor(taken: readonly (string | null | undefined)[]): EpicColor {
  const uses = new Map<EpicColor, number>(EPIC_COLORS.map((c) => [c, 0]))
  for (const c of taken) if (isEpicColor(c)) uses.set(c, (uses.get(c) ?? 0) + 1)
  let best: EpicColor = EPIC_COLORS[0]
  for (const c of EPIC_COLORS) if ((uses.get(c) ?? 0) < (uses.get(best) ?? 0)) best = c
  return best
}
