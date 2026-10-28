# A burn's last commit is never stranded in the sandbox

## Problem

A ticket's agent works in a checkout inside its container (a fresh clone in
`isolated` mode, a reused cache-volume checkout in `slot` mode). A git
`post-commit` hook pushes each commit to the ticket's temp branch on the host.
When that push fails, the hook says "will retry on your next commit; do not
re-commit" and gives up. For the last commit there is no next commit: the
container is removed, and the ticket fails with "agent made no commits" even
though the agent finished, with checks green.

It happened on 2026-10-28: the server's boot cleanup deleted two live ticket
branches (they had no commits yet, so they looked merged). Every later push used
`--force-with-lease` against a branch that no longer existed and was refused as
"stale info". One agent pushed by hand and landed; the other lost its work.

## Approach

From the human's side: a ticket whose agent committed its work either lands it,
or fails saying "N commit(s) stranded in the sandbox" with the reason and a
branch holding them. It never fails as "agent made no commits" when commits
exist, and never lands only part of the work as done. When the host had to
collect commits the sandbox could not push, the feature's timeline says so.

The shape, all in the burner (`packages/server/src/workflows/ticket-burner.ts`)
and its tests. The burner prompt and verify-notes text are not touched
(the in-flight feature `tickets-stop-repeating-checks-and-tests-earn-their-place`
owns them).

**The sync hook** (built by the shared repo-setup steps, so `isolated` and
`slot` both get it), on every commit:

1. Records the checkout's HEAD in a small sync folder in the mounted workspace
   (decision 7). The folder sits beside the other agent files the host harvests
   and is never committed.
2. Pushes with `--force-with-lease` as today; on refusal, waits briefly and
   tries again.
3. On refusal again, does a plain push to the full ref name
   (`refs/heads/<tempBranch>`, so a detached HEAD in a fresh clone of a
   workspace whose branch was deleted still works). This creates a missing
   branch or fast-forwards one that is behind, and refuses if the host holds
   commits the sandbox lacks (decision 1). Never a force push without a lease.
4. On success, deletes any saved bundle in the sync folder: a newer push
   carries everything.
5. On failure, writes a git bundle of the unsynced commits (HEAD, excluding what
   the remote-tracking ref says the host already has; all of HEAD when that ref
   is missing) into the sync folder, replacing any older one (decision 2). It
   prints one stderr line: the commit did not reach the host, it is saved for
   the host to collect, carry on, do not push by hand or re-commit
   (decision 4). It still exits 0.

**Container setup** (decision 6): after the checkout is ready and before the
agent starts, if the sync folder holds a bundle whose commits follow from the
checkout's tip, fast-forward the checkout onto them and push. Otherwise leave
the bundle for the host. In `slot` mode the fetch of the temp branch must still
come first; this step follows it.

**Host, after every agent run** (decision 2, 3, 7), one function the success
path and the failed-attempt path both call, before they read the worktree's
agent files away or count the ticket's commits:

- If a bundle is saved: verify it, fetch it, and move the temp branch onto its
  tip when the branch is missing or is an ancestor of that tip. Emit a timeline
  event naming how many commits were collected. When the branch went
  elsewhere, keep the bundle's commits on a branch of their own next to the
  temp branch and report them as stranded.
- If a HEAD record is present, check the temp branch contains that commit. If
  not, report stranded.
- Report stranded as a failed outcome: `N commit(s) stranded in the sandbox:
  <reason>`, naming the kept branch when there is one. That outcome wins over
  "done" (no partial landing) and over "agent made no commits". The temp
  branch's own commits stay preserved for Retry as any failed ticket's chain
  is (decision 8: Retry does not switch to the stranded branch).

`mounted` and `noSandbox` modes commit straight into the host worktree, have no
hook and no sync folder, and are unchanged: the host function finds nothing and
does nothing.

The doc comments explaining the hook's "it will heal; do not re-commit"
reasoning are rewritten to match.

## Seams

- **The sync hook and setup script under real git** (existing):
  `packages/server/test/burn-slot-workspace.test.ts` already runs the slot setup
  script against throwaway workspace and volume repos and commits in the slot.
  New cases there: delete the workspace's temp branch, then commit, and the
  commit reaches the workspace; break the remote entirely, then commit, and a
  bundle is saved and the agent is told so; a later good commit clears it; the
  next setup on a slot with a saved bundle takes the commits in. An `isolated`
  clone of a workspace on a detached HEAD syncs too.
- **The host's collect-and-check function** (new, exported from the burner):
  given the repo, the temp branch and the worktree directory, it returns
  collected / stranded / nothing. Tested with real git temp repos: a bundle on a
  deleted branch is collected; a bundle on a diverged branch is kept on its own
  branch and reported stranded; a HEAD record missing from the branch with no
  bundle is reported stranded; no files means nothing.
- **Outcome interpretation** (existing, `interpretRunResult` and the code after
  `run()`): a stranded report turns into the named failure even when the chain
  has commits.

Tests assert behaviour (where commits end up, what the outcome says), not the
hook's text, except that the line no longer promises a later commit.

## Out of scope

- The boot cleanup deleting a live burn's temp branches, and the boot reconcile
  failing a run that is still alive. Parked as the backlog feature "Boot cleanup
  never touches a live burn" (decision 5).
- The burner prompt (`implement-ticket.md`) and the verify-notes text.
- Making Retry resume from stranded commits (decision 8).
- Any change to `mounted` / `noSandbox` workspace modes.

## Open questions

- Until the parked feature ships, a hot reload of the server during a burn can
  still delete a temp branch before the agent's first commit. This feature
  makes the next push recreate it, but a sandbox restart that happens before any
  commit still fails its setup fetch. Accepted as the parked feature's to fix.
