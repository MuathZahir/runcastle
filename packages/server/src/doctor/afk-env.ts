import { existsSync, readFileSync } from 'node:fs'
import { AGENT_RUNTIMES } from '@runcastle/core'
import { envPath } from '@runcastle/core/paths'
import { parseEnvFile } from '../workflows/ticket-burner'
import { RUNTIME_SPECS } from './doctor'

/**
 * Merge every runtime's AFK credential from `~/.runcastle/.env` over
 * `process.env`, so the doctor's `afk-key` probes see a token the operator
 * saved rather than only one their shell happened to export.
 *
 * Read fresh on every call, never snapshotted at boot: the AFK card writes that
 * file through `setup.afkToken` while the server is running, and the very next
 * doctor query has to see it (issue #50).
 */
export function envWithAfkCredentials(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env }
  try {
    const path = envPath()
    if (existsSync(path)) {
      const fromFile = parseEnvFile(readFileSync(path, 'utf8'))
      for (const runtime of AGENT_RUNTIMES) {
        const key = RUNTIME_SPECS[runtime].afkKey
        const value = fromFile[key]
        if (value && value.length > 0) merged[key] = value
      }
    }
  } catch {
    // A malformed/unreadable .env just means the key probes report it unset.
  }
  return merged
}
