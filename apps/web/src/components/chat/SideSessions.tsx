import { useCallback, useMemo, useRef, useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import type { SideSessionRow } from '../../lib/chat-sessions'
import { useToast } from '../../lib/toast'
import { trpc } from '../../trpc'
import { IconPlus } from '../../icons'
import { DropdownMenuItem } from '../../ui/dropdown-menu'
import { EndSessionItem } from '../EndSessionButton'
import { ChatView } from './ChatView'

/**
 * The feature's side sessions in the chat column (several-sessions-per-feature
 * decisions 8, 10, 12): extra conversations beside the feature chat, listed in
 * the page header's one switcher. A live one shows its terminal, an ended one
 * its transcript over Reopen. Opening, reopening and ending are the only
 * launches here, each an explicit click.
 */
export interface SideSessionsApi {
  /**
   * The side sessions the switcher lists, in `feature.sessions`' order. One this
   * browser just opened stands in, Untitled, until the list has it — the list
   * only carries a conversation once the CLI has picked it up.
   */
  rows: SideSessionRow[]
  /** New side session. */
  open: () => void
  /** Reopen an ended side session: it resumes its own conversation. */
  reopen: (id: string) => void
  /** An open or reopen is in flight. */
  opening: boolean
  /** Re-read the list (a terminal said its session ended). */
  refresh: () => void
}

/** The feature's side sessions; `onFront` brings one just opened to the front of the column. */
export function useSideSessions(
  featureId: string | undefined,
  sessions: FeatureFull['sessions'],
  onFront: (sessionId: string) => void,
): SideSessionsApi {
  const toast = useToast()
  const utils = trpc.useUtils()
  // Invalidated by the session events over the live stream (lib/live.ts).
  const listed = trpc.feature.sessions.useQuery({ featureId: featureId ?? '' }, { enabled: !!featureId }).data
  const [pending, setPending] = useState<string | null>(null)
  const front = useRef(onFront)
  front.current = onFront

  const refresh = useCallback(() => {
    if (featureId) void utils.feature.sessions.invalidate({ featureId })
  }, [utils, featureId])
  const mutation = trpc.feature.openSideSession.useMutation({
    onSuccess: ({ sessionId }) => {
      setPending(sessionId)
      front.current(sessionId)
      refresh()
      if (featureId) void utils.feature.get.invalidate({ id: featureId })
    },
    onError: (e) => toast.push(e.message),
  })
  const mutate = mutation.mutate

  const rows = useMemo((): SideSessionRow[] => {
    const sides = (listed ?? []).filter((s) => s.kind === 'side')
    if (!pending || sides.some((s) => s.id === pending)) return sides
    const row = sessions.find((s) => s.id === pending)
    if (row?.status === 'ended') return sides
    const standIn: SideSessionRow = {
      id: pending,
      title: 'Untitled',
      status: row?.status ?? 'launching',
      awaitingInput: false,
      createdAt: null,
      endedAt: null,
    }
    return [standIn, ...sides]
  }, [listed, pending, sessions])

  return useMemo(
    () => ({
      rows,
      open: () => {
        if (featureId) mutate({ featureId })
      },
      reopen: (id: string) => {
        if (featureId) mutate({ featureId, reopenSessionId: id })
      },
      opening: mutation.isPending,
      refresh,
    }),
    [rows, featureId, mutate, mutation.isPending, refresh],
  )
}

/**
 * The side sessions' views in the column. Every live one stays mounted behind
 * whatever is in front, as the feature chat and the scenario chat do, so xterm
 * keeps its buffer; an ended one renders only while it is in front.
 */
export function SideSessionsView({
  sides,
  inFront,
  hidden,
}: {
  sides: SideSessionsApi
  /** The column entry in front. */
  inFront: string
  /** The whole column is hidden (the panel has the row). */
  hidden: boolean
}) {
  return (
    <>
      {sides.rows.map((s) => {
        const shown = !hidden && inFront === s.id
        if (s.status !== 'ended') {
          return (
            <ChatView
              key={s.id}
              label="Side session"
              session={{ id: s.id, status: s.status }}
              onEnded={sides.refresh}
              hidden={!shown}
            />
          )
        }
        if (!shown) return null
        return (
          <ChatView
            key={s.id}
            label="Side session"
            session={null}
            transcriptId={s.id}
            onLaunch={() => sides.reopen(s.id)}
            launchLabel="Reopen"
            launching={sides.opening}
          />
        )
      })}
    </>
  )
}

/**
 * The switcher's rows for side sessions (design-mode decision 12 puts a chat's
 * actions in the switcher's menu): End session while a live side session is in
 * front, and the door to a new one, always.
 */
export function SideSessionMenu({
  sides,
  featureId,
  inFront,
}: {
  sides: SideSessionsApi
  featureId: string
  inFront: string
}) {
  const front = sides.rows.find((s) => s.id === inFront)
  return (
    <>
      {front && front.status !== 'ended' && (
        <EndSessionItem featureId={featureId} sessionId={front.id} onEnded={sides.refresh} />
      )}
      <DropdownMenuItem icon={<IconPlus />} disabled={sides.opening} onSelect={sides.open}>
        New side session
      </DropdownMenuItem>
    </>
  )
}
