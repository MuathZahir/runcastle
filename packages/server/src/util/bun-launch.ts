/**
 * The one way runcastle starts Bun (sessions-never-pick-up-a-project-s-api-key).
 *
 * Bun loads `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` from the
 * folder any Bun process starts in, before a line of our code runs. Runcastle
 * starts Bun in project folders (the ACP adapters and the hook client run in the
 * feature worktree, or the human's checkout for host workers), so a project's
 * `ANTHROPIC_API_KEY` would reach Claude Code and be billed over the human's
 * subscription. Every runcastle Bun launch therefore carries `--no-env-file`.
 *
 * A guard test (`bun-launch-guard.test.ts`) fails on any Bun launch in the
 * server's source that does not come through here. The project's own commands
 * (dev pane, drive hooks, scenarios, design server) are not runcastle launches
 * and must keep reading the project's `.env`: they never come through here.
 */

/** Bun's switch that turns off its `.env` autoload for one process. */
export const NO_ENV_FILE = '--no-env-file'

/** A direct spawn of this Bun with `.env` loading off: `{ command, args }`. */
export function bunSpawn(args: readonly string[]): { command: string; args: string[] } {
  return { command: process.execPath, args: [NO_ENV_FILE, ...args] }
}

/**
 * The shell line Claude Code or Codex runs for one hook event. It names the
 * `bun` on PATH, as the hook client always has: the hook runs from the agent's
 * shell, not from this process.
 */
export function bunHookCommand(hookClient: string, event: string): string {
  return `bun ${NO_ENV_FILE} run "${hookClient}" ${event}`
}

/**
 * The Agent SDK options that keep a JavaScript `claude` CLI from loading `.env`.
 * Under Bun the SDK starts a `.js` CLI with `bun`; the native binary does not
 * read `.env` and takes no runtime arguments, so it gets none. Off Bun (node
 * runs the tests) the SDK picks `node`, which has no such flag.
 */
export function sdkExecutableArgs(
  pathToClaudeCodeExecutable: string,
  underBun: boolean = process.versions.bun !== undefined,
): { executableArgs?: string[] } {
  return underBun && /\.(c|m)?js$/i.test(pathToClaudeCodeExecutable) ? { executableArgs: [NO_ENV_FILE] } : {}
}
