# Outcome — Simplify the pages — less repetition, more structure

Cut the facts pages repeat (within a page and across pages) and give the dense pages a structure you can take in at a glance, starting with the feature page.

- Shipped: 2026-09-27
- Laps run: 1

## What shipped

22 commits · 61 files

### Lap 1
- 7 tickets landed: #1 One ticket count, one definition, on every surface; #2 Status rows state each fact once; Check details goes; #3 The lap trail becomes an oldest-first timeline; #4 Four-tier layout for every feature-page state; #6 Building: the next-step bar's burn count still includes the review ticket, disagreeing with the Tickets row and the sidebar; #7 Review row says "Not reviewed yet" while the timeline shows a review pass in the same lap; #8 Run header's "1 stopped" counts the review ticket, a third statement of the orphaned review
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 70dec066889244511183fd3db1ea8fc4f41e09b7
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 29e946a0496958e8c12060f3138141a8ed3a9954
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. One ticket count, one definition, on every surface

# Ticket 1 — One ticket count, one definition, on every surface

**What was done.** Added `packages/core/src/ticket-tally.ts` (exported from the core barrel). `ticketTally(tickets, lap)` returns `{ landed, total, waived }` for this lap's work tickets. The review ticket is never counted, cancelled tickets leave the total and are counted as `waived`, and `landedLap` wins over `lap`. The same file also has `lapWorkTickets(tickets, lap)`, the membership set the tally counts, for surfaces that break it down further (the ledger's "N failed · N burning" and the bar's failed count).

The web's `lapTicketCount` is now a thin wrapper over it, and `ticketCountText` is unchanged. Surfaces now reading the tally:
- The server `feature.list` adds `FeatureListItem.lapTally` (`ticketCounts` stays for the red dot and the MCP index line). The sidebar's `ticketProgress` reads `lapTally`.
- The ledger meta goes through `lapWorkTickets`, so the review ticket is out of failed/burning.
- The next-step `ResolverInput` swaps the unused `lapTickets`/`lapTicketCount` and the all-laps `ticketCount`/`done`/`failed` for `tally` plus a lap-scoped `failed`. The burn bar reads it.
- The run header's "X of Y landed" goes through a new pure `runLanded(tickets, shownRun, featureLap)` in `lib/feature-ui/run.ts`. It uses the shown run's `lap` from `run.listByFeature`, so a past run's record counts its own lap.
- `phaseFacts` (the stepper tooltip and pinned-planning banner) reads the tally.
- The Tickets tab already read `lapTicketCount`.

The planning header meta's count is dropped (d6e), and its stale comment is replaced.

**Deviations and surprises.**
- The building resolver's empty-ledger guard (`t === 0`) now checks `full.tickets.length === 0`. That is the same behaviour as before: it was always an "is the ledger empty" check, not a count.
- The web test fixture `listItem` does not carry `lap`, so `full().feature.lap` is undefined. New tests set `feature.lap` explicitly. I did not change the fixture, to avoid rippling through other tests.
- `review.ts`'s "Run finished with N failed tickets" now reads the lap-scoped `failed` via the input. I did not edit `review.ts` itself.
- In the full suite, `packages/server/test/dev-pane.test.ts > kills the child process tree…` fails, including on a targeted run. It is not in the stated baseline, but it tests process-tree killing, which my diff does not touch, so I treat it as an environment fault in this sandbox. Everything else is green: 4256 passed. Typecheck is clean.

**Left undone.**
- `runHeadline`'s extras (failed/stopped/waived/fixes) still count every ticket it is handed. The live run view hands it all laps, review ticket included. I didn't change it because RunHeader and the failed summary belong to the other ticket.
- `needsMe` planning's `ticketCounts.total > 0` and the MCP `featureIndexLine` pending/burning counts are all-laps. They are not visible counts, so I left them.
- Nothing shows "W waived" yet. The tally returns it for whichever surface adopts it.
- No drive machinery changes were needed (no new service, env var or seed).

#### 3. The lap trail becomes an oldest-first timeline

# Ticket 3 — the lap trail becomes an oldest-first timeline

**What was done.**
- New pure `lib/feature-ui/timeline.ts` (exported through the barrel). `lapTimeline(entry, tickets, findings)` returns each lap's nodes in seq order: burn nodes `{kind:'burn', fixes, tickets}` and pass nodes. A work ticket counts as a fix when its seq is after the lap's first pass. It builds on `TrailEntry` and leaves `lapTrail` unchanged.
- Per-pass figures come from `ReviewFinding.reviewTicketId`:
  - `found` = the defects that pass reported.
  - `fixed` = defects reported by *earlier* passes in the lap that are now fixed (same fix-ticket join as `lapTrail`).
- Orphan passes still become nodes. So does a review ticket the feed has no row for yet (verdict null).
- Account lines:
  - The pass the lap's unverified outcome was read from carries `entry.outcome.line` and `reason`.
  - Any other unverified pass shows its own digest's first line.
  - A verified pass shows `lapAccountLine` of its own digest.
- New primitive `src/ui/timeline.tsx`: `Timeline` + `TimelineNode` with `ring` and `milestone` variants. The milestone disc is a 16% `color-mix` tint of its tone over `surface`, and the connector is `border-strong`. It is exported from `ui.tsx`, catalogued in STYLE.md, and has a tier-1 test (`test/timeline.test.ts`).
- `ReviewTrail.tsx` is rewritten on top of both:
  - Earlier laps come first, as closed `bare` Disclosures whose heading shows verdict, landed-ticket count, defects, notes and time.
  - The current lap comes last, under an `h3` "Lap N" plus the time only.
  - Burn nodes read "Burned / Burning / Queued N tickets|fixes". Cancelled tickets keep their row but leave the count.
- Props are unchanged, so `ReviewBody` and `ShippedBody` compile untouched. The `account` prop is still accepted but no longer rendered: each pass node carries its own account.

**Surprises.**
- Two tests outside the trail assumed the old layout, so I updated them:
  - `review-bands.test.ts` asserted the trail's counts-fallback account line ("1 defect found · 1 still open"). It now asserts the pass node's scoped "1 defect found".
  - `review-page-clicks.test.tsx` picked the *last* Recording button as the earlier lap's; oldest-first makes it the first.
- Server tests are flaky in this sandbox: `dev-pane.test.ts` (process-group kill) fails every time, and `chat-coexistence` / `git.test` failed once, then passed 103/103 on a targeted re-run. My diff touches no server code.

**Left undone (ticket 4's lane).**
- The "History" quiet label above the trail and moving the trail into the Reference tier.
- `ReviewBody`'s comment "The feature's laps, newest first" is now stale.
- Callers still pass `account={accountLine}`; ticket 4 can drop it.
- Burned ticket rows use `ListRow` (40px), not the mockup's 30px compact rows; adding a compact `ListRow` variant would close that gap.
- Drive machinery: this change adds no services, env vars or seeds, so no edit was needed.

#### 4. Four-tier layout for every feature-page state

# Ticket 4 — Four-tier layout for every feature-page state

**What was done**
- **Review** (`ReviewBody`) now renders its tiers in wrappers marked with `data-tier`: `now` (alerts), `status` (StatusStrip), `work` (evidence stage, OpenWork, CarriedFindings), then `reference`.
- **The Reference tier** is a new shared component, `components/review/ReferenceTier.tsx`, used by both the review and shipped bodies. It holds the lap timeline, then the closed disclosures, which share one hairline at the foot.
- **The quiet "History" label** is drawn by `ReviewTrail` itself, using the existing `SectionLabel` (text-xs, tertiary). So it disappears when the trail has nothing to show. I added no new primitive, because `SectionLabel` already is the quiet label. The trail's unused `account` prop is removed from it and from both callers.
- **Shipped** (`ShippedBody`) runs Status → a "What shipped" section → Reference.
  - "What shipped" has an h2 at text-lg/600 with the Outcome doc button beside it (now `size="sm"`). The walkthrough stage and any live chat panel sit under it.
  - "Questions asked" is now one closed `Disclosure` with a count ("2 conversations") at the top of the Reference disclosures. Every row is still inside it.
  - The old "Walkthrough" h2 is gone, since "What shipped" now heads the stage.
- **`statusProperties`** is split into helpers for each row, and gains a `building` variant (`StatusBuilding { elapsed?, lap? }`).
  - Building shows the rows in the order Burn (status, with elapsed as its sub) · Tickets · Review, with no Test drive row. On building, "Not reviewed yet" is quiet rather than amber.
  - `lap` lets a past run's record count that run's own lap.
- **The Tickets row** (every state) now counts through the core `ticketTally`/`lapWorkTickets`. Waived tickets leave the total, as d2 requires; the row had still counted them in. The row also says "N burning", as in the mockup.
- **Building** (`RunBody`) renders the Status tier above the run heading. It reads the review artifacts feed through `useReviewArtifacts`, the same stamp the review page uses.
- **`RunHeader`** lost its status chip, elapsed clock and landed count. It keeps the "Run"/"Past run" heading as the Work-tier heading, plus the picker, Cancel, Back to latest and a past run's failure line. It still shows the headline parts no Status row states: fixes, stopped lanes, a retry.
- **`runLanded`** is deleted; the building Tickets row replaces it.
- **Planning** needed no change. I added a test that TicketsBody renders no Status/Reference tier.
- **Tests added:** tier order for review and shipped, the collapsed Questions asked, the building rows in statusProperties, RunBody's Status tier with the header no longer showing status or elapsed, and the History label.

**Surprises**
- `status-strip.test.ts` pinned the old count, where waived tickets stayed in the total ("1 of 2 landed · 1 waived"). It now expects "1 of 1".
- `run-body-model.test.tsx` needed a `lib/reviews` mock because RunBody now calls `useReviewArtifacts`.
- The full suite passes except `packages/server/test/dev-pane.test.ts` ("kills the child process tree…"). That is the same sandbox fault tickets 1–3 reported, and this diff touches no server code. Typecheck is clean.

**Left undone**
- FeatureSkeleton is unchanged. It still mirrors 3 summary rows, and building also has 3.
- The Burn row reads "Running" in amber (the existing `warn` tone), not the mockup's live dot. `CheckTone` has no live tone.
- There is no compact `ListRow` for timeline ticket rows (ticket 3's note).
- `statusChips` is still dead code.
- No drive machinery changed: no new service, env var, seed or process, so `.runcastle/` needed no edit and was not run.

#### 6. Building: the next-step bar's burn count still includes the review ticket, disagreeing with the Tickets row and the sidebar

**What was done.** The building state's next-step bar (`apps/web/src/lib/feature-ui/next-step/building.ts`) had two places where the review ticket got counted, and both now use the one ticket count, core's `ticketTally`:
- **Interrupted burn:** the title's "N landed, M pending" used to come from the `run.reconciled` event, which counts every ticket on the feature. It now uses the tally's landed and total for this lap. When all work tickets have landed, the bar shows the "0 pending / resume to finalize, hands off to review" variant, even if the review ticket was orphaned.
- **Failed run:** the bar shows the run's summary word for word. That summary contains the burner's own count ("1/2 tickets done (1 cancelled)"). A regex now swaps just that part for `ticketCountText` plus "· W waived", so "1/2 tickets done" becomes "1 of 1 ticket done". The rest of the summary, such as a halted run's headline, is kept as is.

I added three tests to `apps/web/test/feature-ui.test.ts`.

**Repro re-run.** I could not drive the app in this sandbox. Instead I re-ran the repro at the resolver seam with the same data: a failed run with the summary "1/2 tickets done", #1 done and #2 the review ticket. The bar now reads "1 of 1 ticket done", matching the Tickets row's "1 of 1 landed" and the sidebar's 1/1. The orphaned-review interruption case (4 done plus a review) now reads "4 tickets landed, 0 pending" instead of "4 landed, 1 pending".

**Surprises.** The wrong count starts on the server: `ticket-burner.ts` writes review tickets into the run summary's denominator, and `reconcile-runs.ts` counts every ticket in the event. I fixed it where it is displayed, so existing run rows read correctly too. The server strings are unchanged.

**Verify.** Typecheck passes. The full suite had 2 failures, both server process and timing tests: `dev-pane.test.ts` (kill tree) and `pty-teardown.test.ts` (deadline; it measured 4296 then 3424 against ≥4500). Both failed again when I ran them on their own, and neither imports `apps/web`, the only package this change touches. I read them as environment faults in this sandbox, not regressions from this change. Nothing needed a drive-machinery change.

**Left undone.** `BurnInterruption.landedTickets/pendingTickets` are still parsed but the bar no longer reads them. The run heading's "1 stopped" still counts the review ticket; that is a separate fix ticket. The server-side summary and reconcile strings still count the review ticket.

#### 7. Review row says "Not reviewed yet" while the timeline shows a review pass in the same lap

## What was done
The Review row and the lap headings said "Not reviewed yet" beside a visible review node because those passes finished before `tickets.completed_at` existed (migration 0034 added the column with no backfill). They are `done` with a null stamp, and `stampedReview` only counted rows that had a stamp. `stampedReview(rows, tickets)` now also takes the feature's tickets and counts a pass as finished when its ticket is `done` or `failed`. With no time, such a pass ranks below every stamped pass. All its callers pass the tickets they already had: ShippedBody, RunBody, Workspace's merge-dialog freshness, `lapTrail`, `unverifiedLap` and `stampedOutcome`. ReviewBody's inline copy of the old filter was switched to `stampedReview`. On such a pass the Review row reads "Reviewed · this build" (green). `TrailEntry` gained `reviewed: boolean`, so an earlier lap with only unstamped passes says "Reviewed" and not "Not reviewed yet". The current lap's heading now shows only the time (e.g. "6m ago"), or nothing when there is no time. The Review row owns the status (decision 5).

## Re-running the repro
I could not drive the app in this sandbox (no services and no DB), so the live repro was not re-run. I re-ran it as tests using the same data shape: unstamped Review #4 on lap 1 and Review #8 on lap 2, both `done`, with the current lap 2 (`review-trail.test.ts`, "reads a finished pass with no completion stamp as reviewed"). The page no longer contains "Not reviewed yet" and lap 1's heading reads "Reviewed". In `review-derivations.test.ts`, the Review row reads "Reviewed".

## Surprises
- The feed (`GET /api/reviews/:featureId`) does not carry the ticket's status. I read it from the tickets instead so the feed and its roughly 20 test fixtures stay as they are.
- The server reports `landedSince` as 0 for an unstamped pass, so "this build" on a legacy pass is an assumption, not something measured.
- In the full suite, `packages/server/test/dev-pane.test.ts` ("kills the child process tree") fails. It also fails on its own and tests server process-group cleanup, which this diff does not touch, so it comes from the environment. Typecheck is clean; the other 4288 tests pass.

## Left undone
- `packages/server/src/services/outcome.ts` still selects the latest pass by `completedAt !== null`, so the outcome doc of a legacy feature has the same blind spot.
- The Review row does not qualify "this build" for an unstamped pass.
- No drive machinery changed (web-only diff), so there was nothing there to check.

#### 8. Run header's "1 stopped" counts the review ticket, a third statement of the orphaned review

## What was done
`runHeadline` (apps/web/src/lib/feature-ui/run.ts) now takes its extras ("N done / failed / stopped / waived") from the work tickets only, with the review ticket filtered out (decision 2). An orphaned or stopped review lane already says "Stopped" on its own lane and "pending" on the bar, so the Run heading no longer repeats it as "1 stopped". There's a new test in apps/web/test/run-record.test.ts: work ticket #4 is done, review #5 is orphaned, and the heading reads "Burning 1 ticket · 1 done". It failed before the fix and passes after.

## Repro re-run
I could not open the drive DB: the sandbox has no app or services. Instead I rebuilt the repro's exact ticket shape in the new test (review ticket #5 failed with `orphaned: true`) and ran `runHeadline` on it. The heading no longer includes "1 stopped".

## Surprises
- The full suite had 1 failure, outside this change: packages/server/test/dev-pane.test.ts, "kills the child process tree so the port-holder is not orphaned". It fails the same way when run on its own. It tests how the server kills processes, which looks like a sandbox limit, and my change is a pure web function. Typecheck is clean, and all other tests pass (4287).

## Left undone
- The all-green line "All N tickets landed" still counts the review ticket in N (run-settle.test.ts pins "All 3 tickets landed" with a review lane). That also goes against decision 2, but this ticket only covered the extras, so I left it alone.
- No drive machinery changed (none needed).
