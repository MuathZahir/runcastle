import { useState } from 'react'
import { trpc } from '../trpc'
import { isAbsolutePath, pathPlaceholder } from '../lib/platform'
import { repoOpenFailure, type RepoOpenFailure } from '../lib/projects'
import { useToast } from '../lib/toast'
import type { ReactNode } from 'react'
import { IconArrowLeft, IconArrowRight, IconBranch, IconFolder, LogoMark } from '../icons'
import { Button, FailureNote, TextField } from '../ui'
import { DirectoryPicker } from './DirectoryPicker'
import { SetupFrame, StepHeading } from './first-run/StepLayout'

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
  rail,
  onOpened,
  onCancel,
}: {
  firstRun: boolean
  /** The wizard's step rail, when this is setup's last step. */
  rail?: ReactNode
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

  /**
   * The offer behind the "Not a git repository" failure (decisions 2–3): it
   * initializes the folder the human already picked and re-opens it, so the
   * click that answers the error is also the last one — they never leave the
   * screen, and nothing asks them to confirm the same decision twice.
   */
  const initRepo = trpc.project.initRepo.useMutation({
    onSuccess: ({ repoPath: inited }) => {
      setAttempted(inited)
      open.mutate({ repoPath: inited })
    },
    // Inline like `open`'s: a failed init (an unset git identity) is a fact
    // about the note the button sits in.
    onError: () => undefined,
  })

  const clearFailure = () => {
    open.reset()
    initRepo.reset()
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

  // Initializing runs an open straight after it, so the row stays busy across
  // both halves of the one click rather than flickering back between them.
  const busy = open.isPending || initRepo.isPending

  // A refused init replaces the failure that offered it — the git identity it
  // names is the problem now, and the same offer would fail the same way.
  const rejection = initRepo.error ?? open.error
  const failure: RepoOpenFailure | null = relative
    ? {
        message: 'Enter an absolute path',
        hint: `A path from the root of this machine, like ${pathPlaceholder()}.`,
        path: null,
      }
    : rejection
      ? repoOpenFailure(rejection.message, attempted)
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
    <SetupFrame
      rail={rail}
      stepKey="project"
      onKeyDown={(event) => {
        // The picker restores focus to Browse when it closes. Keep Escape as a
        // screen-level way back from there (and from every other control), but
        // let the open dialog consume its own first Escape.
        if (event.key === 'Escape' && !firstRun && !picking) onCancel()
      }}
    >
      {/*
       * The locator says where you are, the heading says what you are doing
       * (decision 1) — so it never repeats the heading's own words back at you,
       * which is all "Open a project" over "Open a project" was. Inside the
       * wizard the rail already says where you are.
       */}
      {!rail && (
        <div className="mb-3 flex items-center gap-2 text-xs text-text-tertiary">
          <LogoMark size={14} />
          {firstRun ? 'Welcome to runcastle' : 'Your projects'}
        </div>
      )}
      <StepHeading title={firstRun ? 'Open your first project' : 'Open a project'}>
        Point runcastle at a local git repository — every feature runs its pipeline against it.
      </StepHeading>

      <div className="mt-8 flex items-center gap-2">
        <TextField
          id="open-repo-path"
          size="lg"
          mono
          icon={<IconFolder />}
          className="flex-1"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder={pathPlaceholder()}
          aria-label="Repository path"
          autoFocus
          spellCheck={false}
          invalid={!!failure}
          aria-describedby={failure ? 'open-repo-error' : 'open-repo-hint'}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <Button size="lg" onClick={browse} disabled={busy}>
          Browse…
        </Button>
        <Button
          variant="primary"
          size="lg"
          icon={<IconArrowRight />}
          loading={open.isPending}
          onClick={() => submit()}
          disabled={busy || repoPath.trim() === ''}
        >
          Open
        </Button>
      </div>

      {failure ? (
        <div className="mt-3 animate-rise-in">
          <FailureNote
            {...failure}
            id="open-repo-error"
            action={
              failure.offer === 'init-repo' ? (
                // Secondary, like every other action that sits inside a note:
                // Open is this view's one primary (apps/web/DESIGN.md), and a
                // second one beside it would be two primaries competing.
                <Button
                  size="sm"
                  icon={<IconBranch />}
                  loading={initRepo.isPending}
                  onClick={() => initRepo.mutate({ repoPath: attempted })}
                  disabled={busy}
                >
                  Initialize repository
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <p id="open-repo-hint" className="mt-2.5 mb-0 text-xs text-text-tertiary">
          Paste an absolute path, or browse for one. The default branch is detected when the
          project opens.
        </p>
      )}

      {!firstRun && (
        <footer className="mt-10 flex items-center border-t border-border-subtle pt-5">
          <Button variant="ghost" icon={<IconArrowLeft />} onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </footer>
      )}

      {picking && (
        <DirectoryPicker initialPath={repoPath} onPick={onPick} onCancel={() => setPicking(false)} />
      )}
    </SetupFrame>
  )
}
