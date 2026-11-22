/** Runcastle is running as root. `uid` is injected for tests. */
export function runningAsRoot(uid: number | undefined = process.getuid?.()): boolean {
  return uid === 0
}

/** Why a root host cannot run workers on Claude Code, and the way out. */
export const ROOT_REFUSED =
  'Runcastle is running as root, and Claude Code refuses to run unattended as root. Run runcastle as a normal user.'
