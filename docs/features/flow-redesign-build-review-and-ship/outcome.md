# Outcome — Flow redesign: build, review, and ship

Redesign the feature's second half end to end — burn/run view, review summary, test drive, walkthrough player and annotation, notes triage, laps, merge and conflict, shipped view — walked and confirmed with the human before design.

- Shipped: 2026-09-06
- Lap: 1

## 1. Server: stamp review evidence with its moment (passKind, reviewedCommit, completedAt, lap) and fix the findings ledger

What was done
Added ticket persistence for review pass kind, reviewed commit, and completion time, including an upgrade migration whose defaults preserve existing rows honestly.
Stamped every terminal ticket service path and recorded the feature-branch head when a review pass completes.
Expanded the review-artifacts HTTP listing with lap/pass/moment fields, completion ordering, and landed-since counts.
Centralized review listing and walkthrough URL patterns/builders in core and removed the note lookup pass-through.
Repaired the findings ledger so failed, cancelled, and orphan-swept fixes return defects to open work, with stable ordering and verification-pass copy.
Added seam tests for migrations, route builders/listing behavior, ticket terminal paths, branch-head capture, and findings behavior.

Surprises
The configured full suite was accidentally launched twice concurrently after the first foreground call yielded without its session id; the overlapping runs interfered through shared temporary repositories and environment, producing unrelated infrastructure failures.
The final focused verification covered eight touched seam files and passed 422 tests; repository-wide typecheck passed.

Left undone
No drive machinery changed because this ticket adds no service, boot environment variable, seed, or companion process.
No adjacent review UI redesign or verification scheduler work was included; those remain owned by later tickets.

## 2. Server: end-of-burn verification pass — tour and verify, mode inherited, never mints fixes

What was done
Added the pure end-of-burn verification decision and wired the scheduler to mint, emit, admit, and await one verification ticket in the feature's current lap.
Verification context records every landed implementation ticket and includes linked finding title, location, and repro step for fix tickets.
Added the tour-and-verify prompt variant, inherited Drive/Gates mode from the verified pass's recording, and centralized the auto-fix cap in prompt rendering.
Verification defects now remain open with the verification reason and never mint another fix wave; ordinary review defects retain their existing auto-fix behavior.
Centralized the attachment-directory prefix and removed the dead path import.

Surprises
The full repository test run found 14 failures outside this ticket: three stale note/title expectations from the already-landed ticket 3 work, plus temp-repository, unsafe-pager, and PTY teardown environment failures.
Ticket-owned focused verification passed 205 tests, and the repository-wide typecheck passed.

Left undone
The unrelated ticket 3 expectations and environment-sensitive repository tests were not changed because they are outside this ticket's scheduler, prompt, and findings seams.
No drive machinery changed because this ticket adds no service, boot variable, seed, or companion process.

## 3. Server: notes bound to their recording, carry/reopen lifecycle, triage commit, first-sentence ticket titles

What was done
Added persisted review-recording bindings and carried-lap metadata for test notes, including a generated Drizzle migration and updated core wire schemas.
Added carried/reopened lifecycle operations, rendered carried-note markers, and froze carried notes from ordinary mutation.
Added the atomic triage service/router operation for dismissing, promoting selected notes and findings, and carrying remaining open notes.
Added triage preview counts and earlier-lap pending implementation-ticket grouping.
Added exact-ID filtering for open-defect promotion.
Added and unit-tested first-sentence, word-boundary ticket titles without ellipses.
Extracted the shared iteration guard and reused it for triage and rethink.

Surprises
Existing annotation tests construct timestamped notes without review-ticket bindings; the service retains that legacy fixture path while the public notes.add mutation enforces the new invariant.
The targeted legacy tests need fixture updates for the intentionally changed router contract and title output.

Left undone
The full suite was not green: six existing expectations still encode the superseded unbound-timestamp and ellipsized-title behavior.
No drive machinery changes were needed because this adds only a migration and no new service, environment variable, seed, or process.

## 4. Server: one drive-state value; merge retires the conflict; outcome doc synthesized after the merge on the base branch

What was done
Added the six-value server-derived drive state and exposed it through DriveInfo.
Moved unresolved merge-conflict derivation into core and retire standing conflicts before shipment.
Added a merge-delta query reporting commit and changed-file counts.
Moved outcome generation after successful merge and commit it separately on the merge target branch.
Rebuilt the outcome composer around shipped scale, laps, stamped reviews, note dispositions, and substantive digests.
Preserved ended Q&A sessions without transcripts as explicit missing-transcript rows.

Surprises
Ticket 3 left three legacy note/title expectations red; these were aligned with its already-landed contracts.
The full suite hit sandbox-environment failures in unrelated burn workspace, pager, PTY, and injected-token tests; all ticket and predecessor-compatibility seams passed (374 tests), and typecheck passed.

Left undone
No drive scripts changed because this ticket adds no service, required environment variable, seed, or companion process.
The unrelated environment-sensitive test failures were not changed as they do not exercise this ticket's code.

## 5. Web: the pure derivations — stroke model, drive-state table, freshness stamp, strip chips, timestamp binding, markers, triage copy, relTime

What was done
Added a pure annotation model with pen, arrow, and rectangle geometry, immutable transitions, save/dirty rules, undo/redo, and edge-only canvas painting.
Added table-driven drive-state presentation and pure run-lane state, verdict, headline, count, protocol-token, and repository-path derivations.
Changed review selection to completion-time ordering and added freshness stamps plus ordered status-strip chips that exclude review tickets and expose waived work.
Added recording-bound timestamp modes, clustered walkthrough markers, lap-chip accounting, triage footer copy, and mixed-lap burn labels.
Added grammatical relative-time phrases and migrated every caller that previously appended “ago”.
Added focused Vitest coverage for every new seam; typecheck and all 61 directly affected tests pass.
Surprises
The advertised core `ticketTitleFromNote` predecessor from ticket 3 is absent on this branch, so this ticket did not duplicate or re-export it; the integration merge must supply that already-owned symbol.
The prescribed full suite ran 2,804 tests but failed 12 unrelated server tests: burn-slot temp repositories disappeared, a process-group cleanup assertion raced, and the host Claude token violated an isolation assertion.
The repository currently reports 180 test files rather than the prompt’s stated 118-file baseline.
Left undone
No components, CSS, server behavior, or drive scripts were changed, as required by this prefactor ticket.
The unrelated server-suite environment failures were left untouched; all affected web tests and the full monorepo typecheck are green.

## 6. Web: walkthrough player and annotation overlay — keyboard transport, frame step, honest states, pen/arrow/rect, any-content save

# ticket(6) — walkthrough player and annotation overlay

## What was done

`WalkthroughPlayer.tsx` was rebuilt on the foundation's tokens and primitives: click-the-frame
toggles, keyboard transport on `window` (Space/K, J/L and arrows ±5 s, `,`/`.` frame step while
paused, `<`/`>` speed cycle, F fullscreen), a `1.5×` control applied to `playbackRate` at
`loadedmetadata`, a whole-second scrub bar with a hover time tooltip and clustered note markers
(count badge, click seeks and reports its note ids), an explicit loading state (first frame nudged
off zero, spinner, `Loading the recording — 21 MB` from a best-effort HEAD) and an explicit decode
error with the file URL and Retry. The published ref became a `WalkthroughHandle`
(`seek` / `pause` / `getTicketId`); a saved annotation now posts `reviewTicketId` beside
`videoTimestamp` and calls `onAnnotationSaved(noteId)`.

Drawing moved out to `components/review/AnnotationOverlay.tsx` over ticket 5's pure model, reduced
in a `useReducer`, with pointer handlers reading the canvas from a ref — the walked second-stroke
crash was `e.currentTarget` read inside a lazily-run state updater, and that read no longer exists.
Pen / arrow / rect, undo/redo/clear, save gated on *any* content, a multi-line note (Enter saves,
Shift+Enter newlines), and a dirty discard confirmed on the foundation `Dialog`. Annotate is never
disabled: clicking it while the recording plays pauses and opens the overlay in one act.

`captureAnnotation` now bakes the shape model at the overlay's own scale, which retired the dead
`Stroke` / `paintStrokes` pair. Two tier-2 files cover it all against a stubbed `<video>` and
canvas. The player's `styles.css` rules were deleted and the ratchet lowered to 3298.

## Surprises

- `notes.add` still requires `text.min(1)` server-side, so a drawing-only save (decision 24c's
  whole point) cannot post empty text. It posts `Annotated 0:42` — the picture and the moment are
  the observation, and the human can type over it from the list. Relaxing the schema is a server
  change and would ripple into the notes list and the ticket-title derivation, so it was not taken.
- `paintShapes` did not draw a one-point pen mark, while the model ticket 5 landed deliberately
  keeps one as saveable content — a tap would have baked an invisible annotation. Fixed in
  `paintShapes` with a test, matching what the retired `paintStrokes` already did.
- `STROKE_WIDTH` was 4 *frame* pixels; decision 24b asks for ~6 *on-screen*, so it is now 6 and
  every caller multiplies by intrinsic-width / rendered-width. The same scale rides into
  `captureAnnotation`, so the baked PNG carries the weight that was drawn.
- The repo's tier-2 tests have no `@testing-library/jest-dom`; assertions are plain property reads.
- 8 tests fail in this sandbox and are not mine: `burn-slot-workspace.test.ts` (its temp repos
  under `/home/agent/cache/tmp` vanish — `fatal: repository ... does not exist`) and one
  `dev-pane.test.ts` process-group kill race. They fail identically on a targeted run with no web
  code loaded, and this diff touches only `apps/web`. Ticket 5's digest reported the same set.
  Everything else is green: typecheck 0 errors, 180 test files / 2851 tests passing.

## Left undone

- **Ticket 7/8's seam.** `ReviewBody` was wired minimally (it derives the recording artifact with
  `latestReview` so the player gets the pass's identity, and passes `clusterMarkers` output). It is
  still the old card layout; `reviewWalkthroughUrl` is now unused by `ReviewBody` but stays as the
  tested derivation seam the EvidenceStage ticket will consume or delete.
- **Bidirectional visible jumps (decision 25b).** `jumpTo` seeks and pauses but does not scroll the
  stage into view — the player owns the stage ref, so that is two lines here if ticket 7/8 wants it
  rather than owning the scroll itself. Worth deciding once, in the ticket that builds the list.
- `onMarkerClick` is plumbed but `ReviewBody` passes nothing for it; highlighting the clicked
  note(s) is the notes-list ticket's half of decision 25c.
- **Drive machinery:** nothing to update. This ticket adds no service, env var, seed or process —
  only web components and tests — so `.runcastle/drive-setup.ts` and friends are untouched and were
  not run (correctly: this sandbox has no app or services).

## 7. Web: the review page bands — ReviewBody split, EvidenceStage, StatusStrip, FullAccounts, alert slot, structural readonly; review+shipped CSS deleted

# ticket(7) — the review page's bands

## What was done

`bodies/ReviewBody.tsx` went from 995 lines with 13 inlined components to a 211-line
orchestrator — the queries, the derivations, and the five bands in decision 17/18's order:
`SessionPanel` → `EvidenceStage` → alert slot → `StatusStrip` → open-work slot →
`FullAccounts`. Everything it mounts is a new file under `components/review/`, each taking
its data as props so it renders without a tRPC provider.

`EvidenceStage` is the ~full-width 16:9 stage: it plays the latest *completed* pass
(`latestReview` over artifacts with a `completedAt`), carries the identity line
(`Walkthrough · 12:34 · reviewed abc1234` / `Verification walkthrough · confirms 4 fixes ·
this build`), an "earlier recordings" disclosure that puts any older pass on the stage, and
the `Open app ▶` affordance. The swap between player and drive is `driveView(state).stageKind`
from the server's own drive-state value. `StatusStrip` renders `statusChips()` as chips that
are each a disclosure or an anchor; the lap chip's disclosure carries `lapChip().story` and
the planned-next-lap prose that used to be its own card. `FullAccounts` is one collapsed
`<details>` holding the lap narrative and every ticket digest. `ConflictCard` moved out
hook-free (`ConflictAlert` is the wired half) and refuses to render under `readonly`.
`readonly` is passed down once and answered by every band; a tier-1 test composes the bands
in the orchestrator's order and asserts that not one of ten live controls survives it.

`NotesPanel`/`NoteText`/`NoteEditor` moved unchanged into `review/NotesLegacy.tsx` and the
four drive components into `review/drive-parts.tsx` (restyled on tokens) — ticket 8 replaces
the first, ticket 9 the second. `WalkthroughPlayer` gained one prop, `onDuration`, because
only the media element knows how long the recording is and the stage header prints it.
`styles.css` lost 176 lines (3298 → 3122, ratchet lowered in the same commit) — the whole
Summary/Test-drive grid, the lap-account block, the planned-lap card, the conflict card, the
drive-failure card, the drive pane and the walkthrough card. Notes and findings stopped
polling outside the review phase, in `Workspace.tsx` (where they actually did) as well as here.

## Surprises

- **The Summary card held something the ticket's band list did not name**:
  `FindingsSummaryBlock` — the "9 defects found · 8 fixed · 1 still open · 3 observations"
  line and the observation rows. Deleting the card silently dropped it, so it is rendered at
  the top of the open-work slot instead; the observations are the review's verdict about
  work, and that is the band the verdict belongs in. Ticket 8 should fold it into `OpenWork`.
- **"confirms N fixes" has no direct source.** The verification ticket does not carry a fix
  count on the wire, so N is derived as `previousPass.landedSince - thisPass.landedSince` —
  both are "implementation tickets done since", so the difference is the window between the
  two passes. It is labelled as derived in the header's tooltip.
- **`lapChip` wants a `lapSessionRan` the feature row does not have.** Derived as "this lap
  has emitted tickets", which is exactly what the past-tense copy claims. A real column
  would be better if decision 27a's tense ever needs to be right before the first ticket.
- **`.drive-pulse` and `.drive-copy` outlived this rebuild** — the first is now only
  preparation's dry-run row, the second only the notes inbox and `AddressNotesDialog`. Both
  are left in `styles.css` with a comment naming who still needs them; they are tickets 8
  and 10's to take.
- **8 tests fail in this sandbox and are not mine**: `burn-slot-workspace.test.ts` (its temp
  repos under `/home/agent/cache/tmp` vanish — `fatal: repository … does not exist`) and one
  `dev-pane.test.ts` process-group kill race. Tickets 5 and 6 reported the identical set.
  This diff is `apps/web` plus two lines of `Workspace.tsx`. Everything else is green:
  typecheck 0 errors, 2889 tests passing, all 63 web test files.

## Left undone

- **The alert slot has no `children` hole.** Ticket 10's failed-Iterate alert renders where
  the conflict card does, between `EvidenceStage` and `StatusStrip`; a prop nothing passes
  yet would have been speculative, so the position is marked with a comment instead.
- **Bidirectional visible jumps (decision 25b)** still are not wired: `onJump` seeks and
  pauses but does not scroll the stage into view, and `onMarkerClick` is not passed at all.
  Both belong to the notes-list ticket (8), which owns the other half of decision 25c.
- **The drive stage is today's components in the new position**, not decision 39's capture
  panel. `DriveStage` inside `EvidenceStage` is where ticket 9 replaces them; the swap logic
  around it is already correct for all six drive states.
- **`Open app ▶` is disabled without a visible reason when another feature or a preparation
  dry run holds the one drive slot** — the "no dev command" case does show its reason. A
  single `startBlocked: string | null` prop would carry both; it was left rather than
  reshaping the prop the ticket named.
- **`reviewWalkthroughUrl` is now unused by any component** (the stage reads whole artifacts).
  It stays as ticket 5's tested derivation seam; whoever is sure nothing wants it should
  delete it with its test.
- **Drive machinery**: nothing to update. This ticket adds no service, env var, seed or
  process — web components, tests and CSS only — so `.runcastle/drive-setup.ts` and friends
  are untouched and were not run (correctly: this sandbox has no app or services).

## 8. Web: open work — NoteRow, NoteComposer with pasted images, lightbox, bidirectional jumps, in-place edit, confirmed delete, carried group

# ticket(8) — open work: one row, pasted pictures, visible jumps

## What was done

`NoteRow.tsx` is the single row anatomy for both a test note and a review defect:
a ~96×54 thumbnail that opens an in-app `Lightbox` (never a browser tab), a timestamp
that is a live jump only into the recording the note was taken against and reads
`0:42 · earlier walkthrough` otherwise, the whole multi-line text, severity/author chips,
a lap badge, and a `being fixed in the running burn · lane #N` link for a defect a fix
ticket is burning. It is hook-free; the triage step (ticket 10) imports it.

`OpenWork.tsx` replaces `OpenWorkSlot`, `NotesLegacy` and `ReviewFindings`: open defects,
defects being fixed, and open notes merge into one lap-grouped list; everything already
dealt with — carried (with Reopen), quick-fixed, handled, fixed, dismissed — sits in a
collapsed group beneath, keeping its evidence. `FindingsSummaryBlock` moved in here from
the deleted `ReviewFindings.tsx` (ticket 7 flagged it as owed a home). Jumps are
bidirectional: a timestamp seeks the player *and* smooth-scrolls `#evidence-stage` into
view; a marker click marks its notes; a fresh annotation scrolls its new row into view and
highlights it for ~2 s. `EvidenceStage` gained `id="evidence-stage"` and now reports which
recording it is playing, plus forwards `onMarkerClick`/`onAnnotationSaved` from the player.

`NoteComposer.tsx` holds the capture box, the in-place editor and the delete confirm. Both
capture surfaces take a pasted or attached image, convert non-PNG to PNG client-side
(`toPngBlob`, new in `lib/reviews.ts`), and ride the existing note-first-then-PNG pipeline
onto `POST /api/reviews/note/:id/screenshot`. One image per note, so a second one asks
first. Editing expands inside the row, so the thumbnail and moment stay on screen.

`styles.css` 2887 → 2750, ratchet lowered in the same commit. Tests: `note-row.test.ts`
(tier 1, 11 cases), `open-work.test.ts` (tier 1, 10 — it replaces the deleted
`review-findings.test.ts`), `note-composer.test.tsx` (tier 2, 15 — lightbox folded in).

**Deviations.** The ticket routed the fixing-defect link through "the prop ReviewBody
receives"; it received none, so `onViewPhase` is threaded one level through
`Workspace.tsx`'s `PhaseBody` (two small edits) and `ReviewBody` builds the
`onViewPhase('implementation')` + scroll-to-`#lane-<id>` callback from it.

## Surprises

- **`openDefects` from the server excludes `fixing` defects.** `defectState` drops a defect
  the moment a live fix ticket exists, so decision 18c's "renders as being fixed in the
  running burn" cannot be built from `openDefects` alone. `OpenWork` mirrors just the
  fixed-vs-fixing half of that join client-side, keyed off the server's own open set so it
  can never disagree about what is *open* — commented as such.
- **A note's standing had to move out of the controls slot.** `readonly` drops every
  control (decision 33a), which would have taken "carried into lap 3" and "→ #9 title" with
  it — statements, not actions. They render in `NoteRow` itself now, from the note's status.
- **`.note-check` / `.note-text` / `.drive-copy` survive.** `AddressNotesDialog` still spells
  all three; they are ticket 10's to take. Everything else in the review block is gone.
- **8 tests fail in this sandbox and are not mine**: `burn-slot-workspace.test.ts` (its temp
  repos under `/home/agent/cache/tmp` vanish — `fatal: repository … does not exist`) and one
  `dev-pane.test.ts` process-group kill race. Tickets 5, 6 and 7 reported the identical set.
  This diff is `apps/web` plus 15 lines of `Workspace.tsx`. Everything else is green:
  typecheck 0 errors, 2941 tests passing, all 66 web test files.

## Left undone

- **The scroll to a fix ticket's lane is best effort** — one `requestAnimationFrame` after
  the phase swap. Landing on the run view always works; if `RunBody`'s queries have not
  settled the scroll silently does nothing. A `scrollTo` prop on `RunBody` would make it
  exact and is ticket 12's territory.
- **`NoteRow`'s `showLap` is used only in the collapsed group** here, because `LapSections`
  already heads the open list. The triage step (ticket 10) is its other caller.
- **`headline()` is now used only for a finding's detail and an observation's**, since notes
  render whole. When triage lands, check whether `feature-ui/summary.ts` still needs it.
- **Drive machinery**: nothing to update — this ticket adds no service, env var, seed or
  process (web components, tests and CSS only), so `.runcastle/drive-setup.ts` and
  `drive-stop.ts` are untouched and were correctly not run in this sandbox.

## 9. Web: Open-app drive panel in the stage with tab self-capture; drive states in stage and bar from one value

# Ticket 9 — Open-app drive panel on the stage; one drive state for stage and bar

## What was done

The evidence stage's placeholder drive panel is replaced by real content for all six
server drive states, driven off `driveView(state)` (ticket 5's table): `starting` says the
dev server is coming up with the boot output one click away; `serving` and
`review-agent-driving` mount the new `review/DrivePanel.tsx`; `bare-checkout` says nothing
was started and links the dev-command setting; `setup-failed` renders `DriveSetupFailed`
(command, how it ended, output behind a disclosure, Fix drive + Stop) where the video
would be. Stopping the drive swaps the player back. Idle-with-a-dev-command now leads with
one line (`testDriveLead`, new in `lib/vocabulary.ts`) over a disclosure holding
`testDriveExplainer`'s full account — the stretched explainer card is gone, and
`ReviewBody` passes `caps` instead of a pre-flattened `devConfigured`.

`DrivePanel` embeds the dev server in a plain cross-origin iframe with a toolbar of
`Select area` / `Reload` / `Open app ↗`. Capture is decision 39's tab self-capture: one
`getDisplayMedia({ preferCurrentTab, selfBrowserSurface })` prompt per drive session, the
stream parked in a hidden `<video>` and its tracks stopped on unmount, then each drag-select
hides its own chrome, waits two `requestAnimationFrame`s **and** the next decoded stream
frame, crops, and ships the PNG through `saveAnnotatedNote` + `uploadScreenshot`. The
geometry is pure in the new `lib/capture.ts` (`selectionRect`, `cropRect`, `isCapturable`,
`tabCaptureSupported`) and unit-tested there.

`resolveReview` now takes `driveState` off `ResolverInput`, so the bar and the stage read
one value. `starting`, `bare-checkout`, `setup-failed` and `review-agent-driving` take the
bar's copy and primary straight from the drive table — only `serving` can print "merge when
it looks right" — with the review verbs kept as secondaries. Iterate's F3 refusal gains an
`escape` action (`stopDriveAndIterate`), rendered by `NextStepBar` as a button on the reason
line and dispatched in `Workspace` as stop → await → `rethink`; `fixDrive` is dispatched
there too.

Two deviations worth naming. **(1)** The ticket asked the capture to open "the `NoteComposer`
in with-image mode", but ticket 8 landed no `NoteComposer` component — only the shared
`saveAnnotatedNote` seam in `lib/walkthrough.ts`. The panel therefore uses a small inline
composer over that same seam, so the create-then-upload dance is shared even though the
markup is not; if ticket 10 lands a `NoteComposer`, this is the one place to fold in.
**(2)** No `styles.css` deletion was needed: ticket 7's review migration had already taken
every drive rule to Tailwind, and the ratchet is already at the file's exact measured count
(2887). The `.drive-pulse` and `.drive-copy` rules that still exist belong to
`PreparationWorkspace` and to the notes surfaces ticket 10 owns, so I left them.

## Surprises

- **Eight server tests fail in this sandbox and none of them are mine.**
  `packages/server/test/burn-slot-workspace.test.ts` (7) dies on `fatal: repository
  '/home/agent/cache/tmp/rc-slot-vol-*/tmp/rc-slot-ws-*' does not exist` and
  `dev-pane.test.ts` (1) on a process-group kill that does not reap here — both are
  capability failures of a nested burn container. This ticket's diff touches zero files
  under `packages/`, and those two test files plus all of `packages/server/src` are
  byte-identical to the pre-ticket commit. Every `apps/web` test passes; typecheck is 0
  errors. The prompt's stated baseline (118 files / 1768 tests) is stale — the suite is now
  191 files / 2953 tests.
- The XFO / `frame-ancestors: deny` case is genuinely unobservable from the embedding page:
  Chrome fires `load` for the blocked frame, so the `loaded && slow` timeout can miss it.
  That is why `Open app ↗` is rendered unconditionally rather than only in the fallback —
  the always-visible link is what actually carries the criterion.
- Chrome's own "stop sharing" ends the capture track without telling React, and a dead
  stream draws a frozen frame. The panel listens for `ended` and drops the stream reference,
  so the next Select area re-prompts — one prompt per *session* still, but an honest one.

## Left undone

- `driveView(state, _info = {})` (ticket 5's) carries a second parameter no caller passes.
  Left alone as another ticket's file.
- `AnnotationOverlay` and `DrivePanel` each have their own note-text textarea. The shared
  save path is factored; the markup is not. Extracting a composer belongs with ticket 10's
  `NoteComposer`, not here.
- No `.runcastle/` change was needed or made: this ticket adds no service, no required env
  var, no seed and no process — it is web-only. `drive-setup.ts` / `drive-stop.ts` are
  untouched and were not run (no services in this sandbox).

## 10. Web: the Iterate door — TriageStep, Merge/Iterate bar, lap chip replaces the banner, labelled Burn count, failed-Iterate alert

# Ticket 10 — the Iterate door, the lap chip, the labelled Burn

## What was done

The review bar now offers two forward decisions. `addressNotes` and `fixDefects` are gone
as action kinds, `AddressNotesDialog.tsx` is deleted, and `resolveReview`'s
open-defects branch is replaced by one "Answer what is still open" bar whose primary is
Iterate whenever any note or defect stands. Iterate's kind is picked in the resolver off
the same two counts the click uses — `rethink` when nothing is open (the step is skipped
and the lap starts empty-handed) and `iterate` when something is — so the bar and the
dispatch cannot disagree; `Workspace.enterIterate` is the single place both land, which
is also where the drive escape (`stopDriveAndIterate`) and the failed lap's Retry go.

`review/TriageStep.tsx` is the door: `NoteRow`s for every open note and defect, grouped
by lap, one unchecked Quick fix checkbox each, mark-all/clear, a dismiss behind a confirm,
label timestamps, the working lightbox, and rows written after the door opened marked as
having arrived. `triageExits` (new, in `feature-ui/laps.ts`) turns the ticked boxes into
the step's buttons and the road each takes; `Workspace.commitTriage` dismisses defects,
calls `notes.triage`, then `feature.burn` (nothing carried) or `feature.rethink` (anything
carried). `LapAbortAlert` gives the review body's alert slot the failed-Iterate state,
from a new `lapAbort(events)` derivation. `LapBannerRow`, `lapBanner`, `LapBanner` and
`LAP_KICKOFF` are deleted — the strip's lap chip is the only lap narration. Both the review
and implementation resolvers label Burn through `burnLabel(pendingTickets, lap)`, which
meant threading the pending ticket ROWS through `ResolverInput` beside the count.
`.notes-dialog-*`, `.ws-lap*`, `.note-check`, `.note-text` and `.drive-copy` are gone from
`styles.css` (2750 → 2689, ratchet lowered) and SPEC §15.6 describes the built shape.

Three deviations worth naming. **(1)** The ticket's `triageFooter({quickFix, carried,
standing})` signature is ticket 5's `{quickFix, carried, nextLap, standing}`; I used what
exists. **(2)** Iterate is no longer hidden while a session is live. Hiding it would have
lost the quick-fix road that `Address notes` used to offer in exactly that state (promotion
only writes ticket rows), so Iterate stays visible, is disabled with the one-terminal
reason only when the conversation is all the click would do, and the step's lap road
carries that same reason (now one constant, `ONE_TERMINAL_ITERATE`). **(3)** The step is
split into `TriageStep` (the `Dialog`, plus the `readonly` gate) and an exported
`TriagePanel` — the foundation `Dialog` portals, and `react-dom/server` cannot render a
portal, so tier 1 asserts the panel's markup while the dialog mechanics stay
`dialog.test.tsx`'s (decision 36's own split for MergeFeatureDialog content).

## Surprises

- **The 8 server test failures are the same ones ticket 9 reported and are not mine.**
  `burn-slot-workspace.test.ts` (7, "fatal: repository … does not exist") and
  `dev-pane.test.ts` (1, a process-group kill that does not reap here) are capability
  failures of a nested burn container. My diff touches zero files under `packages/`
  (`git diff --stat -- packages` is empty). Everything else is green: 194 files / 3012
  tests pass, and `bun run typecheck` is 0 errors. The prompt's stated baseline (118 files
  / 1768 tests, fully green) is stale on both counts.
- **Test fixtures had to grow a `lap` on their tickets.** `burnLabel` counts pending rows
  by lap, and several `as unknown as FeatureFull` fixtures built tickets without one, so a
  plain "Burn 1 ticket" came out as "…— 0 from lap 1 · 1 carried from lap undefined". The
  fixtures were wrong (a real ticket always carries a lap), so I fixed them rather than
  weakening the derivation.
- **The triage mutation only knows notes.** `notes.triage`'s `dismissIds` deletes notes;
  a dismissed *defect* has to go through `findings.dismiss`, so the commit does those
  first and the step's selection carries `dismissFindingIds` separately.
- The open-work bar now outranks the deferred-scope ("the spec plans lap N+1") flip — what
  is open belongs to this lap, and the door triages it. One existing test moved with it.

## Left undone

- **`findings.fixOpenDefects` has no web caller any more.** The procedure and its server
  tests are untouched (the ticket only blessed `notes.promoteMany` staying for MCP);
  someone should decide whether the composite still earns its place.
- The triage step's timestamps render NoteRow's "0:42 · earlier walkthrough" label, since
  passing `onStage: null` is what makes them labels. Inside the step that suffix is a
  slight overstatement for a note taken against the current recording; fixing it means a
  label variant on NoteRow, which is ticket 8's file.
- `commitTriage`'s chain (dismiss → triage → burn/rethink) is covered by review rather than
  by a test: asserting it needs a Workspace render harness, and none exists. The decision
  it encodes — which road each exit takes — is unit-tested through `triageExits`.
- No `.runcastle/` change was needed or made: this ticket adds no service, no required env
  var, no seed and no process — it is web plus one docs edit. `drive-setup.ts` /
  `drive-stop.ts` are untouched and were not run (no services in this sandbox).

## 11. Web: merge dialog sees the conflict, stamped green case, ConflictCard states, bar layout bug, shipped view with read-only stage and Q&A history

# ticket(11) — merge dialog, conflict card, bar layout, shipped view

## What was done

`mergeSummary` was rebuilt to decisions 29/31: it now takes the branch/base, the
`feature.mergeDelta` scale, the feature's tickets and lap, the review
**freshness stamp** (ticket 5's) and the standing conflict, and returns four rows
that are never silently absent (`what lands` = "12 commits · 9 files", `run` =
"8/8 tickets done · 1 waived · 1 failed" never green over set-aside work, `test
drive`, `review` = the stamp verbatim), a `conflictRow` sentence, an enumerated
warnings list (open notes, waived tickets, standing unburned fix tickets per
earlier lap, stale evidence) and a `next` line. It is unit-tested in a new
`test/merge-summary.test.ts`; the superseded `mergeSummary` block was deleted
from `feature-ui.test.ts`.

`MergeFeatureDialog` moved onto the `Dialog` primitive (`size="sm"`) and Tailwind
tokens, its content split out as an exported `MergeConfirmation` — `Dialog`
portals into `<body>`, so the wrapper cannot be rendered to static markup and a
tier-1 test needs the content component. Over a conflict the red row tops "what
lands", the primary flips to **Resolve the merge conflict** (the same
`useResolveConflict` hook the card uses, wired from `Workspace.tsx`) and **Retry
merge anyway** stays enabled with its honest line. Tier-1 tested in
`test/merge-dialog.test.ts`.

`ShippedBody` was rebuilt: hero on tokens with `relTimeAgo`, a "Read the outcome
doc" `DocPeek` link, a read-only `EvidenceStage` playing the latest completed
pass with earlier recordings reachable, a read-only `StatusStrip` (new `shipped`
and `driveLap` props → "Shipped after 2 laps" and "test drive taken · lap 2",
with the chips rendered as statements because the bands they anchor into are not
on that page), and a Q&A history listing every conversation — a
`transcriptMissing` one as "session opened · nothing recorded". Tier-1 tested in
`test/shipped-body.test.ts`.

Deviations worth knowing: (1) the drive lap comes from a new pure
`lastTestDriveLap(events)` in `gates.ts`, counted from `lap.started` rather than
`feature.lap`, because on a shipped feature the latter is the *last* lap and
would file a lap-1 drive under lap 2; (2) the shipped strip drops the commit row
from `reviewChecks` on purpose — `base..branch` is zero once the branch has
landed, and the scale of what shipped belongs to the outcome doc; (3) the
deferred-scope warning from the earlier `mergeSummary` was kept alongside the
four decision-31b warnings — it is a live prior decision and dropping it silently
would have been a regression the ticket did not ask for.

CSS: the MERGE CONFIRMATION section and the `.shipped-*` rules are gone and the
ratchet came down 2887 → 2842. Items 3 and 4 of the ticket (the ConflictCard's
"resolve session ended" state and the next-step bar's one-word-per-line collapse)
were already landed by the interrupted first attempt, in `d8098b7`; I verified
them rather than redoing them.

## Surprises

- **`AddressNotesDialog` was borrowing two MERGE CONFIRMATION rules**
  (`.merge-dialog-title`, `.merge-dialog-lead`). Deleting the section outright
  would have unstyled a dialog that is still live (ticket 10's `TriageStep` has
  not landed here), so those two rules were re-homed under the address-notes
  section and its two class names updated — they die with that dialog.
- **`Dialog` portals**, so tier-1 (`renderToStaticMarkup`) cannot render any
  component that mounts one. No other test in the repo does; the content-split
  above is the pattern the next dialog rebuild should copy.
- **Eight test failures are environmental, not mine.** `bun run test` fails 7
  cases in `packages/server/test/burn-slot-workspace.test.ts` (`fatal:
  repository '/home/agent/cache/tmp/rc-slot-vol-*/tmp/rc-slot-ws-*' does not
  exist` — the temp workspace repo the test clones from is not there) and 1 in
  `dev-pane.test.ts` (the process-group kill does not reap in this sandbox).
  Confirmed on a single targeted run of just those two files; my whole diff is
  `apps/web` only, so it cannot reach them. `bun run typecheck` is clean and the
  entire `apps/web` suite is green (70 files, 1088 tests).

## Left undone

- The next-step bar's own review row still does not carry the freshness stamp;
  only the merge dialog and the strip do. Ticket 5/7 territory, not asked here.
- `statusChips` still builds its own lap label beside `lapChip`'s — two lap
  labels for one fact, inherited from tickets 5/7. Worth collapsing when
  something else touches that seam.
- The shipped strip fetches findings and the spec doc; the review page fetches
  the same keys. They share query keys so it is one fetch per key, but a shipped
  feature is terminal and could be served from a single cached read.
- Drive machinery: this ticket adds no service, env var, seed or process, so
  `.runcastle/drive-setup.ts` / `drive-stop.ts` needed no edit. I confirmed both
  files exist; I did not run them (no services in this sandbox).

## 12. Web: run view rebuilt lanes-first — per-lane transcripts, badges and motion, waive and continue, confirms, stopped state, verdict strips, fix-wave and lap grouping; run CSS deleted

# Ticket 12 — the run view, rebuilt lanes-first

## What was done

`RunBody` is now a lanes-first page: a `RunHeader` (runHeadline's honest counts, elapsed,
run status, Cancel run on the foundation `Dialog` stating the blast radius) over the lanes,
with the run timeline and the run digest collapsed underneath. The lanes|stream split and
the shared Agent/Events tab pane are gone — each lane expands in place to its own events
boot narrative while the container comes up, then its agent transcript, and a failed lane's
expansion opens on `verdictStrip()` with the raw engine error behind a `<details>` and a
hint line when the cause is recognised.

New `components/run/`: `Lane` (all state visuals — burning pulse + elapsed, done settle +
short-sha chip, failed red, stopped amber, waived muted, launch-failed distinct — plus the
runtime icon, model badge, review/verification badges, the conflict card and the actions),
`RunLanes` (lap grouping via `LapSections`, then the review-fix / verification bands),
`RunHeader`, `LaneTranscript` (the old `AgentTranscript`, deleted, restyled on the tokens
and gaining decision 13's hygiene), `RunTimeline`, `ConfirmDialog`. Retry fresh and Cancel
run both confirm through that one dialog; no native `confirm()` is left. Waive sits beside
Retry / Retry fresh on failed and stopped lanes and goes through `ticket.cancel`; Stop
ticket stays one click.

Derivations added to `feature-ui/run.ts` beside ticket 5's: `laneBands` (the wave/verification
grouping), `laneFacts` (per-lane `hadOutput` + start time from the feed, in one pass),
`soloRetrySeq`, `repoRelativeLine`, `reportedComplete`. `resolveImplementation` gains
"Continue to review" as a secondary once every lane is terminal and one landed.
`TicketKindChip` learned to say `verification`; `icons.tsx` gained `IconClaude`/`IconCodex`.
`test/run-lanes.test.ts` is tier-1 across the lane states, bands, lap dividers and header
copy; `feature-ui.test.ts` covers the resolver. The whole `PHASE BODY — run` section of
`styles.css` (235 lines, including every `.agent-*` rule) is deleted and the ratchet lowered
to the measured 3102 in the same commit.

Two deviations worth naming. The ticket sketched the band/lap layout inline in `RunBody`;
it moved to `RunLanes` so it could be statically tested (the acceptance criteria ask for
tier-1 coverage of the wave grouping and the lap divider, and nothing inside `RunBody` is
reachable from a tier-1 test). And decision 13(a)/(b) — the protocol marker and the
repo-relative tool paths — are applied in `LaneTranscript` even though only 13(c) is named
in the ticket's context: ticket 5 landed `stripProtocolTokens` and `repoRelative` with no
consumer anywhere, and this is the only transcript renderer in the app.

## Surprises

- `hadOutput` (what `laneState` needs to call a failure a launch death) has no ticket-row
  source. It is derived from the event feed: a lane with `burn.text`/`burn.tool` had output,
  a lane with only `burn.setup` and a git/docker error did not. `soloRetrySeq` is derived
  the same way, from the `ticket.retry` event plus the shape of the run, because
  `retryTicket` emits that event *before* the burn exists and so it carries no `runId`.
- `styles.css` also holds the `@keyframes` the new components animate on (`pulse`, `fadeUp`,
  `spin`) — they live in the unowned ANIMATIONS section, which this flow adopts on a *later*
  ticket, so the run surface's own rules could go while the keyframes stayed.
- The stated verify baseline is stale: it says 118 files / 1768 tests fully green, and the
  repo now runs 182 files / 2866 tests. Two server test files fail in this sandbox and
  neither is touched by this diff (which is `apps/web/**` only):
  `burn-slot-workspace.test.ts` composes container-mount paths from `os.tmpdir()` and fails
  under this container's `TMPDIR=/home/agent/cache/tmp` — it passes with `TMPDIR=/tmp`;
  `dev-pane.test.ts` asserts a process group is reaped after a kill, which this sandbox does
  not do, and it fails under either TMPDIR. Final numbers: `bun run typecheck` clean;
  `TMPDIR=/tmp bun run test` → 1 failed (dev-pane) / 2861 passed; the full `apps/web` suite
  → 59 files, 956 tests, all green.

## Drive machinery

No change needed and none made: this ticket adds no service, no boot-time env var, no seed
and no companion process — it is a web-only redesign. I checked that `.runcastle/drive-setup.ts`
and `.runcastle/drive-stop.ts` (the two scripts the configured drive commands invoke) exist
and are untouched; I did not run them, per the standing instruction.

## Left undone

- Decision 15's success landing (the all-green beat before the auto-advance to review) and
  15(b)'s navigable run record behind the status bar's "N runs" counter — neither is in this
  ticket's decision list or acceptance criteria.
- Decision 16(b)'s data-informed time expectation ("tickets have been taking ~2 min each")
  belongs in the next-step bar's pre-burn copy, not the run header; 16(b) is not in this
  ticket's list, so `resolveImplementation`'s Burn copy is unchanged.
- The confirm dialogs are covered only by the presence of their triggers. `Dialog` portals
  to `document.body`, so an *open* dialog cannot be rendered by a tier-1 test; asserting its
  copy would cost a tier-2 DOM file, which decision 36 does not spend on this surface.
- `RunBody` still carries two legacy class hooks that are not this ticket's to delete:
  `surface` (workspace section) and `tickets-session` (grill section).
- `components/run/` is not listed in `apps/web/STYLE.md`'s concern-modules table; adding it
  is a one-line doc edit for whoever next touches that file.

## 13. Web: run history and settle — navigable run records, success settles before advancing, transcript hygiene, data-informed burn copy

# Ticket 13 — run history, the success settle, transcript hygiene, burn copy

## What was done

**Server.** New `services/runs.ts` reconstructs any run's lanes with no new persistence:
the events a run emits already carry its `runId` and a `ticketId`, so `runTicketIds` reads
the join back off the feed and `runLap` takes the lap off the run's first event.
`run.listByFeature` returns `{id, status, startedAt, endedAt, lap, ticketIds}[]` newest
first; `run.get` now returns the run row **plus** `tickets` (its own ledger rows, by `seq`)
— additive, so every existing field still reads the same. `tickets.ts` gained `listByIds`
and `ticketDurationStats`, and `ticket.durationStats({projectId})` exposes the latter.
`packages/server/test/run-history.test.ts` covers both through the tRPC caller.

**Run record (decision 15b).** A new `run/RunPicker` disclosure ("3 runs ▾", each row age ·
status · `Lap N · X lanes` · "latest") hangs off `RunHeader`; picking a non-latest run puts
`RunBody` into record mode — lanes read from the run instead of the feature's ledger, every
control withheld (`frozen = readonly || record`), `run.get` and the transcript stop polling,
and "Back to latest" returns. Each lane's expansion gained `run/LaneDigest` (the burner's
own account, collapsed) above the transcript, which already renders the honest
"transcripts are held in server memory for the current burn" note when the server no longer
has one. `runHeadline` now takes the run's status: past tense over a stopped run, and
"All N tickets landed ✓" when a succeeded run's every lane landed.

**Success settles (15a).** `lib/use-success-settle.ts` returns the id of a run it saw
*running* and then *succeeded*; `Workspace` holds only the body swap for `SETTLE_MS` (900 ms)
on that signal, so the lanes play their done-settle under the all-green header before the
review page renders. No click added; a run already finished at mount is never held, because
the hook never watched it run.

**Transcript hygiene (13a–b).** Already applied by ticket 12 inside `LaneTranscript`, but
only reachable through the component. Its block model moved out to `feature-ui/run.ts` as
`transcriptBlocks`, so the marker-becomes-UI rule and the repo-relative path rewrite are
now covered at a seam. `<promise>COMPLETE</promise>` is the only protocol token the burner
prompts define (grepped all five under `packages/skills/burner/`).

**Burn copy (16b).** `burnExpectation(stats)` in `feature-ui/run.ts` renders the project
median coarsely ("~2 min", "under a minute", "~1.5h"); `resolveImplementation` appends it
via a new `NextStepContext.burnStats`, fed by a non-polling `ticket.durationStats` query in
`Workspace`.

Tests: `apps/web/test/run-record.test.ts` (tier 1: picker, record header, terminal lane with
its digest, transcript hygiene), `run-settle.test.ts` (tier 2, one DOM: the hook's timer and
the all-green headline), plus additions to `flow-derivations.test.ts` and `feature-ui.test.ts`.

## Deviations

- **Where the runs counter lives.** The ticket said to grep for an existing feature-level
  "N runs" counter and, failing that, to put a link on the stepper's implementation step.
  There is no such counter anywhere (the status bar dropped its per-project one, and
  `PipelineStepper` has none). I put it in `RunHeader` instead of `PipelineStepper`: it is
  this flow's own file rather than the shell's, it is statically testable as the criterion
  requires, and history is still reachable from later phases because clicking the stepper's
  implementation step renders `RunBody` read-only.
- **What a duration is measured from.** The ticket suggested `ticket.started` event ts →
  `completedAt`. There is no `ticket.started` event (the burner emits `ticket.burning`), and
  the ledger's honest per-execution span is `ticket.timing`'s `wallMs`, which the web's own
  `ticketDurations` already prefers — so `durationStats` medians the last `wallMs` per done
  implementation ticket. Failed lanes and review passes are excluded (a failure measures how
  long it took to give up; a review is different work from what the human is about to burn).
- **The expectation appears on both roads into a burn** — the first Burn and Resume burn —
  not only the first. Both are pre-burn states answering the same question; putting it on
  one would leave the bar inconsistent.

## Surprises

- `run.agentTranscript` polls at 1 s unconditionally, which a run *record* would have paid
  forever for output that can never arrive; `LaneTranscript` gained a `poll` prop rather
  than leaving that standing cost in a history view.
- The SSE push allowlist in `lib/live.ts` invalidates `run.get` by name, so the new
  `run.listByFeature` needed its own line — otherwise a burn that starts mid-session would
  not appear in the counter until the 30 s fallback poll.
- `useEventLog` fetches a feature's events from id 0 on mount, so a past run's timeline and
  per-lane facts (`laneFacts`, `ticketDurations`) work in record mode with no new query.
- The stated verify baseline is stale (it says 118 files / 1768 tests). The repo now runs
  189 files / 2923 tests. Final: `bun run typecheck` clean; `TMPDIR=/tmp bun run test` →
  **1 failed / 2918 passed** — the failure is `packages/server/test/dev-pane.test.ts`
  asserting a process group is reaped after a kill, which this sandbox does not do. It is
  untouched by this diff and was already reported by ticket 12. `burn-slot-workspace.test.ts`
  passes under `TMPDIR=/tmp` (it composes container mount paths from `os.tmpdir()`).

## Drive machinery

No change needed and none made: this ticket adds no service, no boot-time env var, no seed
and no companion process — two read-only tRPC procedures and web rendering. I checked that
`.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` (the scripts the configured drive
commands invoke) exist and are untouched; per the standing instruction I did not run them.

## Left undone

- `components/run/` is still not listed in `apps/web/STYLE.md`'s concern-modules table, and
  it now holds two more files (`RunPicker`, `LaneDigest`). Still a one-line doc edit for
  whoever next touches that file.
- The run record renders a lane's transcript only while the server still holds it. Decision
  15(b) explicitly rules out new persistence, so an older run's transcript stays gone; if
  that turns out to matter, the events feed is where a durable one would have to come from.
- `ticket.durationStats` does not poll and is not on the SSE invalidation allowlist, so the
  median only refreshes on remount. Harmless today (the phase leaves implementation the
  moment a burn ends) but worth knowing if the bar ever shows it mid-burn.
- The lap a run is stamped with comes from its first event's `lap` column. A run whose
  feature changed lap mid-run would report the lap it started in; nothing today does that.

## 14. CSS: adopt and migrate the six orphan sections (ATOMS, MARKDOWN, DOC PEEK, ERROR BOUNDARY/TERMINAL, TOASTS, ANIMATIONS); ratchet to the remnant

# ticket(14) — the six orphan sections, and the ratchet down to the remnant

## What was done

All six unowned `styles.css` sections are gone. **ANIMATIONS**: the keyframes moved to
`theme.css` at the *top level*, not inside `@theme` — Tailwind emits a `@theme` keyframe only
when an `--animate-*` utility naming it is used, and most of these are named from rules
Tailwind never reads (surviving legacy sections, and the `animate-[fadeUp_…]`/`popIn`/`spin`
arbitrary values tickets 7–13 already wrote). Four `--animate-*` tokens cover the surfaces
that migrated; the reduced-motion switch moved with them; `lineIn` had no caller and is gone.
**ATOMS**: `btn-xs` became a real `size="xs"` on `Button` (19 call sites), the five raw
`.btn` markup buttons became `Button`s, `.spin-ring` became a `Spinner` primitive with its
three sizes collapsed to two, and `.mono` was simply deleted at 108 of its 110 sites because
`font-mono` was already beside it — the other nine now say it themselves. `.chip`, `.tag`,
`.dim`, `.dim-line`, `.section-title`, `.ghost-link` went the same way. **MARKDOWN** became a
class list per element in `Markdown.tsx`, handed to react-markdown's `components` map, with
the record exported so `markdown.test.ts` can hold it the way it already held the policy.
**DOC PEEK** collapsed into `Dialog size="lg"` plus utilities; **ERROR BOUNDARY / TERMINAL**
was one rule for a live fallback and a placeholder that no longer exists; **TOASTS** turned
out to also contain the app frame and the whole update banner, so those migrated too.

`styles.css` is 2635 → **2212** lines and `STYLES_CSS_LINE_BASELINE` matches. STYLE.md's
Ratchet section now carries the inventory the next flow needs: every remaining banner and
whose it is. The file, the alias block, the hook classes and the ratchet test all stay — none
of the remainder is this flow's.

## Surprises

- **The remnant here is roughly twice what the spec predicted, and that is expected.** The
  spec measured `styles.css` on main (2313, remnant ~1180). This branch is ~48 commits behind
  main, so it still carries SHELL FRAME, SIDEBAR, WORKSPACE, INSPECTOR RAIL, STATUS BAR and
  COMMAND PALETTE — sections `flow-redesign-project-shell-and-navigation` already deleted on
  main. The ratchet is set to what this branch measures (2212); **whoever merges main into
  this branch must lower it again**, and STYLE.md says so.
- **No visual eyeball was possible.** This sandbox has no browser — no Playwright, no
  Chromium — so acceptance criterion 2's "checked in the running dev app" could not be done as
  written, and I am not claiming it was. What I did instead: `vite build` and `vite dev` both
  run clean, and I grepped the emitted CSS to confirm every migrated surface's utilities are
  actually generated (a real failure mode — a class the scanner cannot see produces nothing).
  Confirmed present: `animate-toast-in` / `-backdrop-in` / `-overlay-in` / `-dot-glow`; all
  ten keyframes including `popIn`, `fadeUp` and `spin`; the `prefers-reduced-motion` block;
  Markdown's `[&>*:first-child]:mt-0`, `[&>code]:bg-transparent`, `marker:` and
  `accent-accent`; the Button `h-5.5` and Spinner `size-2.5 border-[1.6px]`; DocPeek's
  `max-h-[82vh]` and `backdrop-blur`; the update banner's `size-1.75` and `select-all`.
  Someone with a browser should still look at those five surfaces.
- **Three tests pinned Markdown's output as unclassed tags** (`<h2>Scope</h2>`) — they now
  assert `>Scope</h2>`, which is what they were about (rendered, not literal).
- **The type ramp moves under the prose.** Deleting `.mono` and `.md` lets the utilities
  underneath finally apply: 12.5/11.5/10.5px become the theme's 12/14/11. That *is* the
  migration rule working, but it is the most visible change in the diff and it touches every
  surface, not just this flow's.
- **The 8 failing server tests are the same environmental ones tickets 9, 10 and 11 each
  reported** — `burn-slot-workspace.test.ts` (7, "fatal: repository … does not exist") and
  `dev-pane.test.ts` (1, a process-group kill that does not reap here). My diff touches zero
  files under `packages/` (`git diff --stat <base> -- packages` is empty). Everything else is
  green: 198 files / 3072 tests, `bun run typecheck` 0 errors, all 75 `apps/web` files pass.
  The prompt's stated baseline (118 files / 1768 tests, fully green) is stale on both counts.

## Left undone

- `.tag.is-draft`, `.nextstep-spin` and the two `.spin-ring` size overrides were in *other*
  flows' sections but died with the atoms they modified, so I deleted them rather than leave
  rules naming a class nothing emits. If that reads as reaching into another flow's section,
  it was four lines and each was provably dead.
- `PHASE BODY — review + shipped` still exists as a 36-line banner, but nothing in it is this
  flow's any more (preparation's dry-run pulse, the grill terminal's height, DraftBody's base
  select). Renaming the banner honestly would help the next reader; I left it because the
  ticket asked for six named sections and this is not one of them.
- Two spinner sizes now do the work of three: the sidebar's feature chip had a 9px ring, and
  it takes the 10px `sm` one. Invisible at that scale, but it is a change.
- Drive machinery: this ticket adds no service, env var, seed or process — it is CSS, web
  components and one docs edit. `.runcastle/drive-setup.ts` and `drive-stop.ts` needed no
  change; I confirmed both files exist and did not run them (no services in this sandbox).

## 15. Review: drive the redesigned build → review → annotate → triage → lap → merge loop end to end

Reviewed in Drive mode: walked the managed app against the acceptance criteria.

This lap is intended to turn build, review, iteration, and shipping into one evidence-first flow.
The integrated result is described as putting a large walkthrough and Open app stage first, with current status and open work beneath it and long accounts collapsed.
It also adds keyboard playback, multi-tool annotations, evidence-forward notes, screenshot capture during a test drive, and one Iterate door for triage and the next lap.
Run pages are intended to lead with honest per-ticket lanes, while conflict-aware merge confirmation and a read-only shipped record close the loop.
The managed app booted and the walkthrough recording succeeded.
However, the prescribed scratch project opened with no features, so none of the review, run, annotation, triage, verification, conflict, merge, or shipped states were reachable.
The fixture README and seed named by the ticket are absent from the feature checkout, leaving no approved state to load into the per-branch drive database.
I did not invent a replacement environment because that would not represent the app and data setup the human is meant to review.
The recording therefore documents the fixture blocker rather than the redesigned flow.
The delivered behavior remains unverified in-browser until the fixture is restored or the managed drive is seeded with its shipped, in-review, burnable, and recorded examples.
