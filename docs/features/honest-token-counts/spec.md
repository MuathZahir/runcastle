# Honest token counts

## Problem

We are about to spend real work cutting what runcastle's agents spend, and we cannot see what any fix saves, because runcastle's own counts are wrong:

- Orchestrator, side and prepare sessions record nothing (~12% of chat tokens missing).
- A conversation resumed by several launches holds its whole total on every launch's row, so naive sums run ~65% high (2.8B against a true ~1.7B).
- Counts go stale: they refresh only on a feature read or a round's end, and a third of counted chats were more than 2% off.
- Review tickets are never counted (423M in two weeks).
- The one total mixes kinds: cache reads are 97% of it and cost a tenth of input, so it says little about cost.
- A one-off purpose such as resolve-conflict sticks to the main chat forever, so later launches tell the agent a false errand and per-purpose totals are wrong.
- The context meter warns at 650k of a 1M window, long after cost starts to hurt.
- Worker logs see shell calls but not file reads and edits.

## Approach

From the user's side: the context meter warns at a size where cost hurts, and every count in the database is one an analysis can sum straight, raw or weighted, by session kind, purpose and day. Nothing new appears on screen except the meter's change (decision 8); the totals stay telemetry (decision 9).

**Counting once (decisions 1, 2).** The transcript is the counting unit. Core's pure summing function gains a per-message form: it yields each counted assistant message (deduplicated by message id, as today) with its timestamp and its usage split — input, 5-minute cache write, 1-hour cache write, cache read, output. Claude Code reports the two cache-write kinds under `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`; older lines carry only `cache_creation_input_tokens`, which counts as 5-minute. Codex has no cache writes. Sub-agent transcripts are summed in as today.

The server's usage service counts a whole conversation at a time: it gathers every session row sharing the transcript and the conversation's launch records, then assigns each message to the newest launch record at or before it (messages before any go to the earliest). Each row stores its total and its split, plus a `byPurpose` map (purpose → split; `none` for no errand), the conversation's total at that count, and the transcript mtime it counted. Launch records are the `session.launching` events the launcher writes and the new `session.purpose_set` events written whenever a row's purpose changes; a row with neither counts as one launch at its creation, on its own purpose. Events gain an index on their type for this lookup. Every session kind with a transcript is counted.

**When (decisions 3, 13).** The turn-end signal (the point a session is marked awaiting input) and a session's end both recount the conversation when its transcript changed since the last count, re-reading it in full; lines that cannot hold a count are skipped before parsing, so the largest transcript counts in well under a second. The lazy refresh on a feature read and the round-end refresh stay, now over every session kind of the feature. A transcript that is missing or shorter than at the last count never lowers a stored figure. Counting is best-effort; failures are swallowed.

**Backfill (decision 4).** A one-time pass on boot (self-marking: a counted row carries its conversation total, a collapsed one `recounted: false`, so later boots find nothing) recounts every conversation whose transcript exists. For conversations whose transcript is gone, the newest row keeps its figure, the others are zeroed, and all are marked `recounted: false` in their breakdown. Past review tickets stay null.

**Review tickets (decision 5).** The review workflow keeps the result of its worker run (including the partial result when the run throws after the digest is written, where sandcastle provides one) and passes its iterations to the same harvest implementation tickets use.

**Weighted tokens (decisions 6, 11).** The token-breakdown JSON gains `cacheCreation1h`, the 1-hour share of `cacheCreation` (absent on old rows, read as 0), and the `byPurpose` map. Core exports the weights and a `weightedTokens(split)` function: input ×1, cache read ×0.1, 5-minute write ×1.25, 1-hour write ×2, output ×5. No weighted column is stored. The spec's query (below) is the documented way to read totals.

```sql
-- Raw and weighted tokens per day and session kind (rows marked recounted=false still count).
SELECT date(created_at/1000,'unixepoch') AS day, kind,
       sum(tokens) AS raw,
       sum(  json_extract(token_breakdown,'$.input')
           + 0.1  * json_extract(token_breakdown,'$.cacheRead')
           + 1.25 * (json_extract(token_breakdown,'$.cacheCreation') - coalesce(json_extract(token_breakdown,'$.cacheCreation1h'), 0))
           + 2    * coalesce(json_extract(token_breakdown,'$.cacheCreation1h'), 0)
           + 5    * json_extract(token_breakdown,'$.output')) AS weighted
FROM sessions WHERE tokens IS NOT NULL GROUP BY day, kind;
-- Tickets: the same over `tickets` grouped by kind. Per purpose: json_each over $.byPurpose.
```

This spec is where later features find the query. This supersedes "tokens only, never cost" (the earlier feature-lead decision on token telemetry) only so far as a derived weighted figure exists; there is still no limit and no dollar figure.

**An errand lasts until it is done (decisions 7, 12).** Every change of a session's purpose emits `session.purpose_set`. A resolve-conflict purpose clears when the conflict is recorded resolved. Before a conversation's agent process starts, a retired errand (start-lap, relay, lead-wake) or a conflict errand whose conflict no longer stands is cleared, so the agent's instructions name an errand only while it is live. A new errand launch still replaces the old purpose.

**Context meter (decision 8).** The meter component shared by every chat changes its tone rule: amber from 200k tokens, red from 400k or from 85% of the window, whichever comes first. The trigger shows the size (`212k`) instead of a percentage, coloured by the tone on desktop and phone alike; the bar still fills against the window. Sizes of a million and more read as `1M`. The popover's header keeps "212k of 1M"; when amber or red, one line under the bar says every message now re-reads the whole context and Compact now cuts it. The usage-limit bars keep their percentage tones. Thresholds are constants beside the component, not settings.

**Worker logs (decision 10).** runcastle's existing sandcastle patch adds `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (path field) and `Grep`, `Glob` (pattern field) to sandcastle's tool-argument map, so those calls appear in burn logs and timing. The patch's re-application caveat (ADR-0011) applies; the manifest check that pins the patch should pin the new hunk too.

## Seams

- **Core per-message summing** (existing module, new export): given transcript text and runtime, the counted messages with timestamps and splits. Tests feed JSONL fixtures: duplicate message ids, torn lines, 5m/1h splits, old lines with only the combined cache-write field, Codex lines.
- **Core `weightedTokens`** (new): split in, number out.
- **Server conversation count** (existing usage service, reshaped): given a transcript shared by several rows and a set of launch records, each row's stored total, split and `byPurpose`. Observable in the sessions table; tests assert the rows sum to the transcript's true total and that purposes follow launches.
- **Turn-end and session-end refresh** (existing session lifecycle functions): marking a session awaiting input or ended updates its count; a missing transcript leaves it alone.
- **Backfill pass** (new, boot): rows before/after; runs once.
- **Review ticket harvest** (existing review workflow with its injectable agent runner): a fake run with iterations leaves tokens on the review ticket.
- **Errand end** (existing purpose setter and conflict probe, new pre-launch clear): a purpose change is on the timeline; a retired errand or a resolved conflict clears before the next launch; a standing conflict keeps it.
- **Context meter** (existing component, component test tier): tone and label at 150k/250k/450k of a 1M window and at 180k of a 200k window.
- **Sandcastle patch** (existing stream-line parser via the patched package): a Read tool-use line yields a tool-call event.

## Out of scope

- Changing how much any session spends (other features of this cut).
- Keeping burn transcripts (comes with `burns-become-workers`).
- Any screen showing totals or spend (decision 9).
- Dollar figures, budgets or limits.
- Recovering past review tickets' tokens.

## Open questions

- Whether sandcastle's thrown error carries the iterations of a run that died after writing its digest; if it does not, such a review counts nothing and that is accepted.
