# Decisions

Planned without the human (a headless planning run, 2026-10-28). Every decision
below is the planner's own call until the human confirms it.

What the record shows happened (events of `tickets-stop-repeating-checks-and-tests-earn-their-place`,
round 1): at 07:10:37 UTC the server's boot cleanup ran while the burn was still
alive. Its sweep of leftover temp branches deletes every ticket branch that is
"fully merged" into its feature branch, and a live ticket branch with no commits
yet looks exactly like that. Both ticket branches were deleted. From then on the
sandbox's sync push, which uses `--force-with-lease` (push only if the host
branch is still where I last saw it), was refused as "stale info" every time,
because the branch it expected was gone. Ticket 1's agent pushed by hand and
landed; ticket 2's agent trusted the hook's "will retry on your next commit"
line, made no next commit, and its work died with the container.

## 1. A refused sync push falls back to a plain push, never to an overwrite
**Decision:** When the sync hook's lease push is refused, it tries a plain push
of the commit to the ticket's temp branch. That push succeeds when the host
branch is missing (deleted, as in the bug) or is behind the commit, and it
still refuses when the host branch holds commits the sandbox does not have.
**Why:** It fixes the exact failure seen, a deleted branch, without ever
throwing away anything on the host. The lease stays the first try, so an agent
that amends its own commit still syncs.
**Assumed.** Alternative: refresh the lease (fetch the host branch, then force
again), which also covers a host branch that moved, but overwrites whatever is
there.
**Challenged:** Each ticket branch has one writer, so anything on the host the
sandbox lacks can only be the agent's own replaced commits; a refreshed lease
plus a force push is safe and also covers an amend made after a failed sync.
(Planner's answer stands: the boot sweep in this very bug shows host-side code
does rewrite these branches, and a refused push now costs a rescue, not the work.)

## 2. A commit that still cannot sync is saved where the host can collect it
**Decision:** When every push fails, the hook saves the unsynced commits as a
git bundle (one file holding those commits) in the mounted workspace, which the
host can read even after the container is gone. After the run, the burner
applies that bundle to the ticket's temp branch before it counts the ticket's
commits, and says so on the feature's timeline. A later commit that does sync
deletes the bundle, so only stranded work is ever collected.
**Why:** The brief's case is the last commit, after which nothing in the
sandbox runs again. The workspace mount is the one place the sandbox can write
that outlives it, and the host already reads files from it (the digest,
BLOCKED.md). A note in the timeline keeps the rescue visible rather than silent.
**Assumed.** Alternative: only detect the stranded commit (the hook leaves a
marker) and fail the ticket loudly, without recovering the work.
**Challenged:** Too heavy for a small fix. Once the push falls back properly,
almost nothing is left for a rescue to catch; retrying with backoff, recording
the sandbox's last commit and failing by name (decision 7) meets the brief
without a file contract, a host-side apply step or decision 6.
**Superseded by 9.**

## 3. Work that cannot be recovered fails the ticket by name, and is kept on a branch
**Decision:** If the host cannot put the saved commits on the temp branch (the
branch moved somewhere they do not follow from), the ticket fails with "N
commit(s) stranded in the sandbox" and the reason, not "agent made no commits".
The saved commits are kept on a branch of their own, named in the error, so the
work can still be merged in by hand. If the saved file itself cannot be read,
the error says that instead.
**Why:** The brief's expected outcome: the ticket reaches the host, or it fails
loudly saying its commits were stranded. A branch is where a developer looks for
work, and it is the only copy left.
**Assumed.** Alternative: fail by name but let the saved commits go with the
worktree.
**Challenged:** Part of the rescue it would drop (see decision 2).
**Superseded by 9.**

## 4. The hook tells the agent its work is safe, and not to push by hand
**Decision:** The hook's line to the agent on a failed sync says the commit did
not reach the host, that it was saved for the host to collect, and to carry on
without pushing by hand or re-committing. It no longer promises that a later
commit will carry it.
**Why:** With decisions 1 to 3 the agent has nothing useful to do about it, and
a hand push is how an agent could overwrite the host branch. The brief keeps
the burner prompt out of bounds, so the hook's own line is the only place to
say it.
**Assumed.** Alternative: tell the agent to push by hand, as ticket 1's agent
did on its own.
**Superseded by 10.**

## 5. The boot cleanup that deleted the live branches is parked, not fixed here
**Decision:** This feature makes the sandbox survive a missing or moved temp
branch. Stopping the boot cleanup from deleting a live burn's branch, and from
reconciling a run that is still running, goes to a backlog feature.
**Why:** The brief rules out server-restart recovery in general, and the
sandbox fix stands on its own: with decision 1 alone, the round in the bug
would have landed both tickets.
**Assumed.** Alternative: also make the boot sweep skip a temp branch that a
live burn worktree still holds, which is a few lines in the same area.
**Challenged:** The sweep is the root cause and the brief excludes orphaned
rounds and late wakes, not this. It runs on every hot reload of the server, which
is routine while runcastle builds itself, and a deleted branch also breaks the
next container's setup, which no push fallback reaches. (Planner's answer
stands: a crash leftover and a live burn look the same to git, so a correct
sweep needs to know which runs are alive, and the check that should know
(`isRunActive`) is what failed in this bug. That is restart recovery. Parked as
the backlog feature "Boot cleanup never touches a live burn".)

## 6. The agent's next restart in the same run starts from the saved commits
**Decision:** When a run restarts its agent in a fresh container (a turn that
ended before the ticket was done), that container's setup first takes in any
saved commits and syncs them, so the new agent builds on the stranded work.
The same holds when a dead attempt is retried: the host collects the saved
commits before the next attempt branches off.
**Why:** Without it, the restarted agent starts from the host branch, redoes or
skips the stranded work, and its commits no longer follow from the saved ones,
so the work fails by decision 3 when it could have landed.
**Assumed.** Alternative: collect only once, after the run ends, and accept
that a restart in between turns the rescue into a named failure.
**Challenged:** Drop it; it is the most expensive part of the rescue for the
rarest case.
**Superseded by 9.**

## 7. The burner checks that the sandbox's last commit reached the host
**Decision:** On every commit the hook records the sandbox's latest commit in
the mounted workspace. After the run, once any saved commits are collected, the
burner checks that this commit is on the ticket's temp branch. If it is not,
the ticket fails with "N commit(s) stranded in the sandbox", even when earlier
commits did sync, instead of landing only part of the work.
**Why:** The challenger found the gap: the burner counts commits from the host
branch, so a ticket whose earlier commits synced and whose last one did not
would land half its work as "done". The check also catches a hook that was
never armed (a dependency install that rewired git hooks) or a save that
itself failed.
**Assumed.** Alternative: trust the host branch, as today, and rely on the
rescue alone.

## 8. Retry after a stranded failure starts from the host branch, not the saved commits
**Decision:** When a ticket fails by decision 3, the human's Retry continues
from the host temp branch as it does today. The saved commits stay on their own
branch for the human to merge in or ignore.
**Why:** Decision 3 only fails when the saved commits and the host branch went
different ways, so picking one for the human would throw the other away. This
case should be rare enough that a manual call is cheaper than a rule.
**Assumed.** Alternative: Retry resumes from the saved commits.
**Superseded by 9.**

## 9. No rescue: a commit that cannot sync fails the ticket by name
**Decision:** Supersedes: 2, 3, 6 and 8. The hook saves nothing and the host
collects nothing. A commit the sandbox could not push is caught by decision 7
and fails the ticket as "N commit(s) stranded in the sandbox: <reason>". The
human's Retry continues from whatever did reach the host, as for any failed
ticket. Decision 7 stands, without its "once any saved commits are collected"
step.
**Why:** With the plain-push fallback (decision 1), what is left for a rescue
to catch is rare, and a named failure plus Retry covers it at a fraction of the
machinery: no saved file, no host-side apply step, no stranded branch, no
setup change.
**Assumed.** Alternative: the rescue in decisions 2, 3 and 6.
**Changed by the orchestrator:** it judged the rescue heavier than this bug
deserves and took the challenger's side.

## 10. The hook asks the agent to push once more before it finishes
**Decision:** Supersedes: 4. When every push fails, the hook's line says the
commit did not reach the host and asks the agent to run
`git push origin HEAD:refs/heads/<tempBranch>` once more before it finishes. It
no longer promises that a later commit will carry it.
**Why:** With no rescue, one more plain push by the agent is the last chance
the work has, and a plain push cannot overwrite anything on the host.
**Assumed.** Alternative: tell the agent to carry on and leave it to the host
(decision 4).
**Changed by the orchestrator:** it replaced decision 4 along with the rescue.
