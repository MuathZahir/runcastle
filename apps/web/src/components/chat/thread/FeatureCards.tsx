import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconAlert,
  IconBranchFrom,
  IconCheck,
  IconChevronRight,
  IconDoc,
  IconGitMerge,
  IconOrchestrator,
  IconPlay,
  IconPlus,
  IconSend,
  IconStop,
  IconX,
} from '../../../icons'
import { cx } from '../../../ui'
import { StatusDot } from '../../../ui/status'
import type { FeatureListItem } from '../../../lib/api'
import { triageOf } from '../../../lib/feature-ui/sidebar'
import { FeatureProgressIcon, featureStateWords } from '../../SidebarParts'
import { INSET, WELL } from './surfaces'

/**
 * Orchestrator actions and runcastle's news as cards in a chat
 * (docs/features/orchestrator-actions-show-as-cards): one row shape for "a
 * feature", used by the features card (what a turn did to features) and the
 * news block (what happened to them elsewhere). A row names the feature by its
 * title, says what happened in plain words, shows where the feature is now in
 * the sidebar's own words, and opens the feature.
 */

// ---- what a turn did ----

/** What an orchestrator action did to a feature (decision 1). */
export type FeatureAction =
  | 'created'
  | 'parked'
  | 'started'
  | 'planning'
  | 'planningStopped'
  | 'messaged'
  | 'relayed'
  | 'brief'
  | 'taken'
  | 'merged'
  | 'driveStarted'
  | 'driveStopped'

/** One feature a turn acted on: one row of a features card. */
export interface FeatureActionRow {
  featureId: string
  /** The feature as the sidebar reads it; null when the list no longer holds it. */
  feature: FeatureListItem | null
  /** Its title when the action happened, for a feature the list no longer holds. */
  title: string
  /** What the turn did to it, in order. */
  actions: FeatureAction[]
  /** The first line of the message the turn sent it (decision 13). */
  quote?: string
  /** The branch a merge landed on. */
  into?: string
}

/** An action in words, as a row's second line says it. */
export function actionWords(action: FeatureAction, row: Pick<FeatureActionRow, 'into'>): string {
  switch (action) {
    case 'created':
      return 'Created'
    case 'parked':
      return 'Parked in the backlog'
    case 'started':
      return 'Started'
    case 'planning':
      return 'Planning started'
    case 'planningStopped':
      return 'Planning stopped'
    case 'messaged':
      return 'Sent a message'
    case 'relayed':
      return 'Passed on your answer'
    case 'brief':
      return 'Brief updated'
    case 'taken':
      return 'Taken into this chat'
    case 'merged':
      return `Merged into ${row.into ?? 'its base'}`
    case 'driveStarted':
      return 'Test drive started'
    case 'driveStopped':
      return 'Test drive stopped'
  }
}

/** The icon a card's heading wears, by what most of its rows had done to them. */
const ACTION_ICON: Record<FeatureAction, ReactNode> = {
  created: <IconPlus size={14} />,
  parked: <IconPlus size={14} />,
  started: <IconPlay size={14} />,
  planning: <IconDoc size={14} />,
  planningStopped: <IconStop size={14} />,
  messaged: <IconSend size={14} />,
  relayed: <IconSend size={14} />,
  brief: <IconDoc size={14} />,
  taken: <IconBranchFrom size={14} />,
  merged: <IconGitMerge size={14} />,
  driveStarted: <IconPlay size={14} />,
  driveStopped: <IconStop size={14} />,
}

/**
 * A features card's heading: what its rows share, counted ("4 features
 * created"). A card of one row has none, nor one whose rows had different
 * things done to them: each row says what happened to it.
 */
export function featuresCardHeading(rows: readonly FeatureActionRow[]): { text: string; icon: ReactNode } | null {
  if (rows.length < 2) return null
  const n = rows.length
  const first = (r: FeatureActionRow) => r.actions[0]
  const all = (...kinds: FeatureAction[]) => rows.every((r) => kinds.includes(first(r)!))
  if (all('created', 'parked')) return { text: `${n} features created`, icon: ACTION_ICON.created }
  if (all('planning')) return { text: `${n} features planning`, icon: ACTION_ICON.planning }
  if (all('started')) return { text: `${n} features started`, icon: ACTION_ICON.started }
  if (all('messaged', 'relayed')) return { text: `Messages sent to ${n} features`, icon: ACTION_ICON.messaged }
  if (all('merged')) return { text: `${n} features merged`, icon: ACTION_ICON.merged }
  if (all('brief')) return { text: `${n} briefs updated`, icon: ACTION_ICON.brief }
  // Rows that had different things done: each row says its own, a count would say nothing.
  return null
}

// ---- the shared row ----

/**
 * Where the feature is now, as its sidebar row says it: amber words when it
 * needs you. A need shows its label only ("Ready to test"), so the title keeps
 * its room; the reason after "·" is the row's tooltip and is one click away.
 */
export function LiveState({ feature }: { feature: FeatureListItem }) {
  const needsYou = triageOf(feature) === 'needsYou'
  const words = featureStateWords(feature)
  const label = needsYou ? (words.split(' · ')[0] ?? words) : words
  return (
    <span
      title={words === label ? undefined : words}
      className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap', needsYou ? 'text-warning-text' : 'text-text-tertiary')}
    >
      {needsYou && <StatusDot tone="warning" />}
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * One feature, as a row: the glyph the sidebar gives it, its title, a line of
 * what happened (`detail`), and where it is now (`state`). The state sits at
 * the row's end on a wide column and under the detail on a narrow one
 * (decision 11): the card is a size container, so the row follows the chat's
 * width, not the window's.
 */
export function FeatureRow({
  title,
  glyph,
  detail,
  state,
  onOpen,
}: {
  title: string
  glyph: ReactNode
  detail: ReactNode
  /** Where the feature is now; absent when the row shows no live state. */
  state?: ReactNode
  /** Open the feature; absent for a feature the list no longer holds. */
  onOpen?: () => void
}) {
  const body = (
    <>
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center">{glyph}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 @min-[440px]/card:flex-row @min-[440px]/card:items-start @min-[440px]/card:gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-md font-medium text-text">{title}</span>
          <span className="min-w-0 text-sm text-text-secondary">{detail}</span>
        </span>
        {state && <span className="flex min-w-0 shrink-0 pt-px @min-[440px]/card:max-w-[40%] @min-[440px]/card:pt-0.5">{state}</span>}
      </span>
      {onOpen && (
        <IconChevronRight
          size={14}
          className="mt-1 shrink-0 text-icon transition-transform duration-(--dur-1) group-hover/row:translate-x-0.5"
        />
      )}
    </>
  )
  const row = 'group/row flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left'
  return onOpen ? (
    <button
      type="button"
      aria-label={`Open ${title}`}
      onClick={onOpen}
      className={cx(row, 'cursor-pointer transition-colors duration-(--dur-1) hover:bg-surface-hover')}
    >
      {body}
    </button>
  ) : (
    <div className={cx(row, 'opacity-70')}>{body}</div>
  )
}

/** A row's glyph: the feature's own, or a placeholder once the list no longer holds it. */
function Glyph({ feature }: { feature: FeatureListItem | null }) {
  return feature ? <FeatureProgressIcon f={feature} label="" /> : <span className="size-3 rounded-full border border-dashed border-border-strong" />
}

/** A features card row's second line: what the turn did, then the message it sent, quoted. */
function ActionDetail({ row }: { row: FeatureActionRow }) {
  const merged = row.actions.includes('merged')
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5">
        {merged && <IconGitMerge size={13} className="shrink-0 text-success" />}
        <span className={cx('truncate', merged && 'text-success-text')}>{row.actions.map((a) => actionWords(a, row)).join(' · ')}</span>
      </span>
      {row.quote && (
        <span className="line-clamp-2 text-text-tertiary @min-[440px]/card:line-clamp-1">“{row.quote}”</span>
      )}
    </span>
  )
}

/**
 * What a turn did to features, as one card (decisions 1, 3, 12): a heading
 * when there are several, then a row each. Every row opens its feature.
 * `showState` says which rows carry the live state (decision 3): all of them
 * unless told otherwise. A merged row's state is left off: "Shipped" says
 * again what "Merged into main" just said.
 */
export function FeaturesCard({
  rows,
  onOpen,
  showState = () => true,
}: {
  rows: readonly FeatureActionRow[]
  onOpen: (featureId: string) => void
  showState?: (row: FeatureActionRow) => boolean
}) {
  const heading = featuresCardHeading(rows)
  return (
    <div className={cx(WELL, '@container/card flex w-full max-w-[520px] min-w-0 flex-col p-1 animate-rise-in')}>
      {heading && (
        <div className="flex min-w-0 items-center gap-2 px-2.5 pt-2 pb-1.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-text">{heading.icon}</span>
          <span className="min-w-0 flex-1 truncate text-md font-medium text-text">{heading.text}</span>
        </div>
      )}
      <div className={cx('flex min-w-0 flex-col', heading && 'border-t border-border-subtle pt-1')}>
        {rows.map((row) => (
          <FeatureRow
            key={row.featureId}
            title={row.feature?.title ?? row.title}
            glyph={<Glyph feature={row.feature} />}
            detail={<ActionDetail row={row} />}
            {...(row.feature && showState(row) && !row.actions.includes('merged') ? { state: <LiveState feature={row.feature} /> } : {})}
            {...(row.feature ? { onOpen: () => onOpen(row.featureId) } : {})}
          />
        ))}
      </div>
    </div>
  )
}

// ---- runcastle's news ----

/** How a piece of news reads: done, waiting on you, failed, or only so. */
export type NewsTone = 'done' | 'needsYou' | 'failed' | 'info'

/** One thing runcastle reported about a feature, in plain words ("Round 2 finished"). */
export interface NewsEvent {
  tone: NewsTone
  words: string
}

/** One feature's news in a delivery: every line about it, joined (decision 5). */
export interface NewsRow {
  featureId: string
  feature: FeatureListItem | null
  title: string
  events: NewsEvent[]
}

const TONE_RANK: Record<NewsTone, number> = { failed: 3, needsYou: 2, done: 1, info: 0 }

/** A news row's glyph: the most pressing of its events. */
function NewsGlyph({ events }: { events: readonly NewsEvent[] }) {
  const tone = events.reduce<NewsTone>((t, e) => (TONE_RANK[e.tone] > TONE_RANK[t] ? e.tone : t), 'info')
  switch (tone) {
    case 'failed':
      return <IconX size={14} className="text-danger" />
    case 'needsYou':
      return <IconAlert size={14} className="text-warning" />
    case 'done':
      return <IconCheck size={14} className="text-success" />
    case 'info':
      return <span className="size-1.5 rounded-full bg-icon" />
  }
}

/**
 * "What the agent read": the toggle for the text runcastle gave the agent,
 * closed until asked for (decision 7). The caller draws the text under its block.
 */
function AgentReadToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="shrink-0 cursor-pointer text-xs whitespace-nowrap text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
    >
      {open ? 'Hide what the agent read' : 'What the agent read'}
    </button>
  )
}

/** The text an agent was given, as it reads it. */
function AgentText({ text }: { text: string }) {
  return (
    <pre className={cx(INSET, 'm-0 max-h-60 overflow-auto px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-text-secondary animate-fade-in')}>
      {text}
    </pre>
  )
}

/** The small runcastle mark a runcastle line opens with. */
function RuncastleMark() {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-accent-subtle text-accent-text">
      <IconOrchestrator size={12} />
    </span>
  )
}

/**
 * What runcastle told the agent about its features, as one block per delivery
 * (decisions 5, 6, 7): "Runcastle" and when, then a row per feature in the
 * features card's row shape, the event in plain words. `framed` draws it in the
 * chat's well, like an action card; unframed it sits quietly in the thread.
 */
export function NewsBlock({
  rows,
  when,
  agentText,
  onOpen,
  showState = () => true,
  framed = false,
}: {
  rows: readonly NewsRow[]
  /** "2m ago", "10:42". */
  when?: string
  /** What the agent was given, behind "What the agent read". */
  agentText: string
  onOpen: (featureId: string) => void
  showState?: (row: NewsRow) => boolean
  framed?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full max-w-[520px] min-w-0 flex-col gap-1.5 animate-fade-in">
      <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary">
        <RuncastleMark />
        <span className="font-medium text-text-secondary">Runcastle</span>
        {when && (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0">{when}</span>
          </>
        )}
        <span className="flex-1" />
        <AgentReadToggle open={open} onToggle={() => setOpen((o) => !o)} />
      </p>
      <div className={cx('@container/card flex min-w-0 flex-col', framed ? cx(WELL, 'p-1') : 'ml-4 border-l border-border-subtle pl-1')}>
        {rows.map((row) => (
          <FeatureRow
            key={row.featureId}
            title={row.feature?.title ?? row.title}
            glyph={<NewsGlyph events={row.events} />}
            detail={<span className="line-clamp-2">{row.events.map((e) => e.words).join(' · ')}</span>}
            {...(row.feature && showState(row) ? { state: <LiveState feature={row.feature} /> } : {})}
            {...(row.feature ? { onOpen: () => onOpen(row.featureId) } : {})}
          />
        ))}
      </div>
      {open && <AgentText text={agentText} />}
    </div>
  )
}

/**
 * Runcastle's other lines to an agent — a kickoff, a wake, a resumed chat's
 * briefing (decision 8): one quiet line in plain words, the text the agent got
 * behind "What the agent read".
 */
export function RuncastleNote({ summary, agentText }: { summary: string; agentText: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary">
        <RuncastleMark />
        <span className="min-w-0 truncate">
          <span className="font-medium text-text-secondary">Runcastle</span> · {summary}
        </span>
        <span className="flex-1" />
        <AgentReadToggle open={open} onToggle={() => setOpen((o) => !o)} />
      </p>
      {open && <AgentText text={agentText} />}
    </div>
  )
}

// ---- the orchestrator in a feature's chat ----

/**
 * A message the project's orchestrator sent a feature's agent, in that feature's
 * chat (decision 8). Its own words sit on the left under its name, not in your
 * bubble on the right. A relayed answer is yours: it keeps your side, with a
 * line saying the orchestrator passed it on.
 */
export function OrchestratorMessage({ text, relayed = false }: { text: string; relayed?: boolean }) {
  if (relayed) {
    return (
      <div className="flex flex-col items-end gap-1.5 animate-rise-in">
        <div className={cx(WELL, 'max-w-[85%] px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-text')}>{text}</div>
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <IconOrchestrator size={12} className="text-icon" />
          Your answer, relayed by the orchestrator
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1.5 animate-rise-in">
      <span className="flex items-center gap-2 text-sm">
        <RuncastleMark />
        <span className="font-medium text-text-secondary">Orchestrator</span>
      </span>
      <div className={cx(WELL, 'max-w-[85%] px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-text')}>{text}</div>
    </div>
  )
}
