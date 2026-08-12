import { useState } from 'react'
import { trpc } from '../trpc'
import { defaultBaseBranch, duplicateTitleWarning, slugPreview } from '../lib/feature-ui'
import { TALK_IT_THROUGH } from '../lib/project-workspace'
import { useToast } from '../lib/toast'
import { GRILL_EXPLAINER } from '../lib/vocabulary'
import { Button } from '../ui'
import { FormOverlay } from './FormOverlay'

/**
 * The new-feature form (app-redesign) — owns the whole workspace while open.
 * Name it, and starting it creates the feature AND opens a grill session so the
 * ideation body is live the moment you land on it. Or park it as a draft: an idea
 * worth writing down is not always an idea you want to talk about right now
 * (finding F15), and cutting a branch for it only leaves one to go stale
 * (decision 5). A draft's screen carries the Start that cuts it later.
 *
 * The form demands a title up front, which means it demands the human has already
 * cut their thought into a feature — so it carries the escape hatch for when they
 * have not (decision 20): the project session, which does the cutting.
 */
export function NewFeatureForm({
  projectId,
  onCancel,
  onCreated,
  onTalkItThrough,
}: {
  projectId: string
  onCancel: () => void
  onCreated: (featureId: string) => void
  onTalkItThrough: () => void
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
  // Which button is in flight, for its own pending label — both actions run the
  // same create; only the submit call site decides whether a session follows.
  const [starting, setStarting] = useState<'grill' | 'draft' | null>(null)
  const create = trpc.feature.create.useMutation({
    onError: (e) => {
      setStarting(null)
      toast.push(e.message)
    },
  })

  // Same query key the rail polls — one fetch, and the warning is against the
  // list the user can already see.
  const featuresQ = trpc.feature.list.useQuery({ projectId })
  const duplicate = duplicateTitleWarning(title, featuresQ.data ?? [])

  const slug = slugPreview(title)
  const busy = create.isPending || launch.isPending
  const submit = (withGrill: boolean) => {
    const t = title.trim()
    if (!t || busy) return
    // Don't cut a branch while the branch list is still loading — `effectiveBase`
    // isn't known yet, and creating now would silently fork off main. Parking
    // sends no base at all (decision 3), so it never has to wait for the list.
    if (withGrill && branchesQ.isPending) return
    setStarting(withGrill ? 'grill' : 'draft')
    create.mutate(
      {
        projectId,
        title: t,
        oneLiner: oneLiner.trim(),
        // Park it instead of starting it (decision 5): a draft is a DB row and
        // nothing else — no branch, no docs, no commit until Start.
        ...(withGrill
          ? {
              // Send the base the form is SHOWING, not just an explicit pick.
              // Omitting it makes the server fall back to `project.mainBranch`,
              // which silently contradicts the "current branch" default displayed
              // in the picker. Empty only before the branch list loads — then main
              // really is the base.
              baseBranch: effectiveBase || undefined,
            }
          : // No base on the park path (decision 3): a draft can sit for weeks, so
            // its base is chosen and resolved at Start, not now.
            { draft: true }),
      },
      {
        onSuccess: async (feature) => {
          await utils.feature.list.invalidate()
          // Best-effort: open a grill session so the ideation body lands live.
          if (withGrill)
            launch.mutate(
              { featureId: feature.id, kind: 'ideation' },
              { onSettled: () => void utils.feature.get.invalidate({ id: feature.id }) },
            )
          onCreated(feature.id)
        },
      },
    )
  }

  return (
    <FormOverlay dirty={title.trim() !== '' || oneLiner.trim() !== ''} onDismiss={onCancel}>
      {(dismiss) => (
        <>
          <div className="nf-kick">NEW FEATURE</div>
          <div className="nf-h">What are we building?</div>
          <div className="nf-sub">
            {GRILL_EXPLAINER} Name it and start one now — or save it as a draft, parked with no
            branch until you are ready to begin.
          </div>

          <input
            className="nf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Slack notifications on failed runs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(true)
            }}
          />
          {/* A warning, not a block: a second run at the same idea is legitimate,
              and the server suffixes the slug either way (findings F25.3). */}
          {duplicate && (
            <div className="nf-dupe" role="status">
              {duplicate}
            </div>
          )}

          <input
            className="nf-input nf-oneliner"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            placeholder="one-liner (optional) — what & why in a sentence"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(true)
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
                forks off this branch — and merges back into it when shipped. Applies to “Start
                grill session” only; a draft picks its base at Start.
              </span>
            </div>

            <div className="nf-branch">
              branch · feature/{slug || '…'} ← {effectiveBase || '…'}
            </div>
          </details>

          <div className="nf-actions">
            <button className="talk-door" onClick={onTalkItThrough} disabled={busy}>
              {TALK_IT_THROUGH} →
            </button>
            <span className="nf-actions-spacer" />
            <Button variant="ghost" onClick={dismiss} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              onClick={() => submit(false)}
              disabled={!title.trim() || busy}
              title="Park it as a draft — no branch and no repo changes until you click Start on its screen"
            >
              {starting === 'draft' ? 'Saving…' : 'Save as draft'}
            </Button>
            <Button
              variant="solid"
              onClick={() => submit(true)}
              disabled={!title.trim() || busy || branchesQ.isPending}
            >
              {starting === 'grill' ? 'Starting…' : 'Start grill session'}
            </Button>
          </div>
        </>
      )}
    </FormOverlay>
  )
}
