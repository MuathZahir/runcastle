import { useState } from 'react'
import { trpc } from '../trpc'
import { isAbsolutePath, pathPlaceholder } from '../lib/platform'
import { repoOpenFailure, type RepoOpenFailure } from '../lib/projects'
import { useToast } from '../lib/toast'
import { LogoMark } from '../icons'
import { Button, FailureNote, TEXT_INPUT } from '../ui'
import { DirectoryPicker } from './DirectoryPicker'

/**
 * The open-a-project flow (issue #45). One repo path in; the server validates it
 * as a git repo, detects the default branch, and upserts the project (re-opening
 * a known path returns it intact). Reachable from three entry points — the
 * portfolio home, the titlebar switcher, and the last step of the first-run
 * wizard — so `firstRun` swaps the copy and drops the cancel affordance for a
 * user with no project to fall back to.
 *
 * The screen is one row (decision 5): a path field, Browse…, Open. It used to be
 * a paragraph of prose around one field, and a rejected path was printed twice —
 * once inside the server's message, once again in the hint — so the failure now
 * states the problem alone and the path is shown exactly once beneath it,
 * truncated from the left, where the interesting end of a path is.
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
  // The last rejected path, so the failure names the folder the user actually
  // tried rather than whatever the field says by the time they read it.
  const [attempted, setAttempted] = useState('')
  // A path that is not absolute is refused here rather than sent: the server
  // would resolve it against its own working directory and answer about a
  // folder the user never named (decision 5).
  const [relative, setRelative] = useState(false)
  const toast = useToast()
  const utils = trpc.useUtils()

  const open = trpc.project.open.useMutation({
    onSuccess: async (project) => {
      await utils.project.list.invalidate()
      toast.push(`opened ${project.name}`, 'info')
      onOpened(project.id)
    },
    // No toast: a rejected path is a fact about the field two inches away, and
    // a corner toast that expires is the wrong place for it (findings F17.2).
    // `open.error` renders inline below instead.
    onError: () => undefined,
  })

  const clearFailure = () => {
    open.reset()
    setRelative(false)
  }

  const submit = (override?: string) => {
    const path = (override ?? repoPath).trim()
    if (!path) return
    clearFailure()
    if (!isAbsolutePath(path)) {
      setRelative(true)
      return
    }
    setAttempted(path)
    open.mutate({ repoPath: path })
  }

  const browse = () => {
    // A stale failure would sit under a dialog that is about to replace the
    // path it is about.
    clearFailure()
    setPicking(true)
  }

  const failure: RepoOpenFailure | null = relative
    ? {
        message: 'Enter an absolute path',
        hint: `A path from the root of this machine, like ${pathPlaceholder()}.`,
        path: null,
      }
    : open.error
      ? repoOpenFailure(open.error.message, attempted)
      : null

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
    <div
      className="flex h-full items-center justify-center px-6 py-10"
      onKeyDown={(event) => {
        // The picker restores focus to Browse when it closes. Keep Escape as a
        // screen-level way back from there (and from every other control), but
        // let the open dialog consume its own first Escape.
        if (event.key === 'Escape' && !firstRun && !picking) onCancel()
      }}
    >
      <div className="w-full max-w-[560px]">
        {/* inverse treatment (logo spec): accent tile, ink mark */}
        <div className="mb-6 flex size-9 items-center justify-center rounded-md bg-accent">
          <LogoMark size={22} variant="ink" />
        </div>
        {/*
         * The kicker says where you are, the heading says what you are doing
         * (decision 1) — so it never repeats the heading's own words back at
         * you in caps, which is all "Open a project" over "Open a project" was.
         */}
        <div className="text-xs font-semibold tracking-[0.09em] text-accent-hi uppercase">
          {firstRun ? 'Welcome to runcastle' : 'Your projects'}
        </div>
        <h1 className="mt-2 text-xl font-semibold text-text">
          {firstRun ? 'Open your first project' : 'Open a project'}
        </h1>
        <p className="mt-2 text-base text-text-2">
          Point runcastle at a local git repository — every feature runs its pipeline against it.
        </p>

        <div className="mt-7 flex items-center gap-2">
          <input
            id="open-repo-path"
            className={`${TEXT_INPUT} flex-1`}
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder={pathPlaceholder()}
            aria-label="Repository path"
            autoFocus
            spellCheck={false}
            aria-invalid={!!failure}
            aria-describedby={failure ? 'open-repo-error' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <Button variant="ghost" onClick={browse} disabled={open.isPending}>
            Browse…
          </Button>
          <Button
            variant="solid"
            onClick={() => submit()}
            disabled={open.isPending || repoPath.trim() === ''}
          >
            {open.isPending ? 'Opening…' : 'Open'}
          </Button>
        </div>

        {failure ? (
          <div className="mt-3">
            <FailureNote {...failure} id="open-repo-error" />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-3">
            Paste an absolute path, or browse for one. The default branch is detected when the
            project opens.
          </p>
        )}

        {!firstRun && (
          <div className="mt-8">
            <Button variant="ghost" onClick={onCancel} disabled={open.isPending}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {picking && (
        <DirectoryPicker initialPath={repoPath} onPick={onPick} onCancel={() => setPicking(false)} />
      )}
    </div>
  )
}
