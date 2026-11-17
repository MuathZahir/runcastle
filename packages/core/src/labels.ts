/**
 * The labels runcastle puts on every container, image and volume it makes
 * (runcastle-cleans-up-after-itself decision 5): they say runcastle made it and
 * which install — by its data folder — owns it, so a sweep removes only its
 * own leftovers and never another install's. Pure names, no IO.
 */

/** Present on everything runcastle makes, with the value {@link OWNER_VALUE}. */
export const LABEL_OWNER = 'runcastle.owner'
export const OWNER_VALUE = 'runcastle'
/** The absolute data folder (`dataDir()`) of the install that made it: the ownership key. */
export const LABEL_DATA_DIR = 'runcastle.data-dir'
/** The worker id a container belongs to (containers only). */
export const LABEL_WORKER = 'runcastle.worker'
/** The project id an image, volume or container belongs to. */
export const LABEL_PROJECT = 'runcastle.project'
/** The sha256 of the Dockerfile a runcastle sandbox image was built from; containers inherit it from their image. */
export const LABEL_DOCKERFILE_HASH = 'runcastle.dockerfile-hash'

/** The labels of something an install with data folder `dataDir` makes, plus `extra` (worker, project). */
export function ownerLabels(dataDir: string, extra: Record<string, string> = {}): Record<string, string> {
  return { [LABEL_OWNER]: OWNER_VALUE, [LABEL_DATA_DIR]: dataDir, ...extra }
}

/** `--label k=v` pairs for an engine's `run`, `build` or `volume create`. */
export function labelArgs(labels: Record<string, string>): string[] {
  return Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`])
}
