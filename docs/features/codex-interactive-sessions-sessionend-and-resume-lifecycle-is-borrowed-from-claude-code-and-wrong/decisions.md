# Decisions

All grounded in the live verification of codex-cli 0.153.4 recorded in
`research/live-verification.md` (real PTY, real auth, runcastle-shaped
synthetic `CODEX_HOME`).

## 1. PTY exit is the sole `ended` trigger for Codex sessions
**Decision:** For sessions with `runtime='codex'`, the `SessionEnd` hook no
longer marks the row `ended`; the row's status is flipped to `ended` only by
`handlePtyExit`. (Refined by decision 4: SessionEnd keeps no teardown
side-effects for codex either.) The Claude runtime's path is untouched
(ADR-0009); the branch is per-runtime in the hooks route.
**Why:** Verified: codex's TUI emits SessionEnd once at real quit, ~1.6s
before process exit — so PTY exit is an honest, slightly-later end signal,
and any in-TUI rollover that fires SessionEnd while the process lives (the
`/new`-shaped flip Claude sessions demonstrably do) can no longer show a
"Resume session" button over a terminal that is still running. Resume is
offered only when the terminal really is gone.

## 2. Resume with no resumable conversation: spawn fresh, but announce it
**Decision:** When the resume path finds no resumable conversation (no ended
row with a `ccSessionId`), still spawn the terminal, but emit a timeline
event (`session.resume_unavailable`: "no resumable conversation was recorded
— starting a fresh session") instead of today's silent cold start.
**Why:** A Codex row that dies before its first submitted turn never got a
SessionStart, so it has no `ccSessionId`. Since
`native-first-message-delivery` shipped (2026-09-15: kickoff rides argv at
spawn, so turn 1 submits immediately; its ticket 3 also carries the rollout
store across synthetic homes — the former dominant resume failure), this is
an edge case rather than the common case — but the edge (spawn dies before
the first turn completes, update-modal-blocked boot, human closes instantly)
still exists, and silence there makes Resume look broken. Refusing to launch
would add a click to a situation runcastle caused.

## 3. Suppress the update-available modal in session homes
**Decision:** `renderCodexConfig` adds top-level
`check_for_update_on_startup = false` to every session's synthetic
`config.toml`, pinned in the existing config-render test. The human's own
`~/.codex/config.toml` is untouched — their personal codex keeps its update
prompts.
**Why:** Verified live: with an update pending, a synthetic-`CODEX_HOME` TUI
boots into a blocking "Update available" dialog — the composer is dead, the
argv kickoff cannot submit, no hook fires, and the highlighted default is
"Update now (runs npm install -g)", a global self-update one Enter away.
Copying the human's `version.json` does not suppress it; the config key does
(verified parse + no modal on 0.153.4). Updates are the human's business in
their own codex, never a runcastle terminal's.

## 4. PTY exit is the single teardown point for Codex sessions
**Decision:** For codex sessions, ALL end-of-session bookkeeping runs at PTY
exit: `ended` status, waypoint auto-release, project-session landing, and
the resolve-conflict merge probe (the exit handler already does the first
three; the merge probe joins them for codex). The codex `SessionEnd` handler
shrinks to one thing: a truthful timeline note ("conversation ended
(reason: …)") carrying codex's `reason` payload field, distinguishing
when the conversation closed from when the terminal died.
**Why:** If SessionEnd (while the PTY lives) still released waypoints or
probed merges, an in-TUI conversation rollover would tear down a session
whose terminal is still open — the same dishonesty as the premature Resume
button, one layer down. Verified: codex fires SessionEnd ~1.6s before
process exit at real quit, so PTY-exit teardown costs only that lag.
**Guard-rail (operator's):** no change may alter Claude-session behaviour;
anything shared that must move gets a per-runtime branch, and if a shared
seam genuinely has to change shape, the Claude side is updated in the same
ticket with its tests, never left implicitly drifted.

## 5. Tests are unit tests at the changed seams; no committed live-CLI e2e
**Decision:** Pin the new behaviour with unit tests where it changed:
hooks-route (codex SessionEnd leaves row status untouched + emits the
reason note; Claude SessionEnd still ends the row — both directions pinned),
launcher (`handlePtyExit` full codex teardown including the merge probe;
`session.resume_unavailable` on the no-id resume path), and the config
render test extended for `check_for_update_on_startup = false`. No committed
end-to-end test gated on the codex binary.
**Why:** The burn sandbox has no TTY and no credentials, so a live-CLI e2e
would never run where tests run. The live-verification harness survives in
this feature's `prototypes/` (drive.ts / hooklog.ts / decode.py) with its
findings in `research/live-verification.md`, rerunnable by hand on the host
when codex bumps versions — the honest form of that e2e.

## 6. One lap; branch takes main before burn
**Decision:** Sure-and-small: one lap, spec the whole thing, no
`## Later laps`. Before tickets burn, the feature branch merges current main
(post-`native-first-message-delivery`, shipped 2026-09-15) — the tickets
name seams that feature reshaped (argv kickoff, deleted typing machinery,
rollout carry-across on resume).
**Why:** The design tree is narrow and every open question was closed by
live verification; splitting laps would only defer landed certainty. Burning
against the pre-merge branch would have agents patching deleted code.
