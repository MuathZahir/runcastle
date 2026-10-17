import type { ReactNode, ReactElement } from 'react'

export type Phase = 'draft' | 'ideation' | 'spec' | 'tickets' | 'implementation' | 'review' | 'shipped'
export type Tone = 'success' | 'warning' | 'danger' | 'accent' | 'live' | 'neutral'
/** One of the runcastle icon names (see `iconNames`). */
export type IconName = 'activity' | 'arrow-right' | 'bell' | 'bell-off' | 'branch' | 'check' | 'chevron-down' | 'chevron-right' | 'claude' | 'codex' | 'cube' | 'doc' | 'flame' | 'folder' | 'lock' | 'message' | 'more' | 'panel-right' | 'pencil' | 'play' | 'plus' | 'search' | 'settings' | 'shield' | 'sparkle' | 'stop' | 'terminal' | 'trash' | 'undo' | 'x'

/** A 16px stroke icon drawn in currentColor. */
export declare function Icon(p: { name: IconName; size?: 14 | 16 | 20 | number; color?: string; className?: string }): ReactElement
/** A feature phase as a progress glyph; labels itself. */
export declare function PhaseIcon(p: { phase: Phase; size?: number }): ReactElement
/** One key of a shortcut hint. */
export declare function Kbd(p: { children: ReactNode }): ReactElement
/** The app's button. Icon with no children = square icon button (needs `label`). */
export declare function Button(p: { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: IconName; kbd?: string; label?: string; disabled?: boolean; type?: 'button' | 'submit'; onClick?: () => void; className?: string; children?: ReactNode }): ReactElement
/** A ghost, square, icon-only button. */
export declare function IconButton(p: { icon: IconName; label: string; size?: 'sm' | 'md'; variant?: 'ghost' | 'secondary'; onClick?: () => void }): ReactElement
/** A 6px status dot; pass `label` when no word sits beside it. */
export declare function StatusDot(p: { tone?: Tone; label?: string }): ReactElement
/** Sentence-case group heading with optional count and trailing action. */
export declare function SectionLabel(p: { children: ReactNode; count?: number; action?: ReactNode }): ReactElement
/** One sidebar row. */
export declare function NavItem(p: { label: string; icon?: IconName; phase?: Phase; meta?: ReactNode; dot?: Tone; dotLabel?: string; active?: boolean; href?: string; onClick?: () => void }): ReactElement
/** One 40px list row in the content panel. */
export declare function ListRow(p: { title: ReactNode; phase?: Phase; dot?: Tone; icon?: IconName; meta?: ReactNode }): ReactElement
/** The compact pipeline stepper for a page header. */
export declare function PhaseStepper(p: { phase: Phase; viewing?: Phase; steps?: Phase[] }): ReactElement
/** Text tabs that switch a page body. */
export declare function Tabs(p: { items: { id?: string; label: string; icon?: IconName; count?: number }[]; value: string; onChange?: (id: string) => void }): ReactElement
/** Single-line text field. */
export declare function Input(p: { placeholder?: string; label?: string; icon?: IconName; kbd?: string; size?: 'md' | 'lg'; width?: number; defaultValue?: string }): ReactElement
/** Key–value facts. */
export declare function PropertyList(p: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode; phase?: Phase; tone?: Tone; icon?: IconName; mono?: boolean }[] }): ReactElement
/** A line of small inline facts. */
export declare function MetaLine(p: { items: { text: ReactNode; strong?: ReactNode; tone?: Tone; icon?: IconName }[] }): ReactElement
/** A collapsed section with a chevron. */
export declare function Disclosure(p: { title: ReactNode; icon?: IconName; aside?: ReactNode; open?: boolean; children: ReactNode }): ReactElement
/** A calm blank area. */
export declare function EmptyState(p: { title: ReactNode; hint?: ReactNode; icon?: IconName; action?: ReactNode }): ReactElement
/** The floating menu surface. `'-'` is a separator. */
export declare function Menu(p: { items: ({ label: ReactNode; icon?: IconName; kbd?: string; danger?: boolean; active?: boolean } | '-')[] }): ReactElement
export declare const iconNames: IconName[]
