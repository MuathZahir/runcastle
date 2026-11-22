import type { ReactNode } from 'react'
import { Button, cx, IconButton, StatusLabel } from '../ui'
import { IconCheck, IconCopy, IconRefresh } from '../icons'
import { ErrorBoundary } from './ErrorBoundary'
import { HIGHLIGHT_RING, useHighlight } from './settings/highlight'
import { TerminalView } from './lazy'

/**
 * A numbered checklist of one-line verdicts, each with a single action and an
 * optional terminal opening underneath it. The first-run wizard's "Coding
 * agents" step is built from these.
 */

/**
 * One checklist row: its number, the label with a status word beside it, the
 * one line the probe observed, and the row's single action on the right.
 * `below` is the terminal a flow opens, which runs the full width rather than
 * squeezing into the action column.
 *
 * The number is a CSS counter on the {@link Checklist}, so a row that renders
 * nothing takes its number with it rather than leaving a gap. `status`
 * overrides the default Ready / Needed word when a row has something more exact
 * to say.
 */
export function ChecklistRow({
  field,
  label,
  visible = true,
  highlight = false,
  detail,
  ok,
  status,
  children,
  below,
}: {
  /** Stable row id — the `data-field` a deep link names. */
  field?: string
  label: string
  /** False hides the row. */
  visible?: boolean
  /** A deep link named this row: scroll to it and flash it once. */
  highlight?: boolean
  detail: string
  ok: boolean
  status?: string
  children?: ReactNode
  below?: ReactNode
}) {
  const { ref, flash } = useHighlight<HTMLLIElement>(highlight)
  if (!visible) return null
  return (
    <li
      ref={ref}
      {...(field ? { 'data-field': field } : {})}
      className={cx(
        'grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3 [counter-increment:checklist]',
        'border-t border-border-subtle first:border-t-0',
        flash && HIGHLIGHT_RING,
      )}
    >
      <span
        aria-hidden
        className="flex h-5 items-center justify-center text-xs text-text-tertiary tabular-nums before:content-[counter(checklist)]"
      />
      <div className="min-w-0">
        <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-text">{label}</span>
          {ok ? (
            <StatusLabel tone="success" icon={<IconCheck />}>
              {status ?? 'Ready'}
            </StatusLabel>
          ) : (
            <StatusLabel tone="warning">{status ?? 'Needed'}</StatusLabel>
          )}
        </div>
        <div className="mt-0.5 font-mono text-xs break-words text-text-tertiary" title={detail}>
          {detail}
        </div>
      </div>
      <div className="flex max-w-96 flex-wrap items-center justify-end gap-2">{children}</div>
      {below}
    </li>
  )
}

/** The numbered list a set of {@link ChecklistRow}s sits in. */
export function Checklist({ children }: { children: ReactNode }) {
  return (
    <ol className="m-0 list-none border-t border-border-subtle p-0 [counter-reset:checklist]">
      {children}
    </ol>
  )
}

/** The terminal a row's flow opened, under it and across the whole row. */
export function RowTerminal({
  sessionId,
  label,
  onDone,
  onEnded,
}: {
  sessionId: string
  label: string
  onDone?: () => void
  /**
   * The flow's process exited on its own. Distinct from `onDone`, which is the
   * operator dismissing the terminal: an exit leaves the output up to be read.
   */
  onEnded?: () => void
}) {
  return (
    <div className="col-span-full flex flex-col gap-2">
      <div className="h-70 overflow-hidden rounded-md border border-border bg-surface-inset animate-rise-in">
        <ErrorBoundary label={label}>
          <TerminalView sessionId={sessionId} onEnded={onEnded} />
        </ErrorBoundary>
      </div>
      {onDone && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={<IconRefresh />} onClick={onDone}>
            Done — re-check
          </Button>
        </div>
      )}
    </div>
  )
}

/** A command to run, as code, with the one action on it: copy. */
export function CommandLine({ command, onCopy }: { command: string; onCopy: () => void }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-surface-inset py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 truncate font-mono text-xs text-text-secondary" title={command}>
        {command}
      </code>
      <IconButton label="Copy" size="sm" icon={<IconCopy />} onClick={onCopy} />
    </span>
  )
}
