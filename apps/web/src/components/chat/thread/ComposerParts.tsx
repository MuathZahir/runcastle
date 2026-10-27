import { useEffect, useState } from 'react'
import type { BackgroundTask, ContextUsage, Effort, ModelChoice, PlanEntry, UsageLimit } from '../../../lib/chat-thread'
import { groupModels, modelFamily } from '../../../lib/model-groups'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconClaude,
  IconCodex,
  IconDot,
  IconFlame,
  IconStop,
  IconTerminal,
} from '../../../icons'
import { BARE_BUTTON, Button, IconButton, Spinner, cx } from '../../../ui'
import {
  Combobox,
  ComboboxAction,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../../../ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { duration } from './Work'

const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' }

/** The composer footer's chips: quiet until hovered or open. */
const CHIP = cx(
  BARE_BUTTON,
  'flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary',
  'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text data-[state=open]:bg-surface-hover data-[state=open]:text-text',
)

/**
 * The model the NEXT message runs on (decisions 9, 13). One list, the same
 * before and after the agent starts: searchable (type to filter, arrows and
 * Enter to pick, Esc to close), grouped by family with the newest of each in
 * view and older versions folded away, the current model checked, each with
 * its one-line description. The chip names the model alone; effort and fast
 * mode are their own controls beside it.
 */
function ModelPicker({
  runtime,
  models,
  model,
  onModel,
}: {
  runtime: 'claude-code' | 'codex'
  models: ModelChoice[]
  model: string
  onModel: (id: string) => void
}) {
  const Glyph = runtime === 'codex' ? IconCodex : IconClaude
  const [query, setQuery] = useState('')
  const [showOlder, setShowOlder] = useState(false)
  const groups = groupModels(models)
  const older = groups.flatMap((g) => g.older)
  // A thread on an older model opens with it in view.
  const olderOpen = showOlder || query !== '' || older.some((m) => m.id === model)
  const row = (m: ModelChoice) => (
    <ComboboxItem
      key={m.id}
      value={m.id}
      keywords={[m.label, modelFamily(m.label).family]}
      current={m.id === model}
      onSelect={() => onModel(m.id)}
    >
      <span className="flex min-w-0 flex-col py-0.5">
        <span className="truncate">{m.label}</span>
        {m.note && <span className="truncate text-xs text-text-tertiary">{m.note}</span>}
      </span>
    </ComboboxItem>
  )
  return (
    <Combobox
      onOpenChange={(open) => {
        if (open) return
        setQuery('')
        setShowOlder(false)
      }}
    >
      <ComboboxTrigger aria-label="Model" className={CHIP}>
        <Glyph size={14} className="shrink-0 text-icon" />
        <span className="truncate">{models.find((m) => m.id === model)?.label ?? model}</span>
        <IconChevronDown size={13} className="shrink-0 text-icon" />
      </ComboboxTrigger>
      <ComboboxContent side="top" align="start" className="w-80">
        <ComboboxInput placeholder="Search models" aria-label="Search models" value={query} onValueChange={setQuery} />
        <ComboboxList label="Models" className="max-h-80">
          <ComboboxEmpty>No model matches.</ComboboxEmpty>
          {groups.map((g) => (
            <ComboboxGroup key={g.family} heading={g.family}>
              {g.latest.map(row)}
            </ComboboxGroup>
          ))}
          {older.length > 0 &&
            (olderOpen ? (
              <ComboboxGroup heading="Older models">{older.map(row)}</ComboboxGroup>
            ) : (
              <ComboboxAction value="Older models" onSelect={() => setShowOlder(true)}>
                <IconChevronRight size={13} />
                Older models
                <span className="tabular-nums">{older.length}</span>
              </ComboboxAction>
            ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/**
 * The composer footer's model controls: the model, then its effort and fast
 * mode, each its own control and each shown only where the model has it. They
 * work the same on a thread that has not started: the choice rides its first
 * message.
 */
export function ModelControls({
  runtime,
  models,
  model,
  onModel,
  effort,
  onEffort,
  fast,
  onFast,
}: {
  runtime: 'claude-code' | 'codex'
  models: ModelChoice[]
  model: string
  onModel: (id: string) => void
  /** The level held for the thread; absent until one is chosen or reported. */
  effort: Effort | undefined
  onEffort: (e: Effort) => void
  fast: boolean
  onFast: (on: boolean) => void
}) {
  const on = models.find((m) => m.id === model)
  const efforts = on?.efforts ?? []
  // A model that does not take the level held shows the one its runtime recommends.
  const shown = effort && efforts.includes(effort) ? effort : efforts.includes('medium') ? 'medium' : efforts[0]
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ModelPicker runtime={runtime} models={models} model={model} onModel={onModel} />
      {shown && <EffortPicker efforts={efforts} effort={shown} onEffort={onEffort} />}
      {on?.fast && <FastToggle fast={fast} onFast={onFast} />}
    </div>
  )
}

/** How hard the next message's model thinks: only the levels that model takes. */
function EffortPicker({ efforts, effort, onEffort }: { efforts: Effort[]; effort: Effort; onEffort: (e: Effort) => void }) {
  return (
    <Select value={effort} onValueChange={(next) => onEffort(next as Effort)}>
      <SelectTrigger aria-label="Effort" className={CHIP}>
        <span className="text-text-tertiary">Effort</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="top" align="start">
        {efforts.map((e) => (
          <SelectItem key={e} value={e}>
            {EFFORT_LABEL[e]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Fast mode for the next message, where the runtime offers it on the model. */
function FastToggle({ fast, onFast }: { fast: boolean; onFast: (on: boolean) => void }) {
  return <IconButton label="Fast mode" icon={<IconFlame size={14} />} active={fast} onClick={() => onFast(!fast)} />
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
  /** Stop one background command; absent, a command shows without its Stop. */
  onStopTask?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  // A command's running time ticks each second while any runs.
  const [now, setNow] = useState(() => Date.now())
  const ticking = tasks.length > 0
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  const done = plan.filter((p) => p.status === 'completed').length
  const current = plan.find((p) => p.status === 'in_progress')
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
          <span className="min-w-0 flex-1 truncate text-text-secondary">{current?.content ?? 'All steps done'}</span>
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
          <span className="shrink-0 text-xs tabular-nums text-text-tertiary">running {duration(Math.max(0, Math.round((now - t.startedAt) / 1000)))}</span>
          {onStopTask && <IconButton label="Stop this command" icon={<IconStop size={12} />} size="sm" onClick={() => onStopTask(t.id)} />}
        </div>
      ))}
    </div>
  )
}
