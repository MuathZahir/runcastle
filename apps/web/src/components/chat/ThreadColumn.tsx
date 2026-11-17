import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type { ThreadEntry } from '../../lib/chat-thread'
import { subscribeInbox, takeFromInbox } from '../../lib/composer-inbox'
import { useIsPhone } from '../../lib/use-phone'
import { useDraft } from '../../lib/drafts'
import { promptIdFor, useFileLookup, useThread, type ModelPick, type ThreadStart } from '../../lib/use-thread'
import { Spinner } from '../../ui'
import { FormDock, LinkDock, QuestionDock } from './thread/AskDock'
import { ChatThread } from './thread/ChatThread'
import { Composer } from './thread/Composer'
import { ContextMeter, ModelControls, PlanStrip } from './thread/ComposerParts'

/**
 * The column while the thread a link names waits on the page's thread list to
 * vouch for it: neither another thread nor a composer, so nothing is sent
 * before the column knows which thread it shows.
 */
export function ThreadOpening({ label = 'Chat' }: { label?: string }) {
  return (
    <section
      aria-label={label}
      aria-busy="true"
      data-thread-column=""
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 bg-surface text-sm text-text-tertiary"
    >
      <Spinner /> Opening the chat…
    </section>
  )
}

/**
 * One thread in the chat column (chat-as-web-components decisions 7, 8): the
 * approved thread components, composed exactly as `preview/chat.tsx`'s
 * ChatColumn composes them, driven by the thread API through `useThread`.
 * Opening it is instant — it renders the thread's log, no agent involved — and
 * what the agent waits on the human for docks where the composer is.
 *
 * Every agent conversation renders through this: the feature chat, side
 * threads, scenario and Fix-it chats, the project chat and the preparation
 * chat. `threadId` null is a chat nobody has started: an empty thread whose
 * first Send calls `start` (the surface's own launch) and then sends to the
 * thread it answers with.
 */
export function ThreadColumn({
  threadId,
  runtime,
  start,
  startsAs,
  onStarted,
  onPick,
  locked,
  onOpenThread,
  draftKey,
  inbox,
  emptyHint,
  empty,
  meta,
  startMeta,
  notices,
  tail,
  head,
  closed,
  placeholder,
  label = 'Chat',
  children,
  composerStrip,
}: {
  threadId: string | null
  /** The thread's runtime, until its models (which know it, unstarted or not) say. */
  runtime?: ThreadEntry['runtime']
  start?: () => Promise<string>
  /** Where `start` starts it, so the model controls show before the first message. */
  startsAs?: ThreadStart
  onStarted?: (threadId: string) => void
  /** The unstarted chat's model pick, as it changes: for a launch that carries it without a message (Start). */
  onPick?: (pick: ModelPick) => void
  /** The composer takes no message yet (a chat waiting for Start); its model controls still work. */
  locked?: boolean
  /** Bring another thread to the front (a branch made from a message here). */
  onOpenThread?: (threadId: string) => void
  /** Where an unstarted thread keeps its draft. */
  draftKey?: string
  /** The composer inbox whose images land in this composer (a design crop). */
  inbox?: string
  emptyHint?: ReactNode
  /** Instead of the plain "New thread" while nothing has been said. */
  empty?: ReactNode
  /** The quiet line under the composer: where the agent works ("Feature worktree · feature/x"). */
  meta?: ReactNode
  /** That line while nothing has been said here: what can still be chosen before the first message. */
  startMeta?: ReactNode
  /** Lines above the thread (a failed resume, a drive's prerequisites). */
  notices?: ReactNode
  /** A line under the thread's last item (the main chat's waiting line). */
  tail?: ReactNode
  /** What stays atop the thread while it scrolls (a worker's assignment card). */
  head?: ReactNode
  /** In place of the composer, for a thread that takes no messages (an old side chat, a settled worker). */
  closed?: ReactNode
  /** The empty composer's words. */
  placeholder?: string
  /** The region's accessible name. */
  label?: string
  /** What sits on the foot's top edge, above the composer or an ask: the notice strip. */
  children?: ReactNode
  /** A line right above the composer, only while it shows: the owner strip (every-feature-has-one-owner decision 23). */
  composerStrip?: ReactNode
}) {
  const t = useThread({ threadId, draftKey, start, onStarted, ...(startsAs ? { startsAs } : {}), ...(onPick ? { onPick } : {}) })
  const root = useRef<HTMLElement>(null)
  const { view } = t
  const onRuntime = t.runtime ?? runtime ?? 'claude-code'

  // A crop from the design pane: its images join the next message, and the
  // composer takes focus so the human writes it there.
  const attach = t.attach
  useEffect(() => {
    if (!inbox) return
    const take = () => {
      const files = takeFromInbox(inbox)
      if (files.length === 0) return
      attach(files)
      requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus())
    }
    take()
    return subscribeInbox(inbox, take)
  }, [inbox, attach])

  // A phone's composer is the preview's (runcastle-on-your-phone): no quiet line
  // under it, and no model controls while the agent works, so
  // "Working 1m 14s" fits beside Stop and Send.
  const phone = useIsPhone()
  const ask = view.ask
  const line = phone ? null : startMeta && !t.loading && view.items.length === 0 ? startMeta : meta
  const decline = () => ask && t.answer(ask, { kind: 'decline' })
  const footer = closed && !ask ? (
    closed
  ) : ask ? (
    ask.kind === 'question' ? (
      <QuestionDock key={ask.id} questions={ask.questions} onAnswer={(answers) => t.answer(ask, { kind: 'question', answers })} />
    ) : ask.kind === 'form' ? (
      <FormDock
        key={ask.id}
        {...(ask.server ? { server: ask.server } : {})}
        message={ask.message}
        fields={ask.fields}
        onSubmit={(values) => t.answer(ask, { kind: 'form', values })}
        onDecline={decline}
      />
    ) : (
      <LinkDock
        key={ask.id}
        {...(ask.server ? { server: ask.server } : {})}
        message={ask.message}
        url={ask.url}
        onDone={() => t.answer(ask, { kind: 'link', done: true })}
        onDecline={decline}
      />
    )
  ) : (
    <DraftComposer
      draftAt={t.draftAt}
      threadId={threadId}
      attachments={t.attachments}
      onAttach={t.attach}
      onRemoveAttachment={t.removeAttachment}
      commands={view.commands}
      state={view.state}
      {...(locked ? { locked } : {})}
      {...(placeholder ? { placeholder } : {})}
      onSend={() => void t.send()}
      onStop={t.stop}
      onRecall={t.recall}
      {...(view.suggestion ? { suggestion: view.suggestion } : {})}
      // No onStopTask: both adapters keep stopping a background command for JetBrains AIR clients.
      top={<PlanStrip plan={view.plan} tasks={view.tasks} />}
      {...(view.turnStartedAt ? { workingSince: view.turnStartedAt } : {})}
      meter={
        view.context && (
          <ContextMeter
            context={view.context}
            limits={t.usage?.limits ?? []}
            {...(t.usage?.plan ? { plan: t.usage.plan } : {})}
            onCompact={t.compact}
            onOpen={t.refreshUsage}
          />
        )
      }
      footer={
        t.model &&
        !(phone && view.state === 'working') && (
          <ModelControls
            runtime={onRuntime}
            models={t.models}
            model={t.model}
            onModel={t.chooseModel}
            effort={t.effort}
            onEffort={t.chooseEffort}
            fast={t.fast}
            onFast={t.chooseFast}
          />
        )
      }
    />
  )

  // The message actions stay the same functions from render to render, so the
  // memoised transcript is not redrawn for them.
  const latest = useRef({ t, onOpenThread })
  latest.current = { t, onOpenThread }
  const onEdit = useCallback((id: string, text: string, undoFiles: boolean) => latest.current.t.edit(id, text, undoFiles), [])
  const onBranch = useCallback((itemId: string) => {
    const now = latest.current.t
    const promptId = promptIdFor(now.view.items, itemId)
    if (!promptId) return
    void now.branch(promptId).then((to) => {
      if (to) latest.current.onOpenThread?.(to)
    })
  }, [])
  const isClosed = !!closed
  const canBranch = !!onOpenThread
  const canUndoFiles = onRuntime === 'claude-code'
  // A thread that takes no messages takes no edits either; a branch opens only where a page can bring it to the front.
  const actions = useMemo(
    () => (isClosed ? undefined : { onEdit, ...(canBranch ? { onBranch } : {}), canUndoFiles }),
    [isClosed, onEdit, onBranch, canBranch, canUndoFiles],
  )

  return (
    <section ref={root} aria-label={label} data-thread-column="" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {notices && <div className="flex flex-none flex-col gap-2 px-4 pt-2 empty:hidden">{notices}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatThread
          items={view.items}
          state={view.state}
          {...(actions ? { actions } : {})}
          {...(locked ? {} : { onDropImages: t.attach })}
          emptyHint={emptyHint}
          {...(empty ? { empty } : {})}
          loading={t.loading}
          tail={tail}
          {...(head ? { head } : {})}
          footer={
            <div className="flex flex-col gap-1.5">
              {children && <div className="mb-0.5 empty:hidden">{children}</div>}
              {!ask && !closed && composerStrip}
              {footer}
              {!ask && line && <span className="px-4 text-xs text-text-tertiary">{line}</span>}
            </div>
          }
        />
      </div>
    </section>
  )
}

/**
 * The composer over the draft it keeps under `draftAt`: the words live here, so
 * a key redraws this alone, not the column and its transcript. The `@` file
 * lookup follows the words, so it lives here too.
 */
function DraftComposer({
  draftAt,
  threadId,
  ...rest
}: { draftAt: string; threadId: string | null } & Omit<ComponentProps<typeof Composer>, 'value' | 'onChange' | 'files'>) {
  const [text, setText] = useDraft(draftAt)
  const files = useFileLookup(threadId, text)
  return <Composer value={text} onChange={setText} files={files} {...rest} />
}
