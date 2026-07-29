# ADR-0009: A session's opening briefing is delivered and confirmed, never assumed

- **Status:** accepted (2026-07-27)
- **Relates to:** ADR-0007 (landing conflicts), whose two human escape hatches —
  "Resolve with agent" and "Resolve in terminal" — are briefed entirely through
  this mechanism.

## Context

Every terminal runcastle opens is opened *for a reason*, and the reason is
carried by one injected line: the per-kind kickoff (`/runcastle:ideate`,
`/runcastle:converge`, …) or a per-purpose override — the review-iteration
briefing, the merge-conflict resolution briefing (`mergeConflictKickoff`,
`ticketConflictKickoff`). The agent has no other way to learn why it exists.

Delivery was a blind timed write: 1.5s after the session reported live, type the
text into the PTY, 350ms later type `\r`, emit `session.kickoff` ("kicked off
automatically"), done. Two assumptions underneath it were both false.

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

## Decision

**A written kickoff is an attempt; only Claude Code acknowledging it is a
delivery.**

1. **`SessionStart` is registered for every source** (`startup`, `resume`,
   `clear`, `compact`, `fork`) — one matcher group each, since regex-vs-literal
   matching is undocumented. A resumed session is a started session. Repeat
   fires (after `/clear`, after a compaction) refresh `ccSessionId` /
   `transcript_path` — the conversation a later `--resume` would target really
   did change — without re-announcing a live session or re-injecting.
2. **`UserPromptSubmit` is the delivery receipt.** The hook already ran for
   context injection; it now also carries the submitted `prompt` back to
   `noteKickoffPrompt`. A prompt matching the injected line (collapsed
   whitespace, first 40 chars) confirms delivery and cancels the retries.
3. **Unconfirmed within 12s → type it again**, clearing the input line first
   (`Ctrl-U`, so a half-typed first attempt cannot become one doubled prompt),
   up to 3 attempts. This is what carries a briefing across a dialog the human
   dismisses ten seconds after the terminal opened.
4. **Failure is announced, not swallowed.** Out of attempts emits
   `session.kickoff_undelivered`; a terminal that never reported `SessionStart`
   at all within 25s emits `session.not_ready`. Both surface as a warning bar in
   the session strip with **Send briefing**, which re-types the exact stored line
   on demand (`feature.resendKickoff`) and restarts the confirm-and-retry cycle.
5. **A human who types first wins.** A non-matching prompt settles the delivery
   as `superseded`: injecting a paragraph into a conversation someone is already
   driving is worse than not briefing at all. The briefing stays one click away
   in the same bar.
6. **The watchdog never types blind.** When a session has not reported ready, we
   report it rather than firing text and `\r` at an unseen dialog — a stray
   Enter could answer a trust or permission question on the human's behalf.

## Consequences

- The worst case for a swallowed briefing drops from "silently never delivered"
  to "delivered ~12s later, or visibly flagged with a one-click send".
- Kickoff state is in-memory only, keyed by session id and dropped when the
  session ends: the PTY it types into dies with the process, so a delivery can
  never outlive the terminal it belongs to, and no pending retry can leak into
  the next one.
- `session.kickoff` now carries `attempt`, and a session can log more than one:
  the timeline shows re-sends, which is the honest record of what was typed.
- Confirmation matching is a prefix comparison, not equality — a briefing that
  shares its first 40 characters with another would confirm the wrong one. The
  briefings differ in their opening clause, and the cost of a false match (one
  un-retried delivery, still visible in the terminal) is lower than the cost of
  a false miss (re-typing over a working agent).
