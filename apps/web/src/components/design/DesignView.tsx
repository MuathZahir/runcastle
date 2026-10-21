import { EmptyState } from '../../ui'
import { IconPen } from '../../icons'

export interface DesignViewProps {
  featureId: string
  /** Where in the design server to point, as the agent's `show_panel` named it. */
  path?: string
}

/**
 * The panel's design view (design-mode decisions 3, 5): the live preview the
 * agent serves from the feature's talk worktree. A slot for now — the design
 * view's own ticket fills it with the design server's frame and toolbar.
 */
export function DesignView(_props: DesignViewProps) {
  return (
    <EmptyState
      className="py-16"
      icon={<IconPen />}
      title="No design open"
      hint="Ask the agent to show you a design."
    />
  )
}
