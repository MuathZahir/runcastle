# Cheaper burns

## Problem

Burns and reviews cost far more than the work needs. In two weeks, implementation burns used
1.07B tokens over 87 tickets, and drive reviews another ~406M. The waste has known causes:

- A ticket's cost grows with the square of its length, and the ticket guide pushes leads toward
  big tickets. Ten giant tickets used 36% of everything.
- Burn agents never compact, so a long ticket re-reads up to ~700k of context on every call.
- The worker prompt contradicts itself about when to typecheck, and lead-written ticket contexts
  override "never the full suite". Typecheck ran 490 times.
- Review agents take screenshots to look at them, act one browser step per call, and read a
  32k-character prompt on every call. Host reviews also run at the human's own high effort with
  auto-compaction off.
- Every agent call re-reads the brief, decisions and spec in full.

The human pays for all of it without seeing better work for it.

## Approach

Nothing new appears on screen. The human sees the same burns and reviews, at a lower bill. Four
groups of change, all built by the lead in this checkout:

**1. Ticket guide and the oversized-ticket warning (decisions 1, 2, 3, 4, 16).**
The feature skill's ticket guide (`tickets.md` in the runcastle skill pack) is rewritten where it
sizes tickets: about six acceptance criteria in one area per ticket, the quadratic-cost reason
stated, the "merge them / splitting triples it" push removed, splitting reserved for tickets that
would pass the cap. Wide removals or renames spanning more than one area are always expand →
migrate → contract. Ticket contexts must never tell a worker to run the full suite, the verify
commands whole, or "typecheck and test from the repo root".
`emit_tickets` returns `warnings: string[]` alongside `stored`/`ids`, built by the existing
ticket-shape module in `@runcastle/core` (which had no caller): one sentence per warning, each
naming its ticket by seq. The new rule warns on an implementation ticket with more than eight
criteria; the module's existing thin-context and pasted-document warnings ride along. Review
tickets are exempt, as they are from the other shape checks. The lead skill tells leads to read and act on it.

**2. The worker prompt and its environment (decisions 4, 5, 6, 7, 11, 14).**
- The implement prompt states one check rule, once: targeted tests before each commit; the
  project-wide static check once after the last criterion is committed, and once more only if it
  found something that was fixed; never the full suite or the verify commands whole; this rule
  wins over any ticket context that says otherwise. The commit step's "typecheck before each
  commit" goes. The conflict-resolver prompt is brought into line.
- The agent-environment builder used for every headless agent (`buildAgentEnv`, reached through
  `buildBurnAgent`) adds, for the Claude Code runtime only, on host and in containers:
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, and `CLAUDE_CODE_EFFORT_LEVEL` from one per-kind table
  (implementation, conflict, review) that is easy to change; every entry is unset until the human
  answers decision 6, so effort behaves as today. On the host,
  compaction must also hold when the human's own Claude settings turn auto-compaction off (see
  Open questions). Codex agents are unchanged.
- The docs digest handed to burn, conflict and review agents inlines `spec.md` only. `brief.md`
  and `decisions.md` move into the digest's existing "on disk, not inlined" index, each with one
  line saying when to read it: the brief for why the feature exists, the decisions before
  changing anything the spec does not spell out. With no spec, the brief is inlined instead (and with neither, the decisions). The
  lead's `get_feature_context` keeps inlining all three; only the burner-side digest changes.
- The burn guard gains a rule denying in-place `sed` programs addressed by line number (one
  line, one range, or a change/insert/append at a line number), pointing at the Edit tool.
  Pattern substitutions stay allowed. The flag and the program may come in either order, and a
  line edit after a substitution (`'s/a/b/;5d'`) counts. The old two-range rule stays beside it
  for the case it alone covers, two pattern-addressed ranges (`/a/,/b/d;/c/,/d/d`).

**3. The review prompt (decisions 8, 9, 10, 15).**
- Verify every criterion from the text snapshot. Never take a screenshot in order to look at it;
  pictures for the human go only through `review_drive({ action: "capture" })`, which keeps
  them without returning them.
- Chain the actions between two snapshots into one shell call
  (`agent-browser fill @e1 … && agent-browser click @e3 && agent-browser snapshot -i`).
- Never start paid or long-running work inside the app under test (messaging an AI agent,
  starting a job or a build) unless a criterion names it.
- After a compaction, re-snapshot and check which criteria are already reported before going on.
- The template loses examples, anecdotes and repetition only; every rule stays, with no length
  target. The lead's report names each rule that moved or merged.

**4. The model default (decision 12) — the human's call, no code.**
If the human says yes, they switch the implementation step's model in Settings from
`claude-opus-5-5[1m]` to `claude-sonnet-5-5` (or tell the lead to make that one settings change),
and leads keep assigning Opus to UI and complex tickets from the annotated roster. If they say
"compare first", nothing changes here and the comparison becomes its own backlog feature.

**Proof (decisions 17, 18).** Unit tests pin each change at its seam. The test drive hand-starts
this branch's server and burns one small throwaway ticket. About two weeks after merge the
orchestrator compares per-ticket token medians against the brief's numbers.

**Reaching real sessions.** Prompt, guide and server changes reach live sessions only after
runcastle is published and reinstalled.

## Seams

- **Ticket-shape warnings** (existing, `@runcastle/core`): `ticketShapeWarnings(tickets)` gains
  the over-eight-criteria rule; observe the sentences it returns.
- **`emit_tickets` MCP tool** (existing): observe the new `warnings` field in its result.
- **Agent environment** (existing): `buildBurnAgent(config, token, model, options)` — observe the
  env handed to the agent provider for Claude Code and Codex, host and container.
- **Docs digest** (existing): `readDocsDigest(projectId, slug)` / `buildDocsDigest` — observe
  `included`, `withheld` and the rendered text with and without a spec.
- **Burn guard** (existing): `evaluateGuard(command)` — observe which commands are denied.
- **Rendered prompts** (existing): the implement, conflict and review templates as rendered by
  the burner — observe the check rule, the review rules, and the review template's length.
- **Ticket guide** (existing): the skill pack's `tickets.md`, pinned by the feature-skill tests.

## Out of scope

- Moving burns onto the worker runner and keeping transcripts → `burns-become-workers`.
- Counting review tokens → `honest-token-counts`.
- The lead's own chat size → `lead-chats-stay-small`.
- Swapping the `[1m]` model ids for the standard ones (decision 14).
- A standing token report or any new counting machinery (decision 18).
- Compaction or effort for Codex agents.
- Any new setting: every change here is a fixed default.

## Open questions

- **Decisions 6 and 12 are open until the human answers** (the orchestrator has put both to
  them): the effort per kind of agent, and Sonnet or compare first for implementation burns.
- Settled while building: the human's `autoCompactEnabled: false` blocks the env variable (Claude
  Code's docs: whichever turns compaction off, the other cannot turn it back on), so every headless
  Claude Code agent also gets `--settings "{\"autoCompactEnabled\":true}"`, which outranks user
  settings. Only a hand-started burn on the host proves it fires (decision 17).
