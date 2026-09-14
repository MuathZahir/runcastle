# Decisions — codex-hooks-never-fire-enable-the-hooks-feature-flag

## Lap 2 (2026-09-14, revisit)

**The feature-flag hypothesis was wrong, and the remaining defect is not this feature's to fix.**

Lap 1 established (in the landed code comments and end-to-end evidence) that
codex-cli 0.150.1 already ships hooks stable and default-on: the
`[features] hooks = true` pin in `renderCodexConfig` is a harmless defensive
setting, not the cause of the missing kickoff. The pin and its test stay.

The real remaining defect (`finding_CHbZct9aNWFR`) is a kickoff deadlock:
Codex emits SessionStart lazily at the first submitted prompt, not at TUI
startup, while runcastle only sends the kickoff to a session SessionStart has
already marked live. An idle session therefore stays `launching`, hits the
25s `session.not_ready` watchdog, and never gets its kickoff; when a human
types the first prompt, SessionStart and UserPromptSubmit arrive together,
confirming the lazy-emit behavior.

**Decision:** do not fix the deadlock here. Breaking it means changing how the
first message reaches Codex — exactly the scope of the separate
**native-first-message-delivery** feature, which the lap-1 brief already fenced
off ("Do NOT redesign kickoff delivery"). The defect is **carried** for that
feature to answer; lap 2 lands no code and emits no tickets.

Supersedes: the brief's implied claim that enabling the hooks feature flag
would make the session go live and the kickoff arrive.
