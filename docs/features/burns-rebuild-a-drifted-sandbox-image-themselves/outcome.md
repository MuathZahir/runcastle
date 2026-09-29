# Outcome — Burns rebuild a drifted sandbox image themselves

When the burn preflight finds the image's agent CLI differs from the host's, the burn rebuilds the image headlessly and carries on instead of failing.

- Shipped: 2026-09-29
- Laps run: 1

## What shipped

7 commits · 11 files

### Lap 1
- 3 tickets landed: #1 Burner preflight warns on managed-image CLI drift; CLI-too-old names the right fix; #2 Run page surfaces drift warnings with a Rebuild link; halted runs lead with Open Settings → Burns; #4 New next-step test was inserted between an existing comment and the test that comment describes
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 6a94d55f9f7d21ac5fef754440471138d746f1e6
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: c6edf32a29d7d0bc70ed5f29d7a0b30a908c69a9
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Run page surfaces drift warnings with a Rebuild link; halted runs lead with Open Settings → Burns

## What was done
- `eventWarns` (apps/web/src/lib/activity.ts) now returns true for `data.warning === true` as well as `data.oversized === true`, with its doc comment updated.
- `RunTimeline` renders warning rows through `MessageWithSettingsLink`, so "Settings → Burns" in a drift warning becomes a button that opens the image row. Non-warning rows are unchanged: plain text, truncated. The panel already auto-opened on any warning.
- In the building next-step resolver (`next-step/building.ts`), a failed run whose summary points at Settings → Burns and whose tickets had started now gets:
  - title "The burn stopped — rebuild the image"
  - alert styling
  - the summary as its description
  - primary `openBurnSettings`
  - secondaries [Resume burn, Chat, Merge]
- The could-not-start branch and the generic "Resume the burn" fallback are unchanged. The only change there is that the `resume` const is hoisted so both branches share it.
- Tests added in `apps/web/test/run-timeline.test.ts` (drift row opens the panel, links inside the provider, stays plain outside it, plus `eventWarns` cases) and `apps/web/test/feature-ui.test.ts` (halted-mid-run case). The existing "partway through tickets" test still covers other summaries.

## Surprises
- The full suite has 1 failure outside this ticket: `packages/server/test/dev-pane.test.ts` > "kills the child process tree so the port-holder is not orphaned". It also fails when run alone. It is not in the stated baseline, and this ticket changed no server code, so it looks environment-dependent (process-tree kill in the sandbox).
- `bun run typecheck` is green.

## Left undone
- The server side (the `burn.image_cli_drift` warning flag and the new message texts) belongs to the parallel server ticket.
- No drive machinery changes were needed; this ticket adds no infrastructure.

#### 5. Verify the fixes that landed

Lap 1 · mode unrecorded · NO DECLARATION · nothing verified — Review declaration missing or unparseable.

Gates verification pass — verifies pass #3 (Gates mode)

## Fixes

- **#4 New next-step test inserted between an existing comment and its test — HELD.**
  Commit `c6edf32a` only moves the three-line comment "The burner's summary counts the
  review ticket…" (3 lines removed, 3 added) in `apps/web/test/feature-ui.test.ts`. It does not change
  any code or assertions. Re-running the repro against the integration branch
  (`git show feature/…:apps/web/test/feature-ui.test.ts | sed -n '2650,2700p'`) shows
  'leads a run halted mid-burn…' first, then the comment directly above
  'restates the runner’s ticket count with the lap’s work-ticket tally', which is the test it
  describes. The finding no longer reproduces.

## Gates

Both commands ran once each. They ran against the branch tip (`c6edf32a`) in a detached scratch worktree, which
has since been removed. That way the gates checked this branch's code, not main's. The
session's inherited `RUNCASTLE_*` asset env vars were unset for the run, because they point at the
global install.

- `bun run typecheck`: **green** (core, server, web and scripts all exit 0).
- `env -u GIT_ASKPASS bun run test`: 302 files, 4321 passed, 56 skipped, **3 failed**, plus
  1 unhandled EPIPE error:
  - `project-drive.test.ts`: the identity file has an unexpanded `%DB_NAME%` appended (Windows env
    expansion).
  - `review-directory-preparation.test.ts`: the stale sibling paths come back with `\` separators instead of `/`
    (Windows paths).
  - `review-ticket.test.ts`: `AGENT_BROWSER_SESSION=review-tkt_Zv5gV5Ua_PDw` leaks in from this
    review session's own environment.
  - The unhandled EPIPE comes from `pty-sidecar` while `dev-pane.test.ts` runs. That is the same PTY
    teardown flakiness the implementers reported.

  None of these files, or the code they exercise, is touched by this branch. The branch's diff is limited to
  ticket-burner, burn-robustness, ticket-burner tests, RunTimeline, activity, next-step/building
  and their web tests. These are the same three environment failures that pass #3 recorded on main.
  The stated baseline ("118 files / 1768 passed, fully green") is out of date against a 302-file
  suite, so these failures are outside it on paper, but they come from the environment, not from this lap. No finding was filed.

## Tour

This was a Gates pass, so there was no drive. Nothing broken was seen in the fix surface.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
