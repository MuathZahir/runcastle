# Decisions — native-first-message-delivery-for-session-kickoffs

## 1. One lap, spec the whole thing
**Decision:** Sure-and-small: a single lap covering fresh-launch argv delivery for both runtimes, the resume/resend story, and demoting the type-and-confirm loop to a fallback. The uncertain corner — `codex queue` on Windows — is handled inside the spec as "attempt queue, fall back to PTY on failure", not split into a later lap.
**Why:** The feature lives almost entirely in `packages/server/src/launcher/`; the mechanisms are verified against the Codex source (TUI positional prompt; `codex queue --thread --message` over a `$CODEX_HOME` socket) and the design tree is narrow enough to converge in one session.

## 2. Argv for fresh launches; resume sends nothing
**Decision:** Fresh launches deliver the kickoff as the CLI's positional initial prompt in argv, both runtimes (`claude "<line>" …flags` / `codex "<line>" …flags`). Resumed sessions send NO kickoff at all — `--resume <id>` / `resume <id>` restores the conversation, the original briefing is already in its history, and the injected system prompt carries the task regardless. `resumeKickoffLine` and the resume-framing prefix die. No `codex queue`, no Claude inbox-socket integration — not this lap, not planned for later laps.
**Why:** Injection-into-a-running-session was only ever needed because delivery happened after go-live; moving delivery to spawn removes the need. Interactive `codex resume` takes no prompt positional and interactive `claude --resume <id> "<prompt>"` is undocumented — rather than build queue/socket machinery for those, the human cut the requirement: a restored conversation doesn't need to be re-briefed. (Superseded during the grill: an earlier version of this decision had Codex resume attempting `codex queue` with PTY fallback.)

## 3. Resume reliability is in scope
**Decision:** This feature also investigates and fixes why "Resume Session" sometimes starts a new chat: for Codex, whether the synthetic CODEX_HOME loses or relocates session rollouts between launches (also why interactive /resume shows nothing); for Claude, whether a stale/wrong `ccSessionId` is passed to `--resume`. Fixed here, not parked.
**Why:** Native delivery rides the same `ccSessionId` (argv `--resume`, `codex resume <id>`) — and with resume now sending no kickoff at all (decision 2), a resume that silently starts cold leaves an empty, briefing-less session, so resume actually working matters more, not less. The human explicitly folded it in.

## 4. Delete the PTY kickoff machinery — no fallback, no button
**Decision:** The type-and-confirm apparatus is deleted outright, not demoted: `writeKickoffSequence`, `KickoffDelivery`, `attemptKickoff`, the retry loop, `noteKickoffPrompt` / `promptMatchesKickoff`, the delay/confirmation timing constants, `resendKickoff`, the `feature.resendKickoff` tRPC endpoint, and the UI "Send briefing" button. The kickoff-override map (`setKickoffOverride`) survives but is consumed at argv-build time (lap briefings from the Iterate click still arrive as overrides before spawn).
**Why:** With fresh = argv and resume = nothing, the typing path has no caller. The button existed only as an escape hatch for unreliable PTY delivery; argv delivery removes the unreliability at the source. Keeping dead machinery "as fallback" would be complexity with no trigger.

## 5. No watchdog; kickoff telemetry shrinks to one spawn-time event
**Decision:** No delivery confirmation of any kind. `session.kickoff_undelivered` is removed everywhere (emitter, event type, UI handling). `session.kickoff` survives as a single event emitted at spawn recording the briefing the session was opened with (and that it rode argv). The `UserPromptSubmit` hook keeps its other duties but no longer feeds kickoff confirmation.
**Why:** The injected system prompt (`--append-system-prompt-file` / CODEX_HOME instructions) already tells the agent its job — the human has watched an unbriefed agent pick the correct skill on its own. If argv delivery ever silently failed, the visible symptom is an idle terminal the human nudges with a single message; that does not warrant standing machinery. (The human: "I don't think we even need the watchdog.")

## 6. No file-based delivery path; pin argv encoding with a test
**Decision:** Kickoff lines ride argv as-is, all sizes. No file-based or queue-based overflow path. Guard rails: a unit test pinning that a kickoff line containing double quotes/apostrophes survives the Windows argv encoding (node-pty command-line builder) intact, and a build-time sanity assert (`MAX_KICKOFF_ARGV`-style) that throws loudly if a line ever approaches the ~32K Windows command-line ceiling.
**Why:** All kickoff lines — including `lapKickoff` with carried work — are runcastle-generated, single-line, realistically 1–3KB; the ceiling is not a practical risk, but silent quote-mangling and silent truncation would be, so both are pinned by test/assert instead of routed around with machinery.

Verified facts (ctx7 /openai/codex, 2026-09-14):
- Fresh Codex TUI accepts a positional initial prompt.
- Interactive `codex resume <id>` takes NO prompt positional (only `codex exec resume` does) — resumed Codex needs `codex queue` or the PTY fallback.
- `codex queue` resolves the session via `$CODEX_HOME/app-server-control/app-server-control.sock` (Unix socket — Windows behavior unproven) and refuses to queue through an embedded app server while a daemon runs.
- Claude Code: positional prompt at spawn; `--resume <id>` plus positional prompt is the documented interactive-resume shape (smoke-test in a ticket).
