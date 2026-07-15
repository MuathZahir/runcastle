/**
 * @runcastle/design-system — near-black IDE-grammar UI primitives.
 *
 * Import the stylesheet once at your app root:
 *   import '@runcastle/design-system/styles.css'
 * then compose these components. Design tokens are the `:root` block at the top
 * of styles.css — restyle the whole system by editing those token values, not
 * the component rules.
 */

export { Button } from './components/Button'
export type { ButtonProps } from './components/Button'

export { GhostLink } from './components/GhostLink'
export type { GhostLinkProps } from './components/GhostLink'

export { Input } from './components/Input'
export type { InputProps } from './components/Input'

export { Segmented } from './components/Segmented'
export type { SegmentedProps, SegmentedOption } from './components/Segmented'

export { SectionTitle } from './components/SectionTitle'
export type { SectionTitleProps } from './components/SectionTitle'

export { DimLine } from './components/DimLine'
export type { DimLineProps } from './components/DimLine'

export { Tag } from './components/Tag'
export type { TagProps } from './components/Tag'

export { Chip } from './components/Chip'
export type { ChipProps } from './components/Chip'

export { StatusDot } from './components/StatusDot'
export type { StatusDotProps } from './components/StatusDot'

export { Spinner } from './components/Spinner'
export type { SpinnerProps } from './components/Spinner'

export { Panel } from './components/Panel'
export type { PanelProps } from './components/Panel'

export { Toolbar } from './components/Toolbar'
export type { ToolbarProps } from './components/Toolbar'

export { Tabs } from './components/Tabs'
export type { TabsProps, TabItem } from './components/Tabs'

export { Stepper } from './components/Stepper'
export type { StepperProps, Step } from './components/Stepper'

export { Toast } from './components/Toast'
export type { ToastProps } from './components/Toast'

/* ── Screens — presentational, mock-data compositions of the primitives above.
   The composed runcastle app: redesign these, then re-wire your data layer. ── */

export { AppShell } from './screens/AppShell'
export type { AppShellProps } from './screens/AppShell'

export { Titlebar } from './screens/Titlebar'
export type { TitlebarProps } from './screens/Titlebar'

export { Sidebar } from './screens/Sidebar'
export type { SidebarProps, SidebarFeature } from './screens/Sidebar'

export { Inspector } from './screens/Inspector'
export type { InspectorProps, InspectorDoc, InspectorEvent } from './screens/Inspector'

export { StatusBar } from './screens/StatusBar'
export type { StatusBarProps } from './screens/StatusBar'

export { OverviewScreen } from './screens/OverviewScreen'
export type { OverviewScreenProps, OverviewEvent } from './screens/OverviewScreen'

export { TicketsScreen } from './screens/TicketsScreen'
export type { TicketsScreenProps, TicketRowData } from './screens/TicketsScreen'

export { RunScreen } from './screens/RunScreen'
export type { RunScreenProps, RunLane, RunStreamLine } from './screens/RunScreen'

export { TerminalScreen } from './screens/TerminalScreen'
export type { TerminalScreenProps } from './screens/TerminalScreen'
