import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { IconMessage, IconSearch } from '../../icons'
import { EmptyState, Page, PageHeader, TextField, cx } from '../../ui'
import type { ThreadEntry } from '../../lib/chat-thread'
import { threadStateWords } from '../chat/thread/ThreadState'
import { SidebarBackdrop, ThreadGlyph } from '../SidebarParts'

const DAY = 86_400_000

/** The groups a conversation can fall in, in the order they list. */
type Group = 'Active' | 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Earlier'
const ORDER: Group[] = ['Active', 'Today', 'Yesterday', 'This week', 'This month', 'Earlier']

/**
 * Where a conversation lists: working or waiting on you, it is Active whatever
 * its age; otherwise by the calendar day of its last activity.
 */
export function conversationGroup(t: Pick<ThreadEntry, 'state' | 'updatedAt'>, now: number): Group {
  if (t.state !== 'idle') return 'Active'
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const today = midnight.getTime()
  if (t.updatedAt >= today) return 'Today'
  if (t.updatedAt >= today - DAY) return 'Yesterday'
  if (t.updatedAt >= today - 6 * DAY) return 'This week'
  if (t.updatedAt >= today - 29 * DAY) return 'This month'
  return 'Earlier'
}

/** Waiting on you lists before working, within Active. */
function waitingFirst(t: ThreadEntry): number {
  return t.state === 'waiting' ? 0 : t.state === 'working' ? 1 : 2
}

/** The filter's match in a title, marked. */
function marked(title: string, query: string): ReactNode {
  const at = query ? title.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return title
  return (
    <>
      {title.slice(0, at)}
      <mark className="rounded-[2px] bg-accent-subtle text-accent-text">{title.slice(at, at + query.length)}</mark>
      {title.slice(at + query.length)}
    </>
  )
}

/** One conversation on one line, in the sidebar thread row's three columns. */
function ConversationRow({
  thread,
  now,
  query,
  onOpen,
}: {
  thread: ThreadEntry
  now: number
  query: string
  onOpen: (threadId: string) => void
}) {
  const { state } = thread
  return (
    <button
      type="button"
      title={thread.title}
      onClick={() => onOpen(thread.id)}
      className="group/row flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover"
    >
      <ThreadGlyph state={state} />
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-md transition-colors duration-(--dur-1)',
          state === 'idle' ? 'text-text-secondary group-hover/row:text-text' : 'text-text',
        )}
      >
        {marked(thread.title, query)}
      </span>
      <span
        className={cx(
          'shrink-0 text-xs tabular-nums',
          state === 'working' ? 'text-shimmer' : state === 'waiting' ? 'text-warning-text' : 'text-text-tertiary',
        )}
      >
        {threadStateWords(state, thread.updatedAt, now)}
      </span>
    </button>
  )
}

/**
 * Every chat this project has had: the page the sidebar's "All N conversations"
 * opens, the one place past the five it lists. A ledger: on a wide panel the
 * dates hang in a rail left of the column and stay in view as their rows scroll
 * by, so the titles keep the page's edge; on a narrow one they sit over their
 * rows. What is live sits on top in the Working bay's own material, its edge
 * lit while an agent works. A row opens its chat, and a message picks a finished
 * one back up. The same threads, names and states as the sidebar, both from
 * `thread.list`.
 */
export function ConversationsPage({
  threads,
  onOpen,
  now: nowProp,
}: {
  threads: readonly ThreadEntry[]
  onOpen: (threadId: string) => void
  now?: number
}) {
  const [query, setQuery] = useState('')
  const now = nowProp ?? Date.now()
  const q = query.trim()

  const groups = useMemo(() => {
    const sorted = [...threads]
      .filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => waitingFirst(a) - waitingFirst(b) || b.updatedAt - a.updatedAt)
    const by = new Map<Group, ThreadEntry[]>()
    for (const t of sorted) {
      const g = conversationGroup(t, now)
      by.set(g, [...(by.get(g) ?? []), t])
    }
    return ORDER.flatMap((g) => (by.has(g) ? [{ group: g, rows: by.get(g)! }] : []))
  }, [threads, q, now])

  const waiting = threads.filter((t) => t.state === 'waiting').length
  const working = threads.filter((t) => t.state === 'working').length

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <Page routeKey="conversations" className="relative isolate">
        <SidebarBackdrop />
        <PageHeader
          title="Conversations"
          meta={[
            { text: `${threads.length} ${threads.length === 1 ? 'conversation' : 'conversations'}` },
            waiting > 0 ? { tone: 'warning', text: `${waiting} waiting for you` } : null,
            working > 0 ? { tone: 'live', text: `${working} working` } : null,
          ]}
          actions={
            <TextField
              icon={<IconSearch />}
              placeholder="Filter"
              aria-label="Filter conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              className="w-50"
            />
          }
        />
        {threads.length === 0 ? (
          <EmptyState icon={<IconMessage />} title="No conversations yet" hint="A new chat starts from the Orchestrator." className="mt-12" />
        ) : groups.length === 0 ? (
          <EmptyState compact icon={<IconSearch />} title="No conversation matches" hint={`Nothing titled “${q}”.`} className="mt-8" />
        ) : (
          <div className="mt-8 flex flex-col gap-7">
            {groups.map(({ group, rows }, i) => {
              const active = group === 'Active'
              return (
                <section
                  key={group}
                  aria-label={group}
                  style={{ '--i': i } as CSSProperties}
                  className={cx(
                    'grid animate-rise-in grid-cols-1 gap-1 [animation-delay:calc(var(--i)*40ms)] @min-[1000px]:-ml-30 @min-[1000px]:grid-cols-[120px_minmax(0,1fr)] @min-[1000px]:gap-0',
                    !active && 'border-t border-border-subtle pt-2',
                  )}
                >
                  <h2
                    className={cx(
                      'm-0 self-start px-2.5 text-xs font-medium text-text-tertiary @min-[1000px]:sticky @min-[1000px]:top-4 @min-[1000px]:px-0 @min-[1000px]:leading-10',
                      active && 'text-text-secondary',
                    )}
                  >
                    {group}
                  </h2>
                  <div
                    className={cx(
                      'flex min-w-0 flex-col',
                      active && 'card relative rounded-lg p-1',
                      active && working > 0 && 'orbit-light',
                    )}
                  >
                    {rows.map((t, r) => (
                      <Fragment key={t.id}>
                        {r > 0 && <span aria-hidden className="mr-2.5 ml-[34px] h-px bg-border-subtle" />}
                        <ConversationRow thread={t} now={now} query={q} onOpen={onOpen} />
                      </Fragment>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </Page>
    </div>
  )
}
