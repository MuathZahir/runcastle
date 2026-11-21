# Building starts without a plan approval

## Problem

Every feature today stops for the human's yes to a drawn Plan before anything is
built, whatever its size. A one-line fix pays for a plan page, a Plan tab visit and
a wait. The audit behind ADR-0023 found this fixed cost is a large part of why
30-minute features took hours.

## Approach

From the user's side: a lead asks only what is the human's to decide (decisions
file, numbers 1 and 5). When nothing is open it writes a few lines saying what it
will build and who builds it, and starts. Designs still wait for their approval
(2). The Plan tab and its chat card go (3); the docs are read in Details → Docs (4).

The approval exists only in words and in the Plan's UI: no server guard blocks a
lead from building before a yes. So the work is three removals and a rewrite.

**The lead's instructions (skills pack, feature skill).**
- `SKILL.md`: rule 6 becomes "ask only when a decision of the human's is open; else
  play back in a few lines (what, who builds what, the review) and build". It keeps
  "each design needs its own approval". Rule 11 drops "the plan's yes" from what
  goes to the epic (7). The link rule stops naming `feature:<slug>/plan`.
- `references/preview.md` becomes a short page on the optional plan page: when to
  draw one, the same single inline file and starter, shown with `show_file`, never
  a gate. The "Show it, then get the yes" section and "the yes is still needed"
  go. The starter's Check-first group stays: it still serves a planning run.
- `references/planning-alone.md`: the ending follows decision 5. List the assumed
  decisions (check-first first) and ask to change any or say go, with
  `wait_for_you`. With none assumed and no design waiting, play back and build on.
  Drawing the Plan becomes optional. `show_plan` goes; designs keep `show_design`.
- `references/design.md`: the "they say yes to the plan" paragraph becomes "an
  answer to your questions does not approve a design".
- `references/decisions-and-spec.md`: "redraw the Plan" applies only when a plan
  page exists.
- The project and QA skills and the worker link rule stop naming
  `feature:<slug>/plan`. The pack README's line on planning-alone is updated.

**Server.**
- The `show_plan` tool goes, for leads and the orchestrator. Its pre-allow in the
  launch settings goes with it.
- The descriptions of `start_worker` ("on the human's yes") and `hand_back`
  ("plans … for a yes") drop the plan.
- The planning run's prompt (the purpose line and the self-plan kickoff) asks for
  decision 5's ending, not "the human's yes". The run's "complete" check keeps
  working: a run that ends asking still ends on a wait. A run that built on ends
  with no wait. Today that reads "planning stopped before the plan was complete",
  so the message changes to "planning finished" whenever the run committed work
  or ended waiting.
- The plan's shown/seen record goes: the two columns on features (one new
  migration drops them), marking a plan shown or seen, the `plan.shown` /
  `plan.seen` events, the plan figures and `plan.isNew` in the designs list, and
  the `planSeen` mutation.
- Old `plan_shown` thread events stay in stored threads. The thread model turns
  them into an ordinary shown-file card for that feature's `preview.html` (6).
  `show_plan` leaves the talk-only tool list.

**Web app.**
- The Plan view goes from the panel: its view name, label, icon and unseen dot;
  the Plan body (Overview / Decisions / Spec); the plan card in chat; the
  "Preview ready" and "Spec written" chat notices that open it; the phone's Plan
  screen. `NewMark` / `OlderMark` move out of the plan card file first: design
  cards use them.
- Addresses: `/f/<slug>/plan`, the retired `/preview`, and the chat link
  `feature:<slug>/plan` all open the Details view (6).
- The plan-page frame and the full-window preview dialog stay where the file
  viewer uses them; the rest goes.
- Words that promise a plan yes are rewritten: the glossary's "Plan" entry, the
  planning stage's "say yes to its plan", and the "Plan automatically" button's
  hint ("Plans the feature without you, then asks you what it decided").
- Previews (stories) and tests drop the Plan view and plan cards.

**Not changed:** the "Start" / "Plan automatically" choice itself, autopilot's
machinery, the docs the lead writes, and the charter (the orchestrator rewrites
`CONTEXT.md` charter 9 and the "recorded plan" line at merge).

## Seams

- **Server MCP tool list per session kind (existing):** `show_plan` is gone for
  chat and project sessions; tool descriptions carry no plan yes.
- **Launch artifacts and kickoff text (existing):** the planning run's prompt asks
  for decision 5's ending; no "human's yes".
- **Thread model (existing):** an old `plan_shown` event reads as a shown-file card.
- **Panel views (existing, pure):** no feature offers a Plan view; `plan` and
  `preview` addresses map to Details.
- **Database migration (existing migrate-on-boot):** a database with the two plan
  columns boots and loses them.
- **The skills text (existing skill-pack tests, if any):** no "yes to the Plan"
  and no `show_plan` left in the feature, project or QA skills.

No scenario: nothing here is slow to reach. The human checks it by starting a
new feature on the branch's own server and seeing the lead play back and build,
with no Plan tab in the panel.

## Out of scope

- The "how involved am I" setting, and removing "Plan automatically" and
  autopilot: `how-involved-am-i` and the feature after it.
- One file per feature, the review package's "decided without you" list:
  `one-file-per-feature-and-reviews-that-scale`.
- Rewriting the charter: the orchestrator's, at merge.

## Open questions

- Testing the lead's new behaviour needs this branch's skills in a live session.
  Live sessions run the installed runcastle, so the human's drive must start the
  branch's server by hand (or after a publish).
