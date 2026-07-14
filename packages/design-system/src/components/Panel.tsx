import type { ReactNode } from 'react'

export interface PanelProps {
  /** Optional header title; renders a hairline-separated head row. */
  title?: ReactNode
  /** Right-aligned header content — actions or metadata. */
  actions?: ReactNode
  /** Pad the body. Set `false` for edge-to-edge content like lists or tables. */
  padded?: boolean
  children?: ReactNode
}

/**
 * A bordered hairline surface — the system's container primitive. No shadow and
 * no elevation; a 1px border over a slightly sunken background is the entire
 * separation. Give it a `title` for a headed section, or leave it plain.
 */
export function Panel({ title, actions, padded = true, children }: PanelProps) {
  const hasHead = title != null || actions != null
  return (
    <div className="panel">
      {hasHead && (
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          {actions != null && <span className="panel-actions">{actions}</span>}
        </div>
      )}
      {padded ? <div className="panel-body">{children}</div> : children}
    </div>
  )
}
