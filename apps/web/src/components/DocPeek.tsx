import type { RefObject } from 'react'
import { trpc } from '../trpc'
import { humanizeTimestamps } from '../lib/format'
import { IconDoc, IconX } from '../icons'
import { Dialog, DimLine, IconButton } from '../ui'
import { Markdown } from './Markdown'

/**
 * Read-only doc peek (UI-SPEC §2 Knowledge): a clean reading surface. A quiet
 * header — the doc's title and its path in mono — then the doc as prose at the
 * reading measure, the only part that scrolls. Esc closes. No editing —
 * knowledge is agent-authored.
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
      labelledBy="doc-peek-title"
      size="lg"
      returnFocusRef={returnFocusRef}
      // A doc is as long as it is: the panel takes the height it can and the
      // body below the head is the only part that scrolls.
      className="flex max-h-[84vh] flex-col overflow-hidden"
    >
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
        <IconDoc size={16} className="shrink-0 text-icon" />
        <h2 id="doc-peek-title" className="m-0 min-w-0 truncate text-sm font-medium text-text">
          {title || relPath.split(/[\\/]/).pop()}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-tertiary" title={relPath}>
          {relPath}
        </span>
        <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} />
      </div>
      <div className="min-h-0 overflow-y-auto px-10 pt-8 pb-12">
        <div className="mx-auto max-w-[680px]">
          {query.isLoading && <DimLine>Loading {title}…</DimLine>}
          {query.error && (
            <DimLine>
              Could not read {relPath}: {query.error.message}
            </DimLine>
          )}
          {/* Agents stamp docs the way a program does ("Created:
              2026-07-14T14:58:23.231Z"); nobody reads milliseconds (F10.9). */}
          {query.data && <Markdown source={humanizeTimestamps(query.data.content)} size="base" />}
        </div>
      </div>
    </Dialog>
  )
}
