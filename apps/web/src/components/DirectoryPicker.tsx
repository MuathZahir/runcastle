import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { pathPlaceholder } from '../lib/platform'
import { browseFailure, pickerStartDir, type RepoOpenFailure } from '../lib/projects'
import { IconBranch, IconFolder, IconX } from '../icons'
import { BARE_BUTTON, Button, Dialog, DimLine, FailureNote } from '../ui'
import { PathCrumbs } from './PathCrumbs'

/**
 * The roots rail's rows. Their background is written into each tone rather than
 * once into the base: two `bg-*` utilities on one element collide, and which
 * one wins is the order Tailwind emits them in, not the order they are written.
 */
const RAIL_ROW =
  'flex items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-sm ' +
  'hover:bg-panel-inset hover:text-text'

/** One folder in the listing. */
const ENTRY_ROW =
  `${BARE_BUTTON} flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ` +
  'hover:bg-panel-inset hover:text-text'

/**
 * Repo picker for the open-a-project flow — the alternative to hand-pasting an
 * absolute path.
 *
 * It browses the *server's* filesystem (`project.browse` / `project.roots`),
 * not the browser's. apps/web has no desktop shell, and the browser file APIs
 * cannot yield a real absolute path — while every path runcastle uses (git,
 * worktrees, PTYs) is resolved by the Bun server. Since that server runs on the
 * user's own machine, browsing it is both correct and what the user expects.
 *
 * Platform differences are resolved server-side: the rail holds drive letters on
 * Windows and `/` on POSIX, and `crumbs`/`entries` arrive as ready-made absolute
 * paths, so nothing here branches on platform or splits on a separator.
 */
export function DirectoryPicker({
  initialPath,
  onPick,
  onCancel,
}: {
  /**
   * What the caller's path field already holds. The picker used to ignore it
   * and always open at home, so a half-typed path meant navigating back to it
   * by hand (findings F17.3).
   */
  initialPath?: string
  onPick: (path: string) => void
  onCancel: () => void
}) {
  const handed = initialPath?.trim() || undefined
  // `undefined` asks the server for its default (the user's home directory), so
  // the client never has to know what home is.
  const [dir, setDir] = useState<string | undefined>(handed)
  const [showHidden, setShowHidden] = useState(false)
  // What the path control edits. It is the handed path until the user goes
  // somewhere themselves, so a path that turned out not to exist survives the
  // walk up to its nearest listable ancestor and can be corrected in place.
  const [typed, setTyped] = useState<string | null>(handed ?? null)
  // The path we walked away from, kept so the jump is explained rather than
  // silent. Cleared the moment the user goes anywhere themselves.
  const [refused, setRefused] = useState<RepoOpenFailure | null>(null)

  const roots = trpc.project.roots.useQuery()
  const browse = trpc.project.browse.useQuery(
    { dir, showHidden },
    // Keep the previous listing painted while the next one loads — otherwise
    // every navigation flashes the dialog empty.
    { placeholderData: (prev) => prev, retry: false },
  )

  const data = browse.data
  const current = data?.dir ?? dir

  const navigate = (path: string) => {
    setTyped(null)
    setRefused(null)
    setDir(path)
  }

  /**
   * A path typed into the header is a claim, not a place — nothing says it is
   * there. Holding on to it as `typed` puts it through the same walk-up as the
   * path the picker was handed, which is the difference between landing on the
   * nearest folder that lists and collapsing the whole dialog onto the server's
   * sentence with no crumbs and no way up.
   */
  const enterPath = (path: string) => {
    setTyped(path || null)
    setRefused(null)
    setDir(path || undefined)
  }

  /**
   * A path we were given that cannot be listed is not a dead end (decision 6):
   * drop a segment and try again, one failure at a time, until something lists
   * or we are at home. Only a path someone typed is treated this way — clicking
   * a crumb, a root or an entry names a directory the server just listed, so a
   * failure there is a real one and stays on screen.
   */
  const fallback =
    typed !== null && browse.isError ? pickerStartDir(dir, browse.error.message) : null
  const settling = fallback !== null && fallback.dir !== dir
  const settlingTo = fallback?.dir
  const failureMessage = browse.error?.message

  useEffect(() => {
    if (!settling) return
    // Only the first failure is about the path the user actually named; the
    // ones after it are about ancestors they never typed.
    if (dir === typed && failureMessage) setRefused(browseFailure(failureMessage))
    setDir(settlingTo)
  }, [settling, settlingTo, dir, typed, failureMessage])

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      label="Choose a repository"
      className="flex h-[66vh] flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <span className="text-base font-semibold text-text">Choose a repository</span>
        <button
          className={`${BARE_BUTTON} rounded-sm p-0.5 text-text-3 hover:text-text`}
          onClick={onCancel}
          aria-label="Close (Esc)"
        >
          <IconX size={14} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2.5">
        <Button
          variant="ghost"
          className="shrink-0 px-2.5"
          onClick={() => data?.parent && navigate(data.parent)}
          disabled={!data?.parent}
          aria-label="Up one level"
          title="Up one level"
        >
          ↑
        </Button>
        <PathCrumbs
          crumbs={data?.crumbs ?? []}
          value={typed ?? current ?? ''}
          onNavigate={navigate}
          onEnterPath={enterPath}
          placeholder={pathPlaceholder()}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-text-3 select-none">
          <input
            type="checkbox"
            className="accent-accent"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          <span>Hidden</span>
        </label>
      </div>

      {refused && (
        <div className="shrink-0 border-b border-hairline px-4 py-2.5">
          <FailureNote
            message={refused.message}
            path={refused.path}
            // Not the classifier's hint: nothing needs checking or picking, the
            // picker has already moved — what is missing is the fact that it did.
            hint="Showing the closest folder that could be listed. Edit the path to try again."
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-40 shrink-0 flex-col gap-px overflow-y-auto border-r border-hairline p-2">
          {(roots.data ?? []).map((root) => (
            <button
              key={root.path}
              className={
                RAIL_ROW +
                (current === root.path ? ' bg-accent-soft text-text' : ' bg-transparent text-text-3')
              }
              onClick={() => navigate(root.path)}
              title={root.path}
            >
              <IconFolder size={13} />
              <span className="truncate font-mono">{root.label}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-2">
          {/* Mid walk-up the failing directory is one render from being
              replaced, so the pane must not flash a failure that is already
              being answered. */}
          {settling || browse.isLoading ? (
            <DimLine>Loading…</DimLine>
          ) : browse.isError ? (
            <FailureNote {...browseFailure(browse.error.message)} />
          ) : (data?.entries.length ?? 0) === 0 ? (
            <DimLine>
              No subfolders here
              {showHidden ? '' : ' (hidden folders, junctions and node_modules are filtered)'}.
            </DimLine>
          ) : (
            (data?.entries ?? []).map((entry) => (
              <button
                key={entry.path}
                className={ENTRY_ROW + (entry.isRepo ? ' text-text' : ' text-text-2')}
                onClick={() => navigate(entry.path)}
                // A repo is usually the destination, so let a double-click
                // both enter and commit it in one gesture.
                onDoubleClick={() => entry.isRepo && onPick(entry.path)}
                title={entry.path}
              >
                <IconFolder size={13} />
                <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                {entry.isSymlink && <span className="shrink-0 text-xs text-text-4">link</span>}
                {entry.isRepo && (
                  <span className="flex shrink-0 items-center gap-1 text-xs tracking-[0.04em] text-accent-hi uppercase">
                    <IconBranch size={11} /> git
                  </span>
                )}
              </button>
            ))
          )}
          {data?.truncated && <DimLine>Listing truncated — this folder is very large.</DimLine>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-3">
        {/* A long path is truncated at its *start* — the tail (the folder you
            picked) is the part worth reading. `dir="rtl"` moves the ellipsis to
            the left; <bdi> isolates the path so bidi reordering cannot move
            direction-neutral characters around to the wrong end. */}
        <div
          className="min-w-0 flex-1 truncate text-left font-mono text-sm text-text-3"
          dir="rtl"
          title={current}
        >
          <bdi>{current ?? '—'}</bdi>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {/* Enabled even when `.git` was not spotted: the server's git check
              is the authority (bare repos and worktrees do not look like a
              plain checkout), and its error message is the better teacher. A
              directory that would not even list is another matter — that is the
              garbage the primary button used to happily submit. */}
          <Button
            variant="solid"
            onClick={() => current && onPick(current)}
            disabled={!current || browse.isError}
          >
            Open this folder
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
