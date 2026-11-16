import type * as acp from '@agentclientprotocol/sdk/unstable'

/**
 * How runcastle answers a permission request (`agents-never-stop-for-approval`
 * decisions 1, 4, 6): itself, at once, never by asking the human.
 *
 * Runcastle starts its agents in a no-approval mode, yet the CLI still sends
 * some requests on purpose: Claude Code's own safety checks, the human's ask
 * rules, tools that need the user (leaving plan mode), Codex's escalations,
 * every action of a session whose no-approval mode was switched off (a root
 * install). Each is allowed once. What must never run is refused before any of
 * this, by the pre-tool guards (the remote guard among them), which hold in
 * every mode.
 *
 * - Leaving plan mode: the option back into an elevated mode. The adapter
 *   lists them with the session's mode from before plan mode first (bypass for
 *   a lead, auto for a sandbox worker), so the first one listed is taken. A
 *   clear-context option is never picked: it would drop the conversation.
 * - Anything else: the allow-once option. Never an "always" option, which
 *   would write a rule to a settings file.
 * - A request with no allowing option at all is refused, so it never waits.
 */
export function permissionAnswer(req: acp.RequestPermissionRequest): { optionId: string; kind: string } | null {
  const pick = (o: acp.PermissionOption | undefined) => (o ? { optionId: o.optionId, kind: o.kind } : null)
  const planExit = req.options.find((o) => PLAN_EXIT_ELEVATED.has(o.optionId))
  if (planExit) return pick(planExit)
  const once = req.options.find((o) => o.kind === 'allow_once')
  if (once) return pick(once)
  return pick(req.options.find((o) => o.kind === 'reject_once') ?? req.options.find((o) => o.kind === 'reject_always'))
}

/** claude-agent-acp's plan-exit options that keep the conversation and leave plan mode into an elevated mode. */
const PLAN_EXIT_ELEVATED = new Set(['exit-plan-bypass', 'exit-plan-auto', 'exit-plan-accept-edits'])
