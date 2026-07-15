import { useState } from 'react'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { MODEL, SANDBOX_MODE } from '../../lib/env'
import { shortSha } from '../../lib/format'
import { DimLine, SectionTitle, TicketStatusChip } from '../../ui'

/**
 * Tickets phase-body for the pipeline-first workspace: a read-only ledger of the
 * feature's tickets (ordered by seq) with a compact meta line and sandbox/model
 * chips. Rows expand in place to reveal goal / context / acceptance / seams /
 * commits / error. Burning lives in the workspace next-step bar, not here — so
 * this body carries no burn actions.
 */
export function TicketsBody({
  featureId,
  readonly = false,
}: {
  featureId: string
  // Accepted for API symmetry with the other phase bodies; the ledger is
  // already read-only, so it changes nothing here.
  readonly?: boolean
}) {
  const toast = useToast()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  if (full.isLoading) return <DimLine>loading tickets…</DimLine>
  if (full.error || !full.data)
    return <DimLine>could not load tickets: {full.error?.message ?? 'unknown'}</DimLine>

  const tickets = full.data.tickets
  const total = tickets.length
  const done = tickets.filter((t) => t.status === 'done').length
  const failed = tickets.filter((t) => t.status === 'failed').length
  const burning = tickets.filter((t) => t.status === 'burning').length

  const metaParts = [`${done}/${total} done`]
  if (failed > 0) metaParts.push(`${failed} failed`)
  if (burning > 0) metaParts.push(`${burning} burning`)
  const meta = metaParts.join(' · ')

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const copySha = (sha: string) => {
    void navigator.clipboard.writeText(sha)
    toast.push(`copied ${shortSha(sha)}`, 'info')
  }

  return (
    <>
      <div className="body-title">
        <SectionTitle>Tickets</SectionTitle>
        <span className="body-meta">{meta}</span>
        <span style={{ flex: 1 }} />
        <span className="chip chip-neutral" title="sandbox">sandbox · {SANDBOX_MODE}</span>
        <span className="chip chip-neutral" title="model">{MODEL}</span>
      </div>

      {total === 0 ? (
        <DimLine>no tickets yet — a grill session emits them.</DimLine>
      ) : (
        <div className="ledger">
          {tickets.map((t) => {
            const isOpen = open.has(t.id)
            return (
              <div key={t.id} className={`ledger-row${isOpen ? ' is-open' : ''}`}>
                <button className="ledger-head" onClick={() => toggle(t.id)}>
                  <span className="lg-caret">▸</span>
                  <span className="lg-seq">#{t.seq}</span>
                  <span className="lg-title">{t.title}</span>
                  {t.blockedBy.length > 0 && (
                    <span className="lg-block">⊘ after {t.blockedBy.join(', ')}</span>
                  )}
                  <span className="lg-meta">
                    <TicketStatusChip status={t.status} />
                  </span>
                </button>

                {isOpen && (
                  <div className="ledger-detail">
                    <div className="td-section">
                      <div className="td-heading">GOAL</div>
                      <div className="td-body">{t.goal}</div>
                    </div>

                    {t.context && (
                      <div className="td-section">
                        <div className="td-heading">CONTEXT</div>
                        <div className="td-body">{t.context}</div>
                      </div>
                    )}

                    <div className="td-section">
                      <div className="td-heading">ACCEPTANCE</div>
                      <ul className="td-list">
                        {t.acceptanceCriteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="td-section">
                      <div className="td-heading">SEAMS</div>
                      <div className="td-seams">
                        {t.seams.map((s, i) => (
                          <span key={i} className="seam">{s}</span>
                        ))}
                      </div>
                    </div>

                    <div className="td-section">
                      <div className="td-heading">COMMITS</div>
                      {t.commits.length === 0 ? (
                        <div className="td-empty">no commits yet — the burn writes them</div>
                      ) : (
                        <div className="td-commits">
                          {t.commits.map((c) => (
                            <button
                              key={c}
                              className="commit-sha"
                              onClick={() => copySha(c)}
                              title="copy full sha"
                            >
                              {shortSha(c)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {t.status === 'failed' && t.error && (
                      <div className="td-section td-error">
                        <div className="td-heading">Error</div>
                        <div className="td-error-body">{t.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
