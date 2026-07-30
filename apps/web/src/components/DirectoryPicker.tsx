import { useEffect, useState } from 'react'
import { trpc } from '../trpc'
import { pathPlaceholder } from '../lib/platform'
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
  // `undefined` asks the server for its default (the user's home directory), so
  // the client never has to know what home is.
  const [dir, setDir] = useState<string | undefined>(initialPath?.trim() || undefined)
  const [showHidden, setShowHidden] = useState(false)
  // The path box's draft. It follows navigation (so it always shows where you
  // are) but a typed edit wins until it is committed or abandoned.
  const [typed, setTyped] = useState<string | null>(null)

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

  const navigate = (path: string) => {
    setTyped(null)
    setDir(path)
  }

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
            onClick={() => data?.parent && navigate(data.parent)}
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
                <button className="dir-crumb" onClick={() => navigate(crumb.path)}>
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

        {/* Typing a path was the fast way in and the dialog did not offer it —
            deep directories cost eight clicks (findings F17.3). */}
        <div className="dir-path-row">
          <label className="dir-path-label" htmlFor="dir-path-input">
            Path
          </label>
          <input
            id="dir-path-input"
            className="dir-path-input mono"
            spellCheck={false}
            value={typed ?? current ?? ''}
            placeholder={pathPlaceholder()}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed !== null) navigate(typed.trim())
              // Escape abandons the edit and shows where we actually are; the
              // dialog's own Escape-to-close only applies once it is not being
              // typed into.
              if (e.key === 'Escape' && typed !== null) {
                e.stopPropagation()
                setTyped(null)
              }
            }}
          />
        </div>

        <div className="dir-picker-body">
          <div className="dir-rail">
            {(roots.data ?? []).map((root) => (
              <button
                key={root.path}
                className={`dir-rail-item${current === root.path ? ' is-active' : ''}`}
                onClick={() => navigate(root.path)}
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
                No subfolders here
                {showHidden ? '' : ' (hidden folders, junctions and node_modules are filtered)'}.
              </DimLine>
            ) : (
              (data?.entries ?? []).map((entry) => (
                <button
                  key={entry.path}
                  className={`dir-item${entry.isRepo ? ' is-repo' : ''}`}
                  onClick={() => navigate(entry.path)}
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
