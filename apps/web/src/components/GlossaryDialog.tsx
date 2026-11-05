import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Dialog, DialogBody, DialogHeader, EmptyState, SearchField, cx } from '../ui'
import { IconHelp } from '../icons'
import {
  GLOSSARY_GROUP_LABEL,
  GLOSSARY_GROUP_ORDER,
  filterGlossary,
  type GlossaryEntry,
  type GlossaryId,
} from '../lib/glossary'

/**
 * The Glossary (ready-to-publish decision 16): every word runcastle uses, one
 * plain sentence each, in four groups, with a filter box. Opened from the help
 * menu in the sidebar's bottom row, the command menu, and the link inside a
 * `Term` hint, which opens it at that word.
 */
export function GlossaryDialog({
  open,
  onClose,
  focus,
}: {
  open: boolean
  onClose: () => void
  /** The word to scroll to and mark, when a `Term` hint opened the dialog. */
  focus?: GlossaryId
}) {
  const titleId = useId()
  const [query, setQuery] = useState('')
  const entries = filterGlossary(query)
  const listRef = useRef<HTMLDivElement>(null)

  // A fresh open starts unfiltered, at the word it was opened for.
  useEffect(() => {
    if (!open) return
    setQuery('')
    if (!focus) return
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-term="${focus}"]`)?.scrollIntoView({ block: 'center' })
    })
  }, [open, focus])

  return (
    <Dialog open={open} onClose={onClose} size="md" labelledBy={titleId}>
      <DialogHeader
        id={titleId}
        title="Glossary"
        description="The words runcastle uses, in one sentence each."
        onClose={onClose}
      />
      <div className="px-6 pb-3">
        <SearchField
          size="md"
          placeholder="Find a word"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={!focus}
        />
      </div>
      <DialogBody className="max-h-[min(560px,64vh)] overflow-y-auto pt-1 [scrollbar-width:thin]">
        <div ref={listRef}>
          {entries.length === 0 ? (
            <EmptyState icon={<IconHelp size={20} />} title="No word matches" hint="Try a shorter word, or an old one such as “burn”." />
          ) : (
            GLOSSARY_GROUP_ORDER.map((group) => {
              const inGroup = entries.filter((e) => e.group === group)
              if (inGroup.length === 0) return null
              return (
                <section key={group} className="mb-4 last:mb-0">
                  <h3 className="m-0 mb-1 text-xs font-medium text-text-tertiary">{GLOSSARY_GROUP_LABEL[group]}</h3>
                  <dl className="m-0">
                    {inGroup.map((entry) => (
                      <GlossaryRow key={entry.id} entry={entry} marked={entry.id === focus && !query} />
                    ))}
                  </dl>
                </section>
              )
            })
          )}
        </div>
      </DialogBody>
    </Dialog>
  )
}

function GlossaryRow({ entry, marked }: { entry: GlossaryEntry; marked: boolean }) {
  return (
    <div
      data-term={entry.id}
      className={cx(
        '-mx-2 grid grid-cols-[8rem_1fr] gap-x-4 rounded-md px-2 py-2 max-sm:grid-cols-1 max-sm:gap-y-0.5',
        marked && 'bg-surface-selected',
      )}
    >
      <dt className="text-sm font-medium text-text">{entry.term}</dt>
      <dd className="m-0 text-sm text-pretty text-text-secondary">
        {entry.definition}
        {entry.onceCalled && (
          <span className="mt-0.5 block text-xs text-text-tertiary">Once called: {entry.onceCalled.join(', ')}</span>
        )}
      </dd>
    </div>
  )
}

/**
 * Opens the Glossary from anywhere below the app's provider: a `Term` hint's
 * link, the help menu, the command menu. Outside a provider (a component test,
 * a preview island) the link is simply not shown.
 */
export const GlossaryContext = createContext<((focus?: GlossaryId) => void) | null>(null)

export function useOpenGlossary(): ((focus?: GlossaryId) => void) | null {
  return useContext(GlossaryContext)
}

/** Holds the dialog once, near the app's root, and hands its opener down. */
export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; focus?: GlossaryId }>({ open: false })
  return (
    <GlossaryContext.Provider value={(focus) => setState({ open: true, ...(focus ? { focus } : {}) })}>
      {children}
      <GlossaryDialog
        open={state.open}
        {...(state.focus ? { focus: state.focus } : {})}
        onClose={() => setState({ open: false })}
      />
    </GlossaryContext.Provider>
  )
}
