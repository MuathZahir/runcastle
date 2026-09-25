import { useState, type ReactNode } from 'react'
import type { ModelEntry, Ticket } from '@runcastle/core'
import { shortSha } from '../../../lib/format'
import { ticketModelChip } from '../../../lib/feature-ui'
import { Button, TicketKindChip, TicketStatusChip, cx } from '../../../ui'
import { IconChevronRight, IconPencil, IconX } from '../../../icons'
import { Markdown } from '../../Markdown'
import { MessageWithSettingsLink } from '../../settings/MessageWithSettingsLink'
import { ModelMenu } from './ModelMenu'
import { TicketEditor, type TicketPatch } from './TicketEditor'

const EDITABLE_STATUSES = new Set(['pending', 'failed'])

/** One part of an opened ticket: a quiet 12px heading, then its content. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="m-0 text-xs font-medium text-text-tertiary">{title}</h4>
      {children}
    </section>
  )
}

/**
 * One ticket in the ledger, as a 40px list row (the `ListRow` look, built
 * here because its trailing model menu is a control of its own and cannot sit
 * inside the row's button): chevron, `#seq`, the title, its kind, what it
 * waits on — then the model, quiet, and the status as the trailing word.
 * Opened, it reads as a short document: goal, context, acceptance, seams,
 * commits, digest.
 */
export function TicketRow({
  ticket,
  roster,
  readonly,
  onEdit,
  onModel,
  onCancel,
  onCopySha,
}: {
  ticket: Ticket
  roster: readonly ModelEntry[]
  readonly: boolean
  /** Absent in a frozen record — a pinned row mutates nothing (decision 10). */
  onEdit?: (ticketId: string, patch: TicketPatch) => Promise<void>
  onModel?: (ticketId: string, model: string) => void
  onCancel?: (ticketId: string) => void
  onCopySha?: (sha: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const editable = EDITABLE_STATUSES.has(ticket.status)
  const assigned = ticketModelChip(ticket, roster)
  const cancelled = ticket.status === 'cancelled'

  return (
    <article data-list-row="" className="group/row">
      <div
        className={cx(
          'flex min-h-10 min-w-0 items-center gap-3 rounded-md pr-2 transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
          open && 'bg-surface-hover/50',
        )}
      >
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ticket #${ticket.seq}`}
          aria-expanded={open}
          className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md bg-transparent pl-3 text-left text-sm text-text"
          onClick={() => setOpen((value) => !value)}
        >
          <IconChevronRight
            size={12}
            className={cx(
              'shrink-0 text-icon transition-transform duration-(--dur-2) ease-app',
              open && 'rotate-90',
            )}
          />
          <span className="w-7 shrink-0 text-xs text-text-tertiary tabular-nums">#{ticket.seq}</span>
          <span className={cx('min-w-0 truncate', cancelled ? 'text-text-tertiary line-through' : 'text-text')}>
            {ticket.title}
          </span>
          <TicketKindChip kind={ticket.kind} />
          {ticket.blockedBy.length > 0 && (
            <span className="shrink-0 text-xs text-text-tertiary" title="Runs after these tickets land">
              after #{ticket.blockedBy.join(', #')}
            </span>
          )}
        </button>
        {editable && !readonly && onModel ? (
          <ModelMenu value={ticket.model ?? ''} roster={roster} onChange={(model) => onModel(ticket.id, model)} />
        ) : (
          assigned && (
            <span className="max-w-56 shrink truncate font-mono text-xs text-text-tertiary">
              {assigned.id} · {assigned.runtimeLabel}
            </span>
          )
        )}
        <span className="flex w-22 shrink-0 justify-end">
          <TicketStatusChip status={ticket.status} />
        </span>
      </div>

      {open && editing && onEdit && (
        <TicketEditor
          ticket={ticket}
          busy={saving}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            setSaving(true)
            void onEdit(ticket.id, patch)
              .then(
                () => setEditing(false),
                () => undefined,
              )
              .finally(() => setSaving(false))
          }}
        />
      )}

      {open && !editing && (
        <div className="flex flex-col gap-4 pt-2 pr-3 pb-5 pl-[3.75rem] animate-fade-in">
          {!readonly &&
            editable &&
            onEdit &&
            onCancel &&
            (confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger-subtle px-3 py-2 text-sm text-text-secondary">
                <span className="mr-auto">
                  Cancel #{ticket.seq}? Tickets that depend on it treat it as done. Its text stays in the ledger.
                </span>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button size="sm" variant="danger" onClick={() => onCancel(ticket.id)}>
                  Cancel ticket
                </Button>
              </div>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<IconPencil />} onClick={() => setEditing(true)}>
                  Edit ticket
                </Button>
                <Button size="sm" variant="ghost" icon={<IconX />} onClick={() => setConfirming(true)}>
                  Cancel ticket
                </Button>
              </div>
            ))}
          <Part title="Goal">
            <Markdown source={ticket.goal} />
          </Part>
          {ticket.context && (
            <Part title="Context">
              <Markdown source={ticket.context} />
            </Part>
          )}
          <Part title="Acceptance">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary marker:text-text-tertiary">
              {ticket.acceptanceCriteria.map((criterion, index) => (
                <li key={index}>{criterion}</li>
              ))}
            </ul>
          </Part>
          {ticket.seams.length > 0 && (
            <Part title="Seams">
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-text-secondary">
                {ticket.seams.map((seam, index) => (
                  <span key={index}>{seam}</span>
                ))}
              </div>
            </Part>
          )}
          <Part title="Commits">
            {ticket.commits.length === 0 ? (
              <span className="text-xs text-text-tertiary">No commits yet — the burn writes them</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {ticket.commits.map((sha) =>
                  onCopySha ? (
                    <button
                      key={sha}
                      type="button"
                      title="Copy the full SHA"
                      className="cursor-pointer rounded-sm bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-text-secondary transition-colors duration-(--dur-1) hover:text-text"
                      onClick={() => onCopySha(sha)}
                    >
                      {shortSha(sha)}
                    </button>
                  ) : (
                    <span key={sha} className="rounded-sm bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                      {shortSha(sha)}
                    </span>
                  ),
                )}
              </div>
            )}
          </Part>
          {ticket.digest && (
            <Part title="Digest">
              <Markdown source={ticket.digest} />
            </Part>
          )}
          {ticket.status === 'failed' && ticket.error && (
            <div className="rounded-md bg-danger-subtle px-3 py-2 text-sm">
              <div className="mb-1 text-xs font-medium text-danger">Error</div>
              <MessageWithSettingsLink text={ticket.error} />
            </div>
          )}
          {cancelled && ticket.error && (
            <Part title="Cancelled">
              <MessageWithSettingsLink text={ticket.error} />
            </Part>
          )}
        </div>
      )}
    </article>
  )
}
