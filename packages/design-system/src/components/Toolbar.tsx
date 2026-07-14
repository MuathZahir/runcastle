import type { ReactNode } from 'react'

export interface ToolbarProps {
  /** Left-aligned content — a title and its primary controls. */
  children?: ReactNode
  /** Right-aligned content, pushed to the far edge by a flexible spacer. */
  right?: ReactNode
}

/**
 * A horizontal bar on the raised panel surface with a bottom hairline — the
 * header for a pane, a tickets ledger, or a run view. Left content and `right`
 * content are separated by a flexible spacer.
 */
export function Toolbar({ children, right }: ToolbarProps) {
  return (
    <div className="toolbar">
      {children}
      {right != null && (
        <>
          <span className="toolbar-spacer" />
          {right}
        </>
      )}
    </div>
  )
}
