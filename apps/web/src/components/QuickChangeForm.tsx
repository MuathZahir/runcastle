import { useState } from 'react'
import { trpc } from '../trpc'
import { defaultBaseBranch, slugPreview } from '../lib/feature-ui'
import { useToast } from '../lib/toast'
import { BURN_EXPLAINER, lapExplainer } from '../lib/vocabulary'
import { Button } from '../ui'

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
    <div className="nf-overlay">
      <div className="nf-card">
        <div className="nf-kick">QUICK CHANGE</div>
        <div className="nf-h">What needs changing?</div>
        <div className="nf-sub">
          Too small for a conversation. Describe it once — runcastle turns it into a single ticket
          you review, then burn. {BURN_EXPLAINER} No question-and-answer session, no spec.
        </div>

        <input
          className="nf-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Darker empty state"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
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
            if (e.key === 'Escape') onCancel()
            // ⌘/Ctrl-Enter submits; a bare Enter is a newline (this is prose).
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />

        <div className="nf-branch">
          branch · feature/{slug || '…'} ← {base || '…'} · starts at build,{' '}
          <span title={lapExplainer(1)}>lap 1</span>
        </div>

        <div className="nf-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" onClick={submit} disabled={!ready || busy}>
            {busy ? 'Creating…' : 'Create ticket'}
          </Button>
        </div>
      </div>
    </div>
  )
}
