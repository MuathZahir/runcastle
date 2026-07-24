import { useState } from 'react'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { SANDBOX_MODE } from '../../lib/env'
import { shortSha } from '../../lib/format'
import { DimLine, EmptyState, SectionTitle, SessionStatusDot, TicketStatusChip } from '../../ui'
import { IconChevronRight, IconDoc } from '../../icons'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * Tickets phase-body for the pipeline-first workspace: the live session (when
 * one is running — e.g. the emit-tickets grill this phase starts on) as an
 * inline terminal, then a read-only ledger of the feature's tickets (ordered by
 * seq) with a compact meta line and sandbox/model chips. Rows expand in place
 * to reveal goal / context / acceptance / seams / commits / error. Burning
 * lives in the workspace next-step bar, not here — so this body carries no burn
 * actions.
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

  // The burn model chip reflects what the ticket-burner (the `implement` step)
  // will use for this project — read from settings, never a hardcoded constant
  // (issue #48). The step override wins, else the project/global default.
  const projectId = full.data?.feature.projectId
  const settings = trpc.settings.get.useQuery(
    { projectId: projectId as string },
    { enabled: !!projectId },
  )
  const implementField =
    settings.data?.fields.find((f) => f.key === 'stepModels.implement' && f.source === 'file') ??
    settings.data?.fields.find((f) => f.key === 'model')
  const model = typeof implementField?.value === 'string' ? implementField.value : '…'

  if (full.isLoading) return <DimLine>loading tickets…</DimLine>
  // Hard error only when there was NEVER data. A refetch failure after data
  // exists (server restart) keeps rendering the last-good ledger so the inline
  // terminal stays mounted — the workspace-level OFFLINE banner tells the story.
  if (!full.data)
    return <DimLine>could not load tickets: {full.error?.message ?? 'unknown'}</DimLine>

  const tickets = full.data.tickets
  // Same pattern as GrillBody: an active session renders as an inline terminal.
  // Without it the emit-tickets grill runs invisibly and the next-step bar's
  // "Open grill to emit tickets" lands on a body with no terminal.
  const session = [...full.data.sessions]
    .reverse()
    .find((s) => s.status === 'live' || s.status === 'launching')
  const total = tickets.length
  const done = tickets.filter((t) => t.status === 'done').length
  const failed = tickets.filter((t) => t.status === 'failed').length
  const burning = tickets.filter((t) => t.status === 'burning').length
  const cancelled = tickets.filter((t) => t.status === 'cancelled').length

  const metaParts = [`${done}/${total} done`]
  if (failed > 0) metaParts.push(`${failed} failed`)
  if (burning > 0) metaParts.push(`${burning} burning`)
  if (cancelled > 0) metaParts.push(`${cancelled} cancelled`)
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
      {session && (
        <div className="grill-panel tickets-session">
          <div className="grill-strip">
            <span className="grill-kind">{session.kind}</span>
            <SessionStatusDot status={session.status} />
            <span className="grill-live-label">
              {session.status === 'launching' ? 'launching…' : 'live'}
            </span>
            <span className="grill-strip-spacer" />
            <span className="grill-sid" title={session.ccSessionId ?? session.id}>
              {(session.ccSessionId ?? session.id).slice(0, 8)}
            </span>
            <EndSessionButton featureId={featureId} sessionId={session.id} />
          </div>
          <div className="grill-term" id="grill-term">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={session.id} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      <div className="body-title">
        <SectionTitle>Tickets</SectionTitle>
        <span className="body-meta">{meta}</span>
        <span style={{ flex: 1 }} />
        <span className="chip chip-neutral" title="sandbox">sandbox · {SANDBOX_MODE}</span>
        <span className="chip chip-neutral" title="model">{model}</span>
      </div>

      {total === 0 ? (
        <div className="ledger">
          <EmptyState
            icon={<IconDoc size={16} />}
            title="No tickets yet"
            hint="A session breaks the spec into atomic, reviewable tickets — start one from the bar above."
            compact
          />
        </div>
      ) : (
        <div className="ledger">
          {tickets.map((t) => {
            const isOpen = open.has(t.id)
            return (
              <div key={t.id} className={`ledger-row${isOpen ? ' is-open' : ''}`}>
                <button className="ledger-head" onClick={() => toggle(t.id)}>
                  <span className="lg-caret">
                    <IconChevronRight size={11} />
                  </span>
                  <span className="lg-seq">#{t.seq}</span>
                  <span className="lg-title">{t.title}</span>
                  {t.blockedBy.length > 0 && (
                    <span className="lg-block" title="Runs after these tickets land">
                      after #{t.blockedBy.join(', #')}
                    </span>
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

                    {t.status === 'cancelled' && t.error && (
                      <div className="td-section">
                        <div className="td-heading">Cancelled</div>
                        <div className="td-body">{t.error}</div>
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
