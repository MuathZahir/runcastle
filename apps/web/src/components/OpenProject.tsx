import { useState } from 'react'
import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { LogoMark } from '../icons'
import { Button } from '../ui'

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
  const toast = useToast()
  const utils = trpc.useUtils()

  const open = trpc.project.open.useMutation({
    onSuccess: async (project) => {
      await utils.project.list.invalidate()
      toast.push(`opened ${project.name} on ${project.mainBranch}`, 'info')
      onOpened(project.id)
    },
    onError: (e) => toast.push(e.message),
  })

  const submit = () => {
    const path = repoPath.trim()
    if (path) open.mutate({ repoPath: path })
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
        <input
          id="op-repo-path"
          className="op-input mono"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/path/to/your/repo"
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape' && !firstRun) onCancel()
          }}
        />
        <div className="op-hint">
          The default branch is detected automatically when the project opens.
        </div>

        <div className="op-actions">
          {!firstRun && (
            <Button variant="ghost" onClick={onCancel} disabled={open.isPending}>
              Cancel
            </Button>
          )}
          <Button
            variant="solid"
            onClick={submit}
            disabled={open.isPending || repoPath.trim() === ''}
          >
            {open.isPending ? 'Opening…' : 'Open'}
          </Button>
        </div>
      </div>
    </div>
  )
}
