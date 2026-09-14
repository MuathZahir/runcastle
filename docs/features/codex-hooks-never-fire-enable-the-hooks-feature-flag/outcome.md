# Outcome — Codex hooks never fire — enable the hooks feature flag

Interactive Codex sessions never receive their kickoff line and the TUI cursor glitches (fast blinking, horizontal movement). Cause: runcastle's whole Codex lifecycle hangs off hooks.json in the synthetic CODEX_HOME (SessionStart marks the session live; only a live session gets the kickoff — packages/server/src/launcher/sessions.ts:151-174), and current Codex gates ALL hook discovery behind a feature flag: codex-rs/hooks/src/registry.rs list_hooks returns nothing when features.hooks is false ('suppressing all hooks.json file discovery'; the feature doc reads 'Enable Claude-style lifecycle hooks loaded from hooks.json files'). renderCodexConfig in packages/server/src/launcher/runtimes/codex.ts:131 never sets it, so every hook is silently skipped — no live row, no kickoff, no edit guard, no Stop/awaiting-input. Fix: emit the hooks feature flag in the generated config.toml — per registry.rs the config key is features.hooks (likely `[features]` / `hooks = true`); verify the exact TOML spelling against the live CLI via ctx7 /openai/codex before pinning (the config struct is deny_unknown_fields, so a wrong key fails the whole parse). Keep `--dangerously-bypass-hook-trust` in argv — it is still required and still exists (codex-rs/utils/cli/src/shared_options.rs). Pin with a test beside the existing renderCodexConfig assertions in packages/server/test/launch-artifacts.test.ts. Then launch an interactive Codex session end-to-end and confirm: the session goes live, the kickoff line arrives, and the cursor glitch is gone — the glitch is suspected to be attemptKickoff's clear-and-retype retries (3 attempts, 12s apart) hammering a TUI that never confirms via UserPromptSubmit; if it persists after hooks fire, report it rather than chasing it here. Do NOT redesign kickoff delivery — that is a separate feature (native-first-message-delivery).

- Shipped: 2026-09-14
- Laps run: 2

## What shipped

5 commits · 5 files

### Lap 1
- 2 tickets landed: #1 Interactive Codex sessions never receive their kickoff line and the TUI…; #3 The config pin does not establish that the missing kickoff and cursor glitch are fixed
- 0 waived
- 0 failed

### Lap 2
- 0 tickets landed
- 1 waived: #5 Lap 2 close-out: confirm the hooks pin still holds, no other change
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: c5b89a99eb27353383ccff6530bef0efbb109898
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 66f0626be69765cf68fd0fe9b83bc0a00f6b459a
- Landed since: 0
- Outcome: done

### Lap 2 · review

- Reviewed commit: 47f5c774e8c47484a7ad352e63a1297a615c2c25
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. The config pin does not establish that the missing kickoff and cursor glitch are fixed

# ticket(3) — the config pin does not establish that the kickoff and cursor glitch are fixed

## What was done

I re-ran the reviewer's repro step, as far as a Linux sandbox allows, and it still
reproduces. I could not launch on the human's Windows host, but I did drive the real
runcastle launcher in this container: real session row, real synthetic `CODEX_HOME`
(the generated `config.toml` with `[features] hooks = true`, the generated
`hooks.json`, `AGENTS.md`, a copied `auth.json`), a real `node-pty` spawn of the real
`codex-cli` 0.150.1, and the real `POST /api/hooks/*` routes behind an HTTP listener
so the hook client's posts actually landed. Result: the session never left
`launching`, `session.not_ready` fired at 25s, and no kickoff was ever typed.

I then isolated the cause in a bare PTY, away from runcastle. **Codex's interactive
TUI does not emit `SessionStart` when the terminal opens — it emits it with the first
turn, alongside that turn's `UserPromptSubmit`.** Sitting idle at a settled Codex
prompt for 30 seconds, with hook discovery on, the worktree trusted and the update
prompt pre-dismissed, produced no `SessionStart`; typing one prompt produced
`SessionStart` and `UserPromptSubmit` together. `codex exec` against the same
generated home fires all five events, so neither discovery nor hook trust is the
problem — the generated artifacts are correct.

That deadlocks runcastle's lifecycle. `markSessionLive` (the `SessionStart` receiver)
is the only caller of `scheduleKickoff`, and the kickoff is the thing that would
submit the first prompt. So the terminal sits at the prompt forever, and when a human
eventually types something the session goes live and runcastle *then* injects the
briefing on top of a conversation already in flight — which is where the
clear-and-retype churn behind the cursor glitch comes from.

Ticket 1's `[features] hooks = true` line is correct and harmless, but it cannot fix
this, so I left it alone and did not redesign kickoff delivery — the brief says to
report a persisting glitch rather than chase it, and names
`native-first-message-delivery` as the feature that owns the cure. The one change I
committed is the correction the verification forces: the `renderCodexConfig` comment
and the test it belongs to both asserted that turning hook discovery on is what
produces the `live` row and the kickoff. That is now verified false, and leaving it
would have sent the next agent down the same path. The diff is comment- and
test-title-only; no assertion or runtime behaviour changed.

## Surprises

- The proposed cause in the brief is wrong in an interesting way. Hooks were never
  being suppressed — they fire fine. They just fire *later than runcastle assumes*.
  Every downstream symptom in the brief (no live row, no kickoff, no edit guard, no
  `awaiting-input`) follows from the timing, not from discovery.
- Two blockers I chased first and ruled out, both worth not re-chasing: a synthetic
  `CODEX_HOME` with no `auth.json` drops Codex into its first-run API-key screen and
  the kickoff gets typed into the key field (I have a captured `auth.json` containing
  a runcastle kickoff line as its `OPENAI_API_KEY`) — but `checkReady` already refuses
  that launch; and a fresh home hits Codex's "Update available / Press enter to
  continue" modal once the version check caches, which also blocks `SessionStart`.
  Since runcastle builds a brand-new home per session, that modal is worth a look in
  its own right, but it is not the cause here.
- `bun` + `node-pty` in this container SIGHUPs the child within ~300ms (`sleep 3` never
  finishes), so the launcher's PTY path is only drivable under the vitest/node runtime.
  The vendored Linux prebuild also had to be bridged into the bun store path
  (`/home/agent/cache/store/bun/node-pty@1.1.0@@@1/prebuilds/linux-x64/`), not the
  `node_modules/.bun/...` path `scripts/postinstall-node-pty.ts` targets.

## Verify commands

`bun run typecheck` — clean, 0 errors.

`env -u GIT_ASKPASS bun run test` — **10 failed / 3648 passed**, in two files, neither
touched by my diff and both environmental in this container:

- `sandcastle-exec-failure.test.ts` (9) — the installed `@ai-hero/sandcastle` in this
  container's pre-warmed dependency cache does not export `formatExecFailureMessage`,
  i.e. the permanent patch of ADR-0011 is not applied here. Every failure is
  `TypeError: formatExecFailureMessage is not a function`.
- `dev-pane.test.ts` (1) — `kills the child process tree`: `kill -0 -pgid` still
  succeeds after the tree kill, a process-group semantics difference in this sandbox.
  Reproduces on a targeted re-run.

Note the suite reported 250 files / 3662 tests where the prompt's baseline says 118 /
1768, so the baseline may have been taken under a different vitest project selection.
`launch-artifacts.test.ts`, the file I edited, is 59/59 green.

No drive-machinery change was needed: this ticket adds no service, no required env
var, no seed and no process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` are
untouched and still cover the branch.

## Left undone

- **The actual fix.** An interactive Codex session cannot be kicked off while the
  briefing is gated on a `live` row that only the briefing can produce. Breaking that
  cycle belongs to `native-first-message-delivery`; Codex's CLI takes a positional
  `[PROMPT]`, which is the obvious lever, and `buildCodexArgs` is where it would go.
- **The update-available modal.** runcastle generates a fresh `CODEX_HOME` per session,
  so `version.json` never carries a `dismissed_version` and the "Press enter to
  continue" modal can appear a few seconds into startup. Seeding `version.json`, or
  whatever config key suppresses the check, would close a second pre-`SessionStart`
  dialog of exactly the kind `trust_level = "trusted"` already closes.
- **A committed end-to-end test.** I built one (real launcher + real PTY + real codex,
  gated on the binary being present) and used it to produce the finding above, but did
  not commit it: it asserts an outcome that does not hold yet, and it would have to
  stand up a real HTTP listener and a real `codex` login on every machine that runs the
  suite. It is worth rebuilding as the acceptance test for
  `native-first-message-delivery`.
