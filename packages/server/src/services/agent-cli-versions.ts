import { AGENT_RUNTIMES, type AgentRuntime } from '@runcastle/core'
import { type ExecFn, RUNTIME_SPECS } from '../doctor/doctor'
import { resolveTool } from '../util/resolve-executable'

/**
 * The agent CLI versions the host runs (feature
 * `sandbox-agent-clis-track-the-host-version`, decisions 2 and 4). The sandbox
 * runs whatever the host runs: Rebuild pins the image's installs to these, the
 * image carries them as labels, and the doctor and the burn preflight compare
 * against them. One resolver so those three never disagree about the target.
 *
 * `null` for a runtime means "not on host, or not readable" — never drift, since
 * there is nothing to drift from.
 */
export type HostAgentVersions = Record<AgentRuntime, string | null>

/** A bare semver, with an optional pre-release/build suffix. */
const SEMVER = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/

/**
 * The first bare semver in a CLI's `--version` output, or null. Both formats
 * the two CLIs print reduce to it: `2.1.280 (Claude Code)` and `codex-cli 0.46.0`.
 */
export function parseAgentCliVersion(text: string): string | null {
  return SEMVER.exec(text)?.[0] ?? null
}

/** The host versions, and a named problem for each runtime whose CLI is there but unreadable. */
export interface HostAgentVersionsResult {
  versions: HostAgentVersions
  problems: Partial<Record<AgentRuntime, string>>
}

/**
 * The CLI is somewhere this server can see it — the same test the runtimes'
 * `checkReady` makes: `resolveTool` falls back to the bare name when its PATH
 * scan and well-known dirs both come up empty.
 */
function onHost(bin: string): boolean {
  return resolveTool(bin) !== bin
}

/**
 * Ask each agent CLI on the host for its version. A CLI that is simply absent
 * is `null` with no problem (decision 4: not on host, not checked). One that is
 * there but fails to spawn, exits non-zero, or prints no version is `null` too —
 * the build then goes ahead unpinned for that runtime — but with a problem
 * naming the doctor's fix (decision 8), since the human believes it is installed.
 */
export async function resolveHostAgentVersions(
  exec: ExecFn,
  present: (bin: string) => boolean = onHost,
): Promise<HostAgentVersionsResult> {
  const versions = {} as HostAgentVersions
  const problems: Partial<Record<AgentRuntime, string>> = {}
  await Promise.all(
    AGENT_RUNTIMES.map(async (runtime) => {
      versions[runtime] = null
      const { bin, label } = RUNTIME_SPECS[runtime]
      if (!present(bin)) return
      const out = await exec(bin, ['--version'])
      const version = out.ok && out.code === 0 ? parseAgentCliVersion(out.stdout) : null
      if (version !== null) {
        versions[runtime] = version
        return
      }
      const why = !out.ok
        ? `\`${bin} --version\` could not be started`
        : out.code !== 0
          ? `\`${bin} --version\` exited ${out.code}`
          : `\`${bin} --version\` printed no version`
      problems[runtime] =
        `Could not read the host's ${label} version (${why}), so the image installs the latest ` +
        `${label} CLI instead of pinning it. Run \`runcastle doctor\` and fix its "${label} CLI" ` +
        `probe, then restart runcastle from a terminal where \`${bin} --version\` works.`
    }),
  )
  return { versions, problems }
}
