import { Button } from '../ui'
import { IconAlert, IconRefresh } from '../icons'
import { Notice } from './UpdateBanner'

/**
 * The notice that the setup doctor could not be run.
 *
 * The doctor is diagnostics — what git identity and which coding agents the
 * host has — and the shell used to treat it as a prerequisite for showing
 * anything: a probe that threw held "loading projects…" up while the project
 * list sat there resolved behind it. Its failure is a notice instead, a row at
 * the top of the content panel, so the app underneath is reachable while the
 * checks are broken.
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
    <Notice
      tone="danger"
      icon={<IconAlert />}
      action={
        <Button size="sm" variant="ghost" icon={<IconRefresh />} onClick={onRecheck}>
          Re-run checks
        </Button>
      }
    >
      <span className="shrink-0 font-medium text-text">Setup checks could not run</span>
      <span className="min-w-0 truncate font-mono text-xs text-text-secondary" title={error}>
        {error}
      </span>
    </Notice>
  )
}
