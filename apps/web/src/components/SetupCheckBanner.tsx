import { BARE_BUTTON } from '../ui'

/**
 * The notice that the setup doctor could not be run.
 *
 * The doctor is diagnostics — what git identity and which coding agents the
 * host has — and the shell used to treat it as a prerequisite for showing
 * anything: a probe that threw held "loading projects…" up while the project
 * list sat there resolved behind it. Its failure is a banner instead, a row in
 * the frame's normal flow beside `UpdateBanner`, so the app underneath is
 * reachable while the checks are broken.
 *
 * Re-run is a button and not a timer on purpose: the query is not retried (see
 * `use-project-nav`), because the faults this reports — a binary that is not on
 * PATH, a probe that crashes — do not heal between two attempts a second apart.
 */
export function SetupCheckBanner({
  error,
  onRecheck,
}: {
  /** The failure's message, or `null` when the checks ran. */
  error: string | null
  onRecheck: () => void
}) {
  if (!error) return null

  return (
    // As wide as the window, and a long message clips rather than pushing the
    // frame wider — the breadcrumb's lesson, the same one `UpdateBanner` keeps.
    <div
      className="flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-danger/45 bg-danger/8 px-3.5 py-1.5 text-sm text-text"
      role="status"
    >
      <span className="shrink-0 font-medium text-danger">Setup checks could not run</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-3">
        {error}
      </span>
      <button
        className={`${BARE_BUTTON} ml-auto shrink-0 cursor-pointer rounded-sm px-1.5 py-0.5 text-text-2 underline underline-offset-2 hover:text-text`}
        onClick={onRecheck}
      >
        Re-run checks
      </button>
    </div>
  )
}
