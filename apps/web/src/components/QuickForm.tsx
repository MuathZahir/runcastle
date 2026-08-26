import { useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { defaultBaseBranch, duplicateTitleWarning, slugPreview } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { BURN_EXPLAINER } from '../lib/vocabulary'
import { Button } from '../ui'
import { BaseSelect } from './BaseSelect'
import { FormOverlay } from './FormOverlay'

/**
 * The Quick door (decisions.md #12) — the one overlay for "I already know what
 * this is". Both of its modes skip the conversation, which is why they share a
 * door rather than adding a third button to the rail head:
 *
 * - **Quick change** — a title and a list of sentences, one ticket each. The
 *   feature is born straight at implementation carrying all of them: no grill,
 *   no spec, no terminal. Review the cards, click Burn.
 * - **Park a draft** — a title and an optional one-liner, and nothing else
 *   happens. No branch is cut and no session opens; the draft's screen carries
 *   the Start that cuts it later, and the base branch is chosen there.
 *
 * Anything that deserves a conversation goes through New instead, which opens a
 * fresh project chat.
 */

/** Which of the door's two modes is showing. */
type QuickMode = 'change' | 'draft'

export function QuickForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (featureId: string) => void
}) {
  const [mode, setMode] = useState<QuickMode>('change')
  const [title, setTitle] = useState('')
  // One entry per ticket, always at least one row — an empty list would leave
  // the mode with nothing to type in.
  const [tickets, setTickets] = useState<string[]>([''])
  const [oneLiner, setOneLiner] = useState('')
  const utils = trpc.useUtils()
  const toast = useToast()

  // A new row is only useful if the caret follows it, so adding one records
  // which row to focus and the effect below does it after the render that
  // created the textarea.
  const rowRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const [focusRow, setFocusRow] = useState<number | null>(null)
  useEffect(() => {
    if (focusRow === null) return
    rowRefs.current[focusRow]?.focus()
    setFocusRow(null)
  }, [focusRow])

  // Quick change cuts its branch now, so it shows the base it will use and
  // prefills it with the same default the rest of the app does — the branch you
  // are checked out on (decision 8). This mode used to cut silently off that
  // default with no control at all. A draft cuts nothing and picks its base at
  // Start, so it never waits on this.
  const branchesQ = trpc.project.branches.useQuery({ projectId })
  const [basePick, setBasePick] = useState('')
  const base = basePick || (branchesQ.data ? defaultBaseBranch(branchesQ.data) : '')

  // Same query key the rail polls — one fetch, and the warning is against the
  // list the user can already see, including a feature created in another tab
  // while this form sat open.
  const featuresQ = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // One title field, two modes that both cut a feature off its slug — so the
  // warning belongs to the field, not to either mode.
  const duplicate = duplicateTitleWarning(title, featuresQ.data ?? [])

  const landed = async (featureId: string) => {
    await utils.feature.list.invalidate()
    onCreated(featureId)
  }
  const quickChange = trpc.feature.quickChange.useMutation({
    onSuccess: (feature) => void landed(feature.id),
    onError: (e) => toast.push(e.message),
  })
  const create = trpc.feature.create.useMutation({
    onSuccess: (feature) => void landed(feature.id),
    onError: (e) => toast.push(e.message),
  })

  const slug = slugPreview(title)
  const busy = quickChange.isPending || create.isPending
  const written = tickets.map((t) => t.trim()).filter((t) => t !== '')
  const dirty = title.trim() !== '' || oneLiner.trim() !== '' || written.length > 0
  // An empty base blocks quick change outright: the branch list may still be in
  // flight, or it arrived and the checkout is not a base anything can fork from
  // — either way there is nothing to cut off, and guessing one is the behaviour
  // this control exists to end. Park has no base to be missing.
  const ready =
    mode === 'change' ? !!title.trim() && written.length > 0 && base !== '' : !!title.trim()

  const submit = () => {
    if (!ready || busy) return
    if (mode === 'change') {
      quickChange.mutate({
        projectId,
        title: title.trim(),
        // Blank rows are dropped server-side too; sending only what was written
        // keeps the wire honest about how many tickets this is.
        tickets: written,
        baseBranch: base,
      })
    } else {
      // No base on the park path (decisions.md #12): a draft can sit for weeks,
      // so its base is chosen and resolved at Start, not now.
      create.mutate({ projectId, title: title.trim(), oneLiner: oneLiner.trim(), draft: true })
    }
  }

  const editRow = (i: number, value: string) =>
    setTickets((rows) => rows.map((r, j) => (j === i ? value : r)))
  const addRow = (after: number) => {
    setTickets((rows) => [...rows.slice(0, after + 1), '', ...rows.slice(after + 1)])
    setFocusRow(after + 1)
  }
  // The last row is emptied rather than dropped — the mode always has somewhere
  // to type.
  const removeRow = (i: number) => {
    setTickets((rows) => (rows.length === 1 ? [''] : rows.filter((_, j) => j !== i)))
    setFocusRow(Math.max(0, i - 1))
  }

  return (
    <FormOverlay dirty={dirty} onDismiss={onCancel}>
      {(dismiss) => (
        <>
          <div className="nf-kick">QUICK</div>

          <div className="qf-modes" role="tablist" aria-label="Quick door mode">
            <button
              role="tab"
              aria-selected={mode === 'change'}
              className={`qf-mode${mode === 'change' ? ' is-active' : ''}`}
              onClick={() => setMode('change')}
            >
              Quick change
            </button>
            <button
              role="tab"
              aria-selected={mode === 'draft'}
              className={`qf-mode${mode === 'draft' ? ' is-active' : ''}`}
              onClick={() => setMode('draft')}
            >
              Park a draft
            </button>
          </div>

          <div className="nf-h">
            {mode === 'change' ? 'What needs changing?' : 'Park it for later'}
          </div>
          <div className="nf-sub">
            {mode === 'change' ? (
              <>
                Too small for a conversation. Write each change as its own sentence — every one
                becomes a ticket you review, then burn. {BURN_EXPLAINER} No grill session (the Q&amp;A
                that shapes a bigger idea), no spec.
              </>
            ) : (
              <>
                An idea worth writing down is not always one you want to start now. A draft is a row
                and nothing else — no branch, no session, nothing written to the repo until you
                start it, which is where it picks the branch to fork from.
              </>
            )}
          </div>
          {/* The form used to say nothing about this, and users reasonably
              expected the ticket to attach to whichever feature was selected
              (findings F25.5). It does not — it is its own feature. */}
          {mode === 'change' && (
            <div className="nf-sub">
              This creates its own feature and its own branch, beside the ones you already have — it
              does not attach to the feature currently selected.
            </div>
          )}

          <input
            className="nf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              mode === 'change' ? 'e.g. Darker empty state' : 'e.g. Slack alerts on failed runs'
            }
            autoFocus
            onKeyDown={(e) => {
              // In the ticket list Enter belongs to the list; here it only
              // submits the park form, which has nothing else to move to.
              if (e.key === 'Enter' && mode === 'draft') submit()
            }}
          />
          {/* A warning, not a block: a second run at the same idea is legitimate,
              and the server suffixes the slug either way (findings F25.3). */}
          {duplicate && (
            <div className="nf-dupe" role="status">
              {duplicate}
            </div>
          )}

          {mode === 'change' ? (
            <>
              <div className="qf-tickets">
                {tickets.map((row, i) => (
                  <div className="qf-ticket" key={i}>
                    <span className="qf-ticket-num">{i + 1}</span>
                    <textarea
                      className="nf-input nf-textarea qf-ticket-text"
                      ref={(el) => {
                        rowRefs.current[i] = el
                      }}
                      value={row}
                      onChange={(e) => editRow(i, e.target.value)}
                      placeholder={
                        i === 0
                          ? 'One change, in your own words — this becomes the ticket, verbatim.\ne.g. "the run chip stays grey after a cancelled run; expected amber"'
                          : 'Another change…'
                      }
                      onKeyDown={(e) => {
                        // ⌘/Ctrl-Enter submits, Enter starts the next ticket,
                        // shift-Enter is the newline inside one (this is prose).
                        if (e.key !== 'Enter') return
                        if (e.metaKey || e.ctrlKey) {
                          e.preventDefault()
                          submit()
                        } else if (!e.shiftKey) {
                          e.preventDefault()
                          addRow(i)
                        }
                      }}
                    />
                    {tickets.length > 1 && (
                      <button
                        className="qf-ticket-remove"
                        onClick={() => removeRow(i)}
                        title="Remove this ticket"
                        aria-label={`Remove ticket ${i + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button className="qf-add" onClick={() => addRow(tickets.length - 1)}>
                + Add another ticket
              </button>

              <BaseSelect
                id="quick-base-select"
                label="Branch from"
                branches={branchesQ.data}
                value={base}
                onPick={setBasePick}
                hint="This feature forks off here — and merges back into it when shipped."
              />

              {/* The review ticket is named here because the server appends one
                  to every quick change (decisions.md #9) — without it the
                  footer would promise N cards and the ledger would show N+1. */}
              <div className="nf-branch">
                branch · feature/{slug || '…'} ← {base || '…'} · starts at build with{' '}
                {written.length || 1} ticket{(written.length || 1) === 1 ? '' : 's'} + a review
              </div>
            </>
          ) : (
            <input
              className="nf-input nf-oneliner"
              value={oneLiner}
              onChange={(e) => setOneLiner(e.target.value)}
              placeholder="one-liner (optional) — what & why in a sentence"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          )}

          <div className="nf-actions">
            <Button variant="ghost" onClick={dismiss} disabled={busy}>
              Cancel
            </Button>
            <Button variant="solid" onClick={submit} disabled={!ready || busy}>
              {mode === 'change'
                ? busy
                  ? 'Creating…'
                  : `Create ticket${written.length > 1 ? 's' : ''}`
                : busy
                  ? 'Parking…'
                  : 'Park it'}
            </Button>
          </div>
        </>
      )}
    </FormOverlay>
  )
}
