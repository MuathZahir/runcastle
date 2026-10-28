# A burn's last commit is never stranded in the sandbox

## Problem

A ticket's agent works in a checkout inside its container (a fresh clone in
`isolated` mode, a reused cache-volume checkout in `slot` mode). A git
`post-commit` hook pushes each commit to the ticket's temp branch on the host.
When that push failed, the hook said "will retry on your next commit; do not
re-commit" and gave up. For the last commit there is no next commit: the
container is removed, and the ticket fails with "agent made no commits" even
though the agent finished, with checks green.

It happened on 2026-10-28: the server's boot cleanup deleted two live ticket
branches (they had no commits yet, so they looked merged). Every later push used
`--force-with-lease` against a branch that no longer existed and was refused as
"stale info". One agent pushed by hand and landed; the other lost its work.

## Approach

From the human's side: a ticket whose agent committed its work either lands
it, or fails saying "N commit(s) stranded in the sandbox: <reason>". It never
fails as "agent made no commits" when the sandbox held commits, and never lands
only part of the work as done. Retry then continues from whatever reached the
host, as for any failed ticket (decision 9). Nothing is rescued from the
container after it is gone.

All in the burner (`packages/server/src/workflows/ticket-burner.ts`), one small
git helper, and tests. The burner prompt and verify-notes text are not touched
(the in-flight feature `tickets-stop-repeating-checks-and-tests-earn-their-place`
owns them).

**The sync hook** (one builder, so `isolated` and `slot` both get it), on every
commit:

1. Records the checkout's HEAD in a small file in the mounted workspace, the
   one place the container writes that the host can still read once it is gone
   (decision 7). Any push that succeeds deletes the record, so it only ever
   names work that has not reached the host. That matters for history
   rewrites: a rebase that only drops commits fires no hook at all (neither
   `post-commit` nor `post-rewrite`, which a real-git test showed), and a
   record kept after a good push would go on naming the dropped commit and
   fail a ticket that landed fine.
2. Pushes with `--force-with-lease` to the full ref `refs/heads/<tempBranch>`;
   on refusal, waits two seconds and tries again. The full ref matters: a fresh
   clone of a workspace whose branch was deleted sits on a detached HEAD, and
   git refuses `HEAD:<branch>` to a ref the remote lacks.
3. On refusal again, does a plain push of the same ref (decision 1). This
   creates a missing branch or fast-forwards one that is behind, and refuses if
   the host holds commits the sandbox lacks. Never a force push without a lease.
4. On failure, appends to the record how many commits are unsynced and the
   push's first error line, prints that error, and asks the agent to run
   `git push origin HEAD:refs/heads/<tempBranch>` once more before it finishes
   (decision 10). It never promises a later commit will carry it, and still
   exits 0.

**The burner, after a run** — on the normal path and on the path where the run
rejects only because sandcastle could not remove its worktree (which otherwise
lands the commits as done) — reads the record out of the mounted worktree
before discarding it, then checks the temp branch contains the recorded HEAD.
It checks the branch, not the hook's word: an agent that pushed by hand after
the hook gave up has its work home. If the branch lacks it, the ticket fails
with "N commit(s) stranded in the sandbox: <push error> (the agent's last
commit <sha> never reached <tempBranch>)". A record with only a HEAD line (the
hook never finished) gives "commit(s) stranded in the sandbox: the sync hook
did not finish …". That failure wins over "done" and over "agent made no
commits"; the commits that did reach the host stay preserved for Retry.

The same check covers every other place the hook runs (decision 11):

- **A conflict-resolver pass** installs the same hook. Its verdict (BLOCKED,
  then stranded, then "did not complete the merge") is one exported function,
  so a resolver whose merge synced but whose later fix did not fails the pass
  by name rather than landing without the fix.
- **An attempt that dies and is retried**: a stranded last commit is named in
  the `ticket.retrying` timeline line, in the next agent's recovery notes (its
  work is not on the branch; redo what is missing), and appended to the
  ticket's error when no retry follows.

`mounted` and `noSandbox` modes commit straight into the host worktree, have no
hook and no record, and are unchanged.

## Seams

- **The sync hook under real git** (new test file): the hook script installed
  in a real clone of a throwaway "host" repo, fired by real commits. Git runs
  it through its own `sh`, so this runs on Windows too, unlike the existing
  slot-script tests. Cases: a commit syncs and leaves no record; a host branch
  deleted under the burn is recreated (the bug); the same from a detached HEAD;
  an amend still syncs; a squash by rebase and a drop by rebase, each followed
  by a hand force-push, are not called stranded; host commits the sandbox lacks
  are never overwritten and the ticket fails by name; a hand push after the
  hook gave up counts.
- **The stranded check** (new, exported): `strandedCommitsError` with
  `parseSyncRecord` — given the repo, the temp branch and the record, it
  returns the failure text or nothing.
- **The resolver verdict** (new, exported): `judgeResolverPass`, tested under
  real git with a merge that synced and a fix after it that did or did not.
- **The retry notes** (existing, `buildRetryNotes`): name stranded work.
- **The setup-command shape tests** (existing): updated to the full-ref pushes,
  the plain-push fallback and the new agent line.

The burner's run-end and retry wiring (read the record, call the check, let it
win) has no harness that drives it with a fake sandbox; it is a few lines,
covered by reading and by the seams above.

## Out of scope

- Rescuing commits that could not be pushed (saving them for the host,
  collecting them, a branch of stranded work): dropped by the orchestrator
  (decision 9).
- The boot cleanup deleting a live burn's temp branches, and the boot reconcile
  failing a run that is still alive. Parked as the backlog feature "Boot cleanup
  never touches a live burn" (decision 5).
- The burner prompt (`implement-ticket.md`) and the verify-notes text.
- Any change to `mounted` / `noSandbox` workspace modes.

## Open questions

- Until the parked feature ships, a hot reload of the server during a burn can
  still delete a temp branch. The next commit's plain push recreates it, but a
  sandbox restart before any commit still fails its setup fetch.
- A stranded commit in one agent turn followed by a restart in a fresh
  container (a new iteration in the same run) is not caught if the restarted
  agent's own commits sync: their push deletes the record. Rare, and the
  restarted agent sees the branch as it really is.
- A commit that failed to sync, which the agent then drops by rebase and
  force-pushes past, still reads as stranded: the record outlives the drop.
  Rarer still, and it errs loud.
- A resolver merge that completes without conflicts is committed by
  `git merge` itself, which fires `post-merge`, not `post-commit`, so the hook
  never pushes it. That predates this feature, and the resolver verdict's
  "did not complete the merge" check already fails it loudly.
- A hook disarmed entirely (a dependency install that rewires git hooks after
  setup) writes no record, so the check has nothing to compare. The existing
  `core.hooksPath` re-pin is what guards that.
