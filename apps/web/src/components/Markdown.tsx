import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

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
 * One class list per element the renderer can emit — the whole of this
 * component's look, in theme utilities.
 *
 * Exported for the same reason {@link MARKDOWN_POLICY} is: what is ours here is
 * the styling decision, and a plain record is something a test can hold. The
 * spacing is the flow's rhythm read down a column of prose — 12px above a
 * heading, 8px under a block, 2px between list items.
 */
export const MARKDOWN_CLASSES = {
  /** Self-sufficient on purpose: it states its own face and white-space so it
      reads the same inside a mono, `pre-wrap` container as it does anywhere. */
  root: 'font-sans text-sm whitespace-normal text-text-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  h1: 'mt-3 mb-1.5 text-base leading-tight font-semibold tracking-[-0.01em] text-text',
  h2: 'mt-3 mb-1.5 text-sm leading-tight font-semibold text-text',
  h3: 'mt-3 mb-1.5 text-sm leading-tight font-semibold text-text-2',
  p: 'mb-2',
  list: 'mb-2 pl-4',
  /** remark-gfm tags the list itself; the marker is the checkbox. */
  taskList: 'mb-2 list-none pl-0.5',
  li: 'mb-0.5 marker:text-text-4',
  checkbox: 'mr-1.5 align-[-1px] accent-accent',
  strong: 'font-semibold text-text',
  em: 'text-text-2',
  a: 'border-b border-accent-line text-accent-hi no-underline',
  code: 'rounded-[3px] border border-hairline-soft bg-panel-inset px-1 py-px font-mono text-xs text-accent-hi',
  /** A fenced block resets the inline code chrome on the `<code>` inside it. */
  pre:
    'mb-2 overflow-x-auto rounded-sm border border-hairline-soft bg-panel-inset px-2.5 py-2 ' +
    '[&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-text-2',
  table: 'mb-2 w-full border-collapse text-xs',
  th: 'border border-hairline bg-panel px-1.5 py-1 text-left font-semibold text-text-2',
  td: 'border border-hairline px-1.5 py-1 text-left',
  hr: 'my-2.5 border-0 border-t border-hairline',
} as const

/** remark-gfm marks a task list with this class and nothing else does. */
const TASK_LIST = 'contains-task-list'

const COMPONENTS: Components = {
  h1: ({ node: _n, ...p }) => <h1 className={MARKDOWN_CLASSES.h1} {...p} />,
  h2: ({ node: _n, ...p }) => <h2 className={MARKDOWN_CLASSES.h2} {...p} />,
  h3: ({ node: _n, ...p }) => <h3 className={MARKDOWN_CLASSES.h3} {...p} />,
  p: ({ node: _n, ...p }) => <p className={MARKDOWN_CLASSES.p} {...p} />,
  ul: ({ node: _n, className, ...p }) => (
    <ul
      className={className?.includes(TASK_LIST) ? MARKDOWN_CLASSES.taskList : MARKDOWN_CLASSES.list}
      {...p}
    />
  ),
  ol: ({ node: _n, className, ...p }) => (
    <ol
      className={className?.includes(TASK_LIST) ? MARKDOWN_CLASSES.taskList : MARKDOWN_CLASSES.list}
      {...p}
    />
  ),
  li: ({ node: _n, ...p }) => <li className={MARKDOWN_CLASSES.li} {...p} />,
  input: ({ node: _n, ...p }) => <input className={MARKDOWN_CLASSES.checkbox} {...p} />,
  strong: ({ node: _n, ...p }) => <strong className={MARKDOWN_CLASSES.strong} {...p} />,
  em: ({ node: _n, ...p }) => <em className={MARKDOWN_CLASSES.em} {...p} />,
  a: ({ node: _n, ...p }) => <a className={MARKDOWN_CLASSES.a} {...p} />,
  // The language class upstream puts here is not styling we use, and dropping
  // it is what lets one class list cover inline and fenced code alike.
  code: ({ node: _n, className: _c, ...p }) => <code className={MARKDOWN_CLASSES.code} {...p} />,
  pre: ({ node: _n, ...p }) => <pre className={MARKDOWN_CLASSES.pre} {...p} />,
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="mb-2 border-l-2 border-accent-line pl-2.5 text-text-3" {...p} />
  ),
  table: ({ node: _n, ...p }) => <table className={MARKDOWN_CLASSES.table} {...p} />,
  th: ({ node: _n, ...p }) => <th className={MARKDOWN_CLASSES.th} {...p} />,
  td: ({ node: _n, ...p }) => <td className={MARKDOWN_CLASSES.td} {...p} />,
  hr: ({ node: _n, ...p }) => <hr className={MARKDOWN_CLASSES.hr} {...p} />,
}

/**
 * The one renderer for every agent-authored prose surface (doc peek, the map's
 * section bodies, ticket goal/context). Every element it emits is styled by
 * {@link MARKDOWN_CLASSES} at this component, in theme utilities.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={className ? `${MARKDOWN_CLASSES.root} ${className}` : MARKDOWN_CLASSES.root}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
