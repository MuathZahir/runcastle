import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { LINK } from '../ui/button'

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
 * rhythm is prose read down a column: headings open a gap above them and hug
 * what they head, blocks sit 10px apart, list items 4px. Sizes are relative to
 * the root's (`text-sm` 13/20 in dense surfaces, `text-base` 14/22 for prose —
 * see {@link Markdown}'s `size`), so one list covers both.
 */
export const MARKDOWN_CLASSES = {
  /** Self-sufficient on purpose: it states its own face and white-space so it
      reads the same inside a mono, `pre-wrap` container as it does anywhere. */
  root: 'font-sans whitespace-normal text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  h1: 'mt-6 mb-2 text-[1.3em] leading-tight font-semibold tracking-tight text-text',
  h2: 'mt-6 mb-2 text-[1.12em] leading-snug font-semibold text-text',
  h3: 'mt-5 mb-1.5 text-[1em] font-semibold text-text',
  h4: 'mt-4 mb-1 text-[1em] font-medium text-text',
  p: 'mt-0 mb-2.5',
  list: 'mt-0 mb-2.5 list-disc pl-5',
  orderedList: 'mt-0 mb-2.5 list-decimal pl-5',
  /** remark-gfm tags the list itself; the marker is the checkbox. */
  taskList: 'mt-0 mb-2.5 list-none pl-0.5',
  li: 'mb-1 pl-0.5 marker:text-text-tertiary [&>ol]:mt-1 [&>ol]:mb-0 [&>p]:mb-1 [&>ul]:mt-1 [&>ul]:mb-0',
  checkbox: 'mr-2 align-[-1px] accent-accent',
  strong: 'font-semibold text-text',
  em: 'italic',
  /** The app's one link look (`LINK`): accent text, underlined on hover. */
  a: LINK,
  code: 'rounded-sm border border-border-subtle bg-surface-inset px-1 py-px font-mono text-[0.88em] text-text',
  /** A fenced block resets the inline code chrome on the `<code>` inside it. */
  pre:
    'mt-0 mb-3 overflow-x-auto rounded-md bg-surface-inset px-3 py-2.5 font-mono text-xs leading-[18px] ' +
    '[&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em] [&>code]:text-text-secondary [&>code]:border-0',
  blockquote: 'mx-0 mt-0 mb-2.5 border-l-2 border-border-strong pl-3 text-text-tertiary',
  table: 'mt-0 mb-3 w-full border-collapse text-[0.93em]',
  th: 'border-b border-border px-2 py-1.5 text-left font-medium text-text-tertiary first:pl-0',
  td: 'border-b border-border-subtle px-2 py-1.5 text-left align-top first:pl-0',
  hr: 'my-5 border-0 border-t border-border-subtle',
} as const

/** The root's type size: `sm` (13/20) for dense surfaces, `base` (14/22) for reading. */
const MARKDOWN_SIZE = { sm: 'text-sm', base: 'text-base' } as const

/**
 * The body text's colour: `secondary` (the default, prose beside UI), `primary`
 * (`text` — a transcript or a document that *is* the page), `tertiary` (a
 * summary under something else). Headings and `strong` stay `text` in all three.
 */
const MARKDOWN_TONE = {
  primary: 'text-text',
  secondary: 'text-text-secondary',
  tertiary: 'text-text-tertiary',
} as const

/** remark-gfm marks a task list with this class and nothing else does. */
const TASK_LIST = 'contains-task-list'

const COMPONENTS: Components = {
  h1: ({ node: _n, ...p }) => <h1 className={MARKDOWN_CLASSES.h1} {...p} />,
  h2: ({ node: _n, ...p }) => <h2 className={MARKDOWN_CLASSES.h2} {...p} />,
  h3: ({ node: _n, ...p }) => <h3 className={MARKDOWN_CLASSES.h3} {...p} />,
  h4: ({ node: _n, ...p }) => <h4 className={MARKDOWN_CLASSES.h4} {...p} />,
  p: ({ node: _n, ...p }) => <p className={MARKDOWN_CLASSES.p} {...p} />,
  ul: ({ node: _n, className, ...p }) => (
    <ul
      className={className?.includes(TASK_LIST) ? MARKDOWN_CLASSES.taskList : MARKDOWN_CLASSES.list}
      {...p}
    />
  ),
  ol: ({ node: _n, className, ...p }) => (
    <ol
      className={className?.includes(TASK_LIST) ? MARKDOWN_CLASSES.taskList : MARKDOWN_CLASSES.orderedList}
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
    <blockquote className={MARKDOWN_CLASSES.blockquote} {...p} />
  ),
  table: ({ node: _n, ...p }) => <table className={MARKDOWN_CLASSES.table} {...p} />,
  th: ({ node: _n, ...p }) => <th className={MARKDOWN_CLASSES.th} {...p} />,
  td: ({ node: _n, ...p }) => <td className={MARKDOWN_CLASSES.td} {...p} />,
  hr: ({ node: _n, ...p }) => <hr className={MARKDOWN_CLASSES.hr} {...p} />,
}

/**
 * The one renderer for every agent-authored prose surface (doc peek, specs,
 * the map's section bodies, ticket goal/context, transcripts). Every element it
 * emits is styled by {@link MARKDOWN_CLASSES} at this component, in theme
 * utilities. `size` — `sm` (default) for dense surfaces, `base` for a page of
 * prose or a transcript; `tone` — `secondary` (default) · `primary` ·
 * `tertiary`. `className` places it (margins); size and colour are the props.
 */
export function Markdown({
  source,
  className,
  size = 'sm',
  tone = 'secondary',
}: {
  source: string
  className?: string
  size?: keyof typeof MARKDOWN_SIZE
  tone?: keyof typeof MARKDOWN_TONE
}) {
  const root = `${MARKDOWN_CLASSES.root} ${MARKDOWN_SIZE[size]} ${MARKDOWN_TONE[tone]}`
  return (
    <div className={className ? `${root} ${className}` : root}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
