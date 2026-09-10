# Outcome — Open findings survive laps: carry, link, or close

The lap boundary must triage open review defects the way it already triages test notes — a Rethink session sees them, links its tickets to them, or explicitly carries/closes them, so lap-1 findings stop haunting lap-2's review as permanently open.

- Shipped: 2026-09-10
- Laps run: 1

## What shipped

17 commits · 29 files

### Lap 1
- 4 tickets landed: #1 Finding state model: carried status, session provenance, lap-scoped view; #2 Session disposition contract: resolve_finding, linked emits, tickets gate, lap agenda; #3 Review page: honest counts, carried section, provenance on fixed cards; #5 New review derivation is routed back through the collision-prone feature-ui barrel
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 901e10e2ad3d07824a973a3fd01eb46c6aefc03f
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: df73204cf733745349263b3d2e7a0865e2eeb5d9
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Finding state model: carried status, session provenance, lap-scoped view

# Ticket 1 — finding state model: carried status, session provenance, lap-scoped view

## What was done

`FindingStatus` gained `carried`, and `ReviewFinding` gained `carriedLap`,
`resolvedBy` (`'fix-ticket' | 'session'`, a new `FindingResolvedBy` enum) and
`resolutionNote` — all nullable, mirrored on the `review_findings` drizzle table
and added by a hand-written migration, `packages/server/drizzle/0037_finding_carry_and_provenance.sql`
(the 0031/0034/0035 files are the precedent: the migrator reads the directory
directly, so no `meta/_journal.json` entry is involved).

In `services/review-findings.ts`: `carryFinding` and `closeAsAddressed` land as
new verbs, `reopenFinding` beside them for the human, and `markFixed` now stamps
`resolvedBy: 'fix-ticket'`. All four go through the existing `updateStatus`,
which now writes the whole of a finding's mutable state — the carry and
provenance stamps reset to null on every transition unless the transition sets
them, so a finding leaving `carried` cannot keep claiming a lap. `defectState`
treats `carried` as its own state, ranked above the fix-ticket join.
`viewByFeature` scopes its summary and `openDefects` to `finding.lap ===
feature.lap` and returns a new `carriedFindings` array (all laps, status
`carried`). `findings.reopen` joins `dismiss` on the tRPC router.

Two deviations from the ticket text, both deliberate:

- `carryFinding` / `closeAsAddressed` take `featureId` before `findingId`
  (the ticket sketched `(ctx, findingId, note?)`). Acceptance criterion 2
  requires rejecting *another feature's* finding, which is not decidable without
  the caller's feature; the signature now mirrors `carryNotes(ctx, featureId,
  ...)` and reuses the `promoteOpenDefects` guard shape.
- `carried-work.ts` was switched from `viewByFeature(...).openDefects` to a new
  exported `openDefectsAcrossLaps`. Scoping the view to the current lap would
  otherwise have silently emptied the carry channel: the defects a lap must
  answer for are by definition the PREVIOUS lap's, so the kickoff line, the
  injected system prompt and `get_feature_context` would all have told a lap-2
  session there were no open defects. `openDefectsAcrossLaps` is also the
  eligibility set the two new verbs guard against, and is the function the
  `complete_phase(tickets)` gate ticket will want.

## Surprises

- `viewByFeature` had no `getFeatureRow` call before this; scoping needed one,
  which makes the read model depend on the feature row. Cheap, but it means a
  findings view for a missing feature now throws `NotFoundError` where it used
  to return empty counts. No caller does that.
- Three `apps/web` test fixtures build `ReviewFinding` literals by hand and had
  to grow the three new null fields to typecheck (`note-row`, `open-work`,
  `triage-step`). No web source changed.
- `triagePreview` genuinely had no test at all, so acceptance criterion 6 is
  covered by a new one rather than an amended one; it sits in
  `review-findings.test.ts` beside the scoping it inherits.
- The verify baseline in the prompt (118 files / 1768 tests) does not match this
  repo: the suite is 239 files / 3461 tests. One test fails, before and after my
  change and unrelated to it — `packages/server/test/dev-pane.test.ts > kills the
  child process tree`, which asserts a POSIX process group is reaped after a PTY
  kill. Nothing in my diff is reachable from it. Everything else is green
  (3456 passed), and `bun run typecheck` is clean across all four packages plus
  `scripts/`.

## Drive machinery

Nothing to update. The change adds a migration and no service, required env var,
seed or extra process, which the standing instruction explicitly lists as already
covered by the idempotent `.runcastle/drive-setup.ts`. I read that script rather
than running it (the sandbox has no app or services); it names no new path.

## Left undone

Deliberately out of this ticket, and each is another ticket's territory:

- The `resolve_finding` MCP tool and the `complete_phase(tickets)` gate. Both
  should call `carryFinding` / `closeAsAddressed` and read
  `openDefectsAcrossLaps` filtered to `lap < feature.lap`.
- No UI renders `carriedFindings` yet, and `partitionWork` in
  `apps/web/src/components/review/WorkList.tsx` has its own `defectStanding`
  that mirrors the server's — a carried defect currently falls through its final
  `return 'fixing'` and would render as being fixed. That needs the carried
  section and a reopen button wired to the new `findings.reopen` mutation.
- `promoteOpenDefects` (the human's "Fix N open defects" and the boundary
  triage's `quickFixFindingIds`) still guards against the current-lap open set
  only. That is consistent with the decision that current-lap findings belong to
  the burner/review loop, but it does mean the human cannot quick-fix an
  earlier-lap defect from triage — the session's link path is the route for that.

#### 2. Session disposition contract: resolve_finding, linked emits, tickets gate, lap agenda

# Ticket 2 — session disposition contract: resolve_finding, linked emits, tickets gate, lap agenda

## What was done

A lap session can now answer for the defects it inherits, three ways.

**Link** rides `emit_tickets`. `toolEmitTickets` collects every ticket's
`originFindingId`, vets them all through a new `requireLinkableFindings` BEFORE
`storeTickets` runs (so one bad id fails the whole batch, the way an unknown
model id already does), then stamps each stored ticket onto its finding with a
new `linkFixTicket` — `fixTicketId` plus a flip to `fixing`. From there the
shipped burner path (`markFixProgress`) closes the finding when the ticket
lands; nothing in the burner changed.

The validation deliberately sits at the **tool** surface, not in `storeTickets`.
`review-findings.test.ts` pins that placement in prose and by test: `storeTickets`
is also the internal mint used by `reportFinding` and the burner's verification
pass, and those link findings the guard would refuse (a defect the review has
only just opened). The one-review-ticket seatbelt lives at the same seam for the
same reason.

**Carry** and **close-as-addressed** are the new `resolve_finding` MCP tool,
registered for `FEATURE_WRITE_KINDS` — the `emit_tickets` roster. It calls
ticket 1's `carryFinding` / `closeAsAddressed` verbs. The note requirement for
`addressed` is a zod `superRefine`, applied inside `toolResolveFinding` rather
than at the registration so there is exactly one place it is enforced (the MCP
handler passes `args` straight through).

**The gate** is a new clause in `checkGate('tickets-approved')`, backed by a new
`undispositionedDefects` (openDefectsAcrossLaps filtered to `lap < feature.lap`).
It refuses with the offenders' titles and names all three verbs plus the human's
dismiss. Note this reaches the human's Burn click as well as `complete_phase`,
since G3 is one check — that matches the one-review-ticket seatbelt's dual reach,
and the human keeps dismiss and gate-override as the escape hatches.

**The agenda**: `CarriedDefect` grew an `id`, and `carriedWork` grew
`carriedDefects`, both surfaced on `get_feature_context`. The lap kickoff prompt
in `artifacts.ts` and the revisit skill's move 6 state the obligation and the
three verbs.

## Surprises

- **`CarriedDefect` had no `id`.** `get_feature_context`'s `openDefects` served
  title/location/detail/reproStep only, so a session could read the defects and
  act on none of them — neither `originFindingId` nor `resolve_finding` has a
  handle without it. Adding the id was a precondition for the whole ticket, not
  a nicety; it is the one change here that edits an existing payload shape (one
  `toEqual` in `carry-channel.test.ts` was updated).
- The `addressed`-without-note rejection surfaces as a **ZodError**, not the
  `InvalidInputError` the service throws — the schema catches it first. That is
  what "rejected at the schema" means, so the test asserts the message.
- I did NOT add carried defects to `carriedWorkSummary` / `hasCarriedWork`.
  Decision 5 makes carried findings agenda rather than obligation, and those two
  drive the "N carried — address them" kickoff instruction. They stay keyed on
  what the lap actually owes an answer for.
- `viewByFeature`'s carried collection was folded into a shared `isCarried`
  predicate so the new `carriedDefectsAcrossLaps` does not restate it.

## Drive machinery

Nothing to update: no service, required env var, seed or extra process — the
categories the standing instruction lists. Both `.runcastle/drive-setup.ts` and
`drive-stop.ts` parse (checked with `bun build`, not run — the sandbox has no
app or services), and neither names a path this change touches.

## Verification

`bun run typecheck` clean across all four packages plus `scripts/`.
`env -u GIT_ASKPASS bun run test`: 3472 passed, 4 skipped, **1 failed** —
`packages/server/test/dev-pane.test.ts > kills the child process tree`, which
asserts a POSIX process group is reaped after a PTY kill. It fails identically
in isolation, imports nothing this diff touches, and ticket 1 reported it too.
`pty-teardown.test.ts` failed once under full-suite load (a 3653ms-vs-4500ms
timing assertion) and passes in isolation and on the final full run.

The prompt's stated baseline (118 files / 1768 tests) does not describe this
repo, which runs 240 files / 3477 tests — same mismatch ticket 1 hit.

## Left undone

- **No UI for any of it.** `carriedFindings` still renders nowhere, and
  `partitionWork` in `apps/web/src/components/review/WorkList.tsx` keeps its own
  `defectStanding` that has no `carried` case — a carried defect falls through to
  `return 'fixing'` and reads as being fixed. Ticket 1 flagged this; it is still
  true, and now reachable, because a session can actually carry a defect.
  The human reopen verb (`findings.reopen`) has no button either.
- **`triagePreview`'s defect count** inherits the current-lap scoping ticket 1
  gave `viewByFeature`, which is what the spec asks — but the boundary triage
  dialog still cannot promote an earlier-lap defect via `quickFixFindingIds`
  (`promoteOpenDefects` guards on the current-lap open set). The session's link
  path is the intended route; worth confirming that is the wanted end state.
- The gate's refusal lists every offender's title with no cap. A lap inheriting
  a dozen defects gets a long line. Fine at observed volumes (the auto-fix cap is
  8), noted in case it ever is not.

#### 3. Review page: honest counts, carried section, provenance on fixed cards

# Ticket 3 — review page: honest counts, carried section, provenance on fixed cards

## What was done

The review page now has a fourth band, `apps/web/src/components/review/CarriedFindings.tsx`,
between "What still needs attention" and the Full account disclosure. It renders
the server's own `carriedFindings` pile (never a client filter of `findings`) as
`WorkList` rows, so a parked defect reads exactly like every other defect on the
page, and each card carries the two verbs that are the human's alone: Reopen
(`findings.reopen`) and Dismiss, both invalidating `findings.listByFeature` —
the same key the SSE stream invalidates.

A defect's row now states where it went, via a new `findingStanding` derivation
in `lib/feature-ui/review.ts` beside `findingOpenReason`: `captured lap N,
carried into lap M` for a carried one, `closed by a lap session as addressed —
no fix ticket verified it` (amber, with the attestation note under it) for
`resolvedBy: 'session'`, and `fixed by its fix ticket` (green) for a
burner-verified fix. Tone comes from a lookup map in `NoteRow`, per STYLE.md.

Two things in the diff the ticket did not spell out, both consequences of
ticket 1's lap scoping:

- `partitionWork` now skips carried defects entirely — with its own band they
  would otherwise render twice — and `defectStanding`'s fall-through no longer
  returns `fixing` for a defect the current-lap open set leaves out. An earlier
  lap's still-open leftover was rendering as "being fixed" with no controls,
  which hid the Dismiss the spec relies on as the human's way to pre-empt the
  `complete_phase` gate. It now mirrors the server's own last line.
- The status strip's review row counted `findings.length` (every lap). It reads
  `summary.found + summary.observations` now, so "N findings" describes this
  lap's pass rather than the whole feature's history.

Tests: `note-row.test.ts` (carried line, the two provenance classes, silence for
an open defect), `open-work.test.ts` (carried out of both halves; the earlier-lap
leftover keeps Dismiss), `review-bands.test.ts` (the band's place in the
orchestrator's composition, and the counts coming from the server rather than the
rows), and a new tier-2 `carried-findings.test.tsx` — tier 2 because the band
exists for its verbs, and a click calling `findings.reopen` and then refreshing
the query is not something a rendered string can show. Three existing trpc mocks
gained `findings.reopen`.

## Surprises

- `viewByFeature`'s `carriedFindings` and a client-side filter of `findings` by
  status are the same set, so the band could have been built either way. It reads
  the server's array on purpose (acceptance criterion 1), which is why
  `partitionWork` has to skip carried rows rather than hand them over.
- `review-bands.test.ts` computes its own `summary` from the fixture findings, so
  it could not show lap scoping at all until the harness took an explicit
  `summary` override. That override is what makes the "counts come from the
  server, not the rows" test meaningful.
- The full suite is 240 files / 3473 tests here, not the 118/1768 the prompt's
  baseline claims. One test fails before and after this diff and is unreachable
  from it: `packages/server/test/dev-pane.test.ts > kills the child process tree`,
  which asserts a POSIX process group is reaped after a PTY kill (ticket 1
  reported the same one). Everything else is green — 3468 passed — and
  `bun run typecheck` is clean across core, server, web and `scripts/`.

## Drive machinery

Nothing to update, and nothing run: this ticket adds no service, no required env
var, no seed and no extra process — apps/web components and their tests only —
which the standing instruction lists as already covered by the idempotent
`.runcastle/drive-setup.ts`. I did not execute any drive command (the sandbox has
no app or services).

## Left undone

- `styles.css` has nothing left for this surface, so the ratchet constant is
  untouched — the review sections were already migrated to utilities.
- The carried band shows a `Lap N` badge (the flat-list default) as well as the
  `captured lap N` clause in the standing line. Mildly redundant; leaving it
  keeps the row anatomy identical to the settled list's.
- `promoteOpenDefects` still guards on the current-lap open set only, so the
  human's "Fix N open defects" and the boundary triage cannot quick-fix an
  earlier lap's leftover even though the row now offers Dismiss. Ticket 1 flagged
  this and it is consistent with the decisions; the session's link path is the
  route for that work.
