import { nanoid } from 'nanoid'

/**
 * Generate a prefixed id, e.g. `newId('feat')` -> `feat_x1y2z3a4b5c6`.
 * Prefix identifies the entity kind (feat, tkt, sess, run, proj, ...).
 */
export function newId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`
}
