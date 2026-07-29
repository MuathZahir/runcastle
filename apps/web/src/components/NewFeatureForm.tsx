import { useState } from 'react'
import { trpc } from '../trpc'
import { defaultBaseBranch, slugPreview } from '../lib/feature-ui'
import { useToast } from '../lib/toast'
import { Button } from '../ui'

/**
 * The new-feature form (app-redesign) — owns the whole workspace while open.
 * Name it, and starting it creates the feature AND opens a grill session so the
 * ideation body is live the moment you land on it.
 */
export function NewFeatureForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (featureId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  // Empty = fork off the current-checkout default; a value picks an explicit base.
  const [base, setBase] = useState('')
  const utils = trpc.useUtils()
  const toast = useToast()

  const branchesQ = trpc.project.branches.useQuery({ projectId })
  const mainBranch = branchesQ.data?.mainBranch ?? ''
  const currentBranch = branchesQ.data?.current
  const branchList = branchesQ.data?.branches ?? []
  // Remote-only branches (origin/…); picking one materializes a local base.
  const remoteList = branchesQ.data?.remoteBranches ?? []
  const noBranches = branchList.length === 0 && remoteList.length === 0
  // Default to the branch the user is currently on (falls back to main); an
  // explicit pick in the Advanced disclosure overrides it.
  const defaultBase = branchesQ.data ? defaultBaseBranch(branchesQ.data) : mainBranch
  const effectiveBase = base || defaultBase

  const launch = trpc.feature.launchSession.useMutation()
  const create = trpc.feature.create.useMutation({
    onSuccess: async (feature) => {
      await utils.feature.list.invalidate()
      // Best-effort: open a grill session so the ideation body lands live.
      launch.mutate(
        { featureId: feature.id, kind: 'ideation' },
        { onSettled: () => void utils.feature.get.invalidate({ id: feature.id }) },
      )
      onCreated(feature.id)
    },
    onError: (e) => toast.push(e.message),
  })

  const slug = slugPreview(title)
  const busy = create.isPending || launch.isPending
  const submit = () => {
    const t = title.trim()
    // Don't create while the branch list is still loading — `effectiveBase` isn't
    // known yet, and creating now would silently fork off main.
    if (t && !branchesQ.isPending)
      create.mutate({
        projectId,
        title: t,
        oneLiner: oneLiner.trim(),
        // Send the base the form is SHOWING, not just an explicit pick. Omitting
        // it makes the server fall back to `project.mainBranch`, which silently
        // contradicts the "current branch" default displayed in the picker.
        // Empty only before the branch list loads — then main really is the base.
        baseBranch: effectiveBase || undefined,
      })
  }

  return (
    <div className="nf-overlay">
      <div className="nf-card">
        <div className="nf-kick">NEW FEATURE</div>
        <div className="nf-h">What are we building?</div>
        <div className="nf-sub">
          Name it — runcastle opens a grill session so you and Claude shape the idea before any code
          is written.
        </div>

        <input
          className="nf-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Slack notifications on failed runs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />

        <input
          className="nf-input nf-oneliner"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="one-liner (optional) — what & why in a sentence"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />

        <details className="nf-advanced">
          <summary className="nf-advanced-summary">Advanced</summary>

          <div className="nf-base">
            <label className="nf-base-label" htmlFor="nf-base-select">
              Branch from
            </label>
            <select
              id="nf-base-select"
              className="nf-base-select"
              value={effectiveBase}
              disabled={branchesQ.isPending || noBranches}
              onChange={(e) => setBase(e.target.value)}
            >
              {branchList.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === mainBranch ? ' (default)' : ''}
                  {b === currentBranch && b !== mainBranch ? ' (current)' : ''}
                </option>
              ))}
              {remoteList.length > 0 && (
                <optgroup label="Remote (creates a local branch)">
                  {remoteList.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <span className="size-hint">
              forks off this branch — and merges back into it when shipped.
            </span>
          </div>

          <div className="nf-branch">
            branch · feature/{slug || '…'} ← {effectiveBase || '…'}
          </div>
        </details>

        <div className="nf-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="solid"
            onClick={submit}
            disabled={!title.trim() || busy || branchesQ.isPending}
          >
            {busy ? 'Starting…' : 'Start grill session'}
          </Button>
        </div>
      </div>
    </div>
  )
}
