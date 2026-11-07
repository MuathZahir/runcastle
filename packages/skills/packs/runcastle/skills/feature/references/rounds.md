# Running the review round

Load this when you are about to dispatch the review round, or you have just
been woken by it coming back.

A round now runs only the review ticket: one review agent, a clean sandbox, the
feature branch as it stands. Build work goes to workers (`./workers.md`), never
to a round.

The human's yes to the plan covers the review round when the plan says it is
coming; otherwise ask first (SKILL.md, "The human's yes"). If designs wait
uncommitted in the worktree, the human's yes commits only the ones they
approved, and you name and ask about the rest; an orchestrator relay never
approves (`./design.md`, section 8).

## What you run on

`get_feature_context` carries:

- `rounds` — every round so far, numbered from 1: the tickets it held, how it ended, its gates.
- `latestReady` — your newest ready declaration, if any.
- `driveActive` — the human is test-driving this feature right now.
- `stopped` — the human pressed Stop and has not replied since.
- `waitingReason` — why the feature is waiting on the human, if it is.

## Dispatch it

1. **Land or drop every worker first**, so the review sees the whole feature.
2. **Write the review ticket** with `emit_tickets`, following `./tickets.md`.
3. **Dispatch** with `dispatch_round({ seqs })`, naming the review ticket.

## When it comes back

You are woken with the round's outcome, the ticket's status, the verify-gate
result, the review findings and where the digest is.

1. **Trust the record over the prose.** The ticket's status, the gates and the
   findings are what happened; the digest is the review agent's account of it.
   Read it with `get_ticket({ seq })`, and where the two disagree, believe the
   record.
2. **Handle the findings.** Read `reviewEvidence` (the latest review's
   DIGEST.md, screenshots and walkthrough) before planning more work. A finding
   stays open until you resolve it: fix it yourself or with a worker, then
   `resolve_finding`; or dismiss it and say why. A review reports useless tests
   as low-severity observations, never defects: delete or rewrite the named
   tests yourself, with the other fixes.
3. **Decide the next move**:
   - small fixes → do them yourself;
   - a larger fix → a worker (`./workers.md`);
   - a failed review → dispatch it again, or fix what stopped it;
   - a question only the human can answer → call `wait_for_you({ why })`, then ask it as the last thing in the turn;
   - the feature does what the plan says → run the checks and declare ready (SKILL.md, "Ready for the human").

`declare_ready` warns when the last round had failures; pass that on.

## While and after the human drives

Never dispatch while the feature is being driven (`driveActive`). Your own
commits wait until the drive stops. When the human reports back, follow
SKILL.md, "After a drive"; when you are satisfied again, declare ready with a
new scenario.

## What the server refuses

`dispatch_round` is refused, with the reason, for a draft or shipped feature,
while a round is already running, while the human is driving this feature, and
after the human pressed Stop until they have replied. `stop_round` stops the
running round; work that already landed stays.
