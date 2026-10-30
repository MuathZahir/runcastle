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
import { INSET, WELL } from './surfaces'

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

/**
 * The verbs an ACP title can open with ("Read README.md", "Edit src/a.ts",
 * "Fetch https://…"), each said past or in flight. A title that opens with one
 * says its own verb, so the kind's is not put in front of it.
 */
const TITLE_VERB: Record<string, [done: string, doing: string]> = {
  Read: ['Read', 'Reading'],
  Write: ['Wrote', 'Writing'],
  Edit: ['Edited', 'Editing'],
  Delete: ['Deleted', 'Deleting'],
  Move: ['Moved', 'Moving'],
  Fetch: ['Fetched', 'Fetching'],
  Search: ['Searched', 'Searching'],
  Run: ['Ran', 'Running'],
  // codex-acp's own openings: "List files in 'src'", "View Image a.png", "Open page: …", "Find in page …", "Compact conversation".
  List: ['Listed', 'Listing'],
  View: ['Viewed', 'Viewing'],
  Open: ['Opened', 'Opening'],
  Find: ['Searched', 'Searching'],
  Compact: ['Compacted', 'Compacting'],
}

/** A title that opens in flight ("Editing files", codex-acp's edit row): the verb it says, with the call's own tense. */
const DOING_VERB = new Map(Object.values(TITLE_VERB).map((verb) => [verb[1], verb] as const))

/**
 * Titles that already read as a sentence, shown as they are: claude-agent-acp's
 * skill, task and plan rows, and codex-acp's review, image and subagent rows.
 */
const SENTENCE_TITLE =
  /^(Load skill|Create task|Update task|List tasks|Get task|Approve Plan|Exited Plan Mode|Asking for|Preparing file|Edit notebook|Terminal|Image generation|(Start|Interact with|Interrupt|Complete) subagent)\b/

/** An MCP tool's title: Claude's `mcp__server__tool`, codex-acp's `mcp.server.tool`. */
const MCP_TITLE = /^mcp__(.+)__([^_].*)$|^mcp\.(.+)\.([^.]+)$/

/** codex-acp's web search row, "Web search: <query>". */
const WEB_SEARCH = /^Web search(?::\s*(.*))?$/

/**
 * codex-acp's automatic review of an action the agent takes. One follows every
 * action, so an approved one folds away; one under way or one that stopped the
 * action is said in a person's words.
 */
const REVIEW_TITLE = 'Guardian Review'

/** A call the row list leaves out: a review that approved its action has nothing to say. */
const foldedAway = (call: ToolCall): boolean => call.title === REVIEW_TITLE && call.status === 'completed'

/** A command wrapped in its shell (`"…\pwsh.exe" -Command '…'`, `cmd /c …`, `bash -lc '…'`): the shell, then the script. */
const LAUNCHER = /^("[^"]+"|\S+)\s+(?:-(?:NoLogo|NoProfile|NonInteractive)\s+)*(?:-Command|-c|-lc|\/c)\s+([\s\S]+)$/i
const SHELLS = new Set(['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'sh'])

/** The command a shell launcher wraps, unquoted; any other command as it is. */
export function innerCommand(command: string): string {
  const m = LAUNCHER.exec(command.trim())
  const shell = m?.[1].replace(/"/g, '').split(/[\\/]/).pop()?.replace(/\.exe$/i, '').toLowerCase()
  if (!m || !shell || !SHELLS.has(shell)) return command
  const script = m[2].trim()
  return /^(['"])[\s\S]*\1$/.test(script) ? script.slice(1, -1) : script
}

/** "get_feature_context" → "get feature context". */
const inWords = (name: string): string => name.replace(/[_-]+/g, ' ').trim()

/**
 * What a call's row says: one verb, then what it acted on (in mono when that is
 * a path or a command). An MCP tool reads "runcastle: get feature context", an
 * internal tool by its name in words ("Used tool search"), never the raw name;
 * a command reads without the shell that launched it.
 */
export function callText(call: Pick<ToolCall, 'kind' | 'title' | 'status'>, running: boolean): { verb?: string; target: string; mono: boolean } {
  const tense = running ? 1 : 0
  if (call.title === REVIEW_TITLE) {
    const said = running ? "Checking with Codex's reviewer" : call.status === 'failed' ? "Stopped by Codex's reviewer" : "Checked by Codex's reviewer"
    return { target: said, mono: false }
  }
  if (call.kind === 'execute') call = { ...call, title: innerCommand(call.title) }
  const mcp = MCP_TITLE.exec(call.title)
  if (mcp) {
    const [server, tool] = mcp[1] !== undefined ? [mcp[1], mcp[2]] : [mcp[3], mcp[4]]
    return { target: `${inWords(server.replace(/^plugin_/, ''))}: ${inWords(tool)}`, mono: false }
  }
  if (SENTENCE_TITLE.test(call.title)) return { target: call.title, mono: false }
  const web = WEB_SEARCH.exec(call.title)
  if (web) return { verb: running ? 'Searching the web' : 'Searched the web', target: web[1] ?? '', mono: false }
  const [first, ...rest] = call.title.split(' ')
  const own = TITLE_VERB[first] ?? DOING_VERB.get(first)
  if (own) return { verb: own[tense], target: rest.join(' '), mono: true }
  // An internal tool's raw name (ToolSearch): its words.
  if (/^[A-Z][A-Za-z]+$/.test(call.title)) {
    return { verb: KIND_VERB[call.kind][tense], target: call.title.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), mono: false }
  }
  return { verb: KIND_VERB[call.kind][tense], target: call.title, mono: true }
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
            return <Calls key={s.id} calls={s.calls} />
          case 'thought':
            return <Thought key={s.id} seconds={s.seconds} text={s.text} />
          case 'narration':
            return <Markdown key={s.id} source={s.text} size="sm" tone="secondary" className="my-1.5" breaks />
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

/**
 * A subagent the turn delegated to, as a card (the-chat-looks-the-part
 * decision 13): it is its own piece of work, not one more line. Its head says
 * what it was asked and how many calls it made; while it runs, the call in
 * flight shows under the head; opened, every call, grouped as the turn's are.
 */
function Subagent({ title, status, calls }: { title: string; status: ToolCall['status']; calls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const running = status === 'in_progress' || status === 'pending'
  const shown = calls.filter((c) => !foldedAway(c))
  const inFlight = running ? shown.findLast((c) => c.status === 'in_progress' || c.status === 'pending') : undefined
  return (
    <div className={cx(WELL, 'my-1.5 flex min-w-0 flex-col overflow-hidden')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          BARE_BUTTON,
          'group/fold flex h-10 min-w-0 cursor-pointer items-center gap-2 px-3 text-left text-sm',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
        )}
      >
        {/* One spinner per moment: the call in flight under the head has it, so the head keeps its glyph. */}
        {running && !inFlight ? <Spinner size="sm" /> : <IconOrchestrator size={14} className="shrink-0 text-icon" />}
        <span className="shrink-0 text-text-tertiary">Subagent</span>
        <span className={cx('min-w-0 truncate', running ? 'text-shimmer' : 'text-text-secondary')}>{title}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-text-tertiary">
          {shown.length} {shown.length === 1 ? 'call' : 'calls'}
        </span>
        <IconChevronRight
          size={13}
          className={cx('shrink-0 text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')}
        />
      </button>
      {open ? (
        <div className="border-t border-border-subtle px-3 py-1.5 animate-fade-in">
          <Calls calls={calls} />
        </div>
      ) : (
        inFlight && (
          <ol className="m-0 list-none border-t border-border-subtle px-3 py-0.5">
            <CallRow call={inFlight} />
          </ol>
        )
      )}
    </div>
  )
}

/** Which calls fold together when they come one after another: looking around, changing files, running commands. */
type Family = 'explore' | 'change' | 'run'
const FAMILY: Partial<Record<ToolKind, Family>> = {
  read: 'explore',
  search: 'explore',
  fetch: 'explore',
  edit: 'change',
  delete: 'change',
  move: 'change',
  execute: 'run',
}

/** A call's family, or none for a call that reads as its own sentence (an MCP tool, a skill, a review). */
function familyOf(call: ToolCall): Family | undefined {
  if (MCP_TITLE.test(call.title) || SENTENCE_TITLE.test(call.title) || WEB_SEARCH.test(call.title) || call.title === REVIEW_TITLE) return undefined
  return FAMILY[call.kind]
}

type CallRun = { kind: 'one'; call: ToolCall } | { kind: 'group'; family: Family; calls: ToolCall[] }

/** Calls in order, two or more of one family in a row folded into one run (decision 12). */
export function groupCalls(calls: ToolCall[]): CallRun[] {
  const runs: CallRun[] = []
  for (const call of calls.filter((c) => !foldedAway(c))) {
    const family = familyOf(call)
    const last = runs.at(-1)
    if (family && last?.kind === 'group' && last.family === family) last.calls.push(call)
    else if (family && last?.kind === 'one' && familyOf(last.call) === family)
      runs[runs.length - 1] = { kind: 'group', family, calls: [last.call, call] }
    else runs.push({ kind: 'one', call })
  }
  return runs
}

/** How a group reads, per kind inside it: [done, doing, noun, nouns]. */
const GROUP_WORDS: Partial<Record<ToolKind, [string, string, string, string]>> = {
  read: ['Read', 'Reading', 'file', 'files'],
  search: ['Searched for', 'Searching for', 'pattern', 'patterns'],
  fetch: ['Fetched', 'Fetching', 'page', 'pages'],
  edit: ['Edited', 'Editing', 'file', 'files'],
  delete: ['Deleted', 'Deleting', 'file', 'files'],
  move: ['Moved', 'Moving', 'file', 'files'],
  execute: ['Ran', 'Running', 'command', 'commands'],
}

const isRunning = (c: ToolCall): boolean => c.status === 'in_progress' || c.status === 'pending'

/**
 * A group's words: "Read 3 files, searched for 2 patterns", "Edited 5 files".
 * A file read or edited twice counts once. A kind with a call in flight reads
 * in the present: "Reading 4 files".
 */
export function groupText(calls: ToolCall[]): string {
  const kinds = [...new Set(calls.map((c) => c.kind))]
  return kinds
    .map((kind, i) => {
      const words = GROUP_WORDS[kind]
      const of = calls.filter((c) => c.kind === kind)
      if (!words) return ''
      // A file read in two ranges ("a.ts (1 - 5)", "a.ts (6 - 10)") is one file.
      const fileOf = (c: ToolCall) => c.diff?.path ?? callText(c, false).target.replace(/\s+\(\d+\s*-\s*\d+\)$/, '')
      const n = words[2] === 'file' ? new Set(of.map(fileOf)).size : of.length
      const verb = of.some(isRunning) ? words[1] : words[0]
      const said = `${verb} ${n} ${n === 1 ? words[2] : words[3]}`
      return i === 0 ? said : said.charAt(0).toLowerCase() + said.slice(1)
    })
    .filter(Boolean)
    .join(', ')
}

const FAMILY_ICON: Record<Family, (p: { size?: number; className?: string }) => ReactNode> = {
  explore: IconSearch,
  change: IconPencil,
  run: IconTerminal,
}

/**
 * A run of calls of one family as one line, as Claude Code reads them:
 * "Edited 5 files +40 −12", opening to each call. While one is in flight the
 * line names it, so you see what is happening without opening it.
 */
function CallGroup({ family, calls }: { family: Family; calls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const Icon = FAMILY_ICON[family]
  const inFlight = calls.findLast(isRunning)
  const failed = calls.filter((c) => c.status === 'failed').length
  const diffs = calls.flatMap((c) => c.diff?.lines ?? [])
  return (
    <li className="flex min-w-0 flex-col animate-fade-in">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          BARE_BUTTON,
          'group/call -mx-2 flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
        )}
      >
        {inFlight ? <Spinner size="sm" /> : <Icon size={14} className="shrink-0 text-icon" />}
        <span className={cx('shrink-0', inFlight ? 'text-shimmer' : 'text-text-tertiary')}>{groupText(calls)}</span>
        {inFlight && (
          <span className="min-w-0 truncate font-mono text-xs text-text-secondary">{callText(inFlight, true).target}</span>
        )}
        {family === 'change' && diffs.length > 0 && (
          <Delta added={diffs.filter((l) => l.op === '+').length} removed={diffs.filter((l) => l.op === '-').length} />
        )}
        {failed > 0 && <span className="shrink-0 text-danger-text">· {failed} failed</span>}
        <IconChevronRight
          size={13}
          className={cx('shrink-0 text-icon opacity-60 transition-all duration-(--dur-2) ease-app group-hover/call:opacity-100', open && 'rotate-90 opacity-100')}
        />
      </button>
      {open && (
        <ol className="m-0 mt-0.5 mb-1 flex list-none flex-col border-l border-border-subtle p-0 pl-4 animate-fade-in">
          {calls.map((c) => (
            <CallRow key={c.id} call={c} />
          ))}
        </ol>
      )}
    </li>
  )
}

/** A step's calls: single calls as rows, runs of one family as one line each. */
function Calls({ calls }: { calls: ToolCall[] }) {
  const runs = groupCalls(calls)
  if (runs.length === 0) return null
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {runs.map((r) =>
        r.kind === 'one' ? <CallRow key={r.call.id} call={r.call} /> : <CallGroup key={r.calls[0].id} family={r.family} calls={r.calls} />,
      )}
    </ol>
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
  const text = callText(call, running)
  const row = (
    <>
      {running ? (
        <Spinner size="sm" />
      ) : failed ? (
        <IconAlert size={14} className="shrink-0 text-danger" />
      ) : (
        <Icon size={14} className="shrink-0 text-icon" />
      )}
      {text.verb && (
        <span className={cx('shrink-0 text-sm', running ? 'text-shimmer' : failed ? 'text-danger-text' : 'text-text-tertiary')}>{text.verb}</span>
      )}
      {text.target && (
        <span
          className={cx(
            'min-w-0 truncate',
            text.mono ? 'font-mono text-xs' : 'text-sm',
            failed ? 'text-danger-text' : text.verb ? 'text-text-secondary' : running ? 'text-shimmer' : 'text-text-tertiary',
          )}
        >
          {text.target}
        </span>
      )}
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
    <pre className={cx(INSET, 'm-0 mt-1 mb-2 max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-[18px] whitespace-pre-wrap text-text-secondary')}>
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
    <div className={cx(INSET, 'mt-1 mb-2 max-h-80 overflow-auto py-1.5 font-mono text-xs leading-[20px]')}>
      {lines.map((l, i) => (
        <div key={i} className={cx('flex min-w-max border-l-2 pr-3 pl-2.5', DIFF_LINE[l.op], DIFF_GUTTER[l.op])}>
          <span className="w-4 shrink-0 select-none text-text-tertiary">{l.op === ' ' ? '' : l.op === '-' ? '−' : '+'}</span>
          <span className="whitespace-pre">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/** A path that, short of room, gives up its folders from the left and keeps the file name whole. */
function FilePath({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  return (
    <span title={path} className="flex min-w-0 flex-1 font-mono text-xs">
      {cut > 0 && (
        <span className="min-w-0 truncate text-text-tertiary [direction:rtl]">
          <bdi>{path.slice(0, cut)}</bdi>
        </span>
      )}
      <span className="shrink-0 text-text-secondary">{path.slice(cut)}</span>
    </span>
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
    <div className={cx(WELL, 'flex flex-col overflow-hidden')}>
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
                <FilePath path={f.path} />
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
