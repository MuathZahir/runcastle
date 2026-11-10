import type { CSSProperties } from 'react'
import { EPIC_ICON_IDS, EPIC_ICON_LABEL, type EpicColor, type EpicIconId } from '@runcastle/core'
import {
  BookOpen,
  Bot,
  Bell,
  Bug,
  ChartLine,
  Compass,
  CreditCard,
  Database,
  FlaskConical,
  GitBranch,
  Gauge,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Package,
  Palette,
  Plug,
  Rocket,
  Shield,
  Smartphone,
  Sparkles,
  Terminal,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * An epic's look (docs/features/epics-that-look-alive, decisions 1–3, 6): one
 * of eight colours, given when the epic is created, and one of a fixed list of
 * Lucide icons, picked by the orchestrator when it names the epic (or by the
 * human in the picker). An epic with no icon yet wears the default chat bubble.
 *
 * The keys live in `@runcastle/core` (`epic-look.ts`): stored on the epic,
 * validated by the server, offered to `name_epic`. This module maps them to
 * tokens and Lucide components.
 */

export { EPIC_COLORS, EPIC_ICON_IDS, type EpicColor, type EpicIconId } from '@runcastle/core'

export const EPIC_COLOR_NAME: Record<EpicColor, string> = {
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  olive: 'Olive',
  amber: 'Amber',
  rust: 'Rust',
  rose: 'Rose',
  violet: 'Violet',
}

/**
 * The CSS variables an epic's pieces paint with: `--epic` (the hue: wash, grid,
 * tile ring) and `--epic-text` (its icon and words on that wash). Set on the
 * piece's root; the theme tokens behind them switch with the theme.
 */
export function epicStyle(color: EpicColor | null | undefined): CSSProperties {
  const c = color ?? 'blue'
  return { '--epic': `var(--color-epic-${c})`, '--epic-text': `var(--color-epic-${c}-text)` } as CSSProperties
}

/** Each curated icon id (from core, decision 1) as its Lucide component. */
const ICON_OF: Record<EpicIconId, LucideIcon> = {
  rocket: Rocket,
  layers: Layers,
  palette: Palette,
  layout: LayoutDashboard,
  smartphone: Smartphone,
  sparkles: Sparkles,
  bot: Bot,
  workflow: Workflow,
  database: Database,
  chart: ChartLine,
  gauge: Gauge,
  shield: Shield,
  plug: Plug,
  'credit-card': CreditCard,
  users: Users,
  bell: Bell,
  terminal: Terminal,
  'git-branch': GitBranch,
  package: Package,
  wrench: Wrench,
  bug: Bug,
  flask: FlaskConical,
  compass: Compass,
  book: BookOpen,
}

/** The icons the orchestrator picks from, in the picker's order: id, label and component. */
export const EPIC_ICONS: readonly { id: EpicIconId; label: string; Icon: LucideIcon }[] = EPIC_ICON_IDS.map((id) => ({
  id,
  label: EPIC_ICON_LABEL[id],
  Icon: ICON_OF[id],
}))

const BY_ID = new Map<string, LucideIcon>(EPIC_ICONS.map((x) => [x.id, x.Icon]))

/**
 * Lucide draws on a 24px grid at stroke 2; the app's hand-drawn icons on a 16px
 * grid at 1.5. 1.5 × 24/16 gives the same stroke for the same size, so a
 * Lucide epic icon sits beside an `icons.tsx` glyph at one weight.
 */
const STROKE = 2.25

/** An epic's icon, or the default chat bubble when it has none (decision 6). Decorative. */
export function EpicIcon({ icon, size = 16, className }: { icon: EpicIconId | string | null | undefined; size?: number; className?: string }) {
  const Icon = (icon && BY_ID.get(icon)) || MessageSquare
  return <Icon size={size} strokeWidth={STROKE} aria-hidden className={className} />
}
