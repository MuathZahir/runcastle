import type { SessionKind } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { NotImplementedError } from '../errors'

/**
 * Session launcher — WAVE B1 (SPEC §5). Spawns an injected Claude Code terminal
 * via `wt.exe`, creating the session row + talk worktree + launch artifacts.
 * Typed stub: `launchSession` signature is final so B1 replaces only the body.
 */

export interface LaunchSessionInput {
  featureId: string
  kind: SessionKind
}

export interface LaunchSessionResult {
  sessionId: string
}

export async function launchSession(
  ctx: AppCtx,
  input: LaunchSessionInput,
): Promise<LaunchSessionResult> {
  void ctx
  void input
  throw new NotImplementedError('B1')
}
