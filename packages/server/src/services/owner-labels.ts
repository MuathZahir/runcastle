import { dataDir } from '@runcastle/core/paths'

/**
 * The marks runcastle stamps on every image, volume and container it makes
 * (feature `runcastle-cleans-up-after-itself`, decision 5). The data-dir label
 * is the ownership key: an install acts on a resource only when it names this
 * install's data folder, or a folder that no longer exists.
 *
 * Kept in one small module so the build, the volume and the drive-stop code
 * agree by import; the lead may move these into `@runcastle/core`.
 */
export const OWNER_LABEL = 'runcastle.owner'
export const OWNER_VALUE = 'runcastle'
export const DATA_DIR_LABEL = 'runcastle.data-dir'
export const PROJECT_LABEL = 'runcastle.project'

/** The labels for one resource: owner and data folder always, the project when it has one. */
export function ownershipLabels(
  opts: { projectId?: string | null | undefined; dataDir?: string } = {},
): Record<string, string> {
  return {
    [OWNER_LABEL]: OWNER_VALUE,
    [DATA_DIR_LABEL]: opts.dataDir ?? dataDir(),
    ...(opts.projectId ? { [PROJECT_LABEL]: opts.projectId } : {}),
  }
}

/** `--label key=value` pairs for an engine command. */
export function labelArgs(labels: Record<string, string>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`])
}
