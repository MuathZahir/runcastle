# Decisions — MCP read tools stay within a context budget

## 1. One lap, all three read tools
**Decision:** Lap 1 brings `get_feature_context`, `get_project_context` and `get_work_record` under the budget together. We are not taking the brief's fallback of fixing only `get_feature_context` first.
**Why:** Measured on the live DB (2026-09-24), all three overflow. Ticket bodies alone reach 104K chars on one feature, one-liners add 56K to the feature index, and a `get_work_record` seam query ("web") returns 114K. They share one pattern and one oversized fixture. Once the fixture exists, covering the other two tools is cheap, and a budget test that knowingly skips two tools that already overflow would be a false guarantee. The design tree is narrow, so this is not map-sized.

## 2. Agent effectiveness beats context savings; no thrift budget
**Decision:** The goal is to restructure the returns (a clean summary, with details behind their own calls, e.g. ticket titles in the summary and the body on request), not to hit a tight size budget. Wherever the two conflict, keep more inline: spending context is acceptable, but an agent missing what it needs and hallucinating is not.
**Why:** The incident was an agent acting on stale memory because the field it needed was hidden, which is a failure of effectiveness, not of cost. Stripping a summary so far that agents must guess, or skip the fetch, repeats the same failure by another route.

## 3. One "never hidden" guard test at the spill line
**Decision:** One test builds an oversized fixture (100+ features, a multi-lap feature with 15+ long tickets, long digests) and asserts that every MCP read tool's serialized result stays under a ceiling of about 60K chars, roughly 20K tokens at dense JSON's ~3 chars/token. The ceiling is safely below Claude Code's ~25K-token spill-to-file limit. It is a guard against hiding, not a thrift budget; below it, decision 2 governs.
**Why:** Past the spill limit a result is hidden from the agent, which is the effectiveness failure itself. Both context tools grew from fine to hidden with nobody noticing, so without a test they will do it again.

## 4. Tickets: summary rows carry the goal; `get_ticket` carries the rest, including the digest
**Decision:** In `get_feature_context`, every ticket across all laps appears as a summary row: id, seq, title, status, kind, lap, blockedBy, model, seams, error (in full) and goal (in full). Context, acceptance criteria and the burner's digest move to a new fetch-one read, `get_ticket({ seq })`, which reaches the same session kinds as `list_tickets` (feature sessions and run agents). `list_tickets` is unchanged.
**Why:** A single lap's ticket bodies reach 104K chars, so even inlining only the current lap would spill. Goals are small (median 282 chars, one lap's goals total 4–6K) and give the agent the what and why, so no agent works from a title alone. Serving the digest through `get_ticket` fixes a real gap: today no feature session can see what a burn actually did, because the digest is stripped from `get_feature_context` and `get_work_record` is project-only. The tool takes `seq` because that is the number the UI, `blockedBy` and agents all use.

## 5. Canonical docs: inline what fits, loudly index the rest, and never truncate
**Decision:** `get_feature_context` keeps inlining the canonical docs in full, in the order brief, decisions, spec, map, as long as the payload stays under the never-hidden guard (decision 3). A doc that does not fit is never cut short. It goes to a `notInlined` list with its relPath, its absolute path on disk, its byte count, and an explicit instruction to read it before acting (`read_feature_doc` or the file). The skills get one line saying `notInlined` docs must be read. No new doc tool.
**Why:** Canonical docs have a median of about 15K per feature, so the common case keeps what it has today. Only rare features cross the guard; the worst is 111K, driven by an 82K `decisions.md`. Always-index would make every planning session remember to fetch `decisions.md`, the skipped-fetch risk that decision 2 rules out. Head truncation (a first-N-chars excerpt) was considered and rejected: `decisions.md` is append-only, so a head cut drops the newest decisions, the ones that supersede earlier ones. A truncated doc also looks read, which is worse than one that is plainly missing. `read_feature_doc` already serves the fetch.

## 6. `get_feature_context` order: header first; docs are what gets moved out first
**Decision:** The payload fills in this priority order, each part whole or moved out, never truncated:
1. **Header, always first:** phase, lap, gates, `annotatedModels`, `burnConcurrency`, `latestRun`, the map frontier and assigned waypoint, and the review-evidence paths.
2. **Ticket rows** (decision 4).
3. **Findings and test notes, in full.**
4. **Canonical docs** (decision 5), the only part moved out to `notInlined` when the guard would be crossed.

No fetch tool for findings or test notes.
**Why:** The incident happened because decision-critical fields sat at the tail of an 80K payload; the header puts them in the first few hundred characters. Findings and test notes are the lap's to-do list and live only in SQLite, so an index of titles would make revisit and chat sessions plan against a guess. Docs are moved out first because they are the one part with a cheap, well-known fetch path. Accepted risk: if one lap's findings plus notes alone ever passed the guard, nothing would be left to move out and the guard test would fail. Real data peaks at about 35K per lap against the 60K ceiling, so a findings fetch tool waits until something needs it.

## 7. `get_project_context`: slim index lines, charter inline, a `read_feature_brief` fetch-one
**Decision:** Each feature-index line becomes `slug — title [state]`, with no one-liner and no per-line docs path. The state is `in flight: <phase>, lap n, x pending…` (as today), or `shipped`, `draft` or `archived`. Lines are grouped in-flight, then drafts, then shipped, with one note that shipped docs live at `docs/features/<slug>/`. The charter stays inline in full; live ADRs stay an index. New project-kinds-only tool `read_feature_brief({ slug })` returns title, one-liner, status/phase/lap and the brief: from `brief.md` on disk for a shipped feature, from the database for an in-flight one.
**Why:** One-liners have grown into paragraphs (median 252, max 2.5K chars; 56K total) and were 63K of a 78K payload; slug plus title for all 108 features is 8.8K. The charter binds every project decision, so it stays whole. In-flight briefs sit on unmerged branches the project session cannot read, so going from "this title sounds related" to "what it is for" needs a tool.

## 8. The feature index lists recent shipped features by count and points at the rest
**Decision:** The index always lists every in-flight feature and draft, plus the 50 most recently shipped. Older shipped and archived features collapse into one line naming how many were left out and how to reach them: search `docs/features/*/brief.md` on disk, or `read_feature_brief({ slug })`.
**Why:** It keeps the index at a stable size (about 6–7K) however many features the project eventually has. In-flight and draft features are never cut, because collision detection needs all of them and their docs are not on disk. Old shipped features are safe to move out because their docs are on disk in the project worktree, where a grep answers "did we already do X?" better than a title list. Count, not date: a date window depends on how busy the project is, so a quiet project would list nothing.

## 9. `get_work_record`: the seam form lists, the slug form tells, and `seq` drills in
**Decision:**
- **Seam form:** returns matching tickets as rows `{ feature slug, seq, title, status, seams, commits, error }` with no digests.
- **Feature-slug form:** keeps digests inline. When the payload would cross the guard, digests are moved out whole, oldest lap first, and each ticket whose digest was moved is marked `digestNotInlined: true`. Nothing is truncated.
- **Drill-down:** a new optional `seq`, used with `featureSlug`, returns that one ticket with its digest. No new tool.
**Why:** Measured: the seam form reaches 114K ("web") because it inlines digests across every feature; the slug form reaches about 70K on a three-lap, 30-ticket feature (the average is about 13K). A seam query is a sideways search whose job is to find who touched an area; `error` stays in full, so recurring failures still show. Reading what one feature did is what the slug form is for, so it keeps its digests wherever they fit (decision 2). `get_ticket` is bound to the session's own feature, and project sessions look across features, so the drill-down lives on `get_work_record`.

## 10. Skills point at the new shape, and the header only reorders
**Decision:** Skills and prompts are updated only where they describe these payloads: the `ideate`, `spec`, `tickets`, `revisit`, `qa`, `converge`, `waypoint` and `project` skills, the MCP tool descriptions, and the system-prompt lines in `launcher/artifacts.ts`. They must state two rules: `notInlined` docs must be read, and `get_ticket` holds context, acceptance criteria and the digest. They also name `read_feature_brief` and `get_work_record`'s `seq`. The burner prompts read only `lap` and do not change. The `get_feature_context` header reorders fields that already exist; no gates field is added.
**Why:** The brief rules out skill rewrites beyond pointing at the new summary and fetch-one tools. Gates are new data, not restructuring. Sequencing: `project-notes-jot-it-anywhere-triage-it-in-the-project-chat` merged to main (45a2a98a) during this session, so its `mcp/server.ts` changes are the baseline this feature builds on.
