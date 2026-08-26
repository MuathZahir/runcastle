import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where Codex keeps the credentials `codex login` writes, and the one predicate
 * that decides whether this host is logged in.
 *
 * "Codex ready" means exactly one thing everywhere — `auth.json` exists at the
 * Codex home — because that file is the artifact every surface borrows: the
 * launcher copies it into a session's synthetic `CODEX_HOME`, a container burn
 * copies it out of a read-only mount of this same directory. Testing for the
 * file is therefore the only definition that can never disagree with what a
 * burn actually does, and it is cheap enough to ask per ticket.
 *
 * Everything here is pure over an injected env and an injected file check, so
 * the doctor, the burner and their tests answer the question the same way
 * without any of them touching the real home.
 */

/** `$CODEX_HOME`, else `~/.codex` — the same resolution order the CLI uses. */
export function codexHomeDir(env: Record<string, string | undefined> = process.env): string {
  return env.CODEX_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), '.codex')
}

/** `$CODEX_HOME/auth.json` — where `codex login` writes ChatGPT/API credentials. */
export function codexAuthFile(env: Record<string, string | undefined> = process.env): string {
  return join(codexHomeDir(env), 'auth.json')
}

/**
 * Whether this host has a Codex login to lend a session or a burn. `fileExists`
 * is injected so a test can pin the answer without writing to the real home.
 */
export function codexLoggedIn(
  env: Record<string, string | undefined> = process.env,
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  return fileExists(codexAuthFile(env))
}
