# Outcome — Codex interactive sessions die on approval_policy = "untrusted"

Interactive Codex project sessions fail on config load with `Error loading configuration: approval_policy = "untrusted" is no longer supported; remove this setting`. Cause: `approvalPolicyFor` in packages/server/src/launcher/runtimes/codex.ts:111 maps any non-acceptEdits permissionMode to `untrusted`, pinned by feature codex-project-sessions-honour-permissionmode against an older CLI. Current Codex demotes `untrusted` to an internal policy (applied via project `trust_level` in codex-rs/config/src/config_toml.rs; the AskForApproval enum comment now reads 'Internal policy for projects marked untrusted') — it is no longer settable in config.toml. Fix: change the prompting branch to `'on-request'` (the CLI default, 'model decides when to ask' — the closest supported prompting analogue; verify against ctx7 /openai/codex before pinning). Update the return type union, the doc comment above the helper (it argues for untrusted at codex.ts:97-105), and the two test assertions in packages/server/test/launch-artifacts.test.ts:849-858 that pin `approval_policy = "untrusted"` for project-kind launches (`never` for feature-kind stays untouched). Then launch an interactive Codex session to confirm the config loads.

- Shipped: 2026-09-13
- Laps run: 1

## What shipped

2 commits · 3 files

### Lap 1
- 1 tickets landed: #1 Interactive Codex project sessions fail on config load with `Error…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d201fb9d0234cbacb63de4d593cc98ebc5235da2
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes
