import type { Feature, Project, RuncastleConfig, SessionRow } from '@runcastle/core'
import { NotImplementedError } from '../errors'

/**
 * Session launch artifacts — WAVE B1 (SPEC §5.2). Writes `system-prompt.md`,
 * `settings.json` (hooks), and `mcp.json` into `sessionDir(sessionId)`. Typed
 * stub: the signature + returned paths are final so B1 replaces only the body.
 */

export interface SessionArtifacts {
  systemPromptPath: string
  settingsPath: string
  mcpConfigPath: string
}

export interface WriteArtifactsInput {
  session: SessionRow
  feature: Feature
  project: Project
  config: RuncastleConfig
}

export async function writeSessionArtifacts(
  input: WriteArtifactsInput,
): Promise<SessionArtifacts> {
  void input
  throw new NotImplementedError('B1')
}
