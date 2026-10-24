# Running rounds

Load this when you are about to dispatch a round, or you have just been woken by
one coming back.

A round is how workers build: each gets one ticket, a clean sandbox and the full
brief, and works on its own branch that lands on the feature branch. You
dispatch it, you are woken when it comes back, you check what it did, and you
plan the next move.

Start the first round only after the human's explicit yes in chat, and ask again
before any round the agreed plan did not settle (SKILL.md, "The human's yes").

## What you run on

`get_feature_context` carries:

- `rounds` — every round so far, numbered from 1: the tickets it held, how it ended, its gates.
- `latestReady` — your newest ready declaration, if any.
- `driveActive` — the human is test-driving this feature right now.
- `stopped` — the human pressed Stop and has not replied since.
- `waitingReason` — why the feature is waiting on the human, if it is.
- `burnConcurrency` — how many workers the project runs at once.

## Plan a round

1. **Write the tickets** with `emit_tickets`, or reshape pending ones with
   `update_ticket` / `cancel_ticket`, following `./tickets.md`. Then **dispatch**
   with `dispatch_round({ seqs })`, naming exactly the pending tickets this round
   covers. Tickets you do not name wait for a later round. A ticket may stay
   blocked by tickets that landed or were cancelled in an earlier round: those
   count as satisfied. A blocker that is still pending or failed must be named
   in the same round.
2. **Every worker task names its deliverable and how it is checked.** A worker
   with no stated check reports success on its own terms. Say what is built and
   what proves it: the test that goes green, the command that passes, the screen
   that shows it.
3. **Keep the round to `burnConcurrency` workers or fewer.** A soft cap: workers
   past it only queue, and a wider round has more to reconcile when it returns.
4. **Contract first when the work spans layers.** When workers on different
   layers must agree on a shape — types, an API, a schema — make one ticket land
   that contract in code and make the others `blockedBy` it in the same round.
   **Contracts live in code, never in a doc**: workers trust the code.
5. **UI work names the design references.** A ticket that touches UI tells its
   worker which design docs to follow — the project's own design system docs and
   any design references in this feature's docs — and asks it to plan the
   screen, build it, then critique it against those docs with screenshots.

Workers do not talk to each other or to you. They report through their digests,
their ticket status and their commits. A worker that finds the contract wrong
stops and says so in its digest; reconciling it is your job, between rounds.

## When a round comes back

You are woken with the round's outcome, each ticket's status, the verify-gate
result, any review findings and where the digests are.

1. **Trust the record over the prose.** Ticket status, the gates and the commits
   are what happened; a digest is a worker's account of it. Read each digest
   with `get_ticket({ seq })`, and where the two disagree, believe the record.
2. **Reconcile.** Did a worker report the contract wrong, or change something
   another relied on? Did a decision turn out wrong? Fix the contract in code,
   amend `decisions.md` and `spec.md` when what was decided changed, and update
   the pending tickets. A contract reported wrong is a reason to re-plan.
3. **Handle review findings.** A finding stays open until you resolve it: fix it
   in a round or yourself, or dismiss it and say why.
4. **Decide the next move**:
   - small leftovers → fix them yourself;
   - more work, or a failed ticket to retry → plan the next round;
   - a question only the human can answer → ask it in chat and call `wait_for_you({ why })`;
   - the feature does what the plan says → run the checks and declare ready (SKILL.md, "Ready for the human").

A failed round is just what came back. Re-plan, retry or fix it yourself.
`declare_ready` warns when the last round had failures; pass that on.

## While and after the human drives

Never dispatch while the feature is being driven (`driveActive`). Your own
commits wait until the drive stops. When the human reports back, follow
SKILL.md, "After a drive"; when you are satisfied again, declare ready with a
new scenario.

## What the server refuses

`dispatch_round` is refused, with the reason, for a draft or shipped feature,
while a round is already running, while the human is driving this feature, and
after the human pressed Stop until they have replied. It is also refused when a
ticket you name is blocked by a ticket outside the round that is still pending
or failed (or does not exist): the refusal lists each such edge, and the fix is
to name that blocker in the round too. `stop_round` stops the running round;
work that already landed stays.
