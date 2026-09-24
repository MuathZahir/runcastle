# MCP read tools stay within a context budget

## Problem

An agent opening a runcastle session reads its world through three MCP tools: `get_feature_context`, `get_project_context` and `get_work_record`. All three grew into whole-state dumps, and all three now return results larger than Claude Code will show. Past about 25K tokens, Claude Code saves an MCP result to a file and gives the agent a pointer. In practice the agent often never opens it and acts on what it remembers instead.

That is what happened on 2026-09-24. A lap-2 chat stamped tickets with a model id that had not been on the roster for days, because `annotatedModels` sat at the tail of an 84K result that never reached its context. Measured on the live database (108 features, 560 tickets):

- `get_feature_context`: one lap's ticket bodies alone reach 104K chars, and one feature's canonical docs reach 111K.
- `get_project_context`: the feature index is 63K of 78K, mostly one-liners that have grown into paragraphs.
- `get_work_record`: the seam form reaches 114K ("web") and the slug form about 70K.

All three grow with every lap and every feature, silently. The human's priority, which governs every trade-off below: **agent effectiveness beats context savings.** Spending context is fine. An agent missing what it needs, and guessing, is not.

## Approach

**What an agent sees.** Each read tool returns a summary that opens with the fields that decide what an agent does. Bulk detail moves behind one obvious fetch, and anything moved out is named in the payload with instructions to fetch it. Nothing is ever truncated: every part is either present whole or explicitly moved out, because a half-shown doc or acceptance-criteria list looks complete and misleads more than a missing one. A regression test holds every summary under the size at which Claude Code would hide it.

### The never-hidden ceiling

One named ceiling of **60,000 characters**, measured on the serialized JSON text exactly as the tool returns it to the client, applies to every summary/read tool below. That is about 20K tokens at dense JSON's ~3 chars/token, safely under the ~25K-token spill limit. It is a guard against hiding, not a thrift budget. The server's fit logic and the guard test share the same constant, so they cannot drift apart.

### `get_feature_context`: header first, then tickets, then the lap's to-do, then docs

The payload is assembled in this priority order, and the JSON key order follows it so the decision-critical fields come first:

1. **Header:** the feature row, `phase`, `lap`, `annotatedModels`, `burnConcurrency`, `latestRun`, `frontierIds` and `assignedWaypointId` (mapped features), `reviewEvidence` and `currentLapReview`. This only reorders fields that already exist; no new data (such as gates) is added.
2. **Ticket rows:** every ticket across all laps as `{ id, seq, title, status, kind, lap, blockedBy, model, seams, error, goal }`, with error and goal in full. Context, acceptance criteria, the digest and every other ticket field move to `get_ticket`.
3. **The lap's to-do, in full:** `openDefects`, `carriedDefects`, `findings`, `testNotes` and, for mapped features, `waypoints`. These live only in the database, so they have no file to point at, and an index of titles would make revisit and chat sessions plan against a guess.
4. **Canonical docs:** brief, decisions, spec and map, filled in that order. Each doc is inlined whole if the payload still fits under the ceiling. Otherwise it goes to a `notInlined` list as `{ relPath, absPath, bytes, reason }`. `absPath` is the file in the reader's checkout when there is one. The reason tells the agent plainly that the doc was left out because of size and must be read before acting, with `read_feature_doc({ relPath })` or the file on disk. `moreDocs` (the non-canonical index) and `docsNote` are unchanged, and the note gains a sentence about `notInlined`.

Docs are the only part moved out: they are the one part with a cheap, well-known fetch. The accepted risk is that a lap whose findings and notes alone exceed the ceiling has nothing left to move out. Real data peaks around 35K.

### `get_ticket({ seq })`: new fetch-one

This new tool returns one ticket of the caller's feature in full, as the stored ticket row including `goal`, `context`, `acceptanceCriteria` and `digest`. It takes `seq` because that is the number the UI, `blockedBy`, `emit_tickets`' reply and agents all use; a seq that does not exist is a not-found error. It is bound to the reader's own feature, exactly like `list_tickets`, and has the same audience (every feature session kind plus `run`). This is also a gain in effectiveness: today no feature session can see a digest at all.

### `get_project_context`: slim index, charter whole, a brief on request

JSON key order: project, `baseBranches`, charter, `adrs`/`adrsNote`, feature index.

- **Charter** (`CONTEXT.md`) stays inline in full; it binds every project decision. ADRs stay an index.
- **Feature index lines** become `slug — title [state]`. The one-liner and the per-line docs path are dropped. The state is `in flight: <phase>, lap n, x pending, y burning, mapped` (as today), or `shipped`, `draft` or `archived`. Lines are grouped: in-flight, then drafts, then shipped (most recently shipped first).
- **The index is cut by count, not date.** Every in-flight feature and draft is always listed, and so are the 50 most recently shipped (ordered by ship time). Older shipped and archived features collapse into one closing line that names how many were left out and how to reach them: search `docs/features/*/brief.md` on disk, or `read_feature_brief({ slug })`. A single note in the payload says shipped features' docs live at `docs/features/<slug>/`.

### `read_feature_brief({ slug })`: new fetch-one, project session kinds only

This new tool returns `{ slug, title, oneLiner, status, phase, lap, brief }` for any feature of the project. A shipped feature's brief comes from `docs/features/<slug>/brief.md` in the session's worktree. An in-flight or draft feature's brief comes from the database, because its docs live on an unmerged branch. If neither source has one, `brief` is absent and the reply says so. An unknown slug is a not-found error. The audience is the same as `get_work_record`'s.

### `get_work_record`: the seam form lists, the slug form tells, `seq` drills in

- **Seam form:** matching tickets as rows `{ slug, seq, title, status, seams, commits, error }`, with no digests. Rows are grouped per feature as today.
- **Feature-slug form:** digests inline as today. If the payload would cross the ceiling, digests move out whole, oldest lap first (lowest seq first within a lap), and each ticket whose digest moved gets `digestNotInlined: true`. A top-level note says how to fetch one.
- **`featureSlug` + `seq`:** a new optional argument that returns just that one ticket, digest included. There is no new tool. `seq` without `featureSlug` is invalid input.

### Skills and prompts follow, pointing only

The tool descriptions for all changed and new tools are rewritten to the new shape. The skills that describe these payloads are updated: `ideate`, `spec`, `tickets`, `revisit`, `qa`, `converge`, `waypoint` and `project` (including its references), and so are the system-prompt lines in the launcher's artifacts that describe them. Each gets the same two rules, plus the relevant new tools:

- a doc in `notInlined` must be read before acting;
- a ticket's context, acceptance criteria and digest come from `get_ticket`.

The project skill also learns about `read_feature_brief`, the collapsed older-features line, and `get_work_record`'s `seq`. There are no rewrites beyond that. The burner prompts read only `lap` and do not change.

## Seams

- **The read-tool functions, called with a test ctx and serialized exactly as the MCP handler serializes them.** *Existing* seam, already exercised by the MCP tool test suites. It shows each payload's shape, key order, what is inlined versus moved out, and its serialized length. Nearly every behaviour in this spec is asserted here: the header ordering, ticket rows, `notInlined`, the index grouping and cut, the work-record forms, `get_ticket` and `read_feature_brief`.
- **The never-hidden guard test.** A *new* test file on the seam above, with a *new* fixture builder sized past the real maxima:
  - 120+ features: in-flight, drafts, archived, and 60+ shipped with multi-thousand-char one-liners.
  - One three-lap feature with 15 tickets per lap at real-max field sizes (goal ~5K, context ~9K, acceptance criteria ~7.5K, digest ~8K).
  - Canonical docs over 111K, including an ~83K `decisions.md` and a 22K spec.
  - About 35K of current-lap findings plus test notes, and a 12-waypoint map.

  For every summary read tool it asserts that the serialized result is ≤ the shared ceiling. The tools are: `get_feature_context` (for linear and mapped features), `get_project_context`, `get_work_record` (seam form, a slug form that must move digests out, and the `seq` form), `get_ticket` on the largest ticket, `list_tickets`, `read_feature_brief` and `list_project_notes`. It also asserts that the decision-critical header fields are present in the first part of the serialized text.
- **Tool registration per audience (`tools/list` over the in-process MCP app).** *Existing* seam. It shows that `get_ticket` is offered to feature kinds and `run`, and `read_feature_brief` to project kinds, and to nobody else.

## Out of scope

- Validating session-assigned ticket models against the roster. That was `session-assigned-ticket-models-must-be-annotated`, which has since shipped.
- How Claude Code handles oversized MCP output; this fixes our own payloads.
- Skill rewrites beyond pointing at the new shape and the fetch-ones.
- New data in any payload (for example, a gates field in the header).
- A fetch-one for findings or test notes.
- A tight size budget below the never-hidden ceiling.

## Open questions

- **Whole-file reads are exempt from the guard.** `read_feature_doc` and `read_adr` return one file whole, so a very large doc still spills: the real `decisions.md` of `flow-redesign-build-review-and-ship` is 83K chars. For sessions with a checkout, the `notInlined` entry's `absPath` sends the agent to Claude Code's own file Read, which pages large files. A run agent without a checkout has only `read_feature_doc`. Deferred until it bites; it would need a paging or section-read design of its own.
- **Findings and notes have no fallback.** If a single lap's findings plus test notes ever exceeded the ceiling on their own, the guard would fail with nothing left to move out. Real data peaks at about 35K; revisit this if it approaches 60K.
