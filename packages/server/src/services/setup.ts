import { DEFAULT_RUNTIME, RUNTIME_DEFAULT_MODELS, type AgentRuntime } from '@runcastle/core'
import type { ExecFn, ProbeResult } from '../doctor/doctor'
import { RUNTIME_SPECS, gitIdentityProbe } from '../doctor/doctor'
import type { AppCtx } from '../db/types'
import { InvalidInputError } from '../errors'
import { updateSettings, type SettingsIO } from './settings'

/**
 * First-run setup service (issue #50). The wizard's one hard step (git
 * identity), the exact command each embedded sign-in terminal runs, and the
 * model defaults seeded from whatever the operator signed in to all live here as
 * a small, injected core so the host is never touched under test. Everything IO
 * is a passed-in seam: {@link ExecFn} for git.
 */

/**
 * Writes git identity globally — the wizard's only blocking step — then re-runs
 * the identity probe so the caller shows the freshly-written value. Rejects an
 * empty name or an `@`-less email before touching config, so the form's own
 * validation is mirrored server-side and a bad value never reaches `git`.
 */
export async function writeGitIdentity(
  exec: ExecFn,
  identity: { name: string; email: string },
): Promise<ProbeResult> {
  const name = identity.name.trim()
  const email = identity.email.trim()
  if (name.length === 0) throw new InvalidInputError('git user.name cannot be empty')
  if (!email.includes('@')) throw new InvalidInputError('git user.email must be an email address')

  await exec('git', ['config', '--global', 'user.name', name])
  await exec('git', ['config', '--global', 'user.email', email])
  return gitIdentityProbe(exec)
}

/**
 * Which runtime's curated default pair onboarding seeds from (decision 7):
 * Claude Code when it is one of the ready ones — so an operator who authed both
 * keeps today's behaviour — and otherwise whichever single runtime they did
 * auth. `undefined` when nothing is ready, which is the case the wizard refuses
 * to complete in.
 */
export function seedRuntimeFor(ready: readonly AgentRuntime[]): AgentRuntime | undefined {
  return ready.includes(DEFAULT_RUNTIME) ? DEFAULT_RUNTIME : ready[0]
}

/** What onboarding wrote: the runtime it seeded from and the values that landed. */
export interface SeededModelDefaults {
  runtime: AgentRuntime
  /** Values actually written — a key the environment pins is left alone and absent. */
  model?: string
  smoke?: string
}

/**
 * Seed the global default and smoke models from an authed runtime's curated pair
 * when onboarding completes (decision 7). Hardcoded Claude defaults are dead
 * values for a Codex-only operator, so the wizard writes real ones once — as
 * ORDINARY settings mutations, events and all, not magic that keeps re-deciding.
 *
 * A value the environment pins (`RUNCASTLE_MODEL`) is left exactly as the
 * operator pinned it: that is already a decision, and onboarding does not get to
 * overrule it. Returns `null` when no runtime is ready to seed from.
 */
export function seedModelDefaults(
  ctx: AppCtx,
  ready: readonly AgentRuntime[],
  io: SettingsIO = {},
): SeededModelDefaults | null {
  const runtime = seedRuntimeFor(ready)
  if (!runtime) return null
  const pair = RUNTIME_DEFAULT_MODELS[runtime]
  const write = (key: string, value: string): string | undefined => {
    try {
      updateSettings(ctx, { key, value }, io)
      return value
    } catch (err) {
      if (err instanceof InvalidInputError) return undefined
      throw err
    }
  }
  const model = write('model', pair.flagship)
  const smoke = write('stepModels.smoke', pair.smoke)
  return {
    runtime,
    ...(model ? { model } : {}),
    ...(smoke ? { smoke } : {}),
  }
}

/**
 * Which embedded-terminal flow to launch. Each runtime contributes a login flow
 * (`claude auth login`, `codex login`) so onboarding can auth whichever
 * providers the operator has. Workers run on the host under that same sign-in.
 */
export type TerminalKind = 'claude-login' | 'codex-login'

/** The login terminal kind for each runtime, as the wizard and settings offer it. */
export const LOGIN_TERMINAL_KIND: Record<AgentRuntime, TerminalKind> = {
  'claude-code': 'claude-login',
  codex: 'codex-login',
}

/** The exact command an embedded terminal runs, resolved for the active runtime. */
export interface TerminalSpec {
  cmd: string
  args: string[]
}

/** The command each interactive embedded-terminal flow runs: each runtime's own sign-in. */
export function terminalSpec(kind: TerminalKind): TerminalSpec {
  for (const spec of Object.values(RUNTIME_SPECS)) {
    if (kind === LOGIN_TERMINAL_KIND[spec.runtime]) return { cmd: spec.bin, args: spec.loginArgs }
  }
  throw new InvalidInputError(`no terminal command for ${kind}`)
}
