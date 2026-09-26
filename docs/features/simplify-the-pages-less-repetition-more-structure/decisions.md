# Decisions — Simplify the pages: less repetition, more structure

## 1. Lap 1 is the whole feature page, all four states, both complaints
**Decision:** Lap 1 covers the feature page in planning, building, review and shipped, fixing both redundancy (one statement per fact) and structure (a clear hierarchy per state). The "burn page" and "review page" are not separate routes: they are the feature page's building body (`RunBody`) and review body (`ReviewBody`), so both are in scope. Settings, home and the project pages are parked in the spec's `## Later laps`. So is the sidebar row's layout; its count definition changes here (decision 2).
**Why:** The phases share components, so doing one phase alone would leave the page inconsistent, and the page is small enough for one lap. A thinner shipped/review-only lap was offered and declined.

## 2. One ticket count, one definition, everywhere
**Decision:** "The ticket count" means this lap's work tickets, landed of total. The review ticket is never counted (it is the review pass and shows as review, not work). Cancelled/waived tickets leave the total and appear as a separate "W waived". Every surface that shows a count uses this one definition: summary row, header meta, Tickets tab, ledger meta, run header, burn bar, sidebar row. The sidebar row becomes this-lap progress, not an all-laps total; earlier laps' totals live in the lap trail.
**Why:** Today about six formulas disagree (review in or out, cancelled in or out, lap or all laps). That is why a shipped page reads "1 of 1 landed" next to "2/2 done". A burn that has finished its work reads "3 of 3" while the review runs; that wait shows as the review in progress.

## 3. The Review row owns the current lap's verdict; the trail owns history
**Decision:** The summary's Review row states the current lap's verdict and freshness together ("Verified · gates mode · this build", "Unverified · nothing verified", amber "Verified 2 laps ago · 3 landed since"). The current lap's trail entry drops its verdict/mode, keeping time, the one-line account, defect/note counts and the work-ticket rows. Earlier laps keep their verdict on their trail line. The review pass is no longer listed as a ticket row. A lap with more than one pass shows one compact row per pass, keeping the recording link. The "nothing verified" warning at the top stays.
**Why:** Today the verdict shows up to three times and can contradict itself (the Review row reads freshness only, so an unverified lap says "Reviewed · this build" while the trail says "Unverified"). This keeps review-as-a-lap-trail d4 (all laps visible), d5 (a row per pass, recording link) and d3/d5 (unverified reaches the top and the history).

## 4. The Checks row and the Check details disclosure go
**Decision:** Remove the "Checks P of T" summary row and the "Check details" disclosure from the review and shipped states. Each of their facts keeps exactly one home: review findings/verdict in the Review row (decision 3) and open-work count; tickets in the Tickets row (decision 2); run status in the Burn row; commits in the merge dialog, which already shows "N commits · M files". A check that is not fine stays loud in its owning row (failed ticket → Tickets row red, no review ran → Review row amber, failed run → Burn row red). The merge dialog's own checklist is unchanged.
**Why:** Every Check details row restated another row, some with a wrong formula. The shipped findings count summed all laps, which is what made a clean lap read "2 of 3 passed". "Checks P of T" was a tally of repeats. No prior decision created Check details by name; it was flow d18(b)'s "disclosure into its section", and the sections now own their facts directly.

## 5. The lap trail becomes a timeline, oldest first
**Decision:** Each lap reads top to bottom in the order things happened, as a vertical timeline with a connecting line. Review and verification passes are milestone nodes (bigger marker, verdict tone, what they found or confirmed, the Recording button). They stand out and are never styled as ticket rows. Work tickets are compact indented rows under a "Burned N tickets" node, or "Burned N fixes" when burned after the lap's first review pass. That split is read from position (burned after a pass), so no new data is needed. The lap heading carries the lap's verdict; for the current lap the verdict lives in the Review row (decision 3), so its heading shows only the time. The "account line" that merely restated the pass name goes; the pass node carries the pass's own one-line account. Earlier laps sit above in the same trail, each collapsed to its heading line (verdict + counts) and expandable.
**Why:** The newest-first flat list sorted by ticket number hid the lap's story (work → review → fixes → verification). The human never found it easy to understand, and the review/verification tickets looked like any other row. Collapsing earlier laps knowingly bends review-as-a-lap-trail d4 ("all laps visible, nothing collapsed"): every lap stays visible as a heading line with its verdict, only the detail folds.

## 6. Five smaller repeats are cut
**Decision:**
- (a) The summary's **Laps** row goes. The header's "Lap N" (lap > 1) and the trail headings already say it.
- (b) The shipped **Walkthrough "None recorded"** row goes. The walkthrough stage appears when one exists.
- (c) **Full account** stops listing the review pass's own ticket digest. The lap write-up and the work tickets' digests stay; the timeline's pass node carries the pass's one-line account.
- (d) A **failed run's summary** is said once, on the next-step bar. The run header shows only the red Failed status.
- (e) In planning, the **header meta drops its ticket count**. The ticket ledger's own count line, next to the tickets, is the one.
**Why:** Each fact already had another home on the same screen. DESIGN.md principle 5 ("say it once").

## 7. One four-tier skeleton for every state
**Decision:** Every state lays out in the same order:
1. **Now:** header (title, meta line, stepper), the next-step bar, any alerts (conflict, nothing verified, live session…).
2. **Status:** the trimmed summary rows (Review, Tickets, Test drive, plus Burn on the review page).
3. **Work:** the one big section the state exists for. Planning: grill panes or the ticket list. Building: the run lanes. Review: the evidence stage, then open work and carried findings. Shipped: the walkthrough stage and the outcome doc.
4. **Reference:** lighter weight, same in every state that has it: the lap timeline, "Questions asked" as a collapsed disclosure with its count, "How to drive this app", Full account, "Deferred to a later lap".

The Work tier keeps a real section heading. Reference is introduced by a quiet tertiary label (e.g. "History" above the timeline), and its disclosures are plain rows. Nothing there carries a heading as heavy as the Work tier's.
**Why:** Today every section has the same visual weight ("Lap 1" and "Questions asked" are as loud as the main work), so nothing says what matters in the current state. Collapsing Questions asked still honours flow d33(b): no row disappears, they are one click away. Planning and building already roughly follow this order; review and shipped move most.

## 8. Test drive and open work each get one definition
**Decision:**
- (a) **Test drive** reads as "test-driven on lap N (the latest one that was)". If N is not the current lap it is amber "Lap N · not since"; if no lap was ever driven it is "Not run". The shipped summary row and the merge dialog use the same formula.
- (b) **Open work**: the next-step bar keeps its "N defects · M notes open" count. The Open work section heading drops its own "N open" and keeps only "K being fixed", the one thing the bar does not say.
**Why:** The shipped row (latest lap) and the merge dialog (any lap) could contradict each other after an undriven lap 2. The bar and Open work cut one query two ways, so they read as different numbers. review-arrival-is-legible d3 keeps the bar's count always visible, so the section yields.

## 9. The mockup settles the per-state fill-ins
**Decision:** `prototypes/feature-page-states.html` (7 states) is the visual reference for lap 1, and the human approved it. Its choices beyond decisions 1–8 are locked:
- (a) **Building** gets the same Status tier as review (Burn, Tickets, Review rows). The run header keeps only the live lanes; status and elapsed time live in the Burn row.
- (b) **Planning** has no Status tier and no Reference tier, since nothing has run yet.
- (c) **Shipped**'s Work tier is headed "What shipped" with the Outcome doc button beside it.
- (d) **When nothing was verified**, the warning says it once. The next-step bar drops its "Nothing was verified this lap" line and only offers the next action.
- (e) The timeline's look (milestone discs with a toned fill, ring nodes for burns, a `border-strong` connector) is new but built from existing tokens. It is built as a primitive in `src/ui/`, per STYLE.md.

Invented mockup content (lap 2, note/defect text, the grilling bar copy) is illustration only, not a requirement.
**Why:** The mockup surfaced gaps the grilling did not settle and two repeats the earlier decisions left. The human reviewed all seven states and approved.

## 10. Later laps
**Decision:** Parked for after lap 1 proves the approach: settings, home and the project pages, the sidebar row's layout (only its count changes now), a redesign of the "Questions asked" panel (already deferred by one-chat-per-feature), and the merge dialog's layout (only its test-drive formula changes now, 8a).
**Why:** The brief scopes lap 1 to the feature page. The human confirmed this list.
