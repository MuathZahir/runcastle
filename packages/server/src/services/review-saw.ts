import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { SawEntry } from '@runcastle/core'
import { reviewSawDir, reviewSawLogPath } from '@runcastle/core/paths'

/**
 * A review pass's log of what it saw, beside its walkthrough. Paths and files
 * only, because the burner imports this and most services import the burner.
 */

/** Open the pass's log. Its presence says the pass kept a record, even an empty one. */
export function startSaw(ticketId: string): void {
  mkdirSync(reviewSawDir(ticketId), { recursive: true })
  writeFileSync(reviewSawLogPath(ticketId), '', 'utf8')
}

/** Add one entry. A record that cannot be written never costs the review its call. */
export function appendSaw(ticketId: string, entry: SawEntry): void {
  try {
    mkdirSync(reviewSawDir(ticketId), { recursive: true })
    appendFileSync(reviewSawLogPath(ticketId), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    console.error(`[review] could not record what ticket ${ticketId} saw: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The pass's log; a line cut off by a crash is dropped. Empty for a pass from before there were logs. */
export function readSaw(ticketId: string): SawEntry[] {
  const path = reviewSawLogPath(ticketId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return []
      try {
        return [JSON.parse(line) as SawEntry]
      } catch {
        return []
      }
    })
}
