/**
 * What the UI is allowed to assume about the machine it is being read on
 * (findings F17.4).
 *
 * The app told every user to press "⌘K" and to paste "/path/to/your/repo" — two
 * small lies on Windows, where the shortcut is Ctrl+K and no path looks like
 * that. Neither is worth a platform abstraction; both are worth being right.
 *
 * The detection is deliberately a pair of pure functions over the strings the
 * browser exposes, so the wording is testable on any platform. `navigator.platform`
 * is soft-deprecated but still populated everywhere and still the only synchronous
 * answer — `userAgentData.platform` needs an async call the render path cannot make,
 * so the user agent is the fallback.
 */

/** True when the strings describe a Mac (⌘ machines). */
export function isMacLike(platform: string, userAgent = ''): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x/i.test(userAgent)
}

/** True when the strings describe Windows. */
export function isWindowsLike(platform: string, userAgent = ''): boolean {
  return /win/i.test(platform) || /windows/i.test(userAgent)
}

/** The modifier the command palette actually answers to, spelled for a human. */
export function modKeyLabel(platform: string, userAgent = ''): string {
  return isMacLike(platform, userAgent) ? '⌘K' : 'Ctrl+K'
}

/** A repository path that looks like one on this machine. */
export function repoPathPlaceholder(platform: string, userAgent = ''): string {
  return isWindowsLike(platform, userAgent) ? 'C:\\Users\\you\\code\\your-repo' : '/path/to/your/repo'
}

function nav(): { platform: string; userAgent: string } {
  if (typeof navigator === 'undefined') return { platform: '', userAgent: '' }
  return { platform: navigator.platform ?? '', userAgent: navigator.userAgent ?? '' }
}

/** {@link modKeyLabel} for the browser this is running in. */
export function modKey(): string {
  const n = nav()
  return modKeyLabel(n.platform, n.userAgent)
}

/** {@link repoPathPlaceholder} for the browser this is running in. */
export function pathPlaceholder(): string {
  const n = nav()
  return repoPathPlaceholder(n.platform, n.userAgent)
}
