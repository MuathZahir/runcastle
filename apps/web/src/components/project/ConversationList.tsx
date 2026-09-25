import { useMemo, useState } from 'react'
import { IconArrowRight, IconChevronDown, IconMessage, IconRefresh, IconSearch } from '../../icons'
import { Button, EmptyState, IconButton, List, ListRow, PageSection, StatusDot, TextField } from '../../ui'
import type { ProjectConversation } from '../../lib/api'
import { conversationTitle } from '../../lib/conversation-title'
import { relTime } from '../../lib/format'

/** Rows shown before "Show all" — a page, not the whole history. */
const PAGE = 10
/** Past this many conversations the list earns a filter field. */
const FILTER_AT = 8

/**
 * Every conversation this project has had, newest first, the live one on top
 * (decisions.md #6).
 *
 * A row is a title, when it was, and whether it is still open — nothing else.
 * The row itself opens the transcript, which is the thing a returning human
 * actually wants from a list of past chats; reopening one is the deliberate act,
 * so it is an icon button that appears on hover or focus rather than a second
 * permanent control competing with the title beside it.
 *
 * Titles are the first thing typed, so they are cleaned for display
 * (`conversationTitle`): pasted markup and terminal escapes are not a name.
 */
export function ConversationList({
  conversations,
  pending,
  busy,
  onResume,
  onOpen,
  onView,
}: {
  conversations: ProjectConversation[]
  /** Still fetching for the first time — distinct from "there are none". */
  pending: boolean
  busy: boolean
  onResume: (sessionId: string) => void
  onOpen?: (sessionId: string) => void
  onView: (conversation: ProjectConversation) => void
}) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)

  const sorted = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => Number(b.status !== 'ended') - Number(a.status !== 'ended'))
        .map((c) => ({ c, title: conversationTitle(c.title) })),
    [conversations],
  )

  if (pending) return null

  const q = query.trim().toLowerCase()
  const matching = q ? sorted.filter((r) => r.title.toLowerCase().includes(q)) : sorted
  const shown = all || q ? matching : matching.slice(0, PAGE)
  const hidden = matching.length - shown.length

  return (
    <PageSection
      title="Chats"
      action={
        conversations.length > FILTER_AT ? (
          <TextField
            icon={<IconSearch />}
            placeholder="Filter"
            aria-label="Filter chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            className="w-50"
          />
        ) : undefined
      }
    >
      {conversations.length === 0 ? (
        <EmptyState
          compact
          icon={<IconMessage />}
          title="No chats yet"
          hint="A new chat starts from the row above."
        />
      ) : shown.length === 0 ? (
        <EmptyState compact icon={<IconSearch />} title="No chat matches" hint={`Nothing titled “${query.trim()}”.`} />
      ) : (
        <List label="Chats">
          {shown.map(({ c, title }, i) => {
            const live = c.status !== 'ended'
            return (
              <ListRow
                key={c.id}
                index={i}
                leading={live ? <StatusDot tone="live" label={c.status} /> : <IconMessage />}
                title={title}
                meta={c.createdAt === null ? undefined : relTime(c.createdAt)}
                onClick={() => onView(c)}
                actionsOverlay
                actions={
                  // A conversation Claude Code never picked up has nothing to
                  // resume — reopening it would silently be a new chat, so it
                  // does not offer.
                  <IconButton
                    size="sm"
                    label={
                      c.resumable ? (live ? 'Open' : 'Reopen') : 'Reopen — this one never got started'
                    }
                    aria-label={live ? 'Open' : 'Reopen'}
                    icon={live ? <IconArrowRight /> : <IconRefresh />}
                    disabled={busy || !c.resumable}
                    onClick={() => (live ? onOpen?.(c.id) : onResume(c.id))}
                  />
                }
              />
            )
          })}
        </List>
      )}
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronDown />}
          className="mt-2"
          onClick={() => setAll(true)}
        >
          Show {hidden} more
        </Button>
      )}
    </PageSection>
  )
}
