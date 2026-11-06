# Drives never touch real conversations

## Problem

A test drive of runcastle boots a second runcastle server on a copy of the live
database. That copy still holds every thread's conversation id, every run that
was running, the live install's own drive, and the phone subscriptions. At boot
the drive's server treats all of it as its own: it calls the live rounds
"interrupted by a server restart", wakes their leads by resuming their **real**
Claude Code transcripts (Claude Code's config dir is shared with the real
install), takes the live drive for a leftover one it may stop, and pings the
human's real phone. Real agents then act on news that is not true: a lead
re-dispatched a round that was still burning, set its feature waiting for a
false reason, had its model switched (a 336k-token cache rewrite), and rounds
were reported out of order. The phantom turns alone cost about 35M tokens
between 11-04 and 11-06.

In the same family, a merge conflict was resolved twice: the human pressed
Resolve, the lead fixed it in three minutes, and a minute later the orchestrator
relayed the same conflict because its news line told it to ("Resolve it in the
feature's worktree, then merge_feature again"). The lead did it all again, with
a two-subagent review (about 12M tokens).

## Approach

**For the person driving**, a drive looks the same as today: every project,
feature, ticket, round and chat history from the live install is there. What
changes is that nothing in it is wired to the live install any more. A chat
shows its real history read-only, and the first message the driver sends starts
a fresh conversation (Claude Code or Codex) with no memory of the real one. A
round that was burning in the live install shows as closed ("still running in
your real runcastle when this drive started"). Nothing wakes, nothing pings the
phone, and no drive from the live install sits in the drive's slot. Agents in a
drive start only when the driver starts them; from then on they hear news as
usual.

**The shape:**

- **The drive setup marks the copy.** When the drive setup script copies the
  live database into the drive's data dir, it also writes one setting into the
  drive's environment (`drive.env`) saying the database is a copy. A
  brand-new-install drive copies nothing and sets nothing. Suggested name:
  `RUNCASTLE_DATABASE_IS_COPY=1`.
- **The server detaches a copy at boot.** A new boot step runs right after
  migrations and before session and run reconciliation, only when that setting
  is on. In one transaction, it:
  - clears every session row's conversation id (the column that holds both the
    Claude Code session id and a Codex thread id), keeping its transcript path
    so history still reads back;
  - closes every `running` run as failed with the summary above, and fails the
    ticket lanes it left `burning` with a matching error. It emits no events,
    wakes nobody and runs no git (unlike restart reconciliation, which lands a
    parked chat branch onto the feature branch);
  - deletes every phone push subscription (the signing keys may stay).
  With nothing left running, the existing reconciliation and the interrupted-
  round wake find nothing to do.
- **No drive recovery in a copy.** With the setting on, boot skips recovering
  "cut-off" drives: every drive recorded in a copy belongs to the live install.
- **Automatic messages start no conversation in a copy.** With the setting on,
  runcastle's background prompts (orchestrator news, lead wakes when a round
  ends or a drive stops, and any other wake no click asked for) are delivered
  only to a thread that has a conversation begun in this drive (a conversation
  id or a thread log of its own). Otherwise the message is dropped with an
  event saying it was not sent because the drive has not started that agent;
  for a lead it is not held for later either. What the driver's own clicks and
  messages send (Go, Stop, Send to agent, typing in a chat), and relays from an
  agent the driver started, start conversations as usual.
- **Merge-conflict news says who has it.** The orchestrator's news line for a
  merge conflict on a merge the human started says the human has the Resolve
  button on that feature and the orchestrator should leave it unless the human
  asks. `merge.resolved` becomes an END event the holder hears ("merge conflict
  resolved"). The orchestrator's own merges are unchanged (their result
  already comes back from the merge tool and is not echoed).
- **A lead checks a conflict still stands.** The feature skill's "merge
  conflict to resolve" situation and the resolve-conflict kickoff both tell the
  lead to check first whether the base is already in the branch; if it is, say
  so in one line and stop, with no re-verification or review.

The drive setup's existing promise holds: the live database is only ever read.

## Seams

- **The detach step** (new): a server function run against a database handle.
  Tested against an in-memory database seeded with sessions (with and without
  conversation ids), running and finished runs, burning tickets and push
  subscriptions: conversation ids gone, transcript paths kept, running runs and
  burning tickets closed, finished ones untouched, subscriptions gone, no
  events written.
- **Server boot** (existing): with the setting on, no cut-off drive is
  recovered and no interrupted round is woken; with it off, boot is unchanged.
- **Delivery to a lead and to a holder** (existing: the lead-delivery service
  and the orchestrator notifier): with the setting on, a runcastle message to a
  thread with no conversation of its own starts nothing and records why; a
  human-sourced message still starts one; a thread with a drive-born
  conversation still gets news.
- **The notifier's description of events** (existing): the merge-conflict line
  for a human merge, and the new merge-resolved line.
- **The drive setup script** (existing, untested today): writes the setting
  only when it copied a database. Checked by hand.
- **The feature skill and the resolve kickoff** (existing content): the
  check-first wording is present.

**Checking it for real.** The drive's server runs this branch's code, so a
normal drive of this branch exercises it. The proof is a drive started while a
round burns in the live install: the live lead's transcript gets no new prompt,
the live round finishes undisturbed, and the drive shows that round closed.

## Out of scope

- **The drive acting on the real git repo.** Copied projects keep their real
  repo path, so features created, rounds landed and merges done inside a drive
  move real branches. This feature only stops the drive's *boot* from doing
  git work; whether drives should work on the real repo at all is its own
  question (offered as a backlog feature: "Drives never touch real
  repositories").
- **`boot-cleanup-never-touches-a-live-burn`** (a draft): the real server's own
  restart cleanup mistaking a live burn for a dead one. Adjacent and separate.
- A separate Claude Code config dir for drives (decision 1).
- Drives of branches cut before this merges keep today's behaviour until they
  take main.

## Open questions

None blocking. Decisions 1, 2, 7 and 9 are the ones to check first.
