import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ThreadEntry } from '../../lib/chat-thread'
import { subscribeInbox, takeFromInbox } from '../../lib/composer-inbox'
import { promptIdFor, useThread } from '../../lib/use-thread'
import { ApprovalDock, QuestionDock } from './thread/AskDock'
import { ChatThread } from './thread/ChatThread'
import { Composer } from './thread/Composer'
import { ContextMeter, ModelPicker, PlanStrip } from './thread/ComposerParts'

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
  runtime = 'claude-code',
  start,
  onStarted,
  onOpenThread,
  draftKey,
  inbox,
  emptyHint,
  meta,
  notices,
  label = 'Chat',
  children,
}: {
  threadId: string | null
  runtime?: ThreadEntry['runtime']
  start?: () => Promise<string>
  onStarted?: (threadId: string) => void
  /** Bring another thread to the front (a branch made from a message here). */
  onOpenThread?: (threadId: string) => void
  /** Where an unstarted thread keeps its draft. */
  draftKey?: string
  /** The composer inbox whose images land in this composer (a design crop). */
  inbox?: string
  emptyHint?: ReactNode
  /** The quiet line under the composer: where the agent works ("Feature worktree · feature/x"). */
  meta?: ReactNode
  /** Lines above the thread (a failed resume, a drive's prerequisites). */
  notices?: ReactNode
  /** The region's accessible name. */
  label?: string
  /** What floats over the thread (the notice deck), clear of the composer. */
  children?: ReactNode
}) {
  const t = useThread({ threadId, draftKey, start, onStarted })
  const root = useRef<HTMLElement>(null)
  const { view } = t

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

  const ask = view.ask
  const footer = ask ? (
    ask.kind === 'approval' ? (
      <ApprovalDock
        key={ask.id}
        call={ask.call}
        onAnswer={(choice, instead) => t.answer(ask, { kind: 'approval', choice, ...(instead ? { instead } : {}) })}
      />
    ) : (
      <QuestionDock key={ask.id} questions={ask.questions} onAnswer={(answers) => t.answer(ask, { kind: 'question', answers })} />
    )
  ) : (
    <Composer
      value={t.draft}
      onChange={t.setDraft}
      attachments={t.attachments}
      onAttach={t.attach}
      onRemoveAttachment={t.removeAttachment}
      commands={view.commands}
      files={t.files}
      state={view.state}
      onSend={() => void t.send()}
      onStop={t.stop}
      onRecall={t.recall}
      {...(view.suggestion ? { suggestion: view.suggestion } : {})}
      // No onStopTask: both adapters keep stopping a background command for JetBrains AIR clients.
      top={<PlanStrip plan={view.plan} tasks={view.tasks} />}
      footer={
        t.model && (
          <ModelPicker
            runtime={runtime}
            models={t.models}
            model={t.model}
            effort={t.effort}
            onModel={t.chooseModel}
            onEffort={t.chooseEffort}
          />
        )
      }
    />
  )

  const branch = async (itemId: string) => {
    const promptId = promptIdFor(view.items, itemId)
    const to = promptId && (await t.branch(promptId))
    if (to) onOpenThread?.(to)
  }

  return (
    <section ref={root} aria-label={label} data-thread-column="" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {notices && <div className="flex flex-none flex-col gap-2 px-4 pt-2 empty:hidden">{notices}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatThread
          items={view.items}
          state={view.state}
          {...(view.turnStartedAt ? { workingSince: view.turnStartedAt } : {})}
          actions={{ onEdit: t.edit, onBranch: (id) => void branch(id), canUndoFiles: runtime === 'claude-code' }}
          onDropImages={t.attach}
          emptyHint={emptyHint}
          footer={
            <div className="flex flex-col gap-1.5">
              {footer}
              {!ask && (meta || view.context) && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-text-tertiary">{meta}</span>
                  {view.context && (
                    <ContextMeter
                      context={view.context}
                      limits={t.usage?.limits ?? []}
                      {...(t.usage?.plan ? { plan: t.usage.plan } : {})}
                      onCompact={() => void t.send('/compact')}
                    />
                  )}
                </div>
              )}
            </div>
          }
        />
        {/* Clear of the composer floating at the thread's foot. */}
        {children && <div className="pointer-events-none absolute inset-x-0 top-0 bottom-44 [&>*]:pointer-events-auto">{children}</div>}
      </div>
    </section>
  )
}
