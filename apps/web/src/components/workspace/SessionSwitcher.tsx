import type { FeatureSessionEntry } from '../../lib/api'
import { sideWaiting, sideWaitingElsewhere, switcherGroups } from '../../lib/feature-ui/session'
import { relTimeAgo } from '../../lib/format'
import { IconCheck, IconChevronDown, IconPlus } from '../../icons'
import { Button, StatusDot } from '../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu'

/**
 * The feature chat header's session switcher (several-sessions-per-feature
 * decisions 8, 10, 12): which conversation the Chat tab shows — the main chat,
 * a side session, or the scenario chat docked beside a drive — and the door to
 * a new side session.
 *
 * Self-contained on purpose: it takes the list and says what was picked, and
 * owns no query and no layout. *Design mode* puts its own switcher in this same
 * header, and whichever merges second reconciles the two here.
 *
 * The button names the session in view; an amber dot beside the name says a
 * side session the human is not looking at waits on them.
 */
export function SessionSwitcher({
  sessions,
  selectedId,
  name,
  onSelect,
  onNewSide,
  opening,
}: {
  /** `feature.sessions`, in its order. */
  sessions: readonly FeatureSessionEntry[]
  /** The session in view; null is the main chat. */
  selectedId: string | null
  /** The session in view, named. */
  name: string
  /** Show a session; null picks the main chat. */
  onSelect: (id: string | null) => void
  onNewSide: () => void
  /** A side session is being opened — the door waits for it. */
  opening: boolean
}) {
  const { main, live, ended } = switcherGroups(sessions)
  const waiting = sideWaitingElsewhere(sessions, selectedId)

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={TRIGGER} aria-label={`${name} — switch session`}>
          <span className="max-w-64 min-w-0 truncate" title={name}>
            {name}
          </span>
          {waiting && <StatusDot tone="warning" label="A side session is waiting" />}
          <IconChevronDown
            size={14}
            className="shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-aria-expanded:rotate-180"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80">
          <DropdownMenuLabel>Main</DropdownMenuLabel>
          <SessionItem
            name="Main chat"
            session={main}
            current={selectedId === null}
            onSelect={() => onSelect(null)}
          />
          {live.length > 0 && <DropdownMenuLabel>Side sessions</DropdownMenuLabel>}
          {live.map((s) => (
            <SessionItem
              key={s.id}
              name={s.title}
              session={s}
              current={s.id === selectedId}
              onSelect={() => onSelect(s.id)}
            />
          ))}
          {ended.length > 0 && <DropdownMenuLabel>Ended</DropdownMenuLabel>}
          {ended.map((s) => (
            <SessionItem
              key={s.id}
              name={s.title}
              session={s}
              current={s.id === selectedId}
              onSelect={() => onSelect(s.id)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" icon={<IconPlus />} loading={opening} onClick={onNewSide}>
        New side session
      </Button>
    </span>
  )
}

/*
 * The trigger states a background AND a border: there is no preflight
 * (STYLE.md), so a `<button>` that names neither keeps the user agent's slab.
 */
const TRIGGER =
  'group flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 ' +
  'text-sm font-medium text-text transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover aria-expanded:bg-surface-selected'

/**
 * One row: its dot (amber waiting, live, quiet ended), its name, and one quiet
 * word for its state — or, ended, when it ended.
 */
function SessionItem({
  name,
  session,
  current,
  onSelect,
}: {
  name: string
  /** Absent for a main chat nobody has started. */
  session?: FeatureSessionEntry
  current: boolean
  onSelect: () => void
}) {
  const state = itemState(session)
  return (
    <DropdownMenuItem aria-current={current ? 'true' : undefined} onSelect={onSelect}>
      <StatusDot tone={state.tone} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs text-text-tertiary">{state.word}</span>
      {current && <IconCheck size={14} className="text-text" />}
    </DropdownMenuItem>
  )
}

function itemState(session?: FeatureSessionEntry): {
  tone: 'warning' | 'live' | 'accent' | 'neutral'
  word: string
} {
  if (!session) return { tone: 'neutral', word: 'not started' }
  if (sideWaiting(session)) return { tone: 'warning', word: 'waiting' }
  if (session.status === 'live') return { tone: 'live', word: 'live' }
  if (session.status === 'launching') return { tone: 'accent', word: 'starting' }
  return { tone: 'neutral', word: session.endedAt ? relTimeAgo(session.endedAt) : 'ended' }
}
