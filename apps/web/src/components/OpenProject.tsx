import { useState } from 'react'
import { trpc } from '../trpc'
import { pathPlaceholder } from '../lib/platform'
import { repoOpenFailure } from '../lib/projects'
import { useToast } from '../lib/toast'
import { LogoMark } from '../icons'
import { Button } from '../ui'
import { DirectoryPicker } from './DirectoryPicker'

/**
 * The open-a-project flow (issue #45). One repo path in; the server validates it
 * as a git repo, detects the default branch, and upserts the project (re-opening
 * a known path returns it intact). Reachable from three entry points — the
 * portfolio home, the titlebar switcher, and the brand-new-install empty state —
 * so `firstRun` swaps the copy/back-affordance for a fresh install with no
 * project to fall back to.
 */
export function OpenProject({
  firstRun,
  onOpened,
  onCancel,
}: {
  firstRun: boolean
  onOpened: (projectId: string) => void
  onCancel: () => void
}) {
  const [repoPath, setRepoPath] = useState('')
  const [picking, setPicking] = useState(false)
  // The last rejected path, so the hint names the folder the user actually
  // tried rather than whatever the field says by the time they read it.
  const [attempted, setAttempted] = useState('')
  const toast = useToast()
  const utils = trpc.useUtils()

  const open = trpc.project.open.useMutation({
    onSuccess: async (project) => {
      await utils.project.list.invalidate()
      toast.push(`opened ${project.name} on ${project.mainBranch}`, 'info')
      onOpened(project.id)
    },
    // No toast: a rejected path is a fact about the field two inches away, and
    // a corner toast that expires is the wrong place for it (findings F17.2).
    // `open.error` renders inline below instead.
    onError: () => undefined,
  })

  const submit = (override?: string) => {
    const path = (override ?? repoPath).trim()
    if (!path) return
    setAttempted(path)
    open.reset()
    open.mutate({ repoPath: path })
  }

  const failure = open.error ? repoOpenFailure(open.error.message, attempted) : null

  /**
   * Picking commits: "Open this folder" is already the user's confirmation, so
   * asking them to click Open again would be a second confirmation of the same
   * decision. The path is still written into the field first, so a rejected
   * folder (not a git repo) leaves them something to edit rather than an empty
   * box next to a toast.
   */
  const onPick = (path: string) => {
    setRepoPath(path)
    setPicking(false)
    submit(path)
  }

  return (
    <div className="open-project">
      <div className="op-card">
        <div className="op-logo">
          <LogoMark size={22} variant="ink" />
        </div>
        <div className="op-kick">{firstRun ? 'WELCOME TO RUNCASTLE' : 'OPEN A PROJECT'}</div>
        <div className="op-h">
          {firstRun ? 'Open your first project' : 'Open a project'}
        </div>
        <div className="op-sub">
          Point runcastle at a local git repository. It detects the default branch
          and opens the project — every feature runs its pipeline against this repo.
        </div>

        <label className="op-label" htmlFor="op-repo-path">
          Repository path
        </label>
        <div className="op-input-row">
          <input
            id="op-repo-path"
            className="op-input mono"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder={pathPlaceholder()}
            autoFocus
            spellCheck={false}
            aria-invalid={!!failure}
            aria-describedby={failure ? 'op-repo-error' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape' && !firstRun) onCancel()
            }}
          />
          <Button variant="ghost" onClick={() => setPicking(true)} disabled={open.isPending}>
            Browse…
          </Button>
        </div>
        {failure ? (
          <div className="op-error" id="op-repo-error" role="alert">
            <div className="op-error-msg">{failure.message}</div>
            {failure.hint && <div className="op-error-hint">{failure.hint}</div>}
          </div>
        ) : (
          <div className="op-hint">
            Browse your machine, or paste a path. The default branch is detected
            automatically when the project opens.
          </div>
        )}

        <div className="op-actions">
          {!firstRun && (
            <Button variant="ghost" onClick={onCancel} disabled={open.isPending}>
              Cancel
            </Button>
          )}
          <Button
            variant="solid"
            onClick={() => submit()}
            disabled={open.isPending || repoPath.trim() === ''}
          >
            {open.isPending ? 'Opening…' : 'Open'}
          </Button>
        </div>
      </div>

      {picking && (
        <DirectoryPicker
          initialPath={repoPath}
          onPick={onPick}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}
