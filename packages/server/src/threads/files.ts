import { rankPaths } from '@runcastle/core'
import { simpleGit } from 'simple-git'

/**
 * The worktree's files for the composer's `@` (chat-as-web-components tickets
 * 5 and 17): what git tracks there and what it would track (untracked, not
 * ignored — a file the agent just wrote), listed once per {@link FILES_TTL_MS}
 * however fast the human types, and fuzzy-ranked per keystroke. A turn's end
 * forgets the list, since the turn may have written files.
 */

const FILES_TTL_MS = 10_000

const listed = new Map<string, { at: number; files: Promise<string[]> }>()

/** The tracked and untracked-not-ignored files of the worktree at `worktreePath`; none where git cannot list them. */
function worktreeFiles(worktreePath: string): Promise<string[]> {
  const hit = listed.get(worktreePath)
  if (hit && Date.now() - hit.at < FILES_TTL_MS) return hit.files
  let files: Promise<string[]>
  try {
    files = simpleGit(worktreePath)
      .raw(['ls-files', '--cached', '--others', '--exclude-standard'])
      .then((out) => [...new Set(out.split(/\r?\n/).filter((l) => l !== ''))])
      .catch(() => [])
  } catch {
    // simple-git refuses a directory that is not there.
    files = Promise.resolve([])
  }
  listed.set(worktreePath, { at: Date.now(), files })
  return files
}

/** Drop the worktree's cached list: the next `@` lists it afresh. */
export function forgetWorktreeFiles(worktreePath: string): void {
  listed.delete(worktreePath)
}

/** The worktree's files matching `query`, best first, at most `limit`. */
export async function matchWorktreeFiles(worktreePath: string, query: string, limit: number): Promise<string[]> {
  return rankPaths(await worktreeFiles(worktreePath), query, limit)
}
