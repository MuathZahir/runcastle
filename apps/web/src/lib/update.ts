/**
 * Update-banner logic (issue #51). Pure so the show/dismiss decision is testable
 * without a DOM. The banner never installs — it only surfaces the command.
 */
export interface UpdateInfo {
  latest: string | null
  command: string
  updateAvailable: boolean
}

/** localStorage key holding the last version the user dismissed. */
export const DISMISS_KEY = 'runcastle.update.dismissed'

/**
 * Show the banner only for a real, newer version the user hasn't already
 * dismissed. Dismissal is keyed to the version string, so a subsequent release
 * (a different `latest`) surfaces the banner again rather than staying hidden.
 */
export function bannerVisible(info: UpdateInfo, dismissedVersion: string | null): boolean {
  return info.updateAvailable && info.latest !== null && info.latest !== dismissedVersion
}
