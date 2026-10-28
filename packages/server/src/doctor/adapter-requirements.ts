import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { AgentRuntime } from '@runcastle/core'

/**
 * The oldest agent CLI each pinned ACP adapter can drive (ADR-0015), read from
 * the INSTALLED adapter packages so bumping a pin moves the floor with it:
 *
 * - Codex — the `@openai/codex` range `@agentclientprotocol/codex-acp` depends
 *   on (`^0.164.0` → 0.164.0).
 * - Claude Code — `claudeCodeVersion` in the package.json of the
 *   `@anthropic-ai/claude-agent-sdk` that `@agentclientprotocol/claude-agent-acp`
 *   resolves (the SDK embeds and targets that Claude Code release). Before the
 *   Claude adapter is installed, the server's own SDK is the best available
 *   statement of it. (The SDK's own version, 0.x, is not Claude Code's, so an
 *   SDK without that field yields no floor rather than a meaningless one.)
 *
 * `null` = the floor could not be read; the doctor then says nothing rather
 * than guess.
 */

const CODEX_ADAPTER = '@agentclientprotocol/codex-acp'
const CLAUDE_ADAPTER = '@agentclientprotocol/claude-agent-acp'
const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk'

/** Reads a package's `package.json` as seen from `from` (a directory), or null. */
export type ReadPackageJson = (name: string, from?: string) => { json: Record<string, unknown>; dir: string } | null

const SEMVER = /\d+\.\d+\.\d+/

export const readInstalledPackageJson: ReadPackageJson = (name, from) => {
  try {
    const require = createRequire(from ? `${from}/` : import.meta.url)
    const path = require.resolve(`${name}/package.json`)
    return { json: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>, dir: dirname(path) }
  } catch {
    return null
  }
}

function semverIn(value: unknown): string | null {
  return typeof value === 'string' ? (SEMVER.exec(value)?.[0] ?? null) : null
}

export function minimumCliVersion(
  runtime: AgentRuntime,
  read: ReadPackageJson = readInstalledPackageJson,
): string | null {
  if (runtime === 'codex') {
    const deps = read(CODEX_ADAPTER)?.json.dependencies as Record<string, unknown> | undefined
    return semverIn(deps?.['@openai/codex'])
  }
  const adapter = read(CLAUDE_ADAPTER)
  const sdk = read(CLAUDE_SDK, adapter?.dir)?.json
  return semverIn(sdk?.claudeCodeVersion)
}

/** True when semver `a` is older than `b` (numeric major.minor.patch; pre-release suffixes ignored). */
export function isOlderVersion(a: string, b: string): boolean {
  const pa = a.split(/[-+]/)[0].split('.').map(Number)
  const pb = b.split(/[-+]/)[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0)
  }
  return false
}
