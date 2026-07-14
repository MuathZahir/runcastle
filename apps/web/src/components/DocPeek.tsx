import { useEffect } from 'react'
import { trpc } from '../trpc'
import { DimLine } from '../ui'

/**
 * Read-only doc peek overlay (UI-SPEC §2 Knowledge). Renders a doc's raw
 * markdown in mono; Esc closes. No editing — knowledge is agent-authored.
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
        <div className="peek-body mono">
          {query.isLoading && <DimLine>loading {title}…</DimLine>}
          {query.error && <DimLine>could not read {relPath}: {query.error.message}</DimLine>}
          {query.data && <pre className="peek-pre">{query.data.content}</pre>}
        </div>
      </div>
    </div>
  )
}
