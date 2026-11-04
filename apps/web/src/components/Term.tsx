import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { BARE_BUTTON, LINK, cx } from '../ui'
import { glossaryEntry, type GlossaryId } from '../lib/glossary'
import { useOpenGlossary } from './GlossaryDialog'

/** How long the pointer rests on a term before its sentence shows. */
const HOVER_MS = 350

/**
 * A runcastle word where a newcomer first meets it (ready-to-publish decision
 * 17): a dotted underline, and on hover, focus, click or tap its one glossary
 * sentence with a link that opens the Glossary at that word. Only the fixed
 * first-meeting places use it; every other mention is plain text.
 *
 * A popover, not a tooltip: it holds a link, and a tooltip is a label with
 * nothing interactive in it. Tapping works on a phone, which has no hover.
 */
export function Term({ id, children }: { id: GlossaryId; children?: ReactNode }) {
  const entry = glossaryEntry(id)
  const openGlossary = useOpenGlossary()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const later = (next: boolean) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), next ? HOVER_MS : 150)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cx(
            BARE_BUTTON,
            'inline cursor-help rounded-sm p-0 align-baseline font-[inherit] text-[length:inherit] text-inherit',
            'underline decoration-text-tertiary decoration-dotted decoration-1 underline-offset-[3px]',
            'hover:decoration-text-secondary focus-visible:decoration-text-secondary',
          )}
          onPointerEnter={(e) => e.pointerType === 'mouse' && later(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && later(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => later(false)}
        >
          {children ?? entry.term.toLowerCase()}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        className="max-w-72 p-3"
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && later(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="m-0 text-sm text-pretty text-text">
          <span className="font-medium">{entry.term}.</span>{' '}
          <span className="text-text-secondary">{entry.definition}</span>
        </p>
        {openGlossary && (
          <button
            type="button"
            className={cx(BARE_BUTTON, LINK, 'mt-2 text-xs')}
            onClick={() => {
              setOpen(false)
              openGlossary(id)
            }}
          >
            Open the glossary
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
