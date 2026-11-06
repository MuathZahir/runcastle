## Purpose

Quick-win cut from the token analysis (2026-11-06). We are about to spend real work cutting token usage; we cannot see what any fix saves while runcastle's own counts are wrong. This lands first in spirit so later savings show up.

## What is wrong today (evidence)

- **Orchestrator, side and prepare sessions record nothing.** `leadSessions()` in `services/usage.ts` keeps only `kind === 'chat'`. That leaves ~221M (project) and ~13M (side) of two weeks uncounted, ~12% of chat tokens.
- **Resumed chats repeat the total on every row.** Several `sessions` rows share one transcript and each holds the full total (e.g. one transcript has 6 rows of 14.76M). Naive sum 2.8B vs true ~1.7B.
- **Counts go stale.** Refreshed only on a feature read or at round end, and only when the file is >30 s newer; 14 of 46 counted transcripts were >2% off (8931af38 shows 51.7M vs 73.7M real).
- **Review tickets are never counted.** `review-ticket.ts` (~990) awaits `run()` and drops the result; `ticket-burner.ts` calls `harvestTicketTokens` (~:5064, ~:5302). All 325 review tickets are null — 423M in the window alone.
- **The total mixes kinds**: `tokens` adds cache reads at face value (97% of it), so it says little about cost. Store the breakdown and a cost-weighted figure (cache read ≈0.1×, 1h cache write ≈2×, output ≈5× input).
- **A sticky purpose label.** The launcher sets `purpose` (e.g. `resolve-conflict`) on the main-chat row (`launcher.ts:391`) and only `self-plan` is ever cleared (`threads/lifecycle.ts:85`). Every later launch passes it on (`threads/launch.ts:85`) and `artifacts.ts:131` writes "This session resolves a merge conflict…" into the system prompt. Per-purpose totals are wrong and the agent gets a false instruction.
- **The context meter warns too late**: measured against a 1M window, amber at 650k. Cost grows linearly with context, so it should colour by absolute size (warn around 200k).
- **Burn logs see only shell calls**: sandcastle's tool map (`dist/index.js` ~2792) logs Bash, WebFetch, WebSearch and Agent only; Read/Edit/Grep never appear, so burn timing and logs miss file work. Fix if cheap.

## Must not swallow

- Changing how much any session spends (other features of this cut).
- Keeping burn transcripts (that comes with `burns-become-workers`).

## Open

- Whether totals are shown anywhere beyond the meter (`features.ts:424` says "telemetry only") — the lead's call; nothing the human asked for.

## Working agreement (cut 2, agreed 2026-11-06): autonomous

The orchestrator carries this to merged on its own judgement, after the lead's review round. The human sees it at the end.
