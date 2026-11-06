## Purpose

Quick-win cut from the token analysis (2026-11-06). Implementation burns used 1.07B tokens in two weeks (87 tickets, median 7.3M, mean 12.3M) and review tickets another 423M uncounted. A ticket's cost grows with the square of its length: final context ≈ the ticket's cache-creation count + 13k, and every call re-reads it. These are prompt, guide and config changes that pay now and carry over when burns become workers.

## Findings (evidence)

1. **A few giant tickets cost a third.** 10 tickets ended above 250k context and used 464M (36%). Worst: `tickets-and-review-are-tools-not-phases` ticket 7 (133.6M, ~5,800 lines across 4 packages, ~705k context); `chat-as-web-components` ticket 4 (121.7M, 11 criteria, ~9,700 lines). Splitting those 10 in half saves ~116M. The ticket guide (`packages/skills/packs/runcastle/skills/feature/references/tickets.md` ~36–66) pushes toward merging ("splitting triples it") and aims at ~100k per ticket while the median ends at 149k. Direction: cap ~6 criteria and one area; a ticket-shape warning above 8 criteria or 3 packages; enforce expand–migrate–contract for wide removals.
2. **Burns never compact** (~170M): they run on `claude-opus-5-5[1m]` with no compaction window. Set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (~200k) in `buildAgentEnv` (`ticket-burner.ts` ~:4246); commit-often limits what a compaction loses.
3. **The check rules contradict each other** (~60–70M): typecheck ran 490 times (median 3/ticket, max 17); ~100 full-suite runs. `implement-ticket.md` step 4 says typecheck before each commit, its verify section says once after commit; 49 lead-written ticket contexts say "verify with typecheck and test from the repo root", overriding "never the full suite". Make it one rule, and ban whole-suite commands in ticket contexts in `tickets.md`. Read the shipped `tickets-stop-repeating-checks-and-tests-earn-their-place` first — it attacked part of this.
4. **Drive reviews read screenshots back** (~100M+): 33 drive reviews cost 406M; 1,702 of ~3,188 calls were single `agent-browser` actions; 515 screenshots were read into context (~68M). Verify with the text snapshot; keep screenshots as evidence for the human, never read back; batch walkthrough steps. The review prompt template is 32k chars — trim it.
5. **The docs digest inlines brief, decisions and spec in full** (~8k tokens per call on average, max 109k chars). Inline the spec only; list the brief and decisions as files to read when needed (~50M).
6. **Model default.** 91 of 120 tickets ran on Opus 1M because `stepModels.implement` points at it. A small sample (5 Sonnet vs 49 Opus tickets of similar size) suggests Sonnet uses about half (median 4.1M vs 8.8M). **This changes quality, so ask the human before changing the default** — or propose a fair comparison first.
7. Lower confidence: burns set no effort level (output ≈28% of final context); try medium.

## Weird things seen (fix if in reach)

- Shell edits by line number (`sed -i '417,433d'`) get past the burn guard; 655 shell-edit calls.
- Drive reviews prompt live agents inside the test drive ("what is your exact model id?").

## Must not swallow

- Moving burns onto the worker runner, keeping transcripts → `burns-become-workers`.
- Counting review tokens → `honest-token-counts`.
- The lead's own chat → `lead-chats-stay-small`.

## Working agreement (cut 2, agreed 2026-11-06): autonomous

The orchestrator carries this to merged on its own judgement, after the lead's review round — except the model default, which goes to the human first.
