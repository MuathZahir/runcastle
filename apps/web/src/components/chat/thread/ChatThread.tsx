import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { ThreadItem, ThreadState } from '../../../lib/chat-thread'
import {
  IconAlert,
  IconArrowRight,
  IconBranchFrom,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconImage,
  IconMessage,
  IconOrchestrator,
  IconPencil,
  IconStop,
  IconX,
} from '../../../icons'
import { Button, Checkbox, EmptyState, IconButton, Spinner, cx } from '../../../ui'
import { Markdown } from '../../Markdown'
import { ChangesCard, WorkBlock } from './Work'

/** What a message's hover actions ask of the thread. */
export interface MessageActions {
  /** Rewind the conversation to just before this message and send `text` in its place. */
  onEdit?: (id: string, text: string, undoFiles: boolean) => void
  /** Start a new thread that carries the conversation up to here. */
  onBranch?: (id: string) => void
  /** Whether rewinding can also undo the agent's file changes (Claude's checkpoints). */
  canUndoFiles?: boolean
}

/**
 * One thread, read like a conversation (decision 7). Your messages sit on the
 * right; the agent's answer reads as prose at full width; a settled turn's work
 * folds to "Worked for 3m 43s" above its answer, and what the turn changed
 * follows it as one card. Hover a message for its actions: copy, edit (which
 * rewinds the thread to there), branch into a new thread.
 *
 * The composer floats over the thread's foot, which fades out beneath it.
 * Images dropped anywhere on the thread attach to the next message.
 */
export function ChatThread({
  items,
  state,
  workingSince,
  emptyHint,
  loading,
  actions,
  onDropImages,
  footer,
}: {
  items: ThreadItem[]
  state: ThreadState
  /** When the current turn began, for the elapsed time beside "Working". */
  workingSince?: number
  emptyHint?: ReactNode
  /** The thread's history is still being read: an empty thread is not yet a new one. */
  loading?: boolean
  actions?: MessageActions
  onDropImages?: (files: File[]) => void
  /** The composer, or what the agent waits on you for, docked at the foot. */
  footer: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [footH, setFootH] = useState(160)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const el = foot.current
    if (!el) return
    const ro = new ResizeObserver(() => setFootH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Where the thread was last scrolled to, by the reader or by the thread itself.
  const lastTop = useRef(0)
  const toFoot = (el: HTMLElement): void => {
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
  }

  useEffect(() => {
    const el = scroller.current
    if (el && atBottom) toFoot(el)
  }, [items, state, atBottom, footH])

  // The thread grows after the scroll above — an image loads, a turn folds, a
  // message lays out — and a thread read at its foot stays at its foot through
  // all of it: the content's resize follows it down, and so does an image's
  // `load` (which does not bubble, so it is caught on the way down).
  const stick = useRef(atBottom)
  stick.current = atBottom
  useLayoutEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const follow = () => {
      if (stick.current) toFoot(el)
    }
    const ro = new ResizeObserver(follow)
    ro.observe(inner)
    el.addEventListener('load', follow, true)
    return () => {
      ro.disconnect()
      el.removeEventListener('load', follow, true)
    }
  }, [])

  // Only the reader leaves the foot, by scrolling up: the thread growing
  // beneath them moves no scroll position, so it never unsticks the thread.
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const up = el.scrollTop < lastTop.current
    lastTop.current = el.scrollTop
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) setAtBottom(true)
    else if (up) setAtBottom(false)
  }

  const hasImages = (e: DragEvent) => [...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!onDropImages || !hasImages(e)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (images.length && onDropImages) {
          e.preventDefault()
          onDropImages(images)
        }
      }}
    >
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable]">
        <div ref={content} className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 pt-8" style={{ paddingBottom: footH + 24 }}>
          {items.length === 0 && loading ? (
            <p role="status" className="m-0 flex items-center justify-center gap-2 pt-[12vh] text-sm text-text-tertiary">
              <Spinner />
              Loading the thread…
            </p>
          ) : items.length === 0 ? (
            <div className="pt-[12vh]">
              <EmptyState icon={<IconMessage />} title="New thread" hint={emptyHint} />
            </div>
          ) : (
            items.map((item) => <Item key={item.id} item={item} actions={actions} locked={state !== 'idle'} />)
          )}
          {state === 'working' && <WorkingLine since={workingSince} />}
        </div>
      </div>

      <div ref={foot} className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-4">
        <div className="absolute inset-x-0 -top-10 bottom-0 bg-[linear-gradient(to_bottom,transparent,var(--color-surface)_40px)]" />
        <div className="pointer-events-auto relative mx-auto w-full max-w-(--content-max)">
          {!atBottom && (
            <IconButton
              label="Jump to the newest"
              icon={<IconChevronDown />}
              variant="secondary"
              onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
              className="absolute -top-11 left-1/2 -translate-x-1/2 animate-pop-in"
            />
          )}
          {footer}
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] animate-fade-in">
          <span className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2 text-sm text-text shadow-popover">
            <IconImage size={16} className="text-accent" />
            Drop to attach to your message
          </span>
        </div>
      )}
    </div>
  )
}

function Item({ item, actions, locked }: { item: ThreadItem; actions?: MessageActions; locked: boolean }) {
  switch (item.kind) {
    case 'user':
      return item.from === 'runcastle' ? (
        <RuncastleLine text={item.text} />
      ) : (
        <UserMessage item={item} actions={actions} locked={locked} />
      )
    case 'work':
      return <WorkBlock steps={item.steps} seconds={item.seconds} live={item.live} />
    case 'agent':
      return <AgentMessage item={item} actions={actions} />
    case 'changes':
      return <ChangesCard files={item.files} />
    case 'answered':
      return (
        <p className="m-0 -mt-2 flex min-w-0 items-center gap-1.5 text-sm text-text-tertiary">
          {item.denied ? <IconX size={14} className="shrink-0 text-icon" /> : <IconCheck size={14} className="shrink-0 text-icon" />}
          <span className="shrink-0">{item.what}</span>
          <span className="min-w-0 truncate text-text-secondary">{item.answer}</span>
        </p>
      )
    case 'stopped':
      return (
        <p className="m-0 -mt-2 flex items-center gap-1.5 text-sm text-text-tertiary">
          <IconStop size={13} className="shrink-0 text-icon" />
          Stopped by you
        </p>
      )
    case 'compacted':
      return <Divider>Conversation compacted — earlier turns are summarised for the agent</Divider>
    case 'model':
      return (
        <Divider>
          Now on {item.model}
          {item.effort && ` · ${item.effort.charAt(0).toUpperCase()}${item.effort.slice(1)} effort`}
        </Divider>
      )
    case 'error':
      return <ThreadError>{item.message}</ThreadError>
    case 'notice':
      return <Divider>{item.text}</Divider>
  }
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-tertiary">
      <span className="h-px flex-1 bg-border-subtle" />
      {children}
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  )
}

/**
 * A message's actions, shown on hover or focus within it. They hang just under
 * the message without taking room, so a thread's rhythm is its messages alone.
 */
function Actions({ align, children }: { align: 'start' | 'end'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'absolute top-full z-1 flex gap-0.5 pt-0.5 opacity-0 transition-opacity duration-(--dur-1) ease-app',
        'group-hover/msg:opacity-100 group-focus-within/msg:opacity-100',
        align === 'end' ? 'right-0' : '-left-1.5',
      )}
    >
      {children}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      label={done ? 'Copied' : 'Copy'}
      icon={done ? <IconCheck /> : <IconCopy />}
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setDone(true)
        window.setTimeout(() => setDone(false), 1200)
      }}
    />
  )
}

function UserMessage({
  item,
  actions,
  locked,
}: {
  item: Extract<ThreadItem, { kind: 'user' }>
  actions?: MessageActions
  locked: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const [undoFiles, setUndoFiles] = useState(true)
  if (editing) {
    return (
      <div className="ml-auto flex w-full max-w-[85%] flex-col gap-2 rounded-lg bg-surface-raised p-3 shadow-popover animate-pop-in">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(8, draft.split('\n').length + 1)}
          className="w-full resize-none border-0 bg-transparent font-sans text-base text-text outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
          <span className="text-xs text-text-tertiary">Rewinds the thread to here and sends this instead.</span>
          {actions?.canUndoFiles && (
            <Checkbox checked={undoFiles} onChange={setUndoFiles} label="Also undo the agent’s file changes since" />
          )}
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false)
                actions?.onEdit?.(item.id, draft, undoFiles)
              }}
            >
              Rewind and send
            </Button>
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="group/msg relative flex flex-col items-end gap-1.5 animate-rise-in">
      {item.images && item.images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {item.images.map((img) => (
            <img
              key={img.id}
              src={img.src}
              alt={img.name}
              className="max-h-44 max-w-64 rounded-lg object-cover ring-1 ring-border-subtle"
            />
          ))}
        </div>
      )}
      {item.text && (
        <div className="max-w-[85%] rounded-lg bg-[color-mix(in_oklab,var(--color-text)_6%,var(--color-surface))] px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_5%,transparent)] ring-1 ring-inset ring-border-subtle">
          {item.text}
        </div>
      )}
      {item.starting ? (
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <Spinner size="sm" />
          <span className="text-shimmer">Starting the agent…</span>
        </span>
      ) : item.steered ? (
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <IconArrowRight size={12} className="text-icon" />
          Sent into the running turn
        </span>
      ) : (
        <Actions align="end">
          <CopyButton text={item.text} />
          {actions?.onBranch && (
            <IconButton label="Branch into a new thread from here" icon={<IconBranchFrom />} size="sm" onClick={() => actions.onBranch?.(item.id)} />
          )}
          {actions?.onEdit && (
            <IconButton
              label={locked ? 'Edit — stop the turn first' : 'Edit and rewind to here'}
              icon={<IconPencil />}
              size="sm"
              disabled={locked}
              onClick={() => setEditing(true)}
            />
          )}
        </Actions>
      )}
    </div>
  )
}

function AgentMessage({ item, actions }: { item: Extract<ThreadItem, { kind: 'agent' }>; actions?: MessageActions }) {
  return (
    <div className="group/msg relative flex flex-col animate-fade-in">
      <Markdown source={item.text} size="base" tone="primary" breaks />
      <Actions align="start">
        <CopyButton text={item.text} />
        {actions?.onBranch && (
          <IconButton label="Branch into a new thread from here" icon={<IconBranchFrom />} size="sm" onClick={() => actions.onBranch?.(item.id)} />
        )}
        {item.model && <span className="self-center pl-1 text-xs text-text-tertiary">{item.model}</span>}
      </Actions>
    </div>
  )
}

/** The tag runcastle's prompts carry for the agent (`tagRuncastlePrompt`); the line already says who spoke. */
const RUNCASTLE_TAG = /^\s*\[runcastle\]\s*/

/** How long a runcastle line's head may run before it is cut at a word: about one line of the column. */
const RUNCASTLE_HEAD_MAX = 140

/**
 * A runcastle line split into what shows and what folds: its first sentence of
 * its first line, cut at a word past {@link RUNCASTLE_HEAD_MAX}. A briefing's
 * state header, its quote of the main chat and its paths are all `rest`.
 */
function foldRuncastleText(text: string): { head: string; rest: boolean } {
  const firstLine = text.split('\n', 1)[0].trim()
  const sentence = /^.+?[.!?](?=\s|$)/.exec(firstLine)?.[0] ?? firstLine
  const space = sentence.lastIndexOf(' ', RUNCASTLE_HEAD_MAX)
  const head =
    sentence.length <= RUNCASTLE_HEAD_MAX
      ? sentence
      : `${sentence.slice(0, space > 0 ? space : RUNCASTLE_HEAD_MAX).replace(/[\s,;:]+$/, '')}…`
  return { head, rest: head !== text.trim() }
}

/**
 * Runcastle's own message to the agent (Go, a round's end, a thread's
 * briefing): one quiet line, not your bubble. A long one shows its first
 * sentence, the rest behind Show more.
 */
function RuncastleLine({ text: tagged }: { text: string }) {
  const text = tagged.replace(RUNCASTLE_TAG, '')
  const { head, rest } = foldRuncastleText(text)
  const [open, setOpen] = useState(false)
  return (
    <p className={cx('m-0 flex min-w-0 gap-2 text-sm text-text-tertiary', open ? 'items-start' : 'items-center')}>
      <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-accent-text ring-1 ring-inset ring-[color-mix(in_oklab,var(--color-accent)_28%,transparent)]">
        <IconOrchestrator size={12} />
      </span>
      <span className={cx('min-w-0', open && 'whitespace-pre-wrap break-words')}>
        <span className="font-medium text-text-secondary">Runcastle</span> · {open ? text : head}
        {rest && (
          <>
            {' '}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="cursor-pointer whitespace-nowrap text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
            >
              {open ? 'Show less' : 'Show more'}
            </button>
          </>
        )}
      </span>
    </p>
  )
}

function WorkingLine({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : null
  return (
    <p role="status" className="m-0 flex items-center gap-2 text-sm text-text-tertiary">
      <Spinner />
      <span className="text-shimmer">Working</span>
      {secs !== null && (
        <span className="tabular-nums">{secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}</span>
      )}
      <span className="text-text-disabled">·</span>
      <span>Esc to stop</span>
    </p>
  )
}

/** A failure the thread itself hit (the agent would not start, the runtime is signed out). */
export function ThreadError({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-danger-text">
      <IconAlert size={15} className="mt-0.5 shrink-0 text-danger" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
