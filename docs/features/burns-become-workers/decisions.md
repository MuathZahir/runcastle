# Decisions — Burns become workers

Planned by the lead on the human's delegation (2026-11-08), not in a grill; decisions marked
**For the human.** change what they see or how runcastle behaves for them.

Check first: 3, 6, 8, 10, 14

## 1. No rounds, no tickets and no burn engine are left behind
**Decision:** This feature retires the review round, the remaining ticket and round machinery
(tickets, rounds, runs, `emit_tickets`, `dispatch_round` and the rest), the conflict-fixing agent,
and the sandcastle burn engine (`ticket-burner.ts` and its helpers). Build work already runs as
workers since `interactive-workers`; what the burn engine still protects against is carried onto
the worker runner, not kept beside it.
**Why:** Settled with the human in `interactive-workers` (its decision 13: "leaving no rounds and
no old code behind") and ADR-0019 (two levels, one kind of delegated work). Not re-asked here.

## 2. The Fix-drive and scenario chats stay out of this feature
**Decision:** The "Fix drive" chat and the scenario chat beside a test drive are not moved here.
They become workers in their own feature, which the orchestrator creates and which starts by
itself when this one merges. This feature is four things: workers gain the burn engine's safety
nets, the review becomes a worker, a landing conflict gets an agent again, and the old engine,
tickets and rounds are deleted.
**Why:** Both are host chats tied to the human's drive and their real checkout and database; they
land no code. Moving them is a separate design problem from retiring the burn engine. Decided by
the orchestrator on the human's delegation (2026-11-08: "do what you think is best … I want these
things to be done anyway").

## 3. The review is a worker; a drive review runs in the human's checkout, a gates review in a sandbox
**For the human.** The end-of-feature review becomes a worker labelled **Review**, listed with the
feature's other workers, enterable, its conversation kept. It writes no code and has no branch to
land. Its mode is chosen at start, as today:
- **Drive review** (the app can be driven): it runs on the host in the human's own checkout, as the
  review does today, while it holds the project's one drive slot with the feature branch checked
  out (the review drive). It needs the real app, the browser, the walkthrough recording, the
  scenarios and the dev database. It gives the drive slot back when it hands back, and takes it
  again if it is sent back; while the human drives, it waits as queued.
- **Gates review** (nothing to drive): it runs as an ordinary sandboxed worker on the committed
  feature branch, so it checks a clean checkout and never the human's.
**Why:** It keeps everything the review already does, and gains what workers give (enterable,
transcript kept, one list). A browser, ffmpeg, the scenarios and a database inside the image would
be a large, risky change; a gates review needs none of them, so it takes the sandbox's clean
checkout, which also catches uncommitted files.
**Assumed.** Alternative: every review runs sandboxed, with a browser in the project image.
## 4. The review's handback is the Review Package; a fresh small review verifies fixes
**For the human.** The review worker reports findings as it goes (`report_finding`, unchanged) and
hands back with the Review Package card in the lead's chat: screenshots, walkthrough, calls and
findings, as today. The lead closes findings with `resolve_finding`. Once it has fixed findings it
judged real defects, the lead starts a new review worker in verify mode, given only the findings
and the fix commits, in place of the verification ticket the burn engine minted by itself.
**Why:** A fresh verify worker reads little and is not anchored on its own findings; sending the
first reviewer back would re-read a context full of drive output on every message.
**Assumed.** Alternative: send the same review worker back to verify.
## 5. The review runs the project's checks itself; server-run gates retire
**Decision:** The review worker runs the project's verify commands (typecheck, tests) itself and
reports failures as findings: a gates review in its sandbox, a drive review in the human's checkout
while the review drive holds the feature branch there. The server-run gate step (`review-gates.ts`,
run in a sandcastle sandbox) and gate reuse are deleted.
**Why:** They are the last users of sandcastle outside the burn, and the lead already runs the
project's checks before it declares ready. Keeping them would mean keeping, or rebuilding, a
container runner just for gates.
**Assumed.** Alternative: keep server-run gates on a plain `docker run` of the project image.
## 6. A landing conflict goes back to an "on its own" worker by itself; the lead chooses for "with you"
**For the human.** When the lead lands an "on its own" worker and the merge conflicts, runcastle
sends that worker back by itself with the conflicting files and the commits on the other side:
merge the feature branch into its own branch, keep both sides' intent, run the checks, hand back.
The lead is told, and lands again on the next handback. After two such tries the conflict goes to
the lead. For a "with you" worker the lead is told of the conflict and chooses: resolve it itself,
or send the worker back. This amends `interactive-workers` decision 4 ("the lead resolves any
conflict") for "on its own" workers only.
**Why:** The worker that wrote the code knows its intent, and an "on its own" worker's work is
unattended anyway: this is the brief's in-loop conflict agent without a new agent kind. A "with
you" worker's conversation is one the human closed, so reopening it is the lead's call.
**Assumed.** Alternative: a separate conflict worker for each conflict, like the old resolver.
## 7. Workers follow the human's "Carry on when the usage limit resets" setting
**For the human.** A worker the usage limit stops behaves like any chat under the setting the
wake feature added (`agents-are-woken-only-when-it-matters`): with it on, the worker carries on at
the reset; with it off (the default), it shows the quiet limit line and "needs you". There is no
worker-only rule.
**Why:** The human chose that setting and its default for every chat; a burn-era rule that
quietly overrides it would be a second, hidden setting.
**Assumed.** Alternative: unattended workers always carry on at the reset, whatever the setting.

## 8. Transient errors are retried in the same conversation
**For the human.** When a worker's turn ends on a transient error (rate limit, overloaded, a
dropped connection, a stall from decision 9), runcastle tells the same conversation to carry on,
after a short backoff, up to three times. Then the worker is marked failed and its lead is woken
once, as today. Errors that will not pass by themselves (bad login, no credit, a CLI too old, a
conversation too long to continue) fail at once. The burn engine's error classes are kept for this.
**Why:** A retry in the same conversation keeps everything the worker already knew; the burn
engine's fresh attempt had to be told what the dead one was doing. A conversation that is itself
the problem fails at once, so retries never repeat it.
**Assumed.** Alternative: a fresh conversation per attempt, as burns did.
**Challenged:** the last retry should start a fresh conversation with a handoff, since a stuck
conversation repeats its failure. Kept: compaction keeps long conversations alive, the
too-long case fails at once, and the lead decides what to do with a failed worker.
## 9. A stalled turn is stopped and retried
**For the human.** A worker turn that shows no progress for too long (no agent output and no
running command) is cancelled and counted as a transient error under decision 8. A single command
that runs past a hard ceiling counts too.
**Why:** Today a hung worker shows "working" forever and holds a slot of "agents working at once".
**Assumed.** Alternative: only flag the stall to the human and leave the worker running.

## 10. A restart tells a cut-off worker to carry on
**For the human.** A worker whose turn a server restart cut off gets the same "carry on where you
were" message leads and orchestrator chats already get, and its status follows its turn again.
**Why:** Today such a worker stays "working" with nothing running, until the human writes to it.
**Assumed.** Alternative: mark it failed and wake the lead.

## 11. Workers start from the warm per-project dependency cache
**Decision:** A worker's sandbox is set up from the burn engine's per-project cache (a warm copy of
the repo with its dependencies installed, and the package-manager stores ADR-0004 allows), not the
single shared download cache workers use now. A missing or stale project image is built at start
(`ensureBurnImage`), as burns did, instead of failing.
**Why:** It is the measured speed-up the burn engine paid for, and a worker would otherwise pay a
full install at every start.
**Assumed.** Alternative: keep the shared download cache and only add the image build.

## 12. A worker's own conversation file is kept, and its tokens counted
**Decision:** The worker's chat (the host-side thread log) already survives its sandbox, and stays
readable from the feature's worker list after the feature merges. In addition, the agent's own
conversation file (Claude's session file, Codex's rollout) is copied out of the sandbox before the
sandbox is removed and kept beside that log, and each worker's token use is read from it and
recorded on its row. The outcome lists each worker with its tokens.
**Why:** The brief asks that transcripts are kept and tokens can be counted; the host log carries
only context size, not totals.
**Assumed.** Alternative: count tokens from the agent's live usage updates only.
## 13. The working rules from burns carry over to workers
**Decision:** The working rules the burn prompt carried after `cheaper-burns` (the one check rule:
targeted checks while working, the full checks once at the end; keep digests short) go into the
worker briefing, and the burn guard that refuses repeated full test-suite runs runs inside Claude
Code workers' sandboxes as runcastle's own hook (the human's hooks stay out).
**Why:** The brief says those savings carry over unchanged; today the worker briefing has none of
them.
**Assumed.** Alternative: drop the guard and rely on the briefing alone.

## 14. Old tickets and rounds are not kept as history
**For the human.** The tickets, rounds and runs tables, their tools, the Work and tickets views,
the round transcript lanes and the burn settings are deleted. A shipped feature's record is its
`outcome.md`, which already lists its tickets, review and digests. Its page loses the old Work
view. Findings and the Review Package stay (decision 4), now tied to the review worker.
**Why:** The brief and decision 1 ask for no old code left behind; a read-only history view would
be most of that code kept alive for pages nobody opens.
**Assumed.** Alternative: keep a read-only Work view for features shipped before this one.

## 15. Stop stops the lead and every working worker
**For the human.** The feature's Stop ends the lead's turn and cancels the turn of every worker
that is working or queued. They stay where they are and enterable; nothing starts again until the
human replies, as today.
**Why:** With rounds gone, Stop would otherwise stop only the lead while its workers carry on.
**Assumed.** Alternative: Stop stops the lead only; workers are stopped one by one.

## 16. Plans list workers; nothing dispatches by itself
**Decision:** The lead's plan, a self-planning run's plan and the orchestrator's tools name workers
(build workers and the review worker), never tickets or rounds. Nothing starts a round or a burn
by itself any more: the review starts when the lead starts it. The lead's skill loses its tickets
and rounds guides; the review moves into its workers guide.
**Why:** Follows from decision 1; the old paths would start code that no longer exists.
**Assumed.** Alternative: none worth keeping.

## 17. Work in flight at the upgrade is named, not carried
**For the human.** The upgrade drops tickets, rounds and runs. Open review findings stay with their
feature. A feature that still had tickets not done gets one note, riding its lead's next message
(it wakes nothing), naming each dropped ticket and its goal, so the lead can hand the work to
workers.
**Why:** Runcastle is about to be published; a user mid-round must not lose work silently, and a
note costs nothing where nothing was in flight.
**Assumed.** Alternative: refuse the upgrade until no feature has tickets left.

## 18. Which burn settings survive
**For the human.** "Agents working at once" stays. The per-container CPU cap applies to every
worker sandbox. The repeated-test-suite guard's switch stays and now governs workers. The burn
attempt, iteration and conflict-attempt counts are removed: retries are fixed (decisions 6, 8).
The Settings page that held them is renamed so "Workers" names only the workers.
**Why:** The CPU cap and the guard still protect the machine and the bill (ADR-0008); the counts
belonged to a loop that no longer exists.
**Assumed.** Alternative: drop the CPU cap and the guard switch too.
