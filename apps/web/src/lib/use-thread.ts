import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { EMPTY_THREAD_VIEW, foldThread } from './chat-thread'
import type { Ask, AskAnswer, Attachment, Effort, ModelChoice, ThreadEvent, ThreadItem, ThreadView } from './chat-thread'
import { useLivePoll } from './live'
import { useToast } from './toast'

/**
 * One thread, live (chat-as-web-components decision 7): its first paint from
 * `thread.view`, then its whole log from `thread.events`, folded with core's
 * `foldThread` — the same fold the server makes. A `{ kind: 'thread' }` live
 * signal invalidates this thread's `events` query, and the query only ever
 * asks for what comes after the last event already held, so a long thread is
 * read once and then a few events at a time.
 *
 * Sending never waits: the message shows at once, and the server's own prompt
 * event takes its place when it arrives. A thread with no id yet (a feature's
 * chat nobody has talked to) is started by `start` on the first Send, which
 * answers with the new thread's id.
 */

/** An image on its way into a message: shown from a local URL, sent as base64. */
export interface PendingAttachment extends Attachment {
  file: Blob
}

/** A message sent and not yet seen in the log. */
interface Pending {
  localId: string
  /** The thread it went to; null while that thread is being started. */
  threadId: string | null
  text: string
  images: Attachment[]
  /** What `send` answered with, once it has. */
  promptId?: string
  /** The log's cursor when it was sent: only a prompt after it can be this one. */
  after: number
}

/** The log held for one thread; `null` until the first read answers. */
interface Held {
  threadId: string | null
  log: ThreadEvent[] | null
}

const DRAFT_KEY = 'runcastle.thread.draft:'
const AT_FILE = /(?:^|\s)@(\S*)$/

function readDraft(key: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY + key) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(key: string, text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY + key, text)
    else localStorage.removeItem(DRAFT_KEY + key)
  } catch {
    // Storage full or refused: the draft lives on in memory only.
  }
}

/** A blob as base64 with no `data:` prefix, the shape `thread.send` takes images in. */
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

let localSeq = 0

/** The prompt id a message's actions act on: the message itself, or the human's message the answer replied to. */
export function promptIdFor(items: readonly ThreadItem[], itemId: string): string | undefined {
  const at = items.findIndex((x) => x.id === itemId)
  for (let i = at; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'user') return item.id
  }
  return undefined
}

export function useThread({
  threadId,
  draftKey,
  start,
  onStarted,
}: {
  /** The thread; null for one that has never started. */
  threadId: string | null
  /** Where an unstarted thread keeps its draft ("feature:<id>:main"). */
  draftKey?: string
  /** Start the thread on its first message; answers with its id. */
  start?: () => Promise<string>
  /** The unstarted thread now has an id. */
  onStarted?: (threadId: string) => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const poll = useLivePoll()
  const id = threadId ?? ''
  const enabled = !!threadId

  // ---- reading ----
  const [held, setHeld] = useState<Held>({ threadId, log: null })
  const log = held.threadId === threadId ? held.log : null
  const cursor = log?.length ? log[log.length - 1].i : undefined

  const viewQ = trpc.thread.view.useQuery({ threadId: id }, { enabled })
  const eventsQ = trpc.thread.events.useQuery(
    { threadId: id, ...(cursor !== undefined ? { after: cursor } : {}) },
    {
      enabled,
      // A read after a cursor never changes by itself: only a live signal (or
      // the stream being down) says there is more after it.
      staleTime: Infinity,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      refetchInterval: poll,
    },
  )
  const got = eventsQ.data?.events
  useEffect(() => {
    if (!got || !threadId) return
    const base = held.threadId === threadId ? (held.log ?? []) : []
    const last = base.length ? base[base.length - 1].i : -1
    const fresh = got.filter((e) => e.i > last)
    if (fresh.length === 0 && held.threadId === threadId && held.log) return
    const next = [...base, ...fresh]
    // The read after the new cursor has nothing in it yet: say so, so moving
    // the cursor is not itself a fetch. A live signal invalidates it.
    if (next.length) utils.thread.events.setData({ threadId, after: next[next.length - 1].i }, { events: [] })
    setHeld({ threadId, log: next })
  }, [got, threadId, held, utils])

  const folded = useMemo((): ThreadView => {
    if (!threadId) return EMPTY_THREAD_VIEW
    if (log) return foldThread(log)
    return viewQ.data ?? EMPTY_THREAD_VIEW
  }, [threadId, log, viewQ.data])

  // ---- sending ----
  const [pending, setPending] = useState<Pending[]>([])
  const shownPending = pending.filter((p) => {
    if (p.threadId !== threadId) return false
    if (!log) return true
    return !log.some(
      (e) => e.type === 'prompt' && (p.promptId ? e.id === p.promptId : e.source === 'human' && e.i > p.after && e.text === p.text),
    )
  })
  const view = useMemo((): ThreadView => {
    if (shownPending.length === 0) return folded
    const working = folded.state === 'working'
    const items: ThreadItem[] = shownPending.map((p) => ({
      kind: 'user',
      id: p.localId,
      text: p.text,
      ...(p.images.length ? { images: p.images } : {}),
      ...(working ? { steered: true } : folded.process !== 'running' ? { starting: true } : {}),
    }))
    return { ...folded, items: [...folded.items, ...items] }
  }, [folded, shownPending])

  // ---- the draft ----
  const draftAt = threadId ?? draftKey ?? 'new'
  const [draft, setDraftState] = useState(() => ({ at: draftAt, text: readDraft(draftAt) }))
  const text = draft.at === draftAt ? draft.text : readDraft(draftAt)
  const setDraft = useCallback(
    (next: string) => {
      setDraftState({ at: draftAt, text: next })
      writeDraft(draftAt, next)
    },
    [draftAt],
  )
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const attach = useCallback((files: readonly File[]) => {
    setAttachments((as) => [
      ...as,
      ...files.map((f) => ({ id: `att${++localSeq}`, name: f.name || 'image.png', src: URL.createObjectURL(f), file: f })),
    ])
  }, [])
  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((as) => as.filter((a) => a.id !== attachmentId))
  }, [])

  // ---- the model the next message runs on ----
  const [choice, setChoice] = useState<{ threadId: string | null; model?: string; effort?: Effort; fast?: boolean }>({ threadId })
  const chosen = choice.threadId === threadId ? choice : { threadId }
  const model = chosen.model ?? folded.model?.id
  const effort: Effort = chosen.effort ?? folded.model?.effort ?? 'high'
  const fast = chosen.fast ?? folded.model?.fast ?? false
  const modelsQ = trpc.thread.models.useQuery({ threadId: id }, { enabled })
  // While the runtime's list cannot be read, the picker still names the model the thread is on.
  const models: ModelChoice[] = modelsQ.data?.length
    ? modelsQ.data
    : folded.model
      ? [{ id: folded.model.id, label: folded.model.label }]
      : []
  // A refused change is quiet: the choice rides the next message instead. A
  // model the session moved to may offer fast mode where the last did not.
  const setModelM = trpc.thread.setModel.useMutation({
    onSuccess: () => void utils.thread.models.invalidate({ threadId: id }),
    onError: () => undefined,
  })
  const choose = (next: { model?: string; effort?: Effort; fast?: boolean }) => {
    const merged = { ...chosen, ...next, threadId }
    setChoice(merged)
    const to = merged.model ?? folded.model?.id
    if (threadId && to) {
      setModelM.mutate({
        threadId,
        model: to,
        ...(merged.effort ? { effort: merged.effort } : {}),
        ...(merged.fast !== undefined ? { fast: merged.fast } : {}),
      })
    }
  }

  const sendM = trpc.thread.send.useMutation()
  /** Send the composer's message. */
  const send = async (): Promise<void> => {
    const words = text.trim()
    const sent = attachments
    if (!words && sent.length === 0) return
    const local: Pending = {
      localId: `local${++localSeq}`,
      threadId,
      text: words,
      images: sent.map(({ id: imageId, name, src }) => ({ id: imageId, name, src })),
      after: cursor ?? -1,
    }
    setPending((ps) => [...ps, local])
    setDraft('')
    setAttachments([])
    const changed = chosen.model !== undefined && chosen.model !== folded.model?.id
    const effortChanged = chosen.effort !== undefined && chosen.effort !== folded.model?.effort
    const fastChanged = chosen.fast !== undefined && chosen.fast !== (folded.model?.fast ?? false)
    try {
      const images = await Promise.all(
        sent.map(async (a) => ({ name: a.name, mimeType: a.file.type || 'image/png', data: await blobBase64(a.file) })),
      )
      let to = threadId
      if (!to) {
        if (!start) throw new Error('this chat cannot be started from here')
        to = await start()
        const started = to
        setPending((ps) => ps.map((p) => (p.localId === local.localId ? { ...p, threadId: started } : p)))
        onStarted?.(started)
      }
      const { promptId } = await sendM.mutateAsync({
        threadId: to,
        text: words,
        ...(images.length ? { images } : {}),
        ...(changed && chosen.model ? { model: chosen.model } : {}),
        ...(effortChanged ? { effort } : {}),
        ...(fastChanged ? { fast } : {}),
      })
      setPending((ps) => ps.map((p) => (p.localId === local.localId ? { ...p, promptId } : p)))
    } catch (e) {
      setPending((ps) => ps.filter((p) => p.localId !== local.localId))
      // Give the words back so nothing typed is lost.
      setDraftState((d) => (d.text ? d : { at: d.at, text: words }))
      writeDraft(draftAt, words)
      setAttachments((as) => [...sent, ...as])
      toast.push(e instanceof Error ? e.message : 'the message could not be sent')
    }
  }

  /** ↑ in an empty composer: the last thing the human said here. */
  const recall = (): string | undefined =>
    [...view.items].reverse().find((x): x is Extract<ThreadItem, { kind: 'user' }> => x.kind === 'user' && !x.from)?.text

  const onError = (e: { message: string }) => toast.push(e.message)
  const stopM = trpc.thread.stop.useMutation({ onError })
  const answerM = trpc.thread.answer.useMutation({ onError })
  // Refused while the agent works: the human is told so.
  const compactM = trpc.thread.compact.useMutation({ onError })
  // The controls: a runtime that cannot rewind or branch leaves the thread as
  // it was, without a word.
  const quiet = { onError: () => undefined }
  const editM = trpc.thread.edit.useMutation(quiet)
  const branchM = trpc.thread.branch.useMutation(quiet)

  // ---- controls whose reads may be refused: each degrades to nothing ----
  const usageQ = trpc.thread.usage.useQuery({ threadId: id }, { enabled })
  const fileQuery = AT_FILE.exec(text)?.[1]
  const filesQ = trpc.thread.files.useQuery({ threadId: id, query: fileQuery ?? '', limit: 8 }, { enabled: enabled && fileQuery !== undefined })

  return {
    view,
    draft: text,
    setDraft,
    attachments: attachments as Attachment[],
    attach,
    removeAttachment,
    send,
    recall,
    stop: () => {
      if (threadId) stopM.mutate({ threadId })
    },
    answer: (ask: Ask, answer: AskAnswer) => {
      if (threadId) answerM.mutate({ threadId, askId: ask.id, answer })
    },
    models,
    model,
    effort,
    chooseModel: (next: string) => choose({ model: next }),
    chooseEffort: (next: Effort) => choose({ effort: next }),
    /** Fast mode for the next message; offered only where the model the thread runs on has it. */
    fast,
    fastOffered: models.some((m) => m.id === model && m.fast),
    chooseFast: (next: boolean) => choose({ fast: next }),
    /** Compact the conversation (Compact now): no message of the human's, a divider when it is done. */
    compact: () => {
      if (threadId) compactM.mutate({ threadId })
    },
    /** The account's limits and plan; none while that read is refused. */
    usage: usageQ.data,
    /** The worktree's files matching the `@` being typed; none while that read is refused. */
    files: filesQ.data ?? [],
    edit: (promptId: string, next: string, undoFiles: boolean) => {
      if (threadId) editM.mutate({ threadId, promptId, text: next, undoFiles })
    },
    /** A new thread carrying the conversation up to `promptId`; answers with its id. */
    branch: async (promptId: string): Promise<string | undefined> => {
      if (!threadId) return undefined
      try {
        return (await branchM.mutateAsync({ threadId, promptId })).threadId
      } catch {
        return undefined
      }
    },
  }
}

export type ThreadApi = ReturnType<typeof useThread>

/** A Markdown file's name from a thread's title, without what file systems refuse. */
export function markdownFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${name || 'Thread'}.md`
}

/**
 * The thread switcher's rows for the thread in front, as its props: rename it
 * (`thread.rename`), and export it (`thread.export`) as a downloaded
 * `<title>.md`. Apart from `useThread`, since the switcher sits in the page
 * header, away from the column. None for a thread that has not begun.
 */
export function useThreadMenu(threadId: string | null | undefined): {
  onRename?: (title: string) => void
  onExport?: (title: string) => void
} {
  const toast = useToast()
  const utils = trpc.useUtils()
  const renameM = trpc.thread.rename.useMutation({
    onSuccess: () => void utils.thread.list.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  if (!threadId) return {}
  const exportMarkdown = async (title: string): Promise<void> => {
    try {
      const { markdown } = await utils.thread.export.fetch({ threadId }, { staleTime: 0 })
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
      const link = document.createElement('a')
      link.href = url
      link.download = markdownFileName(title)
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'the thread could not be exported')
    }
  }
  return {
    onRename: (title) => renameM.mutate({ threadId, title }),
    onExport: (title) => void exportMarkdown(title),
  }
}
