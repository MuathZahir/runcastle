import type { CSSProperties } from 'react'
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
 * The ids are the stable keys stored on the epic and offered to `name_epic`;
 * never rename one.
 */

/** The eight epic colours, in the order the picker shows them and the migration spreads them. */
export const EPIC_COLORS = ['blue', 'teal', 'green', 'olive', 'amber', 'rust', 'rose', 'violet'] as const
export type EpicColor = (typeof EPIC_COLORS)[number]

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

/** The icons the orchestrator picks from: kinds of work, about two dozen (decision 1). */
export const EPIC_ICONS = [
  { id: 'rocket', label: 'Launch', Icon: Rocket },
  { id: 'layers', label: 'Platform', Icon: Layers },
  { id: 'palette', label: 'Design', Icon: Palette },
  { id: 'layout', label: 'Interface', Icon: LayoutDashboard },
  { id: 'smartphone', label: 'Mobile', Icon: Smartphone },
  { id: 'sparkles', label: 'AI', Icon: Sparkles },
  { id: 'bot', label: 'Agents', Icon: Bot },
  { id: 'workflow', label: 'Workflow', Icon: Workflow },
  { id: 'database', label: 'Data', Icon: Database },
  { id: 'chart', label: 'Analytics', Icon: ChartLine },
  { id: 'gauge', label: 'Performance', Icon: Gauge },
  { id: 'shield', label: 'Security', Icon: Shield },
  { id: 'plug', label: 'Integrations', Icon: Plug },
  { id: 'credit-card', label: 'Billing', Icon: CreditCard },
  { id: 'users', label: 'People', Icon: Users },
  { id: 'bell', label: 'Notifications', Icon: Bell },
  { id: 'terminal', label: 'Tooling', Icon: Terminal },
  { id: 'git-branch', label: 'Git', Icon: GitBranch },
  { id: 'package', label: 'Release', Icon: Package },
  { id: 'wrench', label: 'Maintenance', Icon: Wrench },
  { id: 'bug', label: 'Bugs', Icon: Bug },
  { id: 'flask', label: 'Experiment', Icon: FlaskConical },
  { id: 'compass', label: 'Exploration', Icon: Compass },
  { id: 'book', label: 'Docs', Icon: BookOpen },
] as const satisfies readonly { id: string; label: string; Icon: LucideIcon }[]

export type EpicIconId = (typeof EPIC_ICONS)[number]['id']

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
