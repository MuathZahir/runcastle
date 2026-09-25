import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { trpc } from '../trpc'
import { pathPlaceholder } from '../lib/platform'
import { browseFailure, pickerStartDir, type RepoOpenFailure } from '../lib/projects'
import { IconBranch, IconChevronUp, IconFolder, IconHome } from '../icons'
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FailureNote,
  IconButton,
  NavItem,
  SectionLabel,
  Spinner,
} from '../ui'
import { PathCrumbs } from './PathCrumbs'

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
  // What the path control edits, and the last path someone claimed rather than
  // clicked — the handed one, or one typed into the header since. Either way it
  // survives the walk up to its nearest listable ancestor, so a path that turned
  // out not to exist can be corrected in place instead of retyped.
  const [typed, setTyped] = useState<string | null>(handed ?? null)
  // The failure that made the picker walk away from that path, kept so the jump
  // is explained rather than silent. Cleared the moment the user moves.
  const [refusal, setRefusal] = useState<RepoOpenFailure | null>(null)

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
    setRefusal(null)
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
    setRefusal(null)
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
    if (dir === typed && failureMessage) setRefusal(browseFailure(failureMessage))
    setDir(settlingTo)
  }, [settling, settlingTo, dir, typed, failureMessage])

  /**
   * ↑/↓ walk the listing (and the roots) by focus; Enter opens the focused
   * folder, which is the row's own click. Home/End jump to either end.
   */
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-dir-row] button')]
    if (rows.length === 0) return
    event.preventDefault()
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(rows.length - 1, at + 1)
            : Math.max(0, at === -1 ? 0 : at - 1)
    rows[next]?.focus()
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      labelledBy="dir-picker-title"
      className="flex h-[min(620px,76vh)] flex-col overflow-hidden"
    >
      <DialogHeader
        id="dir-picker-title"
        title="Choose a repository"
        description="Browse this machine for a git repository to open."
        onClose={onCancel}
      />

      <div className="flex shrink-0 items-center gap-2 border-y border-border px-3 py-2">
        <IconButton
          label="Up one level"
          icon={<IconChevronUp />}
          onClick={() => data?.parent && navigate(data.parent)}
          disabled={!data?.parent}
        />
        <PathCrumbs
          crumbs={data?.crumbs ?? []}
          value={typed ?? current ?? ''}
          onNavigate={navigate}
          onEnterPath={enterPath}
          placeholder={pathPlaceholder()}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary select-none hover:bg-surface-hover hover:text-text">
          <input
            type="checkbox"
            className="size-3.5 accent-(--color-accent)"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          <span>Hidden</span>
        </label>
      </div>

      {refusal && (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <FailureNote
            message={refusal.message}
            path={refusal.path}
            // Not the classifier's hint: nothing needs checking or picking, the
            // picker has already moved — what is missing is the fact that it did.
            hint="Showing the closest folder that could be listed. Edit the path to try again."
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2"
          onKeyDown={onListKey}
        >
          <SectionLabel className="px-2.5">Locations</SectionLabel>
          {(roots.data ?? []).map((root) => (
            <div key={root.path} data-dir-row="">
              <NavItem
                label={<span className="font-mono text-xs">{root.label}</span>}
                title={root.path}
                icon={root.label === '~' ? <IconHome /> : <IconFolder />}
                active={current === root.path}
                onClick={() => navigate(root.path)}
              />
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-2" onKeyDown={onListKey}>
          {/* Mid walk-up the failing directory is one render from being
              replaced, so the pane must not flash a failure that is already
              being answered. */}
          {settling || browse.isLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-text-tertiary">
              <Spinner /> Loading…
            </div>
          ) : browse.isError ? (
            <div className="p-2">
              <FailureNote {...browseFailure(browse.error.message)} />
            </div>
          ) : (data?.entries.length ?? 0) === 0 ? (
            <EmptyState
              compact
              icon={<IconFolder />}
              title="No subfolders here"
              hint={
                showHidden ? undefined : 'Hidden folders, junctions and node_modules are filtered.'
              }
            />
          ) : (
            // Keyed on the folder, so a navigation's listing rises in once and
            // a refetch of the same folder does not.
            <div key={current} className="flex flex-col gap-0.5 animate-rise-in" role="list">
              {(data?.entries ?? []).map((entry) => (
                <div
                  key={entry.path}
                  role="listitem"
                  data-dir-row=""
                  // A repo is usually the destination, so let a double-click
                  // both enter and commit it in one gesture.
                  onDoubleClick={() => entry.isRepo && onPick(entry.path)}
                >
                  <NavItem
                    label={entry.name}
                    title={entry.path}
                    icon={entry.isRepo ? <IconBranch /> : <IconFolder />}
                    onClick={() => navigate(entry.path)}
                    className={entry.isRepo ? 'text-text' : undefined}
                    meta={
                      entry.isRepo ? (
                        <span className="text-text-secondary">git</span>
                      ) : entry.isSymlink ? (
                        'link'
                      ) : undefined
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {data?.truncated && (
            <p className="m-0 px-2.5 py-2 text-xs text-text-tertiary">
              Listing truncated — this folder is very large.
            </p>
          )}
        </div>
      </div>

      <DialogFooter
        className="border-t border-border pt-3 pb-3"
        start={
          // A long path is truncated at its *start* — the tail (the folder you
          // picked) is the part worth reading. `dir="rtl"` moves the ellipsis to
          // the left; <bdi> isolates the path so bidi reordering cannot move
          // direction-neutral characters around to the wrong end.
          <div className="min-w-0 truncate text-left font-mono text-xs" dir="rtl" title={current}>
            <bdi>{current ?? '—'}</bdi>
          </div>
        }
      >
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {/* Enabled even when `.git` was not spotted: the server's git check is
            the authority (bare repos and worktrees do not look like a plain
            checkout), and its error message is the better teacher. A directory
            that would not even list is another matter — that is the garbage the
            primary button used to happily submit. */}
        <Button
          variant="primary"
          icon={<IconFolder />}
          onClick={() => current && onPick(current)}
          disabled={!current || browse.isError}
        >
          Open this folder
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
