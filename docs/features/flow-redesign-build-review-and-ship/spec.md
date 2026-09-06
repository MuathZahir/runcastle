# Flow redesign: build, review, and ship

> Converged 2026-09-05 from `map.md`, `decisions.md` (1–42), `research/prior-designs.md`
> and `flow-map.md` §A–§G. Decision numbers below are citations into `decisions.md`;
> the spec restates only what a burner needs to build against.

## Problem

The second half of a feature's life in runcastle — burning tickets, reading the
review, test-driving the branch, annotating the walkthrough video, triaging notes
into the next lap, merging past a conflict, reading the shipped record — is the
part the human uses most and trusts least. The walk (decisions 3–5) located why:

- **The annotation loop breaks.** The second pen stroke on a frame crashes the
  whole feature view to the error boundary; a drawing cannot be saved without
  typing; the note field is one line; Escape discards silently; the player has no
  keyboard, no frame step, no loading or error state, and jump-to-moment seeks a
  player that is off-screen. The human's complaint — "doesn't work well and isn't
  very user friendly" — is this loop, and it is the flow's priority (decision 1).
- **The review page is cluttered and vouches with stale evidence.** The video is
  sixth on the page, Open app is below the fold, digest walls open the page, and
  from lap 2 the page presents lap 1's video and "no findings" as the current
  build's state while fix tickets have already changed the app (decision 5).
- **The run view hides its state.** The transcript is blank for the first 15–20 s
  of every lane, leaks `<promise>COMPLETE</promise>` and container paths, a failed
  lane has no exit but retry, cancel-run is one unconfirmed click, a deliberate
  stop looks like a crash, and a successful run vanishes the moment it succeeds.
- **The bar and the cards disagree.** "Merge when it looks right" over a bare
  checkout or a failed drive setup; an all-green merge dialog over a standing
  conflict; a conflict card with a live agent-launching button on a shipped
  feature; an outcome doc dated `Shipped:` before the merge landed; "merged now
  ago".
- **What remains of `styles.css`** (this flow's ~720 owned lines plus ~410 lines
  nobody owns) keeps the pre-Tailwind stylesheet alive on the app's busiest pages.

## Approach

### What the human sees

**Run view (decisions 10–16).** Lanes are the spine. A run header (honest counts:
"Burning 3 tickets · +2 fixes from review — 2 done · 1 stopped", data-informed
time expectation, the run-level control) sits over the ticket lanes; each lane
carries a runtime icon + model badge, a status-driven live animation while
burning, an elapsed timer, a short-sha chip when done, and expands **in place** to
its own agent transcript and events (the boot narrative while the container
starts — never "waiting for first output"). The shared Agent/Events pane is gone;
the Events tab demotes to a collapsed "Run timeline" under the lanes. The review
lane and any verification lane are badged as a different kind; fix tickets minted
mid-run arrive as a grouped "review fixes" wave under the review lane; lanes group
by lap with a divider when the ledger spans laps. Transcript hygiene: protocol
tokens render as an "agent reported complete" marker, sandbox paths render
repo-relative, a failed lane opens on a structured verdict strip, and a lane that
died before first output gets a distinct "launch failed" treatment with the raw
error behind a disclosure and a hint when the cause is known. Exits: per-lane
**Waive** (cancels through the existing cancel machinery; the lane reads as set
aside) and **Continue to review** as a secondary once every lane is terminal and
at least one ticket is done. Cancel run and Retry fresh confirm on the foundation
dialog; Stop ticket stays one click; `stopped` is a neutral/amber lane state,
never red. Success settles (done-settle motion, an all-green beat) before the
auto-advance; the status bar's runs counter navigates to a read-only run record
in the same lanes layout.

**Review page (decisions 17–21, 6).** Five bands, evidence first, prose last:

1. **Evidence stage** — one ~full-width 16:9 stage. By default it plays the
   latest completed review pass's walkthrough with a compact header
   (`Walkthrough · 12:34 · reviewed <sha>` or `Verification walkthrough · 6:10 ·
   confirms 4 fixes · this build`, an "earlier recordings" disclosure listing
   every older recording playable on the stage, and `Open app ▶`). Starting a
   test drive swaps the stage to the drive panel; stopping swaps back. With no
   walkthrough yet the stage is the drive panel with an honest note. Drive
   problems about the stage (setup failed, bare checkout) render in the stage.
2. **Alert slot** — ConflictCard and "Lap N+1 couldn't start" live here, loudest
   thing on the page but never above the stage.
3. **Status strip** — one line of chips: review outcome with its freshness stamp,
   checks, `Lap N · X of Y tickets landed · Z waived`, run/verification state.
   Each chip discloses or anchors into its section.
4. **Open work** — review-agent defects and drive/annotation notes merged into one
   "what still needs attention" section using one row anatomy; a `fixing` defect
   reads "being fixed in the running burn" with a lane link; carried and
   quick-fixed notes sit in a collapsed group beneath, reopenable.
5. **Full accounts** — review digest, burner digests, and the lap account's
   narrative behind a single disclosure.

The standing lap banner, the Summary card, the digest wall, PlannedNextLapCard
and the stretched test-drive explainer all dissolve into this structure.

**Player and annotation (decisions 22–25).** Keyboard-first transport (click/
Space/K toggle, J/L or ←/→ ±5 s, `,`/`.` frame step while paused, `<`/`>` cycle
speed 0.5–2× defaulting to 1.5×, F fullscreen; slider arrows 1 s; hover tooltip
on the scrub bar; no volume). Honest loading (poster + spinner + "Loading the
recording — 21 MB") and error ("This recording can't be played" + path + retry)
states. The stage and its bar fit the viewport as one unit. Annotate is never
disabled: while playing it pauses and opens the overlay in one act. Tools: pen,
arrow, rectangle in one red at ~6 px on-screen; undo/redo/clear; save gated on
*any* content; multi-line textarea (Enter saves, Shift+Enter newline); dirty
discard confirms; the capture path survives arbitrary strokes. The saved
annotation stays one baked PNG on the existing note-screenshot pipeline, and the
note now records which recording it was taken against.

**Notes, triage and laps (decisions 25–28).** Note rows are evidence-forward
(~96×54 thumbnail with an in-app lightbox, timestamp chip that live-seeks only
when its own recording is on stage and reads `0:42 · earlier walkthrough`
otherwise, full text, author chip, lap badge, in-place edit that keeps the
evidence visible, confirmed delete). Jumps are bidirectional and visible. The
scrub bar carries clustered note markers for the recording on stage. Notes accept
a pasted or attached image — one image per note, replace-after-confirm. The bar
offers two forward choices — **Merge & ship** or **Iterate**; "Address notes"
dies. Iterate opens the triage step (skipped when there are no open notes or
defects): the same rows, one **Quick fix** checkbox per row unchecked by default,
a "mark all" affordance, dismiss behind the delete confirm, a live list, and an
honest footer ("2 tickets will mint · 4 notes carried into the lap conversation ·
3 unburned fix tickets from lap 1 will burn with these"). Everything quick-fixed
→ tickets mint and the burn starts with no session; anything carried → the lap
session opens with those notes. Carried notes leave open work at commit. Ticket
titles are the note's first sentence cut at a word boundary. The Burn count stays
whole-feature but labels whose tickets they are.

**Re-review (decisions 40–42, 8, 19).** When a burn's queue drains and any
implementation ticket landed after the last completed review pass in the run (or
with no review pass in the run at all), the scheduler mints one `kind: 'review'`
ticket of `passKind: 'verification'` and admits it through the existing admit
seam; it is the run's last lane. The pass is "tour and verify": in drive mode it
walks every acceptance criterion's surface once at pace while recording, and
spends scrutiny only on the landed fixes; in gates mode it verifies the fix diffs
against their findings and runs the gates once. Mode is inherited from the pass it
verifies. Its defect findings are stored with `openReason: 'verification'` and
never auto-mint fixes. It does not fire when the review itself could not run, nor
when nothing landed after it. No opt-out. The evidence system keys on the most
recently **completed** review ticket across the feature; every evidence surface is
stamped with its moment (`Reviewed ✓ · this build` / amber `Reviewed 2 laps ago ·
5 tickets landed since — evidence may be outdated`); the amber stamp subsumes
"no review ran this lap". A verification that could not run leaves the previous
evidence amber with the reason in the strip.

**Merge, conflict and shipped (decisions 29–33).** The merge dialog derives from
the same conflict truth as the bar: over a standing conflict a red row tops "what
lands", the primary flips to Resolve, and Retry stays enabled. The green case
renders stamped rows (commits · files, tickets with waived/failed amber, drive
taken, review with freshness) plus an exact warnings box (open notes, waived
tickets, standing unburned fixes, stale evidence) and one "what happens next"
line. A successful merge retires the conflict state; the ConflictCard moves to the
alert slot and gains an "ended without landing" state; `relTime` stops saying
"now ago"; the bar's collapse while the card is up is fixed as a bug. The outcome
doc is written **after** the merge, on the base branch, in its own commit, and is
synthesized (header, what shipped per lap, review record with stamps, notes
record, filtered digests) — never the digest wall. `readonly` is a structural
rule of the review layout: no live action anywhere, the stage plays the final
walkthrough with Annotate gone, action cards render historical statements or
nothing. The shipped view keeps a Q&A history where an ended session that
captured no transcript still leaves a row.

### Shape of the build

**Server.**
- The review-artifacts listing and the review outcome carry `lap`,
  `reviewedCommit`, `completedAt` and `passKind: 'review' | 'verification'`
  (decisions 19a, 41b). The review ticket row gains a `passKind` column (default
  `'review'`) and the reviewed commit is recorded when the pass completes (the
  branch head at completion). No generations table, no latest pointer.
- Test notes gain one nullable column binding a note to the review ticket whose
  recording it annotated (decision 22); the wire type exposes it. The note
  screenshot upload route accepts a pasted image for any note (decision 7a) —
  the existing route already does; the composer just uses it.
- The burn scheduler gains one rule at queue-drain (decision 40a) and a prompt
  variant `verify-fixes.md` rendered through the same review executor with the
  landed fixes and their findings (40b); mode inheritance (40c);
  `openReason: 'verification'` (40d).
- One server-computed drive-state value (`idle | starting | serving |
  bare-checkout | setup-failed | review-agent-driving`) on the drive-info query
  (decision 20).
- `feature.merge` retires the conflict on success (decision 30a), then writes and
  commits the synthesized outcome doc on the base branch after the merge commit
  (decision 32) — the outcome composer becomes a synthesis over stamped review
  data, notes and filtered digests. `git diff --stat` file count feeds the dialog
  (31a).
- Quick-fix promotion (`promoteMany`, `promoteOpenDefects`, the new triage
  commit) never appends a review ticket itself — decision 40's end-of-burn rule
  is the mechanism for decision 26(e)'s invariant.
- An orphaned/cancelled fix ticket mirrors onto its finding so the defect
  returns to open work (research still-open 2). Findings order is stable
  (`createdAt`, then `seq`/id). The triage commit moves carried notes to a
  `carried` state with the lap it went into (decision 27b); the notes service
  adds `carry` / `reopen` beside the existing lifecycle.
- The run record (decision 15b) is a read of what the events table and run rows
  already hold; the runs counter needs a runs-by-feature query.
- Tidiness in touched files: walkthrough and feature-listing URLs spelled once in
  core routes; attachments-dir pattern spelled once; dead pass-throughs and
  imports removed; findings and notes queries stop polling outside review;
  `AUTO_FIX_CAP` spelled once; SPEC §15.6 amended to the built shape.

**Web.** `ReviewBody` becomes a ~150-line orchestrator (queries, band layout,
readonly gate) over a new `components/review/` module — `EvidenceStage`,
`StatusStrip`, `OpenWork` + `NoteRow`, `NoteComposer`, `ConflictCard`,
`FullAccounts`, `TriageStep`, `AnnotationOverlay` beside `WalkthroughPlayer`
(decision 34); `AddressNotesDialog` dies. RunBody is rebuilt lanes-first, moving to
`components/run/` if it crosses ~600 lines. Nine derivations land as pure
functions with plain unit tests (decision 35): drive-state → bar copy + stage
content + footer chrome (table-driven); freshness stamping; status-strip chips;
timestamp binding; marker clustering; ticket-title-from-note; triage footer
summary; a stroke model (begin/extend/commit, any-content save gate, pen/arrow/
rect geometry) with canvas compositing kept thin at the edge; `relTime`.
Component tests follow decision 36's tiers: tier 1 for the bands, dialog content,
verdict strips and lane states; tier 2 (happy-dom, stubbed media) for the player,
the annotation overlay and the note composer.

**Open-app panel (decisions 39, 17).** The drive panel embeds the dev server in a
plain cross-origin iframe; on the first capture of a drive session it calls
`getDisplayMedia({ preferCurrentTab: true, selfBrowserSurface: 'include' })` and
keeps the stream in a hidden video for the session; drag-select hides the
chrome, grabs the current frame, crops by the `videoWidth / innerWidth` ratio,
and ships the PNG onto the note-screenshot pipeline. Chromium-only; elsewhere,
and when the app refuses to embed, the panel falls back to `Open app ↗` + paste
under the same stage chrome.

**CSS (decisions 37–38).** Each rebuilt surface deletes its `styles.css` rules and
lowers the ratchet in the same commit: PHASE BODY run (including every `.agent-*`
rule), PHASE BODY review+shipped, MERGE CONFIRMATION and the notes-dialog rules.
This flow also adopts the six orphan sections — ATOMS, MARKDOWN, DOC PEEK, ERROR
BOUNDARY/TERMINAL, TOASTS, ANIMATIONS — on its last tickets. Measured at converge
(2026-09-05): `styles.css` on main is 2313 lines; after this flow's owned and
adopted deletions roughly 1180 lines remain (LEGACY ALIASES, LOGO WORDMARK,
WORKSPACE, PHASE BODY grill, PHASE BODY tickets ledger, the settings remnant,
MULTI-PROJECT) — none of them this flow's. So **no file-deletion ticket is cut**;
the last adopting ticket lowers the ratchet to the measured remnant and leaves
the file for its owner per STYLE.md's condition.

**Visual bar (decision 6).** Onboarding decision 1's hierarchy and project-chat
decision 9's spacing rhythm (8 / 16 / 24 / 32 px) apply to every surface here.

### Sequencing gate (decision 38) — checked 2026-09-05

`flow-redesign-project-shell-and-navigation` **is on main** (with preparation,
onboarding, project-chat and settings). `flow-redesign-ideation-through-tickets`
(flow 6) **is not**. This branch is 48 commits behind main. Per decision 38(a) the
tickets are cut now but the burn waits: before Burn, main is merged into this
branch, and flow 6 lands first unless the human decides otherwise. The
MARKDOWN and DOC PEEK adoptions ride the last tickets for the same reason.

## Seams

**Existing seams (preferred; observe here first).**

- **`ReviewTicketArtifacts` listing** (`GET /api/reviews/:featureId`) — gains
  `lap`, `reviewedCommit`, `completedAt`, `passKind`; observe the stamped shape
  and that ordering by completion picks the latest pass.
- **`reviewOutcome` / `reviewChecks` / `reviewWalkthroughUrl`** (web
  `feature-ui/review.ts`) — the "latest completed review" pick plus the new
  freshness stamp; table-tested across lap/commit combinations, including the
  no-review, stale, fresh, verification-running and verification-failed cases.
- **`resolveReview` / `resolveImplementation`** (web next-step resolvers) — bar
  primary/secondary per drive state, conflict, Merge/Iterate collapse, Continue
  to review, labelled Burn counts, time expectation.
- **`mergeSummary`** (web `feature-ui/summary.ts`) — the stamped rows, the
  enumerated warnings box, the red conflict row, the "what happens next" line.
- **`feature.driveInfo` tRPC query** — the single drive-state value.
- **`feature.merge` tRPC mutation + `unresolvedMergeConflict`** — conflict
  retired on success; outcome doc committed after the merge on the base branch.
- **`composeOutcomeDoc`** (server outcome service) — synthesized doc from stamped
  data; unit-tested as a pure composition.
- **Burn scheduler pure units** (`ticket-burner` ready-queue / `admitNewTickets`)
  — the end-of-burn verification rule, tested without sandcastle: fires after a
  landed fix wave, after a batch-promote with no review, not after a failed
  review, not when nothing landed after the review, at most once per run.
- **Review prompt rendering** (`renderReviewPrompt` and the new verify-fixes
  variant) — the landed-fixes block and inherited mode are observable in the
  rendered prompt.
- **Test-notes service + `test-notes` tRPC router** — `videoTimestamp` bound to a
  review ticket; `carry` / `reopen`; promotion titles from the first sentence;
  the screenshot upload route for pasted images.
- **Review-findings service** (`viewByFeature` / `defectState`) — orphaned fix
  ticket returns its defect to open; `openReason: 'verification'`; stable order.
- **`lapAccount` / `lapBanner` → lap chip** (web `feature-ui/laps.ts`) — per-lap
  landed counts excluding review tickets, tense-accurate copy.
- **`relTime`** (`lib/format.ts`, existing `format.test.ts`).
- **`styles-ratchet.test.ts`** — every deleting ticket lowers the constant.
- **Events over SSE** — every new mutation (carry, reopen, verification minted,
  conflict retired) emits and invalidates.

**New seams.**

- **`lib/annotation.ts` stroke model** — pure state transitions for begin/extend/
  commit, tool geometry (pen/arrow/rect), undo/redo/clear, and the any-content
  save gate; the crash class becomes unrepresentable here.
- **`feature-ui/drive.ts` drive-state table** — server value → bar copy, stage
  content, footer chrome, for all six states.
- **`lib/walkthrough.ts` timestamp binding + marker clustering** — note +
  recording-on-stage → `live-seek | orphan-label | png-only`; ~1 s clustering with
  counts.
- **Status-strip chip derivation** — ordered chip list per feature state.
- **Triage derivations** — ticket title from note; footer summary with standing
  debt.
- **Run-view derivations** — lane state (`stopped` from cause strings, launch
  failed vs agent failed), verdict strip text, header counts (including solo
  retry and review-fix waves), lap grouping, transcript hygiene (protocol tokens,
  path rewrite), data-informed time expectation.
- **Component surfaces** per decision 36: tier 1 — StatusStrip, NoteRow,
  ConflictCard, MergeFeatureDialog content, EvidenceStage states, TriageStep,
  RunBody lane states/verdicts; tier 2 — `walkthrough-player`,
  `annotation-overlay`, `note-composer` against stubbed media and canvas.
- **Run record query** — runs by feature with their lanes, for the runs-counter
  navigation.

## Out of scope

- Claude Code's "trust this folder" prompt on spawned sessions (decision 28b).
- Distinguishing text-only from drawn annotations in the list (decision 28c).
- Stroke/vector persistence or post-save editing of annotations (decision 22).
- Multiple images per note (decision 25g); orphan-PNG cleanup on feature/project
  delete; attachments for conflict-resolver runs (decision 9).
- Burner docs wording items (mounted-mode `info/exclude` overstatement, the
  clone-side re-exclude) — docs amendments to the burner, not this surface.
- The empty review-drive database (drive tooling) and the sandcastle Windows
  long-path fix — the UI surfaces a readable launch failure; the fix is elsewhere.
- Deleting `styles.css` itself — the remnant belongs to other flows (decision 37c).
- Flow 6 (ideation/spec/tickets), the shell (flow 2), preparation (flow 4).
- A re-review opt-out toggle (decision 40e); a full second audit pass.
- Firefox/Safari in-panel capture — they get the pasted-screenshot floor.
- New persistence for run transcripts (decision 15b renders what is kept).

## Open questions

- **When to burn.** Flow 6 is not on main. Decision 38 says tickets wait; the
  human decides whether to hold Burn until flow 6 lands or to burn now and take
  the Workspace.tsx rebase. Either way main is merged into this branch first.
- **`stopped` from cause strings.** Decision 12b derives the state from recorded
  cause strings; if implementation finds them unreliable, a small run-lane state
  column is the fallback — the burner reports which.
- **Runs-by-feature query.** Whether the existing run/events routers already
  expose enough for the run record or a thin list query is needed is decided by
  the burner against the routers as they stand.

## Later laps

- Agent-side "the lap session closes the notes it addressed" on top of the
  mechanical carry rule (decision 27b).
- "View in its own recording" as a first-class note action beyond the earlier-
  recordings disclosure (decision 41c lands the affordance; a direct link is a
  later nicety).
- Full-page scroll capture in the Open-app panel (decision 39 captures the
  viewport as seen).
