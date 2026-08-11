import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { installIdPath } from '@runcastle/core/paths'

/**
 * The anonymous install ID carried by the boot update-check, so weekly-active
 * installs are countable. A `crypto.randomUUID()` read-or-created lazily in
 * `<dataDir>/install-id` — a random value with nothing derived from the machine,
 * and nothing else is ever sent alongside it (see the README's usage signal).
 *
 * Never throws: the ID is signal-only, so a read-only or full disk yields an
 * unpersisted fresh UUID rather than wedging the check that carries it.
 */

/** A v4 UUID exactly as `crypto.randomUUID()` writes it. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getInstallId(): string {
  const file = installIdPath()
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim()
      if (UUID_RE.test(existing)) return existing
    }
    // Missing, empty, or garbage (a truncated write, a hand-edited file): the
    // honest recovery is a new ID, not a value the endpoint would reject.
    const id = randomUUID()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${id}\n`)
    return id
  } catch {
    return randomUUID()
  }
}
