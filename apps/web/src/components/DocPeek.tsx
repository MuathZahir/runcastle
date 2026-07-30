import { useEffect } from 'react'
import { trpc } from '../trpc'
import { humanizeTimestamps } from '../lib/format'
import { DimLine } from '../ui'
import { Markdown } from './Markdown'

/**
 * Read-only doc peek overlay (UI-SPEC §2 Knowledge). Renders a doc as formatted
 * markdown; Esc closes. No editing — knowledge is agent-authored.
 */
export function DocPeek({
  featureId,
  relPath,
  title,
  onClose,
}: {
  featureId: string
  relPath: string
  title: string
  onClose: () => void
}) {
  const query = trpc.docs.read.useQuery({ featureId, relPath })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="peek-backdrop" onClick={onClose}>
      <div className="peek" onClick={(e) => e.stopPropagation()}>
        <div className="peek-head">
          <span className="mono peek-path">{relPath}</span>
          <button className="peek-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="peek-body">
          {query.isLoading && <DimLine>loading {title}…</DimLine>}
          {query.error && <DimLine>could not read {relPath}: {query.error.message}</DimLine>}
          {/* Agents stamp docs the way a program does ("Created:
              2026-07-14T14:58:23.231Z"); nobody reads milliseconds (F10.9). */}
          {query.data && <Markdown source={humanizeTimestamps(query.data.content)} />}
        </div>
      </div>
    </div>
  )
}
