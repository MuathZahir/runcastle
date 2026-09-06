import { trpc } from '../trpc'
import { humanizeTimestamps } from '../lib/format'
import { BARE_BUTTON, Dialog, DimLine } from '../ui'
import { Markdown } from './Markdown'
import type { RefObject } from 'react'

/**
 * Read-only doc peek overlay (UI-SPEC §2 Knowledge). Renders a doc as formatted
 * markdown; Esc closes. No editing — knowledge is agent-authored.
 */
export function DocPeek({
  featureId,
  relPath,
  title,
  onClose,
  returnFocusRef,
}: {
  featureId: string
  relPath: string
  title: string
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const query = trpc.docs.read.useQuery({ featureId, relPath })

  return (
    <Dialog
      open
      onClose={onClose}
      label={title}
      size="lg"
      returnFocusRef={returnFocusRef}
      backdropClassName="animate-backdrop-in backdrop-blur-[2px]"
      // A doc is as long as it is: the panel takes the height it can and the
      // body below the head is the only part that scrolls.
      className="flex max-h-[82vh] animate-overlay-in flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
        <span className="font-mono text-sm text-text-2">{relPath}</span>
        <button
          className={`${BARE_BUTTON} cursor-pointer text-sm text-text-3 hover:text-text`}
          onClick={onClose}
          aria-label="Close (Esc)"
        >
          ✕
        </button>
      </div>
      <div className="overflow-auto px-4.5 py-3.5">
        {query.isLoading && <DimLine>loading {title}…</DimLine>}
        {query.error && <DimLine>could not read {relPath}: {query.error.message}</DimLine>}
        {/* Agents stamp docs the way a program does ("Created:
            2026-07-14T14:58:23.231Z"); nobody reads milliseconds (F10.9). */}
        {query.data && <Markdown source={humanizeTimestamps(query.data.content)} />}
      </div>
    </Dialog>
  )
}
