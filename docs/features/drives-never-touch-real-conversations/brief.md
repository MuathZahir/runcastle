## Purpose

Bug fix found by the token analysis (2026-11-06). It costs tokens, but worse, it makes real agents act on fake news.

## What happens (evidence)

- `.runcastle/drive-setup.ts` (~:193) copies the live database for the drive, including running runs and each thread's Claude session id. The drive's server boots, marks those runs "interrupted by a server restart" (`workflows/reconcile-runs.ts` ~:153), and **resumes the real Claude transcripts** (`~/.claude` is shared with the real install).
- 22 "interrupted" prompts reached real transcripts on 11-04 to 11-06, while the live database has no such events after 11-02.
- Transcript bb39c782, 11-05 04:50: the live run was still burning, but the lead (woken by the drive's copy) re-dispatched; `run_iNeDj5mXwyQ8` is not in the live DB and failed with "auth token missing". It then set the feature waiting on the human for a reason that wasn't true.
- The drive copy switched that real chat's model (`/model claude-opus-5`, 04:55:51), forcing a 336k cache rewrite.
- An orchestrator "stopped the leftover drive" that belonged to a live review; rounds were reported out of order ("Round 2 failed" then "Round 1 succeeded", bb39c782, aef5dfb5).
- Cost of the phantom turns alone: ~35M tokens.

Also in scope, same family of "work done twice":
- **The same conflict resolved twice.** 2e3b4a92 got the resolve prompt at 10-29 16:34 and finished at 16:37; at 16:38 the orchestrator relayed the same conflict, and the lead did 33 more calls (~12M) including a two-subagent code review.

## Direction (lead decides)

Clear Claude session ids and close running runs in the copied database, and/or give the drive server its own Claude config dir, so nothing the drive starts can reach a real conversation.

## Understood

- Drives of runcastle start from the globally installed version; a change to drive machinery must be tested by hand-starting this branch's server (project memory).

## Must not swallow

- `boot-cleanup-never-touches-a-live-burn` (draft): the *real* server's boot reconcile mistaking a live burn for a dead one. Adjacent, separate.

## Working agreement (cut 2, agreed 2026-11-06): autonomous

The orchestrator carries this to merged on its own judgement, after the lead's review round.
