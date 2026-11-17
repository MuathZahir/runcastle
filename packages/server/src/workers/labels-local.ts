/**
 * The marks runcastle stamps on every image, volume and container it makes
 * (feature `runcastle-cleans-up-after-itself`, decision 5). The data-dir label
 * is the ownership key: an install acts on a resource only when it names this
 * install's data folder, or a folder that no longer exists.
 *
 * A local stand-in for `packages/core/src/labels.ts`, with the same names and
 * signatures, so landing swaps this import for `@runcastle/core`.
 */
export const LABEL_OWNER = 'runcastle.owner'
export const OWNER_VALUE = 'runcastle'
export const LABEL_DATA_DIR = 'runcastle.data-dir'
export const LABEL_WORKER = 'runcastle.worker'
export const LABEL_PROJECT = 'runcastle.project'
export const LABEL_DOCKERFILE_HASH = 'runcastle.dockerfile-hash'

/** Owner and data folder, plus whatever else the resource carries (its project, its worker). */
export function ownerLabels(
  dataDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { [LABEL_OWNER]: OWNER_VALUE, [LABEL_DATA_DIR]: dataDir, ...extra }
}

/** `--label key=value` pairs for an engine command. */
export function labelArgs(labels: Record<string, string>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`])
}
