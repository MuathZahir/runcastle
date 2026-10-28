import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import { rankNames, rankPaths } from '@runcastle/core'
import type { Attachment, SlashCommand, ThreadState } from '../../../lib/chat-thread'
import { IconDoc, IconPaperclip, IconSend, IconStop, IconX } from '../../../icons'
import { BARE_BUTTON, IconButton, Kbd, cx } from '../../../ui'
import { DOCK } from './AskDock'

/** The textarea grows to this many pixels, then scrolls. */
const MAX_HEIGHT = 280

type Suggest = { kind: 'command'; items: SlashCommand[]; query: string } | { kind: 'file'; items: string[]; query: string }

/**
 * The one place the human writes to the agent (decision 5). Enter sends,
 * Shift+Enter breaks the line, Esc stops a working turn, ↑ in an empty box
 * brings back your last message. `/` lists the session's commands and skills;
 * `@` finds a file in the worktree to point the agent at; images ride the
 * message as chips. A message sent while the agent works goes into the
 * running turn (steering), as typing does in Claude Code.
 *
 * Sending never waits on the agent: with no agent running, the message shows
 * at once and the agent starts behind it (decision 7). While the agent works,
 * a light travels the box's edge — the sidebar's working light.
 */
export function Composer({
  value,
  onChange,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  commands = [],
  files = [],
  state,
  onSend,
  onStop,
  onRecall,
  suggestion,
  placeholder = 'Message the agent — / for commands, @ for files',
  autoFocus,
  top,
  footer,
}: {
  value: string
  onChange: (v: string) => void
  attachments?: Attachment[]
  onAttach?: (files: File[]) => void
  onRemoveAttachment?: (id: string) => void
  commands?: SlashCommand[]
  /** The worktree's files, for `@`. */
  files?: string[]
  state: ThreadState
  onSend: () => void
  onStop?: () => void
  /** ↑ in an empty box: the last message you sent. */
  onRecall?: () => string | undefined
  /** The agent's guess at your next message, shown in an empty box; Tab takes it. */
  suggestion?: string
  placeholder?: string
  autoFocus?: boolean
  /** Pinned on the box's top edge: the plan strip. */
  top?: ReactNode
  /** The footer's left side: the model picker. Right of it sit attach, the meter and send. */
  footer?: ReactNode
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  const slash = /^\/(\S*)$/.exec(value)
  const at = /(?:^|\s)@(\S*)$/.exec(value)
  const suggest: Suggest | null = slash
    ? { kind: 'command', query: slash[1], items: rankNames(commands, (c) => c.name, slash[1]) }
    : at
      ? { kind: 'file', query: at[1], items: rankPaths(files, at[1], 8) }
      : null
  const listing = !!suggest && suggest.items.length > 0
  const count = suggest?.items.length ?? 0
  useEffect(() => setActive(0), [suggest?.kind, suggest?.query])

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const canSend = value.trim() !== '' || attachments.length > 0
  const working = state === 'working'

  const take = (i: number) => {
    if (!suggest) return
    if (suggest.kind === 'command') onChange(`/${suggest.items[i].name} `)
    else onChange(`${value.slice(0, value.length - suggest.query.length)}${suggest.items[i]} `)
    area.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        take(active)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onChange(value.replace(/[/@]\S*$/, ''))
        return
      }
    }
    if (e.key === 'Tab' && !value && suggestion) {
      e.preventDefault()
      onChange(suggestion)
      return
    }
    if (e.key === 'ArrowUp' && !value) {
      const last = onRecall?.()
      if (last) {
        e.preventDefault()
        onChange(last)
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
      return
    }
    if (e.key === 'Escape' && working) {
      e.preventDefault()
      onStop?.()
    }
  }

  const takeImages = (list: FileList | null | undefined): boolean => {
    const images = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return false
    onAttach?.(images)
    return true
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (takeImages(e.clipboardData.files)) e.preventDefault()
  }

  return (
    <div className="flex flex-col">
      {top}
      <div className={cx(DOCK, 'animate-none', working && 'orbit-light')}>
        {listing && suggest && (
          <ul
            role="listbox"
            aria-label={suggest.kind === 'command' ? 'Commands' : 'Files'}
            className="m-0 flex max-h-64 list-none flex-col overflow-y-auto border-b border-border-subtle p-1 animate-fade-in"
          >
            {suggest.items.map((item, i) => {
              const name = typeof item === 'string' ? item : `/${item.name}`
              return (
                <li key={name} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => take(i)}
                    onMouseEnter={() => setActive(i)}
                    className={cx(
                      BARE_BUTTON,
                      'flex h-8 w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 text-left text-sm',
                      i === active ? 'bg-[color-mix(in_oklab,var(--color-text)_8%,transparent)]' : '',
                    )}
                  >
                    {typeof item === 'string' ? (
                      <>
                        <IconDoc size={14} className="shrink-0 text-icon" />
                        <span className="min-w-0 truncate font-mono text-xs text-text">{item}</span>
                      </>
                    ) : (
                      <>
                        <span className="shrink-0 font-mono text-xs text-text">{name}</span>
                        <span className="min-w-0 truncate text-text-tertiary">{item.description}</span>
                      </>
                    )}
                    {i === active && <Kbd className="ml-auto">Tab</Kbd>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative size-16 overflow-hidden rounded-md bg-surface-inset ring-1 ring-border-subtle animate-pop-in"
              >
                <img src={a.src} alt={a.name} className="size-full object-cover" />
                <IconButton
                  label="Remove image"
                  icon={<IconX size={12} />}
                  size="sm"
                  variant="secondary"
                  onClick={() => onRemoveAttachment?.(a.id)}
                  className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                />
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            ref={area}
            rows={2}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={suggestion ? '' : working ? 'Steer the agent — this joins the running turn' : placeholder}
            aria-label="Message"
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-1 font-sans text-base text-text outline-none placeholder:text-text-tertiary"
          />
          {suggestion && !value && (
            <span aria-hidden className="pointer-events-none absolute top-3.5 right-4 left-4 flex items-center gap-2 truncate text-base text-text-tertiary">
              <span className="truncate">{suggestion}</span>
              <Kbd>Tab</Kbd>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 px-2 pt-1 pb-2">
          {footer}
          <span className="ml-auto flex items-center gap-1">
            <IconButton label="Attach images" icon={<IconPaperclip />} size="md" onClick={() => picker.current?.click()} />
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                takeImages(e.target.files)
                e.target.value = ''
              }}
            />
            {working && <IconButton label="Stop" kbd="Esc" icon={<IconStop />} size="md" variant="secondary" onClick={onStop} />}
            <IconButton
              label={working ? 'Send into the running turn' : 'Send'}
              kbd="Enter"
              icon={<IconSend />}
              size="md"
              variant={canSend ? 'primary' : 'ghost'}
              disabled={!canSend}
              onClick={onSend}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
