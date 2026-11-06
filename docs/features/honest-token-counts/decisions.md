# Decisions — Honest token counts

Planned without the human (a headless planning run, 2026-11-06). Every decision
marked **Assumed.** is the lead's own pick, open to the human's change. One
independent challenger read the brief and these decisions; where it changed a
decision the decision says so, and where it disagreed and lost, a
**Challenged:** line carries its reason.

Check first: 1, 4, 6, 8, 9

## 1. A conversation is counted once, and each message goes to the launch that wrote it
**Decision:** The unit of counting is the transcript (one agent conversation, with its sub-agent transcripts, as today). Every message in it is counted exactly once. It goes to the launch that was running when it was written: the newest launch of that conversation that started at or before the message's timestamp. A launch's start and purpose come from the launch record the server already writes for every launch. Each session row (one record that may span several launches) keeps its total and, beside it, the same total split by launch purpose (lead-wake, self-plan, resolve-conflict, none…). Summing rows gives the true total; summing the purpose split gives honest per-purpose totals. Messages older than any launch record go to the oldest row of the conversation.
**Why:** Today each resumed launch of a conversation holds the conversation's whole total, so one 14.76M transcript reads as 6 × 14.76M. Counting once per transcript fixes the sum. Splitting by launch rather than by row keeps per-purpose totals honest even when one row is reused for launches with different errands.
**Assumed.** Alternative: count each transcript once on its newest row and leave the older rows empty (simpler, but every per-purpose total is wrong).
**Changed by the challenger:** the first draft split messages by session row and let the row's purpose label decide; a later launch reusing the row would then relabel an earlier errand's tokens. The split is now by launch.

## 2. Every session kind with a transcript is counted, on both runtimes
**Decision:** Main chats, side chats, orchestrator (project) sessions, prepare sessions and headless runs (self-planning, relays, wake-ups) are all counted, with or without a feature, on Claude Code and Codex alike. Only rows with no transcript stay "not counted".
**Why:** The orchestrator alone is ~221M of two weeks, about 12% of chat tokens, and it is uncounted today because only main chats are.
**Assumed.** Alternative: count orchestrator sessions into a separate per-project figure outside the sessions table.

## 3. Counts are taken when a turn ends and when a session ends
**Decision:** When a session's agent finishes a turn, its count is brought up to date by reading only what the transcript gained since the last count. When the session ends, it is recounted in full, which corrects any drift. The refresh on a feature read and at a round's end stay as backstops. A count never lowers a figure because its transcript is missing or shorter than before (deleted or cut by the CLI): it keeps the last good figure. Counting never blocks or fails a turn.
**Why:** Today counts refresh only on a feature read or a round's end, so orchestrator and prepare sessions (no feature) never refresh, and 14 of 46 counted chats were more than 2% off. Reading only the new part keeps per-turn counting cheap on orchestrator transcripts that run to hundreds of millions of tokens.
**Assumed.** Alternative: a background sweep every few minutes over live sessions.
**Changed by the challenger:** the first draft recounted the whole transcript at every turn end, which is heavy on long orchestrator conversations, and did not say what a vanished transcript does to a good figure.

## 4. Existing sessions are recounted once, from the transcripts still on disk
**Decision:** On the first server start after this ships, every existing session row whose transcript still exists is recounted under the new rules. Where a transcript is gone, its rows' old duplicated figures are collapsed: the newest row keeps the figure, the others go to zero, and all of them are marked as not recounted. Past review tickets cannot be recovered (their transcripts were never kept) and stay "not counted".
**Why:** The point of the feature is to see what later savings change. Without a recount, the baseline the next features are measured against is the wrong one, and old duplicated rows would keep inflating it.
**Assumed.** Alternative: count honestly from now on only, and accept a two-week gap in the baseline.
**Changed by the challenger:** the first draft let rows with a missing transcript keep their old figures, which are exactly the duplicates this feature removes.

## 5. Review tickets are counted like implementation tickets
**Decision:** A review ticket's worker run adds its tokens to the ticket, by the same harvest the implementation tickets use, including when the run errors after writing its digest.
**Why:** All 325 review tickets are uncounted today, 423M in the analysis window alone; the review path simply drops the run's result.
**Assumed.** Alternative: none worth weighing; this is the brief's bug.

## 6. Cost is read as "weighted tokens", worked out from the stored split
**Decision:** Sessions and tickets keep the raw total (unchanged meaning) and its split by kind, with 5-minute and 1-hour cache writes stored apart. The cost-weighted figure, **weighted tokens**, is tokens priced as uncached input: input 1, cache read 0.1, 5-minute cache write 1.25, 1-hour cache write 2, output 5. It is not stored; one shared function and the documented query work it out from the split, so a weight can change without a recount. One weight set serves both runtimes.
**Why:** Cache reads are 97% of today's raw total, so it says little about cost. A ratio to the input price holds across Claude models and price changes, so a fix's saving reads the same next month; dollars would need a per-model price table that goes stale.
**Assumed.** Alternative: a dollar figure from a per-model price table.
**Changed by the challenger:** the first draft stored the weighted figure in a column, which freezes today's weights into every row.

## 7. A session's purpose label follows the current launch
**Decision:** When a launch reuses a conversation's row, the row's purpose becomes that launch's purpose, or none when the launch has none. The errand line in the agent's instructions ("This session resolves a merge conflict…") is written only for the launch that has that errand. Token counts do not read this label (decision 1 splits by launch).
**Why:** Today a purpose such as resolve-conflict sticks on the main chat forever, so every later launch tells the agent it is resolving a conflict.
**Assumed.** Alternative: open a fresh row for every errand launch (it would change which row the chat shows as its conversation).

## 8. Every context meter colours by context size, not by how full the window is
**Decision:** The context meter in every chat (feature, side and orchestrator, desktop and phone) turns amber once the context reaches 200k tokens and red at 400k, whatever the model or runtime. It also turns red at 85% of the window, so a small-window model still warns before it runs out. The meter's number shows the size ("212k") instead of a percentage; the bar still fills against the window. When amber or red, the popover adds one line saying every message now re-reads the whole context and Compact now cuts it.
**Why:** Each message re-reads the whole context, so cost grows with absolute size; against a 1M window, today's amber (650k) comes far past the point where cost hurts. A percentage of 1M ("21%") beside an amber colour would read as a contradiction, so the number changes too.
**Assumed.** Alternative: keep the percentage and change only the colours.

## 9. No new place shows the totals
**Decision:** The counts stay telemetry: recorded in the database, read by analyses, shown nowhere new in the app. The spec documents the query that sums them correctly, raw and weighted, by session kind, purpose and day.
**Why:** Nothing the human asked for needs a screen, and the brief leaves it to the lead. A spend view is its own feature once the numbers are trusted.
**Assumed.** Alternative: a "spent so far" line on each feature (raw and weighted).

## 10. Burn logs show file work too
**Decision:** Worker logs also record Read, Write, Edit, MultiEdit, Grep, Glob and NotebookEdit calls with their path or pattern, by adding them to the tool list in runcastle's existing patch of sandcastle (the worker-run library).
**Why:** Today burn logs and burn timing see only shell, web and sub-agent calls, so file work is invisible. It is one line per tool in a patch runcastle already keeps.
**Assumed.** Alternative: leave burn logs alone until burns become workers.

## 11. Savings are measured in weighted tokens over a date window; no snapshot is saved
**Decision:** Later features compare weighted tokens per day (and per landed ticket) before and after they ship, using the documented query over a date window. No baseline snapshot is stored: the one-time recount makes the past honest, so the baseline is simply the dates before a fix.
**Why:** Gives every later saving one yardstick without a new table or a moment someone must remember to snapshot.
**Assumed.** Alternative: store a dated baseline snapshot when this feature ships.
