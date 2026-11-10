import type { ReactNode } from 'react'
import { cx, IconButton, SectionLabel, StatusDot } from '../ui'
import type { FeatureListItem } from '../lib/api'
import type { ThreadEntry } from '../lib/chat-thread'
import { IconArrowRight, IconList, IconOrchestrator, IconPlus } from '../icons'
import { nestedFeatureWords, orderEpicList, type Epic } from '../lib/feature-ui/epics'
import { featureEpic } from '../lib/sidebar-threads'
import type { Crumb } from '../ui/page'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { featureStateWords, openRowMenu, SIDEBAR_CARD, SidebarFeatureRow, ThreadListMore } from './SidebarParts'

/**
 * The sidebar's list of epics (docs/features/orchestrator-chats-become-epics,
 * decisions 4–11): each orchestrator chat is an epic, its row the chat's door,
 * and the features it cut that are in motion or up next sit indented under it
 * on a hairline. Epics with something yellow come first; features with no epic
 * close the list as "Other features". Markup over resolved values: the caller
 * fetches, groups by origin chat, and says who runs each feature.
 */

/** A row's hover controls show on hover or keyboard focus; the marks under them hide on the same. */
const REVEAL = 'opacity-0 group-hover/nav:opacity-100 group-has-[:focus-visible]/nav:opacity-100'
const CONCEAL = 'group-hover/nav:opacity-0 group-has-[:focus-visible]/nav:opacity-0'

/**
 * An epic's mark: the hub in a small accent tile, the same on every epic so
 * the column of tiles down the list reads as the epics. `quiet` is the
 * neutral tile of "Other features", which is not a chat.
 */
export function EpicGlyph({ quiet = false, small = false }: { quiet?: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center',
        // `small`: the 16px tile a header crumb wears, beside 14px glyphs.
        small ? 'size-4 rounded-sm' : 'size-5 rounded-md',
        quiet
          ? 'bg-fill-well text-icon'
          : 'bg-[color-mix(in_oklab,var(--color-accent)_16%,transparent)] text-accent-text ring-1 ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)] ring-inset',
      )}
    >
      {quiet ? <IconList size={small ? 10 : 12} /> : <IconOrchestrator size={small ? 11 : 13} />}
    </span>
  )
}

/**
 * A feature page's first crumb (decision 15): its epic, the chat it came from
 * (`chatId`), as the epic's glyph and name; clicking opens that chat. It stays
 * after the feature ships. Null when the feature has no epic the list holds.
 */
export function epicCrumb(
  feature: { chatId?: string | null | undefined },
  threads: readonly ThreadEntry[],
  onOpen: (chatId: string) => void,
): Crumb | null {
  const epic = featureEpic(feature, threads)
  if (!epic) return null
  return {
    label: (
      <span className="block max-w-44 truncate" title={`Epic: ${epic.title}`}>
        {epic.title}
      </span>
    ),
    icon: <EpicGlyph small />,
    onClick: () => onOpen(epic.id),
  }
}

/** What an epic's row says under its name (decision 11): what its chat asks, that it works, or nothing. */
function epicWords(chat: ThreadEntry, asksAbout: string | null): string | null {
  if (chat.state === 'waiting') return asksAbout ? `Asking about ${asksAbout}` : 'Asking you'
  if (chat.state === 'working') return 'Working'
  return null
}

/**
 * One epic's row: its tile and name, and under them what its chat is doing.
 * Asking, the amber dot sits at the name's end, the one dot for that question
 * (decision 2); working, the word shimmers; at rest it is one line. Clicking
 * opens the chat; "…" on hover or right-click.
 */
export function SidebarEpicRow({
  chat,
  asksAbout = null,
  active,
  onOpen,
  actions = [],
}: {
  chat: ThreadEntry
  asksAbout?: string | null
  active: boolean
  onOpen: (chatId: string) => void
  actions?: FeatureAction[]
}) {
  const words = epicWords(chat, asksAbout)
  const asking = chat.state === 'waiting'
  return (
    <div
      data-epic={chat.id}
      className={cx(
        'group/nav relative shrink-0 rounded-lg transition-colors duration-(--dur-1) ease-app',
        active ? SIDEBAR_CARD : 'hover:bg-surface-hover',
      )}
      onContextMenu={actions.length > 0 ? openRowMenu : undefined}
    >
      <button
        type="button"
        title={words ? `${chat.title} — ${words}` : chat.title}
        aria-current={active ? 'page' : undefined}
        onClick={() => onOpen(chat.id)}
        className="flex w-full cursor-pointer items-start gap-2 rounded-[inherit] py-1.5 pr-2.5 pl-2.5 text-left"
      >
        <EpicGlyph />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex h-5 min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-md font-medium text-text">{chat.title}</span>
            {asking && (
              <span className={cx('transition-opacity duration-(--dur-1)', actions.length > 0 && CONCEAL)}>
                <StatusDot tone="warning" />
              </span>
            )}
          </span>
          {words && (
            <span
              className={cx(
                'truncate text-xs',
                asking ? 'text-text-secondary' : 'text-shimmer text-text-tertiary',
              )}
            >
              {words}
            </span>
          )}
        </span>
      </button>
      {actions.length > 0 && (
        <span data-row-actions="" className={cx('absolute top-1 right-1 flex items-center transition-opacity duration-(--dur-1)', REVEAL)}>
          <FeatureActionsMenu actions={actions} label="Epic actions" />
        </span>
      )}
    </div>
  )
}

/** The head of the features with no epic (decision 7): a label in the epics' columns, not a door. */
function OtherFeaturesHead({ label }: { label: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2.5">
      <EpicGlyph quiet />
      <span className="min-w-0 flex-1 truncate text-md text-text-secondary">{label}</span>
    </div>
  )
}

/** The features under an epic, indented on a hairline that drops from the epic's tile. */
function Nested({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="ml-5 flex flex-col gap-0.5 border-l border-border-subtle pl-1.5">
      {children}
    </div>
  )
}

export interface SidebarEpicsProps {
  /** The epics listed (decision 16 says which); their features, by origin chat, with who runs each. */
  epics: readonly Epic[]
  /** Features with no epic (decision 7). */
  other?: readonly FeatureListItem[]
  /** Every epic the project has, listed or not: "All N epics". */
  total: number
  /** The chat in front, or null. */
  currentChat: string | null
  /** The feature in front, or null. */
  currentFeature: string | null
  onOpenEpic: (chatId: string) => void
  onSelectFeature: (featureId: string) => void
  onNewEpic: () => void
  /** Where every epic lives (today's Conversations page). */
  onAllEpics: () => void
  epicActions?: (chat: ThreadEntry) => FeatureAction[]
  featureActions?: (f: FeatureListItem) => FeatureAction[]
  /** A feature's way down to its workers, when it has some. */
  workersFor?: (f: FeatureListItem) => { live: number; onOpen: () => void } | undefined
  /** The owner choices a feature row's menu carries (every-feature-has-one-owner decision 11); none for a feature with no chat. */
  ownerChoicesFor?: (f: FeatureListItem) => ReactNode
  /** What the list calls a chat: "epic" (decision 14), or "chat". */
  noun?: 'epic' | 'chat'
}

/**
 * The list of epics, under its "Epics" label and its "+" (New epic), ending in
 * "All N epics". No fold and no lanes: the nesting says what belongs to what,
 * and the yellow-first order keeps the next step on top (decision 8).
 */
export function SidebarEpics({
  epics,
  other = [],
  total,
  currentChat,
  currentFeature,
  onOpenEpic,
  onSelectFeature,
  onNewEpic,
  onAllEpics,
  epicActions,
  featureActions,
  workersFor,
  ownerChoicesFor,
  noun = 'epic',
}: SidebarEpicsProps) {
  const groups = orderEpicList(epics, other)
  const many = noun === 'epic' ? 'Epics' : 'Chats'
  const row = (f: FeatureListItem, words: string) => {
    const workers = workersFor?.(f)
    const ownerChoices = ownerChoicesFor?.(f)
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={f.id === currentFeature}
        onSelect={onSelectFeature}
        actions={featureActions?.(f) ?? []}
        nested
        words={words}
        {...(ownerChoices ? { ownerChoices } : {})}
        {...(workers ? { workers } : {})}
      />
    )
  }
  return (
    <section aria-label={many} className="flex flex-col gap-1">
      <SectionLabel
        className="pr-1 pl-2.5"
        action={<IconButton size="sm" label={`New ${noun}`} icon={<IconPlus />} onClick={onNewEpic} />}
      >
        {many}
      </SectionLabel>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {groups.map((g) =>
          g.kind === 'epic' ? (
            <li key={g.epic.chat.id} className="flex flex-col gap-0.5">
              <SidebarEpicRow
                chat={g.epic.chat}
                asksAbout={g.epic.asksAbout}
                active={g.epic.chat.id === currentChat}
                onOpen={onOpenEpic}
                actions={epicActions?.(g.epic.chat) ?? []}
              />
              {g.epic.features.length > 0 && (
                <Nested label={g.epic.chat.title}>
                  {g.epic.features.map((x) => row(x.feature, nestedFeatureWords(featureStateWords(x.feature), x.holder, g.epic.chat.title)))}
                </Nested>
              )}
            </li>
          ) : (
            <li key="other" className="flex flex-col gap-0.5">
              <OtherFeaturesHead label="Other features" />
              <Nested label="Other features">{g.features.map((f) => row(f, featureStateWords(f)))}</Nested>
            </li>
          ),
        )}
      </ul>
      {total > 0 && (
        <ThreadListMore
          label={`All ${total} ${many.toLowerCase()}`}
          icon={<IconArrowRight size={12} />}
          onClick={onAllEpics}
        />
      )}
    </section>
  )
}
