# Outcome — Review findings are fixed in-run

The review agent classifies what it finds into defects and observations, its defects are burned as fix tickets automatically in the same run, and the human arrives at the review phase to a digest plus a short list of what is still open — not a wall of prose notes to triage by hand.

- Shipped: 2026-08-28
- Lap: 1

## 1. Findings store + report_finding MCP tool that mints fix tickets

What was done
Added typed review-finding schemas, the `review_findings` Drizzle table, and nullable ticket origin links.
Generated and committed migration 0033 for the new table and ticket column.
Added a review-findings service with listing, lifecycle mutations, event emission, the eight-ticket cap, and a pure mechanical fix-ticket builder.
Added the run-scoped `report_finding` MCP wire and withdrew `add_test_note` from recognized run callers.
Covered the service, cap, ticket links, events, audience exposure, and run-identity seam with tests.

Surprises
Existing ticket `blockedBy` inputs are batch-local positions, so the finding path needed an explicit internal option for the already-global review ticket sequence.
The full suite had unrelated sandbox-environment failures from inherited pager/token variables and one process-group teardown assertion; affected pager/token tests passed when those variables were removed.

Left undone
Scheduler lifecycle integration and review-page rendering belong to later tickets in this feature and were deliberately not changed.
No drive machinery changed because this ticket adds no runtime service, required environment variable, seed, or companion process; the existing setup, stop, and server entrypoint paths were verified to exist.

## 2. Burner admits fix tickets after the review, requires the repro re-run, and the review prompt reports typed findings

# ticket 2 — the fix wave burns inside the run that found it

**What was done.** The burn scheduler now grows mid-run. `burnTickets` keeps its own
copy of the run's ticket list, and when a `review` ticket goes terminal it re-reads the
feature's tickets and folds in any it has never seen that are still pending — the fix
tickets each reported defect minted while the review was running. They burn through the
normal implementation path in the same `runs` row, and the run's `N/M tickets done`
denominator now counts them (`burnTickets` returns how many it admitted). The re-read
happens at the end of the review's own lane, before it leaves the pool, because a review
that is the run's last ticket would otherwise end the loop before anything was admitted.

A ticket with `originFindingId` also mirrors its own lifecycle onto its finding:
`fixing` when it starts, `fixed` when it lands, `failed` (with the ticket error as the
failure reason) on every failure path, including the cascade. Two optional members were
added to core's `WorkflowCtx` for this — `listTickets()` and `updateFinding()` — because
the burner only ever holds a `WorkflowCtx` and has no database handle; the runner wires
them to `tickets.listByFeature` and a new `markFixProgress` dispatch in the
review-findings service. Optional, so every existing test fake still compiles and
schedules exactly as before.

The implement-ticket template gained one ticket-specific placeholder, `{{FIX_NOTES}}`
(empty for ordinary tickets, so the run-constant prompt prefix is untouched), telling a
fix ticket to re-run its finding's repro step before declaring done and say so in its
digest. The review prompt switched from `add_test_note` to `report_finding`, defines
defect vs observation and the severity scale, tells the agent to report highest severity
first because only the first 8 defects are auto-fixed, and its step-4 summary note is
gone — the digest is the summary, so the steps renumber 3, 4, 5.

**Surprises.** Nothing in the burner could reach the database: the whole workflow
contract is `WorkflowCtx`, so both new capabilities had to become contract members
rather than direct service calls. Putting the finding mirror in `tickets.updateTicket`
instead would have been the tidier funnel, but `review-findings.ts` already imports
`storeTickets`, so that direction is an import cycle. The stated test baseline in the
prompt is stale (it names 118 files / 1768 tests; the repo runs 136 / 2257).

**Left undone.** One full-suite failure survives and is not mine:
`packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder
is not orphaned` fails on a bare re-run of that file alone, and nothing in this diff is
reachable from it (it exercises PTY process-group teardown). Everything else is green:
`bun run typecheck` clean, 2252 passed. Two adjacent things I deliberately did not do:
`sweepOrphanedBurning` marks an orphaned `burning` ticket failed through the tickets
service directly, so a fix ticket killed with its run leaves its finding stuck at
`fixing` — that path belongs to `burn-reliability`; and the auto-fix cap of 8 now lives
both in `AUTO_FIX_CAP` and in the review prompt's prose, which a prompt cannot import.
No drive machinery needed touching — this ticket adds no service, no required env var,
no seed and no process, so `.runcastle/drive-setup.ts` and its siblings are unchanged
(checked by reading what the triggers are, not by running them; the sandbox has no app).

## 3. Review page: digest + counts line, open-defects list with Dismiss, 'Fix N open defects' primary, compact notes

# Ticket 3 — review page: counts line, open defects, "Fix N open defects"

## What was done

Added a `findings` tRPC router (`packages/server/src/trpc/routers/review-findings.ts`, mounted
as `findings`) with `listByFeature`, `dismiss` and `fixOpenDefects`. The read model is computed
in the review-findings service by `viewByFeature`, which joins each finding to its fix ticket and
returns `{ findings, openDefects, summary }` — I send the open set as well as the counts, rather
than letting the page re-filter by status, so the "1 still open" in the counts line and the list
under it are literally one derivation. `fixOpenDefects` is the one composite in the router:
`promoteOpenDefects` (service) mints a mechanical `buildFixTicket` per open defect on the current
lap with no `blockedBy` and flips each finding to `fixing`, then `features.burn` fires the
existing review → implementation loop-back. The burn call lives in the router deliberately —
`features.ts` reaches the burner through the workflow registry, so a service-level import would
have closed a cycle once ticket 2 wires the burner to the findings service.

On the web side: `nextStep` gained `ctx.openDefects` and a `fixDefects` action kind, checked
immediately after the merge-conflict rule (conflict still outranks everything) and before the
pending-tickets rule, so `openDefects > 0` really does mean the Fix primary; a queued burn keeps
its own button as a secondary, the way the conflict bar already does. `ReviewBody` reads the
findings once and hands them to two hook-free components in a new `ReviewFindings.tsx` — a summary
block (counts line + observations) inside the lead card under the digest prose, and an
open-defects card with severity chip, open-reason line, expandable detail and per-row Dismiss.
Notes now render through `headline()` as first line + `<details>` remainder; capture, edit,
toggle and promote are untouched. `live.ts` invalidates `findings` on every SSE signal.

One thing beyond the letter of the ticket, because the ticket's own card would otherwise
contradict itself: `reviewOutcome` counted findings from agent-authored *test notes*, and ticket 1
withdrew `add_test_note` from every session kind, so that count is now permanently zero and the
summary row would render a green "no findings" directly above a counts line saying "9 defects
found". It now takes a `findings` count instead, fed from the same query.

## Surprises

- The review page's `findings` order is not stable. `listByFeature` orders by `createdAt, id`,
  `createdAt` is millisecond-resolution and `newId` is `nanoid` (random, not sortable) — so two
  findings reported in the same millisecond swap places between refetches. My first router test
  caught this by reporting nine findings in a tight loop and passing once by luck before failing
  in the full suite. I made the tests order-independent rather than change ticket 1's ordering;
  a stable report order needs a monotonic column, which is a schema decision, not mine.
- `add_test_note` is already withdrawn from every audience on this branch (ticket 1), which is
  what made the `reviewOutcome` correction necessary now rather than later.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in this sandbox
  both in the full suite and in isolation. It asserts a PTY child *process group* is reaped
  (`kill -0 -pgid`); my diff touches nothing under `packages/server/src/pty/`. I read it as an
  environment fault of this container's PID namespace. `pty-teardown.test.ts` also failed once
  under full-suite load on a 4.5s timing assertion and passes in isolation.
- The stated baseline ("118 files, 1768 passed") is stale — the suite is 138 files / ~2275 tests.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 136 passed, 1 skipped,
1 failed (the `dev-pane` process-group test above, pre-existing and unrelated). New tests:
`packages/server/test/findings-router.test.ts` (5), `apps/web/test/review-findings.test.ts` (5),
plus 15 `nextStep`/render-helper cases in `apps/web/test/feature-ui.test.ts`.

Drive machinery: checked, not run. This ticket adds no service, required env var, seed or
process — only a tRPC router and React components — so `.runcastle/drive-setup.ts` needed no
edit. I confirmed it parses and that every path it emits (`packages/server/drizzle`,
`packages/skills`, `hook-client.ts`, `pty-host.cjs`, `src/assets/sandcastle`) still exists.

## Left undone

- Ticket 2's burner is what marks findings `fixed`/`failed`. Until it lands, the summary leans
  entirely on the ticket join (a defect whose fix ticket is `done` counts as fixed even with the
  finding row untouched) — deliberate, and the reason the join is there.
- Nothing renders a "fixing" defect anywhere: it is counted out of `open` and out of `fixed`, so
  while a fix wave burns the counts line simply says "9 defects found". A "N being fixed" clause
  would be a nice addition and no one asked for one.
- `Workspace` polls `findings.listByFeature` on every phase, matching what `notes.list` already
  does. It could be `enabled` only at review, along with the notes query, but that is a change to
  both and belongs with whoever revisits the query budget.

## 4. Review: findings are fixed in-run

This lap turned the review agent from a note-writer into a reporter, and it changes what you walk into when a burn ends. Before, the review finished by dumping everything it noticed into your test-drive notes as long paragraphs, and you had to read each one in full just to learn whether it was a bug or a remark. Now the review classifies as it goes: things a ticket can act on are defects, everything else is an observation. Each defect mints its own fix ticket the moment it is reported, and — this is the part that removes the round trip — those tickets join the burn that is already running instead of waiting for you to come back and press a button. The run grows to take them in, fixes them, and finishes once.

So the review screen reads differently. The lead card opens with the review's own summary of what the lap did, then a single computed line — "4 defects found · 1 fixed automatically · 1 still open · 2 observations" — with the observations listed compactly under it, each one a title you can expand if you care. Underneath, only what is still open, and each row says in one line why it is still open: "over the auto-fix cap" or "fix failed:" followed by the actual failure. The big button changes to match: while anything is open it reads "Fix N open defects" and fixing them is one click with no dialog; when nothing is open it goes back to Merge & ship. There is a Dismiss on every row, so you can wave something away and watch the count fall rather than burning a ticket to make it go away. Your own notes are untouched by any of this — the agent cannot write to them any more, Address notes still contains only what you typed, and your notes now render as a one-line headline with the rest folded away, so that panel stops being a wall too.

I drove all of that and it holds up. The counts moved live as I dismissed things, the button relabelled itself without a reload, and the reasons on each row were the real ones. Typecheck is clean and the full suite is green on the branch — 2268 passing, nothing failing. Worth knowing: both implementers reported a process-teardown test failing and assumed it was pre-existing; it does not fail here, so that was their sandbox, not your repo.

One thing deserves your attention before you ship. The counts are computed by joining each finding to its fix ticket, and there is a gap in that join: if a fix ticket dies with its run — a server restart mid-fix-wave, which is ordinary — the defect it was fixing stops being counted as either fixed or open, and its row disappears from the list entirely. I reproduced it. The page said four defects found, one fixed automatically, and then nothing, with Merge & ship sitting there as though the lap were clear, while a high-severity defect sat in the database with no way to reach it from the screen. It is a small fix in one branch of one function, and it matters because a count that quietly drops a defect is worse than the wall of prose this feature replaced — the wall was at least honest. The other three notes are smaller: a skill file still telling review agents to use the tool this lap retired, and two internal tidiness points that cost nothing today and will cost the next person reading the code.

What I could not check is the auto-fix wave running for real, end to end, because that needs a live burn and a review drive cannot start one. That path is covered by its tests and I read the scheduler closely, but you will see it work for the first time on your next burn.
