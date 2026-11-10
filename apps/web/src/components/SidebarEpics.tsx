import { Fragment, isValidElement, type ReactNode } from 'react'
import { cx, StatusDot } from '../ui'
import type { FeatureListItem } from '../lib/api'
import type { ThreadEntry } from '../lib/chat-thread'
import { IconArrowRight, IconList, IconOrchestrator } from '../icons'
import { epicOwnerJoin, nestedFeatureWords, orderEpicList, type Epic } from '../lib/feature-ui/epics'
import type { OwnerReading } from '../lib/feature-owner'
import { featureEpic } from '../lib/sidebar-threads'
import type { Crumb } from '../ui/page'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { featureStateWords, openRowMenu, SIDEBAR_CARD, SidebarFeatureRow, ThreadListMore } from './SidebarParts'

/**
 * The sidebar's list of epics (docs/features/orchestrator-chats-become-epics,
 * decisions 4–11): each orchestrator chat is an epic, a card whose head is the
 * chat's door, and the features it cut that are in motion or up next sit
 * inside the card on hairlines. Epics with something yellow come first; features with no epic
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
      <span className="block max-w-44 min-w-0 truncate" title={`Epic: ${epic.title}`}>
        {epic.title}
      </span>
    ),
    icon: <EpicGlyph small />,
    onClick: () => onOpen(epic.id),
    // It gives way with the owner and the title, down to a few letters.
    shrink: true,
    ...(epic.title.length > 6 ? { floor: 'min-w-24' } : {}),
  }
}

/**
 * A feature header's opening crumbs (decision 15, as the orchestrator changed
 * it): the epic, then the owner control, made one crumb when the epic's chat
 * owns the feature. There the name opens the chat and the finish words open
 * the owner menu: "◆ Payment System · you merge ▾". With no epic (or no way to
 * open one), the owner control stands alone. `control` draws the owner control,
 * `inEpic` when it follows its epic's name.
 */
export function epicOwnerCrumbs(
  feature: { chatId?: string | null | undefined },
  threads: readonly ThreadEntry[],
  onOpen: ((chatId: string) => void) | undefined,
  owner: Pick<OwnerReading, 'owner' | 'holderId' | 'chatId'> & { planning?: boolean },
  control: (inEpic: boolean) => ReactNode,
): Crumb[] {
  const epic = onOpen ? featureEpic(feature, threads) : null
  const join = epicOwnerJoin(epic?.id ?? null, owner)
  // A chat's control gives way down to "Runc… · merges it"; "Yours" is narrow and never does
  // (every-feature-has-one-owner's header floors).
  const alone: Crumb = {
    label: control(false),
    ...(owner.owner.kind === 'chat' ? { shrink: true, floor: 'min-w-44' } : {}),
  }
  if (!epic || !onOpen || join === 'owner') return [alone]
  if (join === 'two') return [epicCrumb(feature, threads, onOpen)!, alone]
  return [
    {
      // The epic's name gives way down to a few letters; the finish words after it never do.
      shrink: true,
      ...(epic.title.length > 6 ? { floor: owner.planning ? 'min-w-56' : 'min-w-44' } : {}),
      icon: <EpicGlyph small />,
      label: (
        <span className="inline-flex min-w-0 items-center">
          <button
            type="button"
            onClick={() => onOpen(epic.id)}
            title={`Epic: ${epic.title}`}
            className="block max-w-44 min-w-0 cursor-pointer truncate rounded-md hover:text-text"
          >
            {epic.title}
          </button>
          <span aria-hidden="true" className="pl-1 text-text-tertiary">
            ·
          </span>
          <span className="inline-flex shrink-0">{control(true)}</span>
        </span>
      ),
    },
  ]
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

/** The accent wash an epic's head sits on, the Orchestrator card's own: brighter at the tile, fading right. */
const EPIC_WASH =
  'bg-[linear-gradient(100deg,color-mix(in_oklab,var(--color-accent)_14%,var(--color-canvas)),color-mix(in_oklab,var(--color-accent)_4%,var(--color-canvas))_75%)]'

/** The same wash, brighter, while the epic's chat is the one in front. */
const EPIC_WASH_OPEN =
  'bg-[linear-gradient(100deg,color-mix(in_oklab,var(--color-accent)_26%,var(--color-canvas)),color-mix(in_oklab,var(--color-accent)_9%,var(--color-canvas))_75%)]'

/** The fine grid behind an epic's head, fading out leftward under its name. */
const EPIC_GRID =
  'pointer-events-none absolute inset-y-0 right-0 -z-10 w-1/2 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--color-accent)_13%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-accent)_13%,transparent)_1px,transparent_1px)] [background-size:10px_10px] [mask-image:linear-gradient(to_left,black,transparent)]'

/** An epic's tile in its card's head: the hub, a size up from the list glyph, lit like the Orchestrator's. */
function EpicTile({ quiet = false, open = false }: { quiet?: boolean; open?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
        quiet
          ? 'bg-fill-well text-icon ring-border-subtle'
          : cx(
              'text-accent-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_12%,transparent)] transition-colors duration-(--dur-2) ease-app',
              open
                ? 'bg-[color-mix(in_oklab,var(--color-accent)_28%,transparent)] ring-[color-mix(in_oklab,var(--color-accent)_60%,transparent)]'
                : 'bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)]',
            ),
      )}
    >
      {quiet ? <IconList size={15} /> : <IconOrchestrator size={17} />}
    </span>
  )
}

/** An epic's second line at rest: how many features it holds in motion or up next. */
function restWords(n: number): string {
  return n === 0 ? 'Nothing in motion' : n === 1 ? '1 feature' : `${n} features`
}

/** The card's body: its features, a hairline between each, as the old Working bay held its rows. */
function CardRows({ label, children }: { label: string; children: ReactNode[] }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col p-1">
      {children.map((c, i) => (
        <Fragment key={isValidElement(c) && c.key !== null ? c.key : i}>
          {i > 0 && <span aria-hidden className="mx-2.5 h-px bg-border-subtle" />}
          {c}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * One epic as a card (decisions 4–11): its head is the chat's door, on the
 * Orchestrator card's accent wash and grid, with the hub tile, the name, and
 * under it what the chat is doing or how many features it holds; its features
 * sit below on hairlines. The edge is one quiet hairline in every state: its
 * chat in front, the head's wash and its tile brighten; working, the
 * hub's nodes breathe and a slow sheen crosses the head; asking, the amber dot
 * sits at the name's end.
 */
export function SidebarEpicCard({
  chat,
  asksAbout = null,
  count,
  active,
  onOpen,
  actions = [],
  children,
}: {
  chat: ThreadEntry
  asksAbout?: string | null
  /** Its features in the card, for the resting line. */
  count: number
  active: boolean
  onOpen: (chatId: string) => void
  actions?: FeatureAction[]
  /** Its feature rows. */
  children?: ReactNode[]
}) {
  const doing = epicWords(chat, asksAbout)
  const words = doing ?? restWords(count)
  const asking = chat.state === 'waiting'
  const working = chat.state === 'working'
  const rows = children ?? []
  return (
    <div
      className={cx(
        // One hairline in every state: the head says which epic is open and which works.
        'card relative isolate shrink-0 overflow-hidden rounded-lg',
      )}
    >
      <div
        data-epic={chat.id}
        className={cx(
          'group/nav relative isolate overflow-hidden transition-[background] duration-(--dur-2) ease-app',
          working ? 'hub-working' : 'orchestrator-beat',
          active ? EPIC_WASH_OPEN : EPIC_WASH,
        )}
        onContextMenu={actions.length > 0 ? openRowMenu : undefined}
      >
        <span aria-hidden className={EPIC_GRID} />
        <span
          aria-hidden
          data-sheen
          className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/2 [transform:translateX(-110%)] bg-[linear-gradient(100deg,transparent,color-mix(in_oklab,var(--color-accent)_16%,transparent),transparent)]"
        />
        <button
          type="button"
          title={doing ? `${chat.title} — ${doing}` : chat.title}
          aria-current={active ? 'page' : undefined}
          onClick={() => onOpen(chat.id)}
          className="flex w-full cursor-pointer items-center gap-2.5 py-2 pr-2.5 pl-2 text-left"
        >
          <EpicTile open={active} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-md font-semibold tracking-tight text-text">{chat.title}</span>
              {asking && (
                <span className={cx('transition-opacity duration-(--dur-1)', actions.length > 0 && CONCEAL)}>
                  <StatusDot tone="warning" />
                </span>
              )}
            </span>
            <span
              className={cx(
                'truncate text-xs',
                asking
                  ? 'text-text-secondary'
                  : working
                    ? 'text-shimmer text-text-tertiary'
                    : 'text-[color-mix(in_oklab,var(--color-accent-text)_70%,var(--color-text-tertiary))]',
              )}
            >
              {words}
            </span>
          </span>
        </button>
        {actions.length > 0 && (
          <span
            data-row-actions=""
            className={cx('absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center transition-opacity duration-(--dur-1)', REVEAL)}
          >
            <FeatureActionsMenu actions={actions} label="Epic actions" />
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="border-t border-border-subtle">
          <CardRows label={chat.title}>{rows}</CardRows>
        </div>
      )}
    </div>
  )
}

/** The features with no epic (decision 7), as a quiet card: a neutral head that is a label, not a door. */
function OtherFeaturesCard({ label, children }: { label: string; children: ReactNode[] }) {
  return (
    <div className="card relative shrink-0 overflow-hidden rounded-lg">
      <div className="flex items-center gap-2.5 py-2 pr-2.5 pl-2">
        <EpicTile quiet />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-md font-semibold tracking-tight text-text-secondary">{label}</span>
          <span className="truncate text-xs text-text-tertiary">Not from an epic · {restWords(children.length).toLowerCase()}</span>
        </span>
      </div>
      <div className="border-t border-border-subtle">
        <CardRows label={label}>{children}</CardRows>
      </div>
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
 * The list of epics, a card each, ending in "All N epics". No label of its
 * own: the cards say what they are, and New epic lives in the create menu. No fold and no lanes: the nesting says what belongs to what,
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
    <section aria-label={many} className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {groups.map((g, i) => (
          <li key={g.kind === 'epic' ? g.epic.chat.id : 'other'} className="flex animate-rise-in flex-col" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
            {g.kind === 'epic' ? (
              <SidebarEpicCard
                chat={g.epic.chat}
                asksAbout={g.epic.asksAbout}
                count={g.epic.features.length}
                active={g.epic.chat.id === currentChat}
                onOpen={onOpenEpic}
                actions={epicActions?.(g.epic.chat) ?? []}
              >
                {g.epic.features.map((x) => row(x.feature, nestedFeatureWords(featureStateWords(x.feature), x.holder, g.epic.chat.title)))}
              </SidebarEpicCard>
            ) : (
              <OtherFeaturesCard label="Other features">{g.features.map((f) => row(f, featureStateWords(f)))}</OtherFeaturesCard>
            )}
          </li>
        ))}
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
