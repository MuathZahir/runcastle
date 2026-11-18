import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A project folder whose `.env` holds a fake Anthropic key, for the tests that
 * prove no runcastle Bun process reads it (sessions-never-pick-up-a-project-s-api-key).
 */
export const SENTINEL_KEY = 'sk-ant-sentinel-from-project-dotenv'

/** Prints the Anthropic key the process sees, or `<unset>`. */
const PRINT_KEY = "process.stdout.write('KEY=' + (process.env.ANTHROPIC_API_KEY ?? '<unset>'))\n"

export interface DotenvFolder {
  dir: string
  /** A script in the folder that prints `KEY=<what it sees>`. */
  fixture: string
  cleanup: () => void
}

export function makeDotenvFolder(): DotenvFolder {
  const dir = mkdtempSync(join(tmpdir(), 'rc-dotenv-'))
  writeFileSync(join(dir, '.env'), `ANTHROPIC_API_KEY=${SENTINEL_KEY}\n`)
  const fixture = join(dir, 'print-key.ts')
  writeFileSync(fixture, PRINT_KEY)
  return { dir, fixture, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** The test runner's env without any Anthropic key, so only the `.env` could supply one. */
export function envWithoutAnthropicKey(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

/** Runs a command and returns its stdout, failing loudly on a non-zero exit. */
export function runOut(command: string, args: readonly string[], opts: SpawnSyncOptions): string {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...opts })
  if (r.status !== 0) throw new Error(`${command} exited ${r.status}: ${String(r.stderr)}`)
  return String(r.stdout)
}

/**
 * Runs an ACP launch spec's arguments under a real Bun, from a folder whose
 * `.env` holds the sentinel, with a fixture in place of the adapter entry (the
 * spec's last argument). Returns what the fixture saw. The suite runs under
 * node, so `spec.command` (`process.execPath`) is node here; `bun` stands in.
 */
export function keySeenByLaunchSpec(bun: string, spec: { args: readonly string[]; env: Record<string, string> }): string {
  const folder = makeDotenvFolder()
  try {
    const args = [...spec.args.slice(0, -1), folder.fixture]
    return runOut(bun, args, { cwd: folder.dir, env: { ...envWithoutAnthropicKey(), ...spec.env } })
  } finally {
    folder.cleanup()
  }
}
