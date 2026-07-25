import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { IconBranch, IconChevronRight, IconFolder } from '../icons'
import { Button, DimLine } from '../ui'

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
  onPick,
  onCancel,
}: {
  onPick: (path: string) => void
  onCancel: () => void
}) {
  // `undefined` asks the server for its default (the user's home directory), so
  // the client never has to know what home is.
  const [dir, setDir] = useState<string | undefined>(undefined)
  const [showHidden, setShowHidden] = useState(false)

  const roots = trpc.project.roots.useQuery()
  const browse = trpc.project.browse.useQuery(
    { dir, showHidden },
    // Keep the previous listing painted while the next one loads — otherwise
    // every navigation flashes the dialog empty.
    { placeholderData: (prev) => prev, retry: false },
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const data = browse.data
  const current = data?.dir ?? dir

  return (
    <div className="peek-backdrop" onClick={onCancel}>
      <div
        className="peek dir-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a repository"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="peek-head">
          <span className="dir-picker-title">Choose a repository</span>
          <button className="peek-close" onClick={onCancel} aria-label="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="dir-picker-bar">
          <Button
            variant="ghost"
            className="dir-up"
            onClick={() => data?.parent && setDir(data.parent)}
            disabled={!data?.parent}
            aria-label="Up one level"
            title="Up one level"
          >
            ↑
          </Button>
          <div className="dir-crumbs mono" aria-label="Current path">
            {(data?.crumbs ?? []).map((crumb, i) => (
              <span key={crumb.path} className="dir-crumb-wrap">
                {i > 0 && <IconChevronRight size={11} />}
                <button className="dir-crumb" onClick={() => setDir(crumb.path)}>
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <label className="dir-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>Hidden</span>
          </label>
        </div>

        <div className="dir-picker-body">
          <div className="dir-rail">
            {(roots.data ?? []).map((root) => (
              <button
                key={root.path}
                className={`dir-rail-item${current === root.path ? ' is-active' : ''}`}
                onClick={() => setDir(root.path)}
                title={root.path}
              >
                <IconFolder size={13} />
                <span className="dir-rail-label mono">{root.label}</span>
              </button>
            ))}
          </div>

          <div className="dir-list">
            {browse.isError ? (
              <DimLine>{browse.error.message}</DimLine>
            ) : browse.isLoading ? (
              <DimLine>Loading…</DimLine>
            ) : (data?.entries.length ?? 0) === 0 ? (
              <DimLine>
                No subfolders here{showHidden ? '' : ' (hidden folders are filtered)'}.
              </DimLine>
            ) : (
              (data?.entries ?? []).map((entry) => (
                <button
                  key={entry.path}
                  className={`dir-item${entry.isRepo ? ' is-repo' : ''}`}
                  onClick={() => setDir(entry.path)}
                  // A repo is usually the destination, so let a double-click
                  // both enter and commit it in one gesture.
                  onDoubleClick={() => entry.isRepo && onPick(entry.path)}
                  title={entry.path}
                >
                  <IconFolder size={13} />
                  <span className="dir-item-name mono">{entry.name}</span>
                  {entry.isSymlink && <span className="dir-item-tag">link</span>}
                  {entry.isRepo && (
                    <span className="dir-item-repo">
                      <IconBranch size={11} /> git
                    </span>
                  )}
                </button>
              ))
            )}
            {data?.truncated && <DimLine>Listing truncated — this folder is very large.</DimLine>}
          </div>
        </div>

        <div className="dir-picker-foot">
          <div className="dir-picked mono" title={current}>
            {/* <bdi> keeps the path rendering left-to-right inside the
                right-to-left truncation container — see .dir-picked. */}
            <bdi>{current ?? '—'}</bdi>
          </div>
          <div className="dir-picker-actions">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {/* Enabled even when `.git` was not spotted: the server's git check
                is the authority (bare repos and worktrees do not look like a
                plain checkout), and its error message is the better teacher. */}
            <Button variant="solid" onClick={() => current && onPick(current)} disabled={!current}>
              Open this folder
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
