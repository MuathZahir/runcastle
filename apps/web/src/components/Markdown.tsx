import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * What we hand the renderer, as plain data. The component itself has no unit
 * seam — with no DOM environment its output can't be asserted, and its
 * behaviour is almost entirely upstream's — so the policy is exported and
 * pinned by test instead. Visual correctness is checked against
 * `docs/features/improve-map-workflow-ui-ux-make-markdown-render-correctly/prototype.html`.
 */
export const MARKDOWN_POLICY = {
  /** Agents write GFM — tables, task lists, strikethrough. */
  gfm: true,
  /** No raw-HTML rehype plugin: HTML in a doc is escaped, never mounted. */
  rawHtml: false,
  /** No highlighter dependency — a styled <pre><code> in the mono face is enough. */
  syntaxHighlighting: false,
} as const

/**
 * The one renderer for every agent-authored prose surface (doc peek, the map's
 * section bodies, ticket goal/context). Styling lives entirely in the `.md`
 * rules in styles.css.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}
