# Decisions — Tools and skills say less

Planned without the human (a headless planning run, 2026-11-06). Every decision
below is the planner's own recommendation, accepted; the alternative it was
chosen over is named on each.

Check first: 1, 2, 5, 9, 10

## 1. A repeat feature read sends unchanged docs as a stub
**Decision:** `get_feature_context` remembers, per session, which version of each canonical doc (brief, decisions, spec) it already sent. On a repeat call a doc that has not changed comes back as `{ relPath, sha, unchanged: true }`; a changed doc comes in full. The memory lives in the server's memory, so a server restart simply resends everything. It is wiped when the session's conversation loses its context: any SessionStart except a plain resume (so `/clear`, compaction and a fresh start all reset it). `read_feature_doc` always returns the doc in full, and `get_feature_context({ full: true })` resends everything.
**Why:** Brief and decisions were ~66% of each reply, and 63 of 146 calls repeated in the same session. Resending is safe to lose (a restart costs one full reply); keeping it in memory needs no schema change.
**Assumed.** Alternative: store the sent hashes in the database so they survive a restart.

## 2. The orchestrator gets a short status view of a feature
**Decision:** When the orchestrator calls `get_feature_context({ slug })` it gets a status view: the feature's status, waiting reason and kind, holder, `humanTypedAt`, whether a round is running, ticket counts by status, the latest ready declaration, the latest review's verdict and the count of open findings, design states, base branch and `dependsOn`, and an index of the docs with their sizes, but no doc bodies. Everything else comes with `full: true`, which returns the lead's whole working bundle, every doc in full (decision 8).
**Why:** The orchestrator mostly asks "where is this feature and does it need me?"; the lead's bundle cost it ~4M tokens over two weeks. Doc bodies stay one `read_feature_doc` away.
**Assumed.** Alternative: a separate `feature_status` tool, leaving `get_feature_context` as it is.
**Changed by the orchestrator:** it named the fields it actually uses when orchestrating; the view carries exactly those (ticket counts, not ticket rows).

## 3. Ticket and finding updates return a short receipt
**Decision:** `update_ticket` returns `{ ok, seq, status, changed }` (the field names it changed), `cancel_ticket` returns `{ ok, seq, status }`, and `resolve_finding` returns `{ ok, findingId, status }`. None of them echoes the whole row.
**Why:** The caller just sent the change; echoing the row back cost ~8M tokens and told it nothing new.
**Assumed.** Alternative: keep returning the row with its long fields (context, criteria, detail) cut.

## 4. Resolving a finding that already closed is not an error
**Decision:** `resolve_finding` on a finding of this feature that is already fixed or dismissed changes nothing and succeeds, returning its current status and `alreadyClosed: true`. A finding of another feature, or one that does not exist, is still refused.
**Why:** 27 of 99 calls failed only because the finding had closed itself when its fix ticket landed. The agent's intent was met either way, and the error sent it hunting.
**Assumed.** Alternative: keep the refusal, with a message that says the finding already closed and how.
**Challenged:** Still succeed, but add a short note when the finding's status differs from the one asked for (marked fixed, but it was dismissed), so the disagreement is not hidden.

## 5. A settled ticket's read leaves out its plan
**Decision:** `get_ticket` on a done or cancelled ticket leaves out its `context` and keeps the goal, acceptance criteria, status, seams, error and the worker's digest. Pending, running and failed tickets come in full. `full: true` returns everything.
**Why:** After a ticket lands, a reader needs what it did (the digest) and what it was meant to do (the criteria), not the instructions it was given; `context` is the bulk of ~4–6M tokens.
**Assumed.** Alternative: a `fields` option the caller picks from.
**Changed by the orchestrator:** keep the acceptance criteria, as the challenger argued: whoever judges whether a done ticket did its job needs them.

## 6. Reading a feature's chat returns only what is new
**Decision:** `read_feature_chat` remembers, per orchestrator thread and feature, how far it last read. A repeat call returns only the turns, shown files and review pictures added since, capped at the newest ~8k characters with a count of the earlier new turns it left out; with nothing new it says so in one line. A new conversation on the feature (a different transcript) is read as new. `full: true` returns the last ~8k characters as today. The memory resets like decision 1's.
**Why:** 59 of 124 reads returned the same last 8k the thread already had.
**Assumed.** Alternative: always return the last turns, but fewer of them.

## 7. The project read stops repeating the charter and the branch list
**Decision:** `get_project_context` sends the charter (`CONTEXT.md`) as `{ unchanged: true, sha }` when this thread already has the current version. It always returns the current branch, whether it can be a base, and the detected main branch, but the full list of selectable branches and the project's long prepared settings (drive instructions and the other commands) only with `full: true`. Same memory and reset as decision 1.
**Why:** The charter repeated on every call, and the branch list and settings matter only when picking an unusual base or preparing the project (~1.5M tokens).
**Assumed.** Alternative: keep the branch list and settings, dedupe only the charter.

## 8. One escape hatch, `full: true`, on every trimmed read
**Decision:** Every read this feature trims (`get_feature_context`, `get_ticket`, `read_feature_chat`, `get_project_context`) takes the same optional `full: true`, which returns what it returns today.
**Why:** One name agents learn once; a trimmed reply never strands an agent that really needs the whole thing.
**Assumed.** Alternative: a different option per tool, named for what it adds back.

## 9. Tool descriptions are one or two sentences, and a test keeps them short
**Decision:** Every runcastle tool description says what the tool does and when to use it in one or two sentences; each parameter description is a short phrase. Teaching that matters moves into the skill that uses the tool; teaching that only explains a field its name already explains is dropped. A test caps each tool's description length, so descriptions cannot grow back into essays while a genuinely new tool never fails the build.
**Why:** The chat kind's 22 tools cost ~5.5k tokens and the project's 28 ~6.3k on every call; the skills already teach how to use them.
**Assumed.** Alternative: shorten them once, with no test.
**Changed by the orchestrator:** cap each description, not each kind's whole tool list, as the challenger argued: a cap on the total fails the next feature that honestly needs a new tool.

## 10. The project skill keeps only what every turn needs
**Decision:** The project skill's main file keeps who the orchestrator is, how it opens, the standing Orchestrating rules, the closing move and the don'ts, plus a one-line pointer per job. Intake and the cut (with the working agreement), routing with Q&A and curation, the charter, health sweeps, notes triage and preparation each live in a reference file read only when that job comes up. The "Your tools" section is dropped, since it repeats the tool descriptions; its two non-tool facts (how to read shipped and in-flight features' docs, and which references exist) stay as short lines. Target: about half its size, ~25k characters or less.
**Why:** It is 49k characters, ~11.7k tokens riding every orchestrator call; most of it serves one job at a time.
**Assumed.** Alternative: also move the Orchestrating rules into references, for a much smaller main file.

## 11. Feature skill references load one at a time, and the plan page is copied, not read
**Decision:** The feature skill says to read only the reference for the step in hand, one file per read, never several in one command. The plan page starter (`preview-starter.html`) is copied with a shell copy and filled through marked slots that `preview.md` lists, so it is never read whole. `design.md` is trimmed to what a design session needs. `tickets.md` is not touched here (the `cheaper-burns` feature owns it), and edits to the feature skill's main file stay small and local (the `lead-chats-stay-small` feature edits it too).
**Why:** Reading several references in one command overflowed to a file that was then read whole (15.5M tokens), and the 15k-character starter was read 80 times before being copied anyway.
**Assumed.** Alternative: a tool that writes the plan page from the decisions.

## 12. Each session is told, once, how to load its runcastle tools in one go
**Decision:** The SessionStart note for a Claude Code session ends with one tool-search line that loads every runcastle tool that session kind is offered (`select:` with their names), and the feature and project skills say to run it once at the start rather than loading tools one at a time.
Those skill lines are written by the skills ticket (decision 14).
**Why:** Feature chats ran 143 tool searches, often for one runcastle tool late in the chat. With the descriptions short (decision 9) loading them all costs little.
**Assumed.** Alternative: only a sentence in the skills, with no ready-made line.

## 13. A resumed conversation is not told to load its entry skill again
**Decision:** When runcastle opens a conversation already under way with a briefing (a self-planning run, a relay, a conflict), the opening line says to continue and to invoke the entry skill only if its text is not already in the conversation. A fresh conversation is still told to invoke it.
**Why:** `runcastle:feature` was loaded 71 times in 41 chats; each reload added the whole skill again.
**Assumed.** Alternative: leave the line as it is.

## 14. Built as three tickets and a review
**Decision:** Workers build it in three tickets: the trimmed replies (decisions 1–8, 16), the short tool descriptions with the server's tool-loading and resume lines (9, 12, 13, 15), and every skill-file edit (10, 11, and the skill halves of 12 and 15). The second waits on the first, because both edit the tool server and the descriptions must describe the new replies; the skills ticket touches only skill files. A review ticket checks the whole with the project's checks, and by calling the branch's own tool server the way a session would: read twice, reset as a compaction does, read again, and read as the orchestrator. Nothing here has a screen.
**Why:** It is too much for this chat's window beside the conversation, and it splits cleanly between server and skill files.
**Assumed.** Alternative: the lead builds it all in its own chat.

## 15. "Call it again whenever unsure" becomes "read what you need"
**Decision:** The feature skill and the SessionStart note stop telling agents to call `get_feature_context` again whenever they are unsure. They say a repeat call returns the current state with only changed docs in full, and that a doc not in view (after handing work to a subagent, say) is one `read_feature_doc` away.
**Why:** With stubs (decision 1), an unsure agent that calls again gets a stub back; the advice has to point at the read that actually returns the doc.
**Assumed.** Alternative: keep the advice and let the stub's own note redirect the agent.

## 16. Who gets stubs: every conversation, never a worker
**Decision:** The stubs of decisions 1, 6 and 7 apply to every session kind with a conversation (the lead's chat, side chats, Q&A, drive-fix, the orchestrator and the rest). A worker on a round always gets full replies, since nothing tells runcastle when its context resets. A subagent shares its parent session's memory, so each stub carries the doc's path on disk and one line saying to read it there, or with `read_feature_doc`, if it is not in view.
**Why:** Every conversation repeats its reads, but only conversations have a start note that says when their context was lost. Runcastle cannot tell a subagent's call from its parent's, so the stub has to be enough on its own.
**Assumed.** Alternative: stubs for the lead's chat and the orchestrator only.

