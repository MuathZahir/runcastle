/**
 * The one naming rule every drive script trusts: a drive's data dir is
 * `~/.runcastle-drive-<id>`. `drive-setup.ts` builds it, `drive-stop.ts` deletes
 * only a dir that carries it, and a scenario writes only into one that does —
 * the developer's `~/.runcastle` and `~/.runcastle-dev` sit beside it and never
 * match.
 */
import { basename } from 'node:path'

export const DRIVE_PREFIX = '.runcastle-drive-'

export function isDriveDataDir(dir: string): boolean {
  return basename(dir).startsWith(DRIVE_PREFIX)
}
