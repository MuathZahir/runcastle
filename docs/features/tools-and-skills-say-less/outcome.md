# Outcome — Tools and skills say less

runcastle's MCP tools stop resending what the agent already has, their descriptions get short, and the project and feature skills load only what the current step needs.

- Shipped: 2026-11-06

## What shipped

15 commits · 33 files

- 3 tickets landed: #1 Tool replies: send only what the agent does not already have; #2 Tool descriptions: one or two sentences, one tool-loading line, no skill reload on resume; #3 Skills: the project skill keeps only what every turn needs, feature references load one at a time
- 0 waived
- 0 failed

## Review record

### Ticket 4 · review

- Reviewed commit: 628ece74a94e09291f8f0e6733ed1b8115fac0ab
- Landed since: 0
- Outcome: done

- **Orchestrator get_feature_context description is ~4 sentences and misdescribes its default** — fixed
- **Server gate: pty-bun test fails, in a file this branch does not touch** — open
- **Misplaced doc comment, and a chat-read edge with no guard** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Tool replies: send only what the agent does not already have

# Ticket 1 — Tool replies: send only what the agent does not already have

## What was done
- New `packages/server/src/mcp/sent-memory.ts`: an in-process map keyed by runcastle session id. It holds the sha256 of every doc sent whole (feature docs keyed by featureId+relPath, the charter by a fixed key) and each `read_feature_chat` position per feature. It exports `clearSentMemoryOnStart` (clears on any source but `resume`) and `resetSentMemoryForTests`. Both SessionStart handlers in `routes/hooks.ts` call it.
- `get_feature_context` (session callers): `featureContext` takes a 4th `options` argument `{ dedupe, full }`. When dedupe is on, an unchanged canonical doc is sent as a `{ relPath, absPath, sha, unchanged, note }` stub. The size ceiling is measured with the stubs in place, and docs sent whole are recorded. Only the MCP handler turns dedupe on; direct callers and run callers (no `sessionId`) get today's reply. `FeatureReader` gained an optional `sessionId`. `FeatureContext` lives in server.ts, not core, so `docs` widened there.
- Orchestrator `get_feature_context({ slug })` returns the new `featureStatusView` with exactly the fields in the context, plus slug and title. `roundRunning` means any run of the feature is `running`. `full: true` returns the old bundle with no stubs.
- Write tools now return receipts: `update_ticket` → `{ ok, seq, status, changed }`, `cancel_ticket` → `{ ok, seq, status }`, `resolve_finding` → `{ ok, findingId, status }`. A finding of this feature that is already fixed or dismissed returns `alreadyClosed: true` without calling the service, so the service's rule is unchanged.
- `get_ticket` leaves out `context` on done and cancelled tickets unless `full: true`.
- `get_project_context`: the charter becomes `{ unchanged, sha }` on a repeat; `baseBranches` loses `selectable`; `project` is cut to `{ id, name, repoPath, sessionBranch }`; `full: true` returns today's reply. `toolGetProjectContext` takes a third `input` argument.
- `read_feature_chat` resumes from the thread's last read. `main-chat-excerpt.ts` gained `mainChatTurns` and `capTurnsCounted`; `mainChatExcerpt` and `capTurns` behave as before.
- Each tool description gained one clause about `full`; nothing else in the descriptions changed.
- Tests: new `test/repeat-reads.test.ts` goes through the real `/mcp` and `/api/hooks` routes. It covers stubs, changed docs, `full`, the reset for compact/clear/startup but not resume, run callers getting full docs, and the orchestrator status view and its `full`. Added tests for:
  - `read_feature_chat`: only new turns, the nothing-new reason, a new transcript, the cap count, `full`, and a different thread
  - project context on a repeat
  - an already-closed finding and another feature's finding
  - `get_ticket` by ticket status

  Existing tests were updated to the receipt shapes, and some now pass `full: true`.

## Surprises
- Decision 4 also suggests a note when the status differs from the one asked for, but spec.md's receipt has no such note, so I left it out.
- New `reviewShots` are counted shot by shot, oldest pass first. `reviewShots()` keeps only the 3 newest passes, so when a 4th pass pushes one out between reads, the count can be off. If the stored count is larger than what exists now, everything is resent.

## Left undone
- I didn't check whether ACP conversations (ADR-0015) fire SessionStart hooks on compaction. If they don't, their memory only resets when the server restarts.
- The descriptions are not shortened (that's ticket 2). No drive machinery changed: no new service, env var, seed or process.

### 2. Tool descriptions: one or two sentences, one tool-loading line, no skill reload on resume

# Ticket 2 digest

## What was done
- Rewrote every tool description and parameter description in `mcp/server.ts`, `orchestrator-tools.ts` and `orchestrator-run-tools.ts` to one or two sentences or a short phrase. `get_feature_context` went from about 2.9k to about 270 characters. Error and refusal messages are unchanged.
- New `test/tool-description-length.test.ts` builds the server for every session kind plus `run` and lists tools over the real MCP client. It fails if any tool description is over 400 characters or any parameter description, including nested and union branches, is over 120. It puts no cap on a whole list.
- Serialized tool-list size (information only), chat: 22 tools, 24031 → 12986 chars. Project: 28 tools, 27346 → 16202 chars.
- Both SessionStart notes in `routes/hooks.ts` end with `Load your runcastle tools once: ToolSearch "select:mcp__runcastle__…"`, built from `toolsForAudience(session.kind)`. It is added only for `claude-code` runtime sessions (null runtime = default). The feature note's closing line now says a repeat `get_feature_context` returns only what changed and `read_feature_doc` returns any doc in full.
- `chatKickoffFor` and `selfPlanKickoffFor` take `resumed`. The launcher passes it when the conversation is already under way. The resumed chat line is "…invoke X and continue this feature, unless its text is already in this conversation (then just continue)." The resumed self-plan line is "Invoke X (unless its text is already in this conversation) and follow…". Both keep the same first 40 characters as the fresh lines, so `promptMatchesKickoff` still recognises them without changes to `conversations.ts`.
- Tests: new length test. `kickoff.test.ts` covers the resumed lines (still recognised as a kickoff, fresh unchanged). `hooks-route.test.ts` covers the tool-loading line for the chat and project notes. Removed the `get_feature_context` description assertion in `mcp-tools.test.ts`, which pinned prose that no longer exists. Rewrote the `review_drive` description assertion in `review-wires.test.ts` to check it points at `deniedCode`/`retriable`/stop.

## Moved to skills
Sentences dropped from descriptions that I did not check against the skills in `packages/skills/packs`. The skills ticket should confirm each is covered:
- `get_feature_context`: the field-by-field glossary (rounds, `latestReady`, `driveActive`, `stopped`, `waitingKind`, `humanTypedAt`, `dependsOn`/`blocks`/`upNext`, `heldBy`, `annotatedModels` being the only models `emit_tickets` may assign, `burnConcurrency`, `scenarios.setUp` deciding whether a ticket ships a scenario, `designs`/`approvedBy`/`opened`, `reviewEvidence` to be read before planning more work). Also: `goalNotInlined`/`ticketsNotInlined` and `notInlined` docs MUST be fetched before acting, and `openDefects` vs `findings`.
- `emit_tickets`: `blockedBy` positions are positions within the call; `model` takes an annotatedModels id only with a reason to deviate; storing opens the Work panel.
- `update_ticket`: only pending/failed can be edited; `model: ""` clears the assignment.
- `cancel_ticket`: a cancelled blocker counts as satisfied.
- `resolve_finding`: to fix a defect through a ticket, emit it with `originFindingId` and the round closes the finding when it lands.
- `dispatch_round`: the full list of refusals (a round already running, driving, shipped, Stop pressed) and how a blocker outside the round counts.
- `declare_ready`: run the checks first and tell the human in chat what to test and how you checked.
- `wait_for_you`: what each `kind` means and the button wording it produces, including that a "design" wait with no recorded design reads as an answer.
- `start_design_server`: write `$RUNCASTLE_DESIGN_PORT` in the command, pinned (e.g. `bunx vite --port $RUNCASTLE_DESIGN_PORT --strictPort`), on every OS. The command is recorded in `.runcastle/design.json`, which should be committed. The server's lifetime rules.
- `show_design`: one design per screen. States are buttons inside the page and tweaks are inside it, so never show a separate design for a state or variant. Show again after every change (this resets it to waiting). Approving in words → `set_design_state`. `set_design_state approved` → commit as "design: <title>".
- `show_file`: say what it shows in `caption` and put the ask after the call. Words before the call fold away. The chat keeps a copy. Files linked from Markdown/HTML are not copied.
- `show_plan`: refused when there is no plan page, decisions or spec.
- `notify_human`: do not call during a back-and-forth. A tap opens this chat. Relay any `note`. Refused on a feature an orchestrator thread holds.
- `show_review_package`: say so when `commitsSince` is above zero.
- `dry_run_drive`: `start` lands committed work on the base branch first, so commit `.runcastle/` scripts; the landing refusal reasons. A clean pass stamps keys verified and your own checks decide.
- `record_finding`: record a deliberate none (empty value plus evidence); `userSupplied` only when the human gave it verbatim. `record_event`: reuse existing tags.
- `review_drive`: the `slot_held` poll (about ten times, thirty seconds apart), `dirty` being final, and scenario/try_call/capture details. `packages/skills/burner/review-ticket.md` already carries the poll and dirty rules.
- `create_feature`: always pass `baseBranch` explicitly, naming the one told to the human. Pass `dependsOn: [this slug]` when parked scope builds on this feature. Ask per feature whether to start or park.
- `get_project_context`: how to read the feature index lines (`waits on`, `up next`, `stuck`, `blocked`) and where older shipped docs live. Reply notes (`FEATURE_INDEX_NOTE`, `ADRS_NOTE`) still carry some of this.
- `get_work_record`: digests move out whole for big features (`digestNotInlined`). Never returns goals or criteria. `seam` is a case-insensitive substring match.
- `read_feature_brief`: shipped briefs come from the worktree and in-flight ones from the database.
- `read_feature_chat`: `shown` paths work with `show_file`, even after merge. Use `show_review_package` to put a review in front of the human.
- `send_to_feature`: a message counts as a human message and lets the agent start a round after a Stop.
- `set_feature_dependencies`: the refusal cases and the stored-set return.

## Surprises
- `hooks.ts` now imports `toolsForAudience` from `mcp/server.ts`. There is no cycle, since `server.ts` does not import the hooks route.
- `planKickoff`'s explicit lines (relay, conflict) are the caller's own text. Only the `opening` that follows them carries the resumed wording, which is what the resumed launch path uses.
- `PROJECT_READ_NOTE`, `ADRS_NOTE` and `FEATURE_INDEX_NOTE` are reply content, not descriptions, so I left them. `PROJECT_READ_NOTE` is still appended to the orchestrator's read tools and each stays under the cap.

## Left undone
- The self-plan prompt's remaining wording and any `$feature` Codex handling are unchanged. Codex gets no tool-loading line, as specified.
- Not verified: whether every sentence under "Moved to skills" is already in a skill. That check belongs to the skills ticket.
- No drive machinery changed: no new service, env var, seed or process.

### 3. Skills: the project skill keeps only what every turn needs, feature references load one at a time

# Ticket 3 — skills say less

**What was done**
- `project/SKILL.md` went from 49,287 to 24,974 bytes. Section 1 (intake) and the working-agreement questions moved to the new `project/references/intake.md`. Sections 2–4 (routing, portfolio Q&A, curation) moved verbatim to the new `project/references/routing.md`. Sections 1–6 and Notes triage are now one pointer each, saying when to read which reference. "## Your tools" is gone. In its place are two short lines: load runcastle tools once with the start note's ToolSearch line, and how to read shipped vs in-flight features' docs. `## Orchestrating` stays. Its `### The working agreement` subsection now keeps only what applies every turn: that the agreement exists, "You decide" means autonomous, read it back from the briefs, "Let them see it", and the work-within-it rules. The reorient line now says `get_feature_context({ slug })` gives a status view and `full: true` gives the lead's bundle. `read_feature_chat` returns what is new (`full: true` for the last turns). A few repeated sentences were tightened to land under 25k; the size margin is only about 30 bytes.
- `feature/SKILL.md` got 2 in-place sentence edits. Orient: load tools once, and a repeat `get_feature_context` sends only the docs that changed, while `read_feature_doc` returns any doc in full. That replaces "again whenever you are unsure". Intro: read only the reference for the step in hand, one file per read.
- `preview-starter.html` has `<!-- FILL:<name> -->` markers for 9 slots: title, what, show, screen, later, not-this, D, C, hood. The D and C markers sit inside the script as `// <!-- … -->` so the JS stays valid. `preview.md` says to `cp` the starter, `grep -n 'FILL:'` the copy and edit each slot, never reading it whole. It lists every slot, with the D and C entry shapes.
- `design.md` went from 13.1k to 6,975 bytes. All 8 numbered sections and **Tweaks** are kept, with the same numbers.
- Tests: `orchestrator-skill.test.ts` now checks the ≤25k size, the absence of "Your tools", that every pointed-at reference exists, and that every project tool is named across the skill plus its references. The working-agreement assertions are split between `intake.md` and Orchestrating. `preview-skill.test.ts` adds one test: every FILL slot in the starter is listed in `preview.md`. The 6 named skill test files pass (167 tests), and `bun run typecheck` is clean.

**Surprises**
- `orchestrator-skill.test.ts` pinned the whole "Your tools" section, and the "Four procedures load on demand" line. Those assertions were repointed, not dropped.

**Left undone**
- No "Moved to skills" list from ticket 1 or 2 exists in the repo (no digest, commit body or doc), so nothing was carried over.
- `planning-alone.md` never mentions reading feature context, so no `full: true` line was added there.
- `tickets.md` is untouched. The drive machinery is unaffected (skill files only).
