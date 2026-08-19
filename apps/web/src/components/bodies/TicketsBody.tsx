import { useState } from 'react'
import type { ModelEntry, Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { SANDBOX_MODE } from '../../lib/env'
import { BURN_EXPLAINER } from '../../lib/vocabulary'
import { shortSha } from '../../lib/format'
import { useLivePoll } from '../../lib/live'
import { effectiveStepModel, modelOptionGroups, rosterFromView } from '../../lib/settings'
import type { SettingsView } from '../../lib/api'
import { groupByLap, ticketModelChip } from '../../lib/feature-ui'
import {
  Button,
  DimLine,
  EmptyState,
  LapSections,
  SectionTitle,
  TicketKindChip,
  TicketStatusChip,
} from '../../ui'
import { IconChevronRight, IconDoc } from '../../icons'
import { Markdown } from '../Markdown'
import { SessionPanel } from '../SessionPanel'

/**
 * Tickets phase-body for the pipeline-first workspace: the session panel (the
 * emit-tickets grill this phase starts on, live as an inline terminal or ended
 * with a Resume), then a read-only ledger of the feature's tickets (ordered by
 * seq) with a compact meta line and sandbox/model chips. Rows expand in place
 * to reveal goal / context / acceptance / seams / commits / digest / error.
 * Burning lives in the workspace next-step bar, not here — so this body carries
 * no burn actions.
 *
 * A pending or failed row's detail can also be edited in place (title / goal /
 * context / acceptance), which is what makes the quick-change door's promise
 * true: correct the card before Burn without opening a terminal to do it. The
 * server refuses every other status, so no other row offers the affordance.
 */
export function TicketsBody({
  featureId,
  readonly = false,
}: {
  featureId: string
  /**
   * Looking back at a phase the feature has already left. The ledger itself is
   * read-only either way; what this suppresses is the session panel's offer to
   * reopen a conversation from a phase that is over (findings F10.6).
   */
  readonly?: boolean
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: useLivePoll() })
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  // The ticket currently being edited in place, or null. One at a time — the
  // ledger is a review surface, not a spreadsheet.
  const [editing, setEditing] = useState<string | null>(null)

  const edit = trpc.ticket.edit.useMutation({
    onSuccess: () => {
      setEditing(null)
      void utils.feature.get.invalidate({ id: featureId })
      toast.push('ticket updated', 'success')
    },
    onError: (e) => toast.push(e.message),
  })

  // The burn model chip reflects what the ticket-burner (the `implement` step)
  // will use for this project — read from settings, never a hardcoded constant
  // (issue #48). The project's own model wins, else the global step model, else
  // the default.
  const projectId = full.data?.feature.projectId
  const settings = trpc.settings.get.useQuery(
    { projectId: projectId as string },
    { enabled: !!projectId },
  )
  // `useQuery().data` infers to `{}` here (the same tRPC-in-component typing gap
  // the settings overlay documents); the runtime value is a SettingsView.
  const model = effectiveStepModel(settings.data as SettingsView | undefined, 'implement') ?? '…'
  // Every model the operator has configured — what a per-ticket assignment may
  // be changed to, and where each id's runtime is declared (decisions.md #3).
  const roster = rosterFromView(settings.data as SettingsView | undefined)

  if (full.isLoading) return <DimLine>loading tickets…</DimLine>
  // Hard error only when there was NEVER data. A refetch failure after data
  // exists (server restart) keeps rendering the last-good ledger so the inline
  // terminal stays mounted — the workspace-level OFFLINE banner tells the story.
  if (!full.data)
    return <DimLine>could not load tickets: {full.error?.message ?? 'unknown'}</DimLine>

  const tickets = full.data.tickets
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

  // One ledger row, named rather than inlined: the lap grouping below renders
  // rows per lap, and this is the same row whichever lap it sits under.
  const ticketRow = (t: Ticket) => {
    const isOpen = open.has(t.id)
    const assigned = ticketModelChip(t, roster)
    return (
      <div key={t.id} className={`ledger-row${isOpen ? ' is-open' : ''}`}>
        <button className="ledger-head" onClick={() => toggle(t.id)}>
          <span className="lg-caret">
            <IconChevronRight size={11} />
          </span>
          <span className="lg-seq">#{t.seq}</span>
          <span className="lg-title">{t.title}</span>
          <TicketKindChip kind={t.kind} />
          {t.blockedBy.length > 0 && (
            <span className="lg-block" title="Runs after these tickets land">
              after #{t.blockedBy.join(', #')}
            </span>
          )}
          <span className="lg-meta">
            {/* Only an ASSIGNED ticket says anything: an unassigned one burns on
                the model the ledger's own chip already names. */}
            {assigned && (
              <span
                className="chip chip-neutral"
                title={`Burns on ${assigned.id} (${assigned.runtimeLabel})`}
              >
                {assigned.id} · {assigned.runtimeLabel}
              </span>
            )}
            <TicketStatusChip status={t.status} />
          </span>
        </button>

        {isOpen && editing === t.id && (
          <TicketEditor
            ticket={t}
            roster={roster}
            busy={edit.isPending}
            onCancel={() => setEditing(null)}
            onSave={(patch) => edit.mutate({ ticketId: t.id, ...patch })}
          />
        )}

        {isOpen && editing !== t.id && (
          <div className="ledger-detail">
            {!readonly && EDITABLE_STATUSES.has(t.status) && (
              <button className="td-edit-open" onClick={() => setEditing(t.id)}>
                Edit ticket
              </button>
            )}
            <div className="td-section">
              <div className="td-heading">GOAL</div>
              <div className="td-body"><Markdown source={t.goal} /></div>
            </div>

            {t.context && (
              <div className="td-section">
                <div className="td-heading">CONTEXT</div>
                <div className="td-body"><Markdown source={t.context} /></div>
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

            {/* The burner's own account of the burn — present on done
                tickets whose agent wrote one, absent everywhere else. */}
            {t.digest && (
              <div className="td-section">
                <div className="td-heading">DIGEST</div>
                <div className="td-body"><Markdown source={t.digest} /></div>
              </div>
            )}

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
  }

  return (
    <>
      <SessionPanel
        featureId={featureId}
        sessions={full.data.sessions}
        className="tickets-session"
        showResume={!readonly}
      />

      <div className="body-title">
        <SectionTitle>Tickets</SectionTitle>
        <span className="body-meta">{meta}</span>
        <span style={{ flex: 1 }} />
        <span className="chip chip-neutral" title="sandbox">sandbox · {SANDBOX_MODE}</span>
        <span className="chip chip-neutral" title="model">{model}</span>
      </div>
      {/* The bar above this ledger says "review, then burn" without ever saying
          what burning does with them (finding F12/F16). */}
      <div className="body-hint">{BURN_EXPLAINER}</div>

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
          {/* Grouped by lap (decisions.md #6): the ledger IS where the human
              looks for "what was done this lap", so the lap it was done on is a
              header here rather than a view of its own. */}
          <LapSections
            groups={groupByLap(tickets, full.data.feature.lap)}
            currentLap={full.data.feature.lap}
            meta={(g) =>
              `${g.rows.filter((t) => t.status === 'done').length}/${g.rows.length} done`
            }
          >
            {(rows) => rows.map(ticketRow)}
          </LapSections>
        </div>
      )}
    </>
  )
}

/**
 * Statuses whose content the server will still accept a rewrite for — the same
 * pair `editTicket` enforces (`burning` is already running; `done`/`cancelled`
 * are history). Mirrored here so the button never offers a certain error.
 */
const EDITABLE_STATUSES = new Set(['pending', 'failed'])

interface TicketPatch {
  title: string
  goal: string
  context: string
  acceptanceCriteria: string[]
  /** The assigned model id, or `''` to clear it back to the default chain. */
  model: string
}

/**
 * In-place editor for one pending/failed ticket. Seams are left alone: they are
 * the burner's map of the codebase, written by a session that read it, and the
 * ledger is not where a human re-derives them.
 *
 * The model IS editable here, and only here: the ticket session's assignment
 * (decisions.md #4) is a suggestion the human overrules before Burn, and the
 * same status guard that gates content edits is what makes "pre-burn" true —
 * a burning ticket's agent has already launched on whatever model it had.
 */
function TicketEditor({
  ticket,
  roster,
  busy,
  onCancel,
  onSave,
}: {
  ticket: Ticket
  roster: readonly ModelEntry[]
  busy: boolean
  onCancel: () => void
  onSave: (patch: TicketPatch) => void
}) {
  const [title, setTitle] = useState(ticket.title)
  const [goal, setGoal] = useState(ticket.goal)
  const [context, setContext] = useState(ticket.context)
  // One criterion per line — the same shape the human reads them in.
  const [criteria, setCriteria] = useState(ticket.acceptanceCriteria.join('\n'))
  const [model, setModel] = useState(ticket.model ?? '')

  const lines = criteria
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean)
  const ready = !!title.trim() && !!goal.trim() && lines.length > 0

  return (
    <div className="ledger-detail td-edit">
      <label className="td-section">
        <div className="td-heading">TITLE</div>
        <input className="td-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="td-section">
        <div className="td-heading">GOAL</div>
        <textarea className="td-input td-area" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>

      <label className="td-section">
        <div className="td-heading">CONTEXT</div>
        <textarea
          className="td-input td-area"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
      </label>

      <label className="td-section">
        <div className="td-heading">ACCEPTANCE — one per line</div>
        <textarea
          className="td-input td-area"
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
        />
      </label>

      <label className="td-section">
        <div className="td-heading">MODEL</div>
        <select className="td-input" value={model} onChange={(e) => setModel(e.target.value)}>
          {/* Clearing the assignment is the first option, because unassigned is
              the ordinary state — the burn then resolves its model as usual. */}
          <option value="">default (project model)</option>
          {modelOptionGroups(roster).map((g) => (
            <optgroup key={g.runtime} label={g.label}>
              {g.entries.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.note ? `${m.id} — ${m.note}` : m.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="td-edit-actions">
        <Button variant="ghost" className="btn-xs" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="solid"
          className="btn-xs"
          disabled={!ready || busy}
          onClick={() =>
            onSave({
              title: title.trim(),
              goal: goal.trim(),
              context: context.trim(),
              acceptanceCriteria: lines,
              model,
            })
          }
        >
          {busy ? 'Saving…' : 'Save ticket'}
        </Button>
      </div>
    </div>
  )
}
