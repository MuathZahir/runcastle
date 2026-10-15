import type { Project } from '@runcastle/core'
import type { AppCtx } from '../db/types'

/**
 * What the orchestrator hears about its features (`whole-cuts-plan-themselves`
 * decision 11): one `[runcastle]` line typed into its terminal while it is live,
 * and a catch-up list in its briefing when the human reopens it.
 *
 * Sockets for now — the notifier and the catch-up are filled in by a later
 * ticket of this lap. The launch and the boot already call them.
 */

/**
 * One line per thing that ended on the orchestrator's features since the
 * project's last orchestrating session ended, oldest first.
 */
export function orchestratorCatchUp(_ctx: AppCtx, _project: Project): string[] {
  return []
}

/**
 * Subscribe the notifier to the live event bus; returns the unsubscribe. Called
 * once at boot.
 */
export function startOrchestratorNotifier(_ctx: AppCtx): () => void {
  return () => {}
}
