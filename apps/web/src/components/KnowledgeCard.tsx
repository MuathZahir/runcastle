import { useState } from 'react'
import { trpc } from '../trpc'
import { Modal } from '../ui'

interface DocSummary {
  relPath: string
  title: string
}

export function KnowledgeCard({
  featureId,
  docs,
}: {
  featureId: string
  docs: DocSummary[]
}) {
  const [selected, setSelected] = useState<string | null>(null)

  const docQuery = trpc.docs.read.useQuery(
    { featureId, relPath: selected ?? '' },
    { enabled: selected !== null },
  )

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="section-title">Knowledge</h2>
      </div>
      <div className="card-body">
        {docs.length === 0 ? (
          <p className="muted">No docs yet.</p>
        ) : (
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.relPath}>
                <button
                  className="link-btn"
                  onClick={() => setSelected(d.relPath)}
                >
                  <span className="mono">{d.relPath}</span>
                  <span className="muted"> — {d.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected !== null && (
        <Modal title={selected} wide onClose={() => setSelected(null)}>
          {docQuery.isLoading && <p className="muted">Loading…</p>}
          {docQuery.error && (
            <p className="banner-error">{docQuery.error.message}</p>
          )}
          {docQuery.data && (
            <pre className="doc-content">{docQuery.data.content}</pre>
          )}
        </Modal>
      )}
    </div>
  )
}
