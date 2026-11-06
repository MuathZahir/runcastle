# Tools and skills say less

## Problem

Every byte a runcastle tool returns stays in the agent's context for every later
call, and every tool description and skill body rides in every call. The token
analysis of 2026-11-06 found agents paying tens of millions of tokens over two
weeks for things they already had: the same feature docs resent on repeat reads,
whole ticket rows echoed back after an edit, the same 8k of a feature's chat
reread, essay-length tool descriptions, a 49k-character orchestrator skill, and
feature-skill references read several at a time or read whole only to be copied.
A quarter of `resolve_finding` calls also failed for no useful reason. None of
this changes what the human sees; it makes every agent conversation cheaper and
leaves more room before compaction.

## Approach

Agents keep every capability they have today. What changes is how much they are
sent by default, with `full: true` on every trimmed read to get today's reply
back (decision 8).

**Replies remember what a conversation already has.** A small per-session memory
in the tool server (an in-process map keyed by runcastle session id, never
persisted) records, per doc, the content hash last sent to that session.
`get_feature_context` (decision 1) sends each unchanged canonical doc as a stub:

```ts
{ relPath: string; absPath: string; sha: string; unchanged: true;
  note: 'unchanged since this session last received it; read it at absPath or with read_feature_doc if it is not in view' }
```

The stub's shape and wording pin decision 16: a subagent shares its parent's
session, so the stub alone must be enough to recover the doc. The same memory
backs the charter in `get_project_context` (decision 7) and the read position in
`read_feature_chat` (decision 6). The memory for a session is cleared when its
SessionStart hook fires with any source but `resume` (feature-scoped and
project-scoped handlers both), and is empty after a server restart. Callers with
no session (a worker under a run header) bypass it and always get full replies
(decision 16). The header, ticket rows and to-do of `get_feature_context` are
unchanged; only doc bodies are deduplicated. The existing size ceiling logic
still applies, now measured with stubs in place.

**The orchestrator reads a status view** (decision 2). `get_feature_context({ slug })`
for the project kind returns exactly what the orchestrator uses: the feature's
status, waiting reason and kind, holder, `humanTypedAt`, whether a round is
running, ticket counts by status, the latest ready declaration, the latest
review's verdict and the count of open findings, design titles and states, base
branch and `dependsOn`, and a doc index `{ relPath, bytes }` for every doc.
`full: true` returns today's lead bundle, docs in full.

**Writes answer with a receipt** (decision 3): `update_ticket` →
`{ ok, seq, status, changed: string[] }`, `cancel_ticket` → `{ ok, seq, status }`,
`resolve_finding` → `{ ok, findingId, status }`. `resolve_finding` on a finding of
this feature that is already closed returns `{ ok, findingId, status, alreadyClosed: true }`
and changes nothing (decision 4); a foreign or unknown finding is still refused.
The refusal lives in the review-findings service; the tool checks the finding's
current state before calling it, so the service's own rule is unchanged for
other callers.

**Settled tickets read short** (decision 5): `get_ticket` on a `done` or
`cancelled` ticket omits `context` unless `full: true`; its acceptance criteria stay.

**A feature's chat reads from where the thread left off** (decision 6). The read
position is `{ transcriptPath, turnCount, shownCount, reviewShotCount }` per
(orchestrator session, feature). A repeat read with the same transcript returns
only the turns after `turnCount` (capped to the newest ~8k characters, with
`earlierNewTurnsOmitted: n`), and only the shown files and review pictures added
since. A different transcript counts as a new chat and is read from its end as
today. With nothing new, `quote` is null and `reason` says nothing new since the
last read.

**The project read trims** (decision 7): the charter as `{ unchanged: true, sha }`
on repeats; `baseBranches` reduced to `{ current, currentIsSelectable, detectedMain }`;
the project row reduced to `{ id, name, repoPath, sessionBranch }`. `full: true`
returns the `selectable` list and the full project row.

All trimming happens in the MCP tool layer. The services and the tRPC routes the
web app uses return exactly what they do today.

**Tool descriptions get short** (decision 9). Each description is one or two
sentences: what the tool does and when to reach for it; each parameter
description a short phrase. Behaviour a description teaches that no skill
teaches moves into the skill that uses the tool (the skills ticket carries
those lines; the descriptions ticket lists them in its digest). A test builds
the MCP server for every audience, lists the tools over the real MCP client,
and fails when any one tool's description (or any parameter description)
exceeds its length cap. There is no cap on a whole tool list, so a new tool
never fails the build.

**One tool-loading line, and no skill reload on resume** (decisions 12, 13, 15).
The SessionStart note of a Claude Code session ends with
`Load your runcastle tools once: ToolSearch "select:<every mcp__runcastle__ tool this kind is offered>"`,
built from the audience table (`toolsForAudience`). The feature note's closing
line changes from "Call get_feature_context for the full docs + tickets" to say
a repeat call returns only what changed. When runcastle opens a conversation
already under way with a briefing (self-plan, purpose, explicit kickoff), the
opening says to continue and to invoke the entry skill only if its text is not
already in the conversation; a fresh conversation is still told to invoke it.

**The skills cut** (decisions 10, 11, 12, 15).
- The project skill's main file keeps: the intro, §0 Open by asking,
  Orchestrating minus the working agreement, the closing move and Do NOT, plus
  the two non-tool facts from "Your tools" and one pointer line per job.
  New references: intake and the cut (§1 with the working agreement), routing
  with Q&A and curation (§2–4). Charter, health sweeps, notes triage and
  preparation already have references; their in-body sections shrink to a
  pointer. "Your tools" is dropped. Target ≤ 25k characters. The heading the
  launcher names verbatim (`Orchestrating`) must survive.
- The feature skill's main file gains, in place and briefly: read only the
  reference for the step in hand, one file per read; load runcastle tools in
  one call at the start; a repeat `get_feature_context` returns only what
  changed, and `read_feature_doc` returns a doc in full. "Call it again whenever
  you are unsure" goes.
- `preview-starter.html` gains marked slots (`<!-- FILL:<name> -->`);
  `preview.md` lists them and says to copy the starter with a shell copy and
  fill the slots by editing, never reading it whole.
- `design.md` is trimmed to what a design session needs.
- `tickets.md` is not touched (owned by `cheaper-burns`).
- `planning-alone.md` and the orchestrator's guidance mention `full: true`
  where an agent may need today's whole reply.

## Seams

- **The MCP tool server, called through the real MCP client** (existing; the
  pattern in the server's MCP tool tests): observes reply shapes, stubs on a
  repeat call, `full: true`, the orchestrator's status view, receipts, the
  already-closed finding, settled-ticket reads, and each tool's description
  length.
- **The exported tool functions** (existing: the feature-context, ticket,
  finding and chat-read functions): the same behaviours at a lower level where
  a test needs a session row the client cannot easily fake.
- **The hooks route** (existing): a SessionStart with `compact`, `clear` or
  `startup` clears the session's memory; `resume` keeps it; the note carries the
  tool-loading line.
- **The kickoff builders** (existing): a resumed conversation's opening does not
  demand the skill be invoked again.
- **The skill files on disk** (existing, the skill tests): the project skill's
  size, its `Orchestrating` heading, the references it points at exist.

## Out of scope

- Compaction and the lead handing work to subagents (`lead-chats-stay-small`).
- The wake rule and news lines (`agents-are-woken-only-when-it-matters`).
- Burn prompts and `tickets.md` (`cheaper-burns`).
- The human's user-level skills.
- Deduplicating ticket rows or the header of `get_feature_context`.
- Codex sessions' tool loading (they have no ToolSearch); they get the shorter
  replies and descriptions like everyone else.
- Re-running the token analysis to measure the saving; worth doing once this
  merges, as its own small piece of work.

## Open questions

- The exact per-description cap is set by the descriptions ticket (around 400
  characters for a tool, 120 for a parameter).
- Whether Claude Code keeps an invoked skill's text across compaction in every
  case; decision 13's wording ("only if its text is not already in the
  conversation") is safe either way.
