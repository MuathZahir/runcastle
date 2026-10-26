import { useState } from 'react'
import type { BackgroundTask, ContextUsage, Effort, ModelChoice, PlanEntry, UsageLimit } from '../../../lib/chat-thread'
import { IconCheck, IconChevronDown, IconChevronUp, IconClaude, IconCodex, IconDot, IconStop, IconTerminal } from '../../../icons'
import { BARE_BUTTON, Button, IconButton, Spinner, cx } from '../../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover'
import { duration } from './Work'

const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
]

/**
 * The model and effort the NEXT message runs on. Both runtimes take a model
 * change mid-conversation, so each message can go to a different model; the
 * thread starts on the one runcastle resolved for its kind.
 */
export function ModelPicker({
  runtime,
  models,
  model,
  effort,
  onModel,
  onEffort,
}: {
  runtime: 'claude-code' | 'codex'
  models: ModelChoice[]
  model: string
  effort: Effort
  onModel: (id: string) => void
  onEffort: (e: Effort) => void
}) {
  const Glyph = runtime === 'codex' ? IconCodex : IconClaude
  const current = models.find((m) => m.id === model)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Model"
        className={cx(
          BARE_BUTTON,
          'flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text data-[state=open]:bg-surface-hover',
        )}
      >
        <Glyph size={14} className="shrink-0 text-icon" />
        <span className="truncate">{current?.label ?? model}</span>
        <span className="text-text-tertiary">{EFFORTS.find((e) => e.id === effort)?.label}</span>
        <IconChevronDown size={13} className="shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        {models.map((m) => (
          <DropdownMenuItem
            key={m.id}
            role="menuitemradio"
            aria-checked={m.id === model}
            icon={m.id === model ? <IconCheck /> : <span className="size-4 shrink-0" />}
            onSelect={() => onModel(m.id)}
          >
            <span className="flex min-w-0 flex-col">
              <span>{m.label}</span>
              {m.note && <span className="text-xs text-text-tertiary">{m.note}</span>}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        <div className="flex gap-0.5 px-1 pb-1">
          {EFFORTS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onEffort(e.id)}
              className={cx(
                BARE_BUTTON,
                'h-7 flex-1 cursor-pointer rounded-md text-xs transition-colors duration-(--dur-1) ease-app',
                e.id === effort ? 'bg-surface-selected text-text' : 'text-text-tertiary hover:bg-surface-hover hover:text-text-secondary',
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className="m-0 px-2 pt-1 pb-1.5 text-xs text-text-tertiary">Applies from your next message.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Ring({ percent, size = 16 }: { percent: number; size?: number }) {
  const r = (size - 3) / 2
  const c = 2 * Math.PI * r
  const tone = percent >= 85 ? 'text-danger' : percent >= 65 ? 'text-warning' : 'text-text-secondary'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2" className="stroke-border" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        className={cx('stroke-current transition-[stroke-dasharray] duration-(--dur-3) ease-app', tone)}
      />
    </svg>
  )
}

function Bar({ percent }: { percent: number }) {
  const tone = percent >= 85 ? 'bg-danger' : percent >= 65 ? 'bg-warning' : 'bg-text-secondary'
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-border">
      <span className={cx('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, percent)}%` }} />
    </span>
  )
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/**
 * How full the context is, as a small ring by Send; it opens to the numbers,
 * the thread's cost, the account's usage limits (Claude's /usage, Codex's
 * /status) and Compact now.
 */
export function ContextMeter({
  context,
  limits,
  plan,
  onCompact,
}: {
  context: ContextUsage
  limits: UsageLimit[]
  /** Which account the runtime runs on: "Claude Max", "ChatGPT Pro". */
  plan?: string
  onCompact: () => void
}) {
  const percent = Math.round((context.used / context.size) * 100)
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Context ${percent}% used`}
        className={cx(
          BARE_BUTTON,
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs tabular-nums text-text-tertiary',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text-secondary data-[state=open]:bg-surface-hover',
        )}
      >
        <Ring percent={percent} />
        {percent >= 65 && <span>{percent}%</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-text">Context</span>
              <span className="text-xs tabular-nums text-text-tertiary">
                {k(context.used)} of {k(context.size)} · {percent}%
              </span>
            </div>
            <Bar percent={percent} />
            {context.costUsd !== undefined && (
              <span className="text-xs tabular-nums text-text-tertiary">This thread so far: ${context.costUsd.toFixed(2)}</span>
            )}
          </section>
          {limits.length > 0 && (
            <section className="flex flex-col gap-2 border-t border-border-subtle pt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-text">Usage limits</span>
                {plan && <span className="text-xs text-text-tertiary">{plan}</span>}
              </div>
              {limits.map((l) => (
                <div key={l.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-text-secondary">{l.label}</span>
                    <span className="tabular-nums text-text-tertiary">
                      {l.percent}% · resets {l.resets}
                    </span>
                  </div>
                  <Bar percent={l.percent} />
                </div>
              ))}
            </section>
          )}
          <Button size="sm" onClick={onCompact} className="self-start">
            Compact now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The agent's task list for the turn, pinned over the composer while it works
 * (ACP plan updates — Claude's todo list, Codex's plan). Closed it is one line:
 * the step in progress and how far along; open, every step. Background
 * commands the agent left running sit on the same strip, each with its Stop.
 */
export function PlanStrip({
  plan,
  tasks,
  onStopTask,
}: {
  plan: PlanEntry[]
  tasks: BackgroundTask[]
  onStopTask: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const done = plan.filter((p) => p.status === 'completed').length
  const now = plan.find((p) => p.status === 'in_progress')
  if (plan.length === 0 && tasks.length === 0) return null
  return (
    <div className="mx-3 flex flex-col overflow-hidden rounded-t-lg border-x border-t border-border-subtle bg-surface-inset text-sm animate-rise-in">
      {plan.length > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cx(BARE_BUTTON, 'flex h-8 min-w-0 cursor-pointer items-center gap-2 px-3 text-left hover:bg-surface-hover')}
        >
          <span className="shrink-0 text-xs tabular-nums text-text-tertiary">
            {done} of {plan.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-text-secondary">{now?.content ?? 'All steps done'}</span>
          {open ? <IconChevronDown size={14} className="text-icon" /> : <IconChevronUp size={14} className="text-icon" />}
        </button>
      )}
      {open && (
        <ol className="m-0 flex list-none flex-col gap-0.5 px-3 pb-2 animate-fade-in">
          {plan.map((p) => (
            <li key={p.content} className="flex min-w-0 items-center gap-2 py-0.5">
              {p.status === 'completed' ? (
                <IconCheck size={13} className="shrink-0 text-success" />
              ) : p.status === 'in_progress' ? (
                <Spinner size="sm" />
              ) : (
                <IconDot size={13} className="shrink-0 text-text-disabled" />
              )}
              <span className={cx('min-w-0 truncate', p.status === 'completed' ? 'text-text-tertiary line-through' : p.status === 'in_progress' ? 'text-text' : 'text-text-secondary')}>
                {p.content}
              </span>
            </li>
          ))}
        </ol>
      )}
      {tasks.map((t) => (
        <div key={t.id} className="flex h-8 min-w-0 items-center gap-2 border-t border-border-subtle px-3">
          <IconTerminal size={13} className="shrink-0 text-icon" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{t.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-text-tertiary">running {duration(t.seconds)}</span>
          <IconButton label="Stop this command" icon={<IconStop size={12} />} size="sm" onClick={() => onStopTask(t.id)} />
        </div>
      ))}
    </div>
  )
}
