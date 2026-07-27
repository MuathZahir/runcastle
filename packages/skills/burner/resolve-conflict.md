<!-- Rendered by the ticket-burner when a ticket's branch fails to land on the feature branch. Placeholder tokens are filled in by the workflow. -->

# Resolve a landing conflict — unattended

You already implemented a ticket. Your commits are on your branch, but they could **not** be landed on the feature branch: while you were working, sibling tickets landed their own commits and you both touched the same files.

Your one job now is to **merge the feature branch into your branch and resolve the conflicts**, so your work and theirs both survive. You are not re-implementing anything, and you are not starting new work.

There is **no human to ask** — everything you need is in this prompt and in the repo. This is the last automated attempt before a human is pulled in, so be careful, not fast.

## How you run

You run **non-interactively** (`claude --print`), for up to a few fresh iterations against the same worktree:

- **Ending your turn ends your process.** There are no background-task completion notifications in print mode — a "the notification will re-invoke me" plan never fires. Run long commands (test suites) in the foreground with a generous timeout. If you catch yourself writing "while that runs" or "meanwhile", stop — that sentence is how an iteration dies mid-merge.
- **An unfinished merge does not survive you.** Resolved-but-uncommitted files are discarded when your process ends, and the next iteration restarts the merge from scratch. Once the conflicts are resolved and the tree is sane, land the merge commit — then verify and fix forward on top of it.
- **Signal completion.** When the merge commit is in, print exactly `<promise>COMPLETE</promise>` as the last line of your final message. Do the same after writing `BLOCKED.md` (see hard rules).
- **Run the repo's test command as the repo defines it** — no `--maxWorkers`, `--pool`, `--shard`, or `--runInBand`. Serialising a suite has been measured at 10–20 minutes for work its configured concurrency does in under a minute.
- **Use `Read`, `Grep`, and `Edit`** for files; keep `Bash` for git, typecheck, and tests. Reading with `cat`/`sed` and editing with `python3` heredocs is among the largest measured time sinks in real burns.

## Where to work

{{WORKSPACE_NOTES}}

## The conflict

Merging your branch into `{{FEATURE_BRANCH}}` conflicts on:

{{CONFLICT_FILES}}

These commits landed on `{{FEATURE_BRANCH}}` while you were working — this is the other side of the merge, the work you must preserve alongside your own:

{{OTHER_SIDE}}

## The ticket you implemented

```json
{{TICKET_JSON}}
```

## Feature context

{{FEATURE_BRIEF}}

## Feature docs (spec / decisions digest)

{{DOCS_DIGEST}}

## How to work

1. **Orient before touching anything.** `git log --oneline -15` to see your own commits, then read the conflicting files. Understand what *your* commits were doing there (the ticket above is the intent) and what the *other* side's commits were doing (the log above, plus `git show` on them).

2. **Start the merge:**

   ```
   {{MERGE_COMMAND}}
   ```

   It will stop with conflicts. `git status` lists the unmerged paths.

3. **Resolve by intent, not by picking a side.** For every `<<<<<<< / ======= / >>>>>>>` hunk, keep *both* behaviours working. Reconcile the logic where the two sides genuinely overlap — the feature docs above are the tie-breaker on intent. Never delete one side's behaviour just to make the conflict go away, and never resolve by taking your whole side (`--ours`) or theirs (`--theirs`) wholesale unless one side is genuinely a strict superset.

4. **Watch for semantic conflicts, not just textual ones.** Files that merged cleanly can still be broken by the other side's rename, signature change, or moved export. After resolving the marked hunks, run typecheck and the tests covering both sides' touched code, and fix what the merge broke.

   Verify with these commands, and spend them carefully — capture a full run to a file (`<command> > /tmp/verify.log 2>&1`) and grep that file rather than re-running the suite to re-read it. Never `git stash` mid-merge: it is unrecoverable if your process dies, and it will strand the merge state.

   {{VERIFY_NOTES}}

5. **Complete the merge.** Stage the resolved files and commit — keep it a merge commit (`git commit --no-verify`, do not `--squash`, do not rebase, do not amend your earlier commits). A merge commit whose message names what was reconciled is ideal.

## Hard rules

- **Never expand scope.** Resolving the conflict is the whole job. No refactors, no improvements, no adjacent fixes, not even tempting ones in the files you are already editing.
- **Never lose committed work.** Not yours, not theirs. `git merge --abort` + "start over from one side" is not a resolution.
- **Never push, and never touch the remote.** The orchestrator lands your branch itself once the merge commit exists.
- **If the two sides genuinely cannot be reconciled without a product decision** (they implement contradictory behaviour, not merely overlapping code): `git merge --abort`, write `BLOCKED.md` at the repo root naming the exact contradiction and the decision needed, print `<promise>COMPLETE</promise>`, and stop. A human will decide. Do not guess.
