import { simpleGit } from 'simple-git'
import { fuzzyFiles } from './controls'

/**
 * The worktree's files for the composer's `@` (chat-as-web-components ticket
 * 5): what git tracks there, listed once per {@link FILES_TTL_MS} however fast
 * the human types, and fuzzy-matched per keystroke.
 */

const FILES_TTL_MS = 30_000

const listed = new Map<string, { at: number; files: Promise<string[]> }>()

/** The tracked files of the worktree at `worktreePath`; none where git cannot list them. */
function trackedFiles(worktreePath: string): Promise<string[]> {
  const hit = listed.get(worktreePath)
  if (hit && Date.now() - hit.at < FILES_TTL_MS) return hit.files
  let files: Promise<string[]>
  try {
    files = simpleGit(worktreePath)
      .raw(['ls-files'])
      .then((out) => out.split(/\r?\n/).filter((l) => l !== ''))
      .catch(() => [])
  } catch {
    // simple-git refuses a directory that is not there.
    files = Promise.resolve([])
  }
  listed.set(worktreePath, { at: Date.now(), files })
  return files
}

/** The worktree's tracked files matching `query`, shortest first, at most `limit`. */
export async function matchWorktreeFiles(worktreePath: string, query: string, limit: number): Promise<string[]> {
  return fuzzyFiles(await trackedFiles(worktreePath), query, limit)
}
