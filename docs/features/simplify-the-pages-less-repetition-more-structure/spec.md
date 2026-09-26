# Simplify the pages — less repetition, more structure

## Problem

The feature page states the same fact several times, and the copies disagree. A shipped feature reads "Tickets 1 of 1 landed" in its summary, "Tickets 2/2 done" in Check details and "succeeded · 2/2 tickets done" on the Run row. The review verdict appears on the summary's Review row, on the lap line and again as a ticket row. On an unverified lap the Review row still says "Reviewed · this build" while the trail says "Unverified". "Checks 2 of 3 passed" sits above a Check details block that restates it, and it is often amber only because the shipped view sums findings across all laps.

The page also has no hierarchy. Every section (summary rows, "Lap 1", "Questions asked", three disclosures) carries the same weight, so nothing says what matters in the current state. The lap trail is a newest-first list sorted by ticket number, so a lap's actual story (work → review → fixes → verification) is hidden. Review and verification passes look like any other ticket, and the human never found the trail easy to read.

## Approach

Lap 1 reworks the feature page in all four states (planning, building, review, shipped), including its building body (run view) and review body. It is an information-architecture and layout pass. It removes and reorders, adds no new information, and keeps the design system (DESIGN.md, STYLE.md, theme.css) as it is. The approved visual reference is `prototypes/feature-page-states.html` (seven states). Its invented content (lap 2, note/defect text, grilling bar copy) is illustration only.

**Every fact has one owner and one definition.**

- **Ticket count** (d2). There is one definition everywhere: this lap's *work* tickets, landed of total. The review ticket is never counted, since it is the review pass and shows as review. Cancelled/waived tickets leave the total and show as a separate "W waived". Every surface that shows a count uses it: the summary Tickets row, the Tickets tab, the ticket ledger's count line, the run view, the burn bar, and the sidebar row. The sidebar row becomes this-lap progress. The definition lives once, as a pure function shared by the server (sidebar `ticketCounts`) and the web, so the formulas cannot drift again. The pinned-planning banner and the stepper tooltip also read it.
- **Review verdict** (d3). The summary's Review row owns the current lap's verdict and freshness together: "Verified · gates mode · this build", "Unverified · nothing verified", or amber "Verified 2 laps ago · 3 landed since". The current lap's trail entry does not repeat it. Earlier laps carry their own verdict on their trail heading.
- **Checks** (d4). The "Checks P of T" row and the "Check details" disclosure are removed from review and shipped. Each of their facts already has an owner: the Review row, the Tickets row, the Burn row, and the merge dialog for commits and files. A check that is not fine turns its owning row amber or red. The merge dialog's checklist is unchanged.
- **Smaller repeats** (d6, d8, d9d):
  - The Laps row goes.
  - The shipped Walkthrough "None recorded" row goes.
  - Full account drops the review pass's own ticket digest.
  - A failed run's summary is shown once, on the next-step bar.
  - Planning's header meta drops its ticket count; the ledger keeps its count.
  - Test drive has one definition, "test-driven on lap N (latest that was)": amber "Lap N · not since" when N is not the current lap, "Not run" when never. The summary row and the merge dialog share it.
  - The Open work heading keeps only "K being fixed", since the bar owns the open count.
  - When nothing was verified, the alert says so and the bar only offers the next action.

**One four-tier skeleton** (d7), in the same order in every state:

1. **Now:** the header (title, meta line, stepper), the next-step bar, and alerts.
2. **Status:** the trimmed summary rows. Review, Tickets and Test drive on review/shipped, plus Burn on review. Building gets Burn, Tickets and Review (d9a), and the run header keeps only the live lanes. Planning has no Status tier (d9b).
3. **Work:** the one big section of the state. Planning: the grill panes or the ticket ledger. Building: the run lanes. Review: the evidence stage, then open work and carried findings. Shipped: "What shipped" with the Outcome doc button beside it, then the walkthrough stage (d9c).
4. **Reference:** at lighter weight. The lap timeline, "Questions asked" as a collapsed disclosure with its count, "How to drive this app", Full account, and "Deferred to a later lap". Planning has none (d9b).

The Work tier has a real section heading. Reference is introduced by a quiet tertiary label ("History" above the timeline), and its disclosures are plain rows. `statusProperties` stays the tested home of the summary rows' order and wording, and the feature-page skeleton (`FeatureSkeleton`) is updated to mirror the new rows.

**The lap trail becomes a timeline** (d5, d9e), oldest first, with a vertical connector:

- **"Burned N tickets" nodes** (ring marker) with the work tickets as compact indented rows. Work burned after the lap's first review pass reads "Burned N fixes". The split is derived from order (tickets burned after a pass), so no new data is needed.
- **Review and verification passes as milestone nodes** (larger disc with a toned fill in the verdict colour). Each node shows the pass kind, #seq, mode, what it found or confirmed, its one-line account, and the Recording button. A pass is never styled as a ticket row. A lap with several passes gets one node per pass.
- **The lap heading** carries the lap's verdict and counts for earlier laps. For the current lap it shows only the time, since the Review row owns the verdict.
- **Earlier laps** are collapsed to their heading line and expand in place. This knowingly bends review-as-a-lap-trail d4: every lap stays visible, and only its detail folds.
- The timeline is built as a primitive in `src/ui/` from existing tokens (STYLE.md), not hand-rolled in the trail.

Rules from earlier features that stay honoured:

- The next-step bar's open-work count is always visible.
- The Test drive control stays.
- The Agentic review button is present on every review state.
- No Q&A row disappears (it is one click away).
- An unverified lap reaches both the top of the page and the history.
- Merge is never disabled.

## Seams

- **Ticket tally function (new, highest seam).** A pure function in `@runcastle/core` that takes a feature's tickets and current lap and returns `{ landed, total, waived }` for this lap's work tickets. Unit-tested on its own: review excluded, cancelled/waived excluded from the total, other laps ignored. The server's sidebar `ticketCounts` and every web count call it. Check: grep that no count formula remains outside it.
- **`statusProperties` (existing).** The pure builder of the summary rows, per state. Tests observe the exact rows and wording per state: no Checks/Laps/Walkthrough rows, the Review row's verdict+freshness wording including unverified and stale, the Test drive formula, Burn on review/building.
- **Lap trail model (`lapTrail`, existing, reshaped).** Pure. Tests observe per lap the ordered nodes (burn node with its tickets, pass milestone, "fixes" burn node, verification milestone), the fixes split, and heading content (verdict on earlier laps only).
- **Next-step resolvers (existing).** Pure. Tests observe the failed-run summary on the bar, no "nothing verified" subtitle when the alert shows, and counts via the tally.
- **Merge dialog summary (existing, `summary` in feature-ui).** Tests observe the shared test-drive formula.
- **Full account builder (existing).** Tests observe that the review pass's digest is absent and the work digests are present.
- **Component tests (existing tiers, STYLE.md).** The review, shipped, building and planning bodies render tiers in order: no Check details, Reference under its quiet label, Questions asked collapsed with its count, earlier laps collapsed. The new timeline primitive has its own component test.

## Out of scope

- A restyle. Tokens, type ramp and primitives stay. The only new visual element is the timeline primitive, built from existing tokens.
- Loading states and skeleton behaviour beyond mirroring the new summary rows.
- New information, new data or schema changes. The fixes split is derived.
- Pages other than the feature page (see Later laps).
- The merge dialog's layout. Only its test-drive formula changes.

## Open questions

- None blocking. The mockup's invented content (lap 2 tickets, note/defect wording, the grilling bar copy) is not a requirement. Keep the existing copy where the mockup invented it.

## Later laps

- Settings.
- Home and the project pages.
- The sidebar row's layout (only its count changes in lap 1).
- A redesign of the "Questions asked" panel, already deferred by one-chat-per-feature.
- The merge dialog's layout.
