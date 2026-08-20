import type { AgentRuntime } from '@runcastle/core'
import { GateError } from '../../errors'
import { claudeRuntime } from './claude'
import { codexRuntime } from './codex'
import type { AgentRuntimeAdapter } from './types'

export type {
  AgentRuntimeAdapter,
  RuntimeLaunchInput,
  RuntimeLaunchSpec,
  RuntimeReadiness,
} from './types'

/**
 * The runtime registry: which adapter launches a session, decided by the
 * `runtime` of whichever model won the `resolveModel` chain (decision 2 —
 * runtime is a property of the model, never a knob of its own).
 */

const BUILT_IN: readonly AgentRuntimeAdapter[] = [claudeRuntime, codexRuntime]

const adapters = new Map<AgentRuntime, AgentRuntimeAdapter>(BUILT_IN.map((a) => [a.id, a]))

/**
 * The adapter for a runtime. A runtime with no adapter throws HERE — before a
 * session row, a worktree or an artifact exists — rather than letting the launch
 * proceed to a spawn of a CLI nobody wired up.
 */
export function runtimeAdapterFor(id: AgentRuntime): AgentRuntimeAdapter {
  const adapter = adapters.get(id)
  if (!adapter) {
    throw new GateError(
      `no agent runtime is wired up for ${id} — the model this step resolves to runs on ${id}; ` +
        'pick a model from a supported runtime in Settings.',
    )
  }
  return adapter
}

/**
 * Register an adapter, replacing any adapter for the same runtime. This is the
 * seam a runtime is added through — and the one tests drive the launcher's
 * runtime dispatch from, with {@link resetRuntimeAdapters} restoring the
 * built-in set afterwards.
 */
export function registerRuntimeAdapter(adapter: AgentRuntimeAdapter): void {
  adapters.set(adapter.id, adapter)
}

/** Restore the built-in adapter set (test teardown — see {@link registerRuntimeAdapter}). */
export function resetRuntimeAdapters(): void {
  adapters.clear()
  for (const adapter of BUILT_IN) adapters.set(adapter.id, adapter)
}
