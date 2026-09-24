# Outcome — Slot warm sync leaves no remote-tracking ref, so the sync hook push is rejected

Slot warm sync: fetch the attempt branch so refs/remotes/origin/<tempBranch> exists (explicit refspec or update-ref after reset --hard), keeping the hook's bare --force-with-lease intact; update burn-slot-workspace.test.ts string assertions and, where the POSIX 'driven for real' block allows, prove a warm second run's post-commit push on a new branch name is accepted; refresh the buildSlotSetupCommand step-3 doc comment. Root cause and evidence are in brief.md.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

2 commits · 3 files

### Lap 1
- 1 tickets landed: #1 Slot warm sync: fetch the attempt branch so…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 78b3c9affb3b78e3f2b7a69874d442a61135e3f2
- Landed since: 0
- Outcome: done

- **Gates review found no defects** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Slot warm sync: fetch the attempt branch so…

# ticket(1) — warm slot sync now leaves a remote-tracking ref

## What was done

`buildSlotSetupCommand`'s warm branch fetched the attempt's temp branch by bare
name (`git fetch <workspace> <tempBranch>`), which writes `FETCH_HEAD` and
nothing else. The post-commit sync hook pushes with a *valueless*
`--force-with-lease`, and git reads that lease's baseline out of
`refs/remotes/origin/<branch>`. On any attempt after the one that cloned the
slot the branch name is one the slot has never seen, so there was no baseline
and git rejected every commit's push with `! [rejected] … (stale info)`. The fix
is one string: fetch with an explicit `+<tempBranch>:refs/remotes/origin/<tempBranch>`
refspec. The hook is untouched — the lease stays bare, and its baseline is now
the workspace tip the sync just read (the slot is that branch's only writer).
The step-3 doc comment on `buildSlotSetupCommand` explains that, the string
assertion in `burn-slot-workspace.test.ts` expects the refspec, and the POSIX
"driven for real" block gained a test that warm-syncs slot 1 onto a second,
never-before-seen branch name, commits, and asserts the hook's push landed. No
deviation from the approach the ticket described (it offered `update-ref` as an
alternative; the refspec is one token and keeps `reset --hard FETCH_HEAD`
working unchanged).

## Surprises

- **The bug bit this burn, live.** My own first `git commit` in the slot printed
  the exact `(stale info)` rejection and the hook's "commit sync failed" line —
  this sandbox is a warm slot on a fresh branch name. I repaired my slot by
  hand (`git fetch /home/agent/workspace +<branch>:refs/remotes/origin/<branch>`
  then the hook's own push) and every commit after that synced silently. That is
  the fix proven against production, not just the temp-dir harness.
- **The prompt's baseline numbers are stale.** It claims "118 files, 1768
  passed"; the suite is actually 264 files / 3826 tests.
- **One pre-existing failure, not listed in the baseline.**
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned` fails here (`pidAlive(-pgid)` is still true after
  teardown). Confirmed on a single targeted run of that one file; it is a PTY
  process-group-reaping assertion about this container's environment and shares
  no code with anything I touched. Everything else is green: `bun run typecheck`
  0 errors, `env -u GIT_ASKPASS bun run test` 3790 passed / 1 failed (that one).
- The `persistent-burn-cache-volume` outcome doc already noted at the time that
  the sync "fetches by path into FETCH_HEAD, not into refs/remotes/origin/*" and
  concluded "nothing in the burn contract reads them". `--force-with-lease` does;
  that line is the miss this ticket closes.

## Left undone

- **Stale `origin/main` in a warm slot.** Only `refs/remotes/origin/<tempBranch>`
  is refreshed now; `origin/main` and friends are still whatever the original
  clone saw, so an agent running `git log origin/main` in a slot sees an old tip.
  Nothing in the burn contract reads those, and widening the refspec is outside
  this ticket.
- **Local branches accumulate in a warm slot** (one `checkout -B` ref per burn,
  plus, now, one `origin/<tempBranch>` ref per burn). Still bounded only by the
  operator's clear-cache action, as the original outcome doc noted.
- **Drive machinery:** checked the trigger list and none applies — this change
  adds no service, no required env var, no seed and no extra process, so
  `.runcastle/drive-setup.ts` / `drive-stop.ts` need no edit. I did not run them
  (no services in this sandbox) and did not need to.
