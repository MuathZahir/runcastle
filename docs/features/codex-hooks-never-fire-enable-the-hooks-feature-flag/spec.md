# Spec — codex-hooks-never-fire-enable-the-hooks-feature-flag

This feature came through the quick-change door; brief.md is the lap-1
statement of intent. This spec exists to record lap 2's scope.

## Lap 2 scope

None. Lap 1 landed the `[features] hooks = true` pin in `renderCodexConfig`
(packages/server/src/launcher/runtimes/codex.ts) with a test in
packages/server/test/launch-artifacts.test.ts, and established that the flag
was not the cause of the missing kickoff — codex-cli 0.150.1 already enables
hooks by default.

The remaining kickoff deadlock (Codex emits SessionStart lazily at the first
submitted prompt; runcastle gates the kickoff on SessionStart) is carried to
the **native-first-message-delivery** feature, per `decisions.md` § Lap 2.
Lap 2 emits no tickets and changes no code.

## Out of scope

- Any change to kickoff delivery, session-live gating, or `attemptKickoff`
  retry behavior — all of it belongs to native-first-message-delivery.
- Removing the `[features] hooks = true` pin — it stays as a defensive
  setting.
