import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DiffLine, FileChange, ToolCall, ToolKind, WorkStep } from '../../../lib/chat-thread'
import {
  IconAlert,
  IconArrowRight,
  IconChevronRight,
  IconCube,
  IconDoc,
  IconExternalLink,
  IconOrchestrator,
  IconPencil,
  IconSearch,
  IconSparkle,
  IconTerminal,
  IconTrash,
} from '../../../icons'
import { BARE_BUTTON, Spinner, cx } from '../../../ui'
import { Markdown } from '../../Markdown'

const KIND_ICON: Record<ToolKind, (p: { size?: number; className?: string }) => ReactNode> = {
  read: IconDoc,
  edit: IconPencil,
  delete: IconTrash,
  move: IconArrowRight,
  search: IconSearch,
  execute: IconTerminal,
  think: IconSparkle,
  fetch: IconExternalLink,
  other: IconCube,
}

/** The verb a call reads with, past or in flight: "Read", "Reading". */
const KIND_VERB: Record<ToolKind, [done: string, doing: string]> = {
  read: ['Read', 'Reading'],
  edit: ['Edited', 'Editing'],
  delete: ['Deleted', 'Deleting'],
  move: ['Moved', 'Moving'],
  search: ['Searched', 'Searching'],
  execute: ['Ran', 'Running'],
  think: ['Thought', 'Thinking'],
  fetch: ['Fetched', 'Fetching'],
  other: ['Used', 'Using'],
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  return m < 60 ? `${m}m ${seconds % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** A disclosure row: chevron, words, and what opens under it. Quiet until hovered. */
function Fold({
  head,
  open,
  onToggle,
  children,
}: {
  head: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cx(
          BARE_BUTTON,
          'group/fold -mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-1.5 self-start rounded-md px-2 text-sm',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
          'text-text-tertiary hover:text-text-secondary',
        )}
      >
        {head}
        <IconChevronRight
          size={13}
          className={cx(
            'shrink-0 text-icon opacity-60 transition-transform duration-(--dur-2) ease-app group-hover/fold:opacity-100',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && <div className="mt-1 flex min-w-0 flex-col gap-1.5 animate-fade-in">{children}</div>}
    </div>
  )
}

/**
 * A turn's work. Live, each step shows as it lands — the call in flight with
 * its verb ("Running bun test"), narration in secondary prose. Settled, the
 * whole of it folds to one line, "Worked for 3m 43s", so a finished thread
 * reads as the conversation it was: your words, then the agent's answer.
 */
export function WorkBlock({ steps, seconds, live }: { steps: WorkStep[]; seconds: number; live?: boolean }) {
  const [open, setOpen] = useState(false)
  if (live) return <Steps steps={steps} />
  return (
    <Fold open={open} onToggle={() => setOpen(!open)} head={<span>Worked for {duration(seconds)}</span>}>
      <div className="border-l border-border-subtle pl-4">
        <Steps steps={steps} />
      </div>
    </Fold>
  )
}

function Steps({ steps }: { steps: WorkStep[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {steps.map((s) => {
        switch (s.kind) {
          case 'tools':
            return (
              <ol key={s.id} className="m-0 flex list-none flex-col p-0">
                {s.calls.map((c) => (
                  <CallRow key={c.id} call={c} />
                ))}
              </ol>
            )
          case 'thought':
            return <Thought key={s.id} seconds={s.seconds} text={s.text} />
          case 'narration':
            return <Markdown key={s.id} source={s.text} size="sm" tone="secondary" className="my-1.5" />
          case 'subagent':
            return <Subagent key={s.id} title={s.title} status={s.status} calls={s.calls} />
        }
      })}
    </div>
  )
}

function Thought({ seconds, text }: { seconds: number; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Fold
      open={open}
      onToggle={() => setOpen(!open)}
      head={
        <>
          <IconSparkle size={14} className="shrink-0 text-icon" />
          <span>Thought for {duration(seconds)}</span>
        </>
      }
    >
      <p className="m-0 border-l border-border-subtle pl-4 text-sm leading-[22px] text-text-tertiary italic">{text}</p>
    </Fold>
  )
}

function Subagent({ title, status, calls }: { title: string; status: ToolCall['status']; calls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const running = status === 'in_progress' || status === 'pending'
  return (
    <Fold
      open={open}
      onToggle={() => setOpen(!open)}
      head={
        <>
          {running ? <Spinner size="sm" /> : <IconOrchestrator size={14} className="shrink-0 text-icon" />}
          <span className={cx('min-w-0 truncate', running && 'text-shimmer')}>
            Subagent · <span className="text-text-secondary">{title}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
            {calls.length} {calls.length === 1 ? 'call' : 'calls'}
          </span>
        </>
      }
    >
      <ol className="m-0 flex list-none flex-col border-l border-border-subtle p-0 pl-4">
        {calls.map((c) => (
          <CallRow key={c.id} call={c} />
        ))}
      </ol>
    </Fold>
  )
}

/** One call: verb, then its target in mono; output and diffs open under it. */
function CallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[call.kind]
  const running = call.status === 'in_progress' || call.status === 'pending'
  const failed = call.status === 'failed'
  const hasDetail = !!call.output || !!call.diff
  const added = call.diff?.lines.filter((l) => l.op === '+').length ?? 0
  const removed = call.diff?.lines.filter((l) => l.op === '-').length ?? 0
  const row = (
    <>
      {running ? (
        <Spinner size="sm" />
      ) : failed ? (
        <IconAlert size={14} className="shrink-0 text-danger" />
      ) : (
        <Icon size={14} className="shrink-0 text-icon" />
      )}
      <span className={cx('shrink-0 text-sm', running ? 'text-shimmer' : failed ? 'text-danger-text' : 'text-text-tertiary')}>
        {KIND_VERB[call.kind][running ? 1 : 0]}
      </span>
      <span className={cx('min-w-0 truncate font-mono text-xs', failed ? 'text-danger-text' : 'text-text-secondary')}>
        {call.title}
      </span>
      {call.diff && <Delta added={added} removed={removed} />}
      {hasDetail && (
        <IconChevronRight
          size={13}
          className={cx('shrink-0 text-icon opacity-0 transition-all duration-(--dur-2) ease-app group-hover/call:opacity-100', open && 'rotate-90 opacity-100')}
        />
      )}
    </>
  )
  return (
    <li className="flex min-w-0 flex-col animate-fade-in">
      {hasDetail ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cx(
            BARE_BUTTON,
            'group/call -mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left',
            'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
          )}
        >
          {row}
        </button>
      ) : (
        <div className="flex h-7 min-w-0 items-center gap-2">{row}</div>
      )}
      {open && call.diff && <DiffView lines={call.diff.lines} />}
      {open && call.output && <Output text={call.output} />}
    </li>
  )
}

export function Delta({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-success-text">+{added}</span> <span className="text-danger-text">−{removed}</span>
    </span>
  )
}

function Output({ text }: { text: string }) {
  return (
    <pre className="m-0 mt-1 mb-2 max-h-64 overflow-auto rounded-md bg-surface-inset px-3 py-2 font-mono text-xs leading-[18px] whitespace-pre-wrap text-text-secondary ring-1 ring-inset ring-border-subtle">
      {text}
    </pre>
  )
}

const DIFF_LINE = {
  ' ': 'text-text-tertiary',
  '+': 'bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-text',
  '-': 'bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] text-text-secondary',
} as const

const DIFF_GUTTER = {
  ' ': 'border-transparent',
  '+': 'border-success',
  '-': 'border-danger',
} as const

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="mt-1 mb-2 max-h-80 overflow-auto rounded-md bg-surface-inset py-1.5 font-mono text-xs leading-[20px] ring-1 ring-inset ring-border-subtle">
      {lines.map((l, i) => (
        <div key={i} className={cx('flex min-w-max border-l-2 pr-3 pl-2.5', DIFF_LINE[l.op], DIFF_GUTTER[l.op])}>
          <span className="w-4 shrink-0 select-none text-text-tertiary">{l.op === ' ' ? '' : l.op === '-' ? '−' : '+'}</span>
          <span className="whitespace-pre">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * What a turn changed, under its final words: "2 changed files +29 −12", each
 * file a row that opens to its diff. The one card in a settled turn, because
 * it is the turn's result rather than its narration.
 */
export function ChangesCard({ files }: { files: FileChange[] }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<string | null>(null)
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--color-text)_2.5%,transparent)] ring-1 ring-inset ring-border-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          BARE_BUTTON,
          'flex h-10 cursor-pointer items-center gap-2 px-3 text-left text-sm text-text-secondary',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
        )}
      >
        <IconChevronRight size={14} className={cx('shrink-0 text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')} />
        <span>
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </span>
        <Delta added={added} removed={removed} />
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col border-t border-border-subtle p-1 animate-fade-in">
          {files.map((f) => (
            <li key={f.path} className="flex min-w-0 flex-col">
              <button
                type="button"
                aria-expanded={file === f.path}
                onClick={() => setFile(file === f.path ? null : f.path)}
                className={cx(
                  BARE_BUTTON,
                  'flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left',
                  'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
                )}
              >
                <IconDoc size={14} className="shrink-0 text-icon" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{f.path}</span>
                <Delta added={f.added} removed={f.removed} />
              </button>
              {file === f.path && (
                <div className="px-1">
                  <DiffView lines={f.lines} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
