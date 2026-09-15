# ADR-0009: A session's opening briefing rides the launch, never the keyboard

- **Status:** accepted (2026-07-27)
- **Amended:** 2026-09-15 — the briefing is handed to the CLI as its positional
  initial prompt at spawn instead of typed into a live terminal; the delivery
  receipt, the retry loop, the undelivered event and its one-click re-send are
  retired along with the typing they existed to cover (feature
  native-first-message-delivery-for-session-kickoffs)
- **Relates to:** ADR-0007 (landing conflicts), whose two human escape hatches —
  "Resolve with agent" and "Resolve in terminal" — are briefed entirely through
  this mechanism.

## Context

Every terminal runcastle opens is opened *for a reason*, and the reason is
carried by one line: the per-kind kickoff (`/runcastle:ideate`,
`/runcastle:converge`, …) or a per-purpose override — the review-iteration
briefing, the merge-conflict resolution briefing (`mergeConflictKickoff`,
`ticketConflictKickoff`). The agent has no other way to learn why it exists.

Delivery began as a blind timed write: 1.5s after the session reported live,
type the text into the PTY, 350ms later type `\r`, emit `session.kickoff`
("kicked off automatically"), done. Two assumptions underneath it were both
false.

1. **That the session reports live at all.** `markSessionLive` is only ever
   called by the `SessionStart` hook, and the generated `settings.json`
   registered that hook with `matcher: "startup"` — a single source. A `--resume`
   launch fires `SessionStart` with source `resume`, which matched nothing. So
   for *every resumed terminal* — every revisit, every reopened grill, both
   conflict-resolution paths — the hook never fired: the row stayed `launching`,
   no `ccSessionId` was recorded (so the next resume targeted an older
   conversation), and no kickoff was ever typed. Observed as: clicking "Resolve
   with agent" on a merge conflict opened a terminal on the old grilling
   conversation, said nothing, and left the human to explain the conflict by
   hand.
2. **That whatever is on screen accepts the keystrokes.** A PTY write goes to
   whatever the TUI is showing. Claude Code can be showing a startup dialog at
   1.5s — the "start from a summary?" chooser on `--resume`, a trust prompt, an
   update notice — and then the briefing is eaten, `session.kickoff` still claims
   success, and the terminal looks perfectly healthy while the agent sits idle.

The first answer kept the typing and wrapped it in a receipt: the
`UserPromptSubmit` hook echoing the injected line confirmed delivery, an
unconfirmed line was cleared and re-typed up to three times, and running out of
attempts raised a warning bar with a one-click re-send. That made the failure
visible without making it rare — the writes still raced the TUI's startup
redraw, *knowing* whether one had landed depended on the hook pipeline being
healthy, and on Codex the retry loop was the suspected cause of a visible cursor
glitch. Watched in use, it "doesn't always work reliably".

Both CLIs take a first message as an argument of the launch itself: Claude Code
and the Codex TUI each start their REPL with a positional prompt already
submitted. Runcastle assembles that argv anyway.

## Decision

**The briefing is part of the launch, not an act performed on a running
session.**

1. **`SessionStart` is registered for every source** (`startup`, `resume`,
   `clear`, `compact`, `fork`) — one matcher group each, since regex-vs-literal
   matching is undocumented. A resumed session is a started session. Repeat
   fires (after `/clear`, after a compaction) refresh `ccSessionId` /
   `transcript_path` — the conversation a later resume would target really did
   change — without re-announcing a live session.
2. **A fresh launch carries its briefing in argv.** The line — the launch's
   explicit briefing if it has one, else the runtime's per-kind default — is
   resolved where the argv is built (`buildClaudeArgs` / `buildCodexArgs`) and
   passed as the CLI's positional initial prompt. There is no window to race:
   the process starts with the prompt already submitted.
3. **A resumed launch sends nothing.** `--resume <id>` / `resume <id>` restores
   the conversation the original briefing is already in, and the injected system
   prompt carries the task regardless. Re-briefing a restored conversation is
   noise, so there is no resume framing and no resume kickoff line.
4. **An explicit briefing forces a fresh conversation.** A launch carrying a
   per-purpose briefing (the Iterate lap briefing, a conflict-resolution brief)
   skips the resume it could have had and starts fresh with that briefing in its
   argv, announced as `session.resume_skipped`. Resume is reserved for launches
   with nothing new to say; the docs carry the state, exactly as the re-entry cap
   already assumes.
5. **Nothing confirms delivery.** `session.kickoff` is emitted once, at spawn,
   recording the briefing the session was opened with — no receipt, no retries,
   no undelivered event, no re-send button. `UserPromptSubmit` keeps its other
   duties and no longer feeds kickoff state.
6. **Readiness is still watched — delivery is not.** A terminal that has not
   reported `SessionStart` within 25s emits `session.not_ready` and renders a
   warning bar in the session strip: the agent has not started on its briefing,
   and something only the human can see (a trust prompt, a login, an update
   notice) is holding it up. We report it rather than touching the terminal — a
   stray Enter could answer that question on the human's behalf.
7. **A briefing's size is asserted, not routed around.** Kickoff lines are
   runcastle-generated and realistically 1–3KB, far below the Windows
   command-line ceiling, so there is no file-based or size-gated delivery path.
   `assertKickoffArgv` throws above `MAX_KICKOFF_ARGV` rather than letting a line
   be silently truncated, and a test pins that a line carrying double quotes and
   an apostrophe reaches the argv verbatim.

## Consequences

- A swallowed briefing stops being a failure class: the CLI submits the prompt
  itself, before any dialog or redraw can eat it, so the worst case that
  motivated the retry loop cannot occur.
- No kickoff state outlives argv construction. The in-memory delivery records,
  their timers and their per-session cleanup are gone with the typing.
- `session.kickoff` is at most one event per session, emitted at spawn instead of
  per attempt; a resume emits none. The timeline reads "opened with this
  briefing" or "resumed that conversation" — which is what happened.
- Delivery no longer depends on the hook pipeline being healthy. Hooks stay
  load-bearing for everything else: live status, `ccSessionId`, turn state, the
  edit guard.
- The accepted cost: if argv delivery ever failed silently, nothing would say so.
  The symptom is a visibly idle terminal, the injected system prompt already
  tells the agent its job, and one typed message from the human is the fix —
  cheaper than standing machinery to watch for it.
