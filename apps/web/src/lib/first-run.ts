/**
 * First-run wizard sequencing (finding F13) and provider readiness (decision 6).
 *
 * Three decisions the wizard card should not make inline: where setup begins,
 * how a step the host already satisfies is shown, and when the operator has
 * enough of a coding agent to leave. Starting silently on step 2 reads as a step
 * that was never checked — so an auto-satisfied step keeps its row, wears a
 * checkmark, and carries what was detected.
 */

import { AGENT_RUNTIMES, type AgentRuntime } from '@runcastle/core'
import { RUNTIME_LABEL } from './settings'

/** The setup steps, in order. The intro screen sits before all of them. */
export type SetupStep = 'identity' | 'runtimes' | 'afk' | 'project'

/** Every screen the wizard can show — the intro is not a setup step. */
export type WizardScreen = 'intro' | SetupStep

/** The shape of a doctor probe result, structurally (keeps this module IO-free). */
export interface ProbeLike {
  status: string
  detail: string
  fix?: string
  /** Set on the per-runtime probes: whose readiness this reports. */
  runtime?: AgentRuntime | null
  /** Set on the per-runtime probes: `binary`, `auth` or `afk-key`. */
  check?: string | null
}

/**
 * `passed` is the honest state for a step the host satisfied before the user
 * arrived; `done` is one they walked through themselves.
 */
export type StepState = 'passed' | 'done' | 'current' | 'todo'

export interface WizardStepRow {
  key: SetupStep
  label: string
  state: StepState
  /** What was already in place — set on `passed` rows only. */
  detected?: string
}

const SETUP_ORDER: { key: SetupStep; label: string }[] = [
  { key: 'identity', label: 'Git identity' },
  { key: 'runtimes', label: 'Coding agents' },
  { key: 'afk', label: 'AFK burns' },
  { key: 'project', label: 'First project' },
]

/** Setup opens on the first step the host has not already satisfied for us. */
export function firstSetupStep(identity: ProbeLike | undefined): SetupStep {
  return identity?.status === 'ok' ? 'runtimes' : 'identity'
}

/** The step after `current`, or `undefined` on the last one. */
export function nextSetupStep(current: SetupStep): SetupStep | undefined {
  return SETUP_ORDER[SETUP_ORDER.findIndex((s) => s.key === current) + 1]?.key
}

/**
 * Each runtime's interactive sign-in: the embedded-terminal flow to spawn and
 * the command it runs, named so the button says exactly what will happen.
 */
export const RUNTIME_LOGIN: Record<
  AgentRuntime,
  { kind: 'claude-login' | 'codex-login'; command: string }
> = {
  'claude-code': { kind: 'claude-login', command: 'claude auth login' },
  codex: { kind: 'codex-login', command: 'codex login' },
}

/** One provider card: what was detected about a runtime, and what it unlocks. */
export interface RuntimeReadiness {
  runtime: AgentRuntime
  label: string
  /** Its CLI is resolvable. */
  installed: boolean
  /** Its CLI reports an interactive login. */
  authed: boolean
  /** Its unattended credential is in place — see {@link runtimeReadiness}. */
  afkReady: boolean
  /** Enough to open talk sessions on this runtime. */
  talkReady: boolean
  /** What the CLI probe actually found. */
  detail: string
  /** How to install it, when it is not here. */
  installFix?: string
}

/**
 * The provider cards, one per runtime, folded out of the doctor report. Both
 * runtimes are always shown as peers: which ones the operator has is the
 * question the step exists to answer, so a missing one is a card saying how to
 * get it, not an absence.
 *
 * `talkReady` accepts EITHER an interactive login or the unattended credential,
 * because both really do authenticate a session — an operator who pasted a
 * token is not sent back to log in a second time.
 *
 * For Codex the two are one thing: a burn borrows the very file `codex login`
 * writes, so its AFK credential IS the login (decision 4) and there is no key
 * that could make it ready without one. Claude Code keeps the separate token.
 */
export function runtimeReadiness(probes: readonly ProbeLike[]): RuntimeReadiness[] {
  return AGENT_RUNTIMES.map((runtime) => {
    const of = (check: string) => probes.find((p) => p.runtime === runtime && p.check === check)
    const binary = of('binary')
    const installed = binary?.status === 'ok'
    const authed = of('auth')?.status === 'ok'
    const afkReady = runtime === 'codex' ? authed : of('afk-key')?.status === 'ok'
    return {
      runtime,
      label: RUNTIME_LABEL[runtime],
      installed,
      authed,
      afkReady,
      talkReady: installed && (authed || afkReady),
      detail: binary?.detail ?? 'not checked',
      ...(installed || !binary?.fix ? {} : { installFix: binary.fix }),
    }
  })
}

/**
 * The runtimes onboarding may seed defaults from — the ones actually ready to
 * open a session. At least one of these is the wizard's whole gate: runcastle
 * needs a coding agent, not a particular vendor's (decision 6).
 */
export function readyRuntimes(cards: readonly RuntimeReadiness[]): AgentRuntime[] {
  return cards.filter((c) => c.talkReady).map((c) => c.runtime)
}

/**
 * What the git-identity probe found, phrased for a human. An unset probe's detail
 * is a complaint ("commits would fail"), not a value — so it detected nothing.
 */
function detectedIdentity(identity: ProbeLike | undefined): string | undefined {
  return identity?.status === 'ok' ? `detected from git config: ${identity.detail}` : undefined
}

/**
 * The stepper rows for the screen being shown. Git identity is the only step the
 * host can satisfy on its own, so it is the only one that can come out `passed`
 * — a runtime the host already has still gets its step, because choosing which
 * providers to use is the operator's call, not a detection result.
 */
export function wizardSteps(current: SetupStep, identity: ProbeLike | undefined): WizardStepRow[] {
  const idx = SETUP_ORDER.findIndex((s) => s.key === current)
  const detected = detectedIdentity(identity)
  return SETUP_ORDER.map((s, i) => {
    if (s.key === 'identity' && i < idx && detected)
      return { ...s, state: 'passed' as StepState, detected }
    return { ...s, state: i < idx ? 'done' : i === idx ? 'current' : 'todo' }
  })
}
