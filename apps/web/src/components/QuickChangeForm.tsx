import { useState } from 'react'
import { trpc } from '../trpc'
import { defaultBaseBranch, slugPreview } from '../lib/feature-ui'
import { useToast } from '../lib/toast'
import { BURN_EXPLAINER, lapExplainer } from '../lib/vocabulary'
import { Button } from '../ui'
import { FormOverlay } from './FormOverlay'

/**
 * The quick-change door (decision 21) — the second entrance beside New Feature,
 * for a tweak too small to deserve a conversation. One title, one prose field,
 * and the feature is born straight at the build phase carrying a single ticket
 * whose goal and sole acceptance criterion are that same sentence. No grill, no
 * spec, no terminal: review the card, click Burn.
 *
 * Deliberately has no Branch-from picker — the point is the shortest path to a
 * card. It forks off the same default the New Feature form shows (the branch
 * you're checked out on), so the two doors never disagree about the base.
 */
export function QuickChangeForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (featureId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [prose, setProse] = useState('')
  const utils = trpc.useUtils()
  const toast = useToast()

  const branchesQ = trpc.project.branches.useQuery({ projectId })
  const base = branchesQ.data ? defaultBaseBranch(branchesQ.data) : ''

  const quickChange = trpc.feature.quickChange.useMutation({
    onSuccess: async (feature) => {
      await utils.feature.list.invalidate()
      onCreated(feature.id)
    },
    onError: (e) => toast.push(e.message),
  })

  const slug = slugPreview(title)
  const busy = quickChange.isPending
  const ready = !!title.trim() && !!prose.trim() && !branchesQ.isPending
  const submit = () => {
    if (!ready || busy) return
    quickChange.mutate({
      projectId,
      title: title.trim(),
      prose: prose.trim(),
      baseBranch: base || undefined,
    })
  }

  return (
    <FormOverlay dirty={title.trim() !== '' || prose.trim() !== ''} onDismiss={onCancel}>
      {(dismiss) => (
        <>
          <div className="nf-kick">QUICK CHANGE</div>
          <div className="nf-h">What needs changing?</div>
          <div className="nf-sub">
            Too small for a conversation. Describe it once — runcastle turns it into a single ticket
            you review, then burn. {BURN_EXPLAINER} No grill session (the Q&A that shapes a bigger
            idea), no spec.
          </div>
          {/* The form used to say nothing about this, and users reasonably
              expected the ticket to attach to whichever feature was selected
              (findings F25.5). It does not — it is its own feature. */}
          <div className="nf-sub">
            This creates its own feature and its own branch, beside the ones you already have — it
            does not attach to the feature currently selected.
          </div>

          <input
            className="nf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Darker empty state"
            autoFocus
          />

          <textarea
            className="nf-input nf-textarea"
            value={prose}
            onChange={(e) => setProse(e.target.value)}
            placeholder={
              'The change, in your own words — this becomes the ticket, verbatim.\n' +
              'e.g. "expected the run chip to stay amber while burning, got grey — reproduce by cancelling a run"'
            }
            onKeyDown={(e) => {
              // ⌘/Ctrl-Enter submits; a bare Enter is a newline (this is prose).
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
          />

          <div className="nf-branch">
            branch · feature/{slug || '…'} ← {base || '…'} · starts at build,{' '}
            <span title={lapExplainer(1)}>lap 1</span>
          </div>

          <div className="nf-actions">
            <Button variant="ghost" onClick={dismiss} disabled={busy}>
              Cancel
            </Button>
            <Button variant="solid" onClick={submit} disabled={!ready || busy}>
              {busy ? 'Creating…' : 'Create ticket'}
            </Button>
          </div>
        </>
      )}
    </FormOverlay>
  )
}
