# Native first-message delivery for session kickoffs

## Problem

Every runcastle session opens with a kickoff line — the per-kind briefing that tells the agent to invoke its skill and get to work. Today that line is delivered by literally typing into the PTY after the session goes live, waiting, pressing Enter, and then watching the `UserPromptSubmit` hook to find out whether the CLI actually accepted it — retrying up to three times before giving up with `session.kickoff_undelivered`. The human has watched it fail ("doesn't always work reliably"), it races the TUI's startup redraw, it depends on the hook pipeline being healthy just to know it worked, and on Codex the retry loop is the suspected cause of a visible cursor glitch. Separately, the "Resume Session" button sometimes silently starts a *new* conversation instead of restoring the old one — on Codex, resumed sessions are not even visible to the interactive `/resume` picker.

## Approach

Deliver the kickoff the way each CLI natively supports: as the positional initial prompt in the argv at spawn. Both CLIs start their interactive REPL with a positional prompt already submitted (verified against Codex source and Claude Code docs, 2026-09). Runcastle already assembles an argv per runtime at spawn; the kickoff line becomes one more element of it. Delivery stops being an act performed *on* a running session and becomes a property of the launch itself.

The consequences cascade, and the grill chose to follow them all the way:

- **Fresh launches (every session kind, both runtimes):** the kickoff line — an explicit override if one was stashed, else the runtime's per-kind default — is resolved at argv-build time and passed as the positional prompt. The pre-spawn override map survives unchanged as the seam by which lap briefings (the Iterate click) and any other caller replace the default; only its *consumption point* moves from post-go-live to argv construction.
- **An explicit briefing forces a fresh launch.** A launch carrying a per-purpose kickoff override (the Iterate click's lap briefing, the conflict-resolve brief) skips any available resume and starts fresh, the briefing riding argv — the docs carry the state, exactly as the existing resume cap already assumes. Resume is reserved for launches with no explicit briefing.
- **Resumed sessions send nothing.** A resume restores the conversation; the original briefing is already in its history and the injected system prompt carries the task regardless. The resume-framing prefix and resume kickoff line are deleted. (Interactive `codex resume` accepts no prompt positional and interactive `claude --resume <id> "<prompt>"` is undocumented — but the requirement was cut, not worked around: no `codex queue`, no inbox-socket integration, this lap or later.)
- **The PTY type-and-confirm machinery is deleted, not demoted.** The two-write sequence, the delivery record, the retry/confirmation loop, the prompt-matching, the timing constants, the "Send briefing" resend path (service function, tRPC endpoint, and UI button) all go. With fresh = argv and resume = nothing, the typing path has no caller.
- **No watchdog.** No delivery confirmation of any kind. `session.kickoff_undelivered` is removed everywhere (emitter, event type, UI handling). If argv delivery ever silently failed, the symptom is a visibly idle terminal the human nudges with one message — the injected system prompt means the agent still knows its job. `session.kickoff` survives as a single event emitted at spawn, recording the briefing the session was opened with; the `UserPromptSubmit` hook keeps its other duties but no longer feeds kickoff state.
- **Resume reliability is fixed in the same feature.** Investigate and fix why "Resume Session" sometimes starts cold: on Codex, whether the synthetic per-session CODEX_HOME loses or relocates the session rollouts that `codex resume <id>` looks for (also why the interactive picker shows nothing); on Claude, whether a stale or wrong recorded session id is passed to `--resume`. With resume now sending no kickoff, a cold-started resume leaves an empty, briefing-less session — resume working matters more, not less.
- **Argv encoding is pinned, not routed around.** Kickoff lines are runcastle-generated, single-line, realistically 1–3KB — far under the ~32K Windows command-line ceiling. No file-based or size-gated delivery path. Instead: a unit test proving a line containing double quotes and apostrophes survives the Windows argv encoding intact, and a loud build-time assert if a line ever approaches the ceiling.

## Seams

All existing; no new seams are needed.

- **The per-runtime argv builders** (the runtime adapters' launch-input → argv functions, both runtimes): observe that a fresh launch's argv carries the kickoff line as the positional prompt (override winning over per-kind default), that a resumed launch's argv carries the resume id and *no* prompt, and that quoting survives encoding. This is where the size assert lives.
- **The kickoff-planning seam** (the exported kickoff-plan/line-resolution functions): observe which line a given launch resolves to — lap briefing on Iterate, override, or per-kind default — independent of any PTY.
- **The events service / SSE stream:** observe exactly one `session.kickoff` per fresh launch emitted at spawn, none on resume, and that `session.kickoff_undelivered` no longer exists as a type.
- **The tRPC feature router:** observe the resend endpoint is gone (compile-time seam for the web client).
- **The session-persistence surface for resume** (synthetic CODEX_HOME layout + the session id recorded from the SessionStart hook): observe that a session's rollout survives to a later launch and that `resume <id>` / `--resume <id>` restores the same conversation rather than starting cold.

## Out of scope

- Hook enablement (owned by the codex-hooks-never-fire quick change; hooks stay load-bearing for live/Stop/edit-guard).
- The Codex `approval_policy` fix (its own card, already cut).
- `codex queue` and Claude's cross-session inbox socket — investigated during ideation, deliberately rejected, not deferred.
- Any change to what the kickoff lines *say* (skill invocations, lap briefing wording).

## Open questions

- The exact root cause of cold-starting resumes is an investigation inside the feature, not a pre-resolved design: the CODEX_HOME-relocation and stale-session-id hypotheses are the starting points, and the fix follows what the investigation finds.

## Later laps

None — the grill judged this sure-and-small: one lap, spec'd whole.
