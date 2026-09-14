# Brief

## The symptom (reported 2026-09-14 by the operator, on the runcastle project itself)

Running Codex interactively (ideation and the other talk kinds), the session "just suddenly closes": the feature's next-step bar flips to **Resume session**. Clicking Resume then fails to reopen the conversation roughly 80% of the time — a flicker, sometimes the `session.resume_failed` banner, and either a fresh cold session or nothing usable. Together this makes Codex talk sessions close to unusable.

## Why this feature exists — the diagnosis so far

runcastle's session lifecycle was designed against Claude Code's hook timing and Codex was mapped onto it one-for-one (`packages/server/src/launcher/runtimes/codex.ts` renders the same five events into `$CODEX_HOME/hooks.json`; `packages/server/src/routes/hooks.ts` handles them identically). Feature `codex-hooks-never-fire-enable-the-hooks-feature-flag` (shipped 2026-09-14, read `docs/features/codex-hooks-never-fire-enable-the-hooks-feature-flag/outcome.md`, ticket 3 digest) established, by driving the real launcher + real `node-pty` + real `codex-cli` 0.150.1, that the mapping's timing assumption is false: **Codex's interactive TUI does not emit `SessionStart` when the terminal opens; it emits it with the first submitted turn, together with that turn's `UserPromptSubmit`.** `codex exec` fires all five events normally, so the generated artifacts are correct — the events just fire at different moments than Claude Code's.

Nothing in the portfolio has yet looked at the *other end* of the lifecycle, and that is where the two reported symptoms most likely live:

1. **"Suddenly closes."** `handleSessionEnd` (`routes/hooks.ts:~290`) and `handleProjectScopedSessionEnd` mark the row `ended` the instant the `SessionEnd` hook posts. Neither kills the PTY nor checks that it is alive. If Codex's TUI fires `SessionEnd` per turn — symmetric with its per-turn `SessionStart`, so plausible but **unverified** — then every completed reply ends the row, the UI shows Resume, and the terminal is still running underneath. A second candidate: the `Stop` hook is mapped to `awaiting-input`; check Codex's Stop/SessionEnd semantics against the live CLI rather than assuming. Also rule out genuine process exits (`session.pty_exited` in the event log with an exit code — e.g. quota/401, the "Update available / press enter" modal on a fresh `CODEX_HOME` that ticket 3 flagged as left undone).

2. **"Resume rarely works."** Resume spawns `codex resume <ccSessionId> --dangerously-bypass-hook-trust` (`runtimes/codex.ts` `buildCodexArgs`), where `ccSessionId` is whatever `session_id` the SessionStart payload carried (`routes/hooks.ts:~128`). Two unverified assumptions: (a) that the hook payload's `session_id` is the thread/rollout id `codex resume` accepts; (b) that the `resume` subcommand accepts `--dangerously-bypass-hook-trust` in that position. Either being wrong makes Codex exit immediately → `handlePtyExit` (`launcher.ts:~1215`) emits `session.resume_failed`. Separately, a session that ended before the human ever typed has no `ccSessionId` at all (SessionStart never fired), so `mostRecentResumableSession` finds nothing and Resume silently spawns fresh — that alone could account for a large share of the "doesn't work" cases if symptom 1 is ending rows early. Also note `RESUME_MAX_REENTRIES` / `resume_capped` (`sessions.ts:~1082`) — if rows are being ended per turn, every turn counts as a re-entry and the cap trips fast.

## What this feature should do

- **Verify on the host first, in a real interactive Codex terminal** — ticket 3 proved a burn sandbox cannot do this (no TTY, no credentials). Record what the TUI actually emits and when for each of the five events, what `session_id` it sends, and what `codex resume` accepts. Use ctx7 (`/openai/codex`) for the CLI's documented shape; trust the live CLI over the docs where they differ.
- Then make the bookkeeping honest: a Codex row must not be marked `ended` while its PTY is alive; "ended" for a runtime whose hooks fire per turn should be driven by PTY exit (or a verified end-of-conversation signal), not by `SessionEnd`. Keep `session.ended` / `pty_exited` events truthful so the UI's Resume offer only appears when the terminal really is gone.
- Make Resume target an id Codex will actually reopen, with the flag/arg shape the `resume` subcommand accepts — or, when no resumable id exists, say so on the timeline instead of silently spawning a cold session.
- Pin the verified behaviour with tests beside the existing `renderCodexConfig` / `handlePtyExit` coverage (`packages/server/test/launch-artifacts.test.ts` and the launcher tests). A committed end-to-end test gated on the `codex` binary being present would be welcome but is not required.

## What this feature must NOT swallow

- **Kickoff delivery.** How the opening briefing reaches a Codex session — the SessionStart-gated `scheduleKickoff` deadlock, Codex's positional `[PROMPT]`, `attemptKickoff`'s clear-and-retype retries — belongs to `native-first-message-delivery-for-session-kickoffs` (in flight, ideation lap 1). Do not redesign it here. If fixing end/resume requires the row to go live without SessionStart, coordinate by keeping the change minimal and documenting the seam; do not solve first-message delivery as a side effect.
- **The Claude Code runtime's lifecycle.** ADR-0009 defines Claude's semantics and they work; changes must be Codex-scoped (runtime adapter / per-runtime branch), not a rewrite of the shared handlers.
- **The update-available modal / fresh-`CODEX_HOME` seeding.** Worth a separate quick change if it turns out to be a real cause of exits; note it, don't chase it unless it is the cause.

## Collision warning

This feature and `native-first-message-delivery-for-session-kickoffs` will both edit `packages/server/src/launcher/runtimes/codex.ts`, `packages/server/src/launcher/sessions.ts` and `packages/server/src/routes/hooks.ts`. Project-session recommendation: land this one first (smaller, blocking the operator today; the other has no tickets yet and can absorb the change cheaply).

## Already settled

- ADR-0009 (`docs/adr/0009-kickoff-delivery.md`): a briefing is delivered and confirmed, never assumed; the watchdog never types blind. Binding, but silent on when a non-Claude runtime's session counts as ended.
- `[features] hooks = true` in the generated Codex config is a correct defensive pin and not a cause of anything here (ticket 1 digest of the shipped feature).
- `--dangerously-bypass-hook-trust` is required for any hook to fire at all (verified live in ticket 1).
