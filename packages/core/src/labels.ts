/**
 * The labels runcastle put on every container, image and volume it made
 * (runcastle-cleans-up-after-itself decision 5): they say runcastle made it and
 * which install, by its data folder, owns it. Runcastle makes none now; the
 * upgrade step reads them to find only this install's leftovers. Pure names, no IO.
 */

/** Present on everything runcastle made, with the value {@link OWNER_VALUE}. */
export const LABEL_OWNER = 'runcastle.owner'
export const OWNER_VALUE = 'runcastle'
/** The absolute data folder (`dataDir()`) of the install that made it: the ownership key. */
export const LABEL_DATA_DIR = 'runcastle.data-dir'
/** The worker id a container belonged to (containers only). */
export const LABEL_WORKER = 'runcastle.worker'
/** The project id an image, volume or container belonged to. */
export const LABEL_PROJECT = 'runcastle.project'
/** The sha256 of the Dockerfile a runcastle sandbox image was built from; containers inherit it from their image. */
export const LABEL_DOCKERFILE_HASH = 'runcastle.dockerfile-hash'
