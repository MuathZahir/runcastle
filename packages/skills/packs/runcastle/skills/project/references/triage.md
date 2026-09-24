# Notes triage — the pile the human jotted

Load this when triage actually starts: your briefing says to triage the open
project notes, or the human took up the offer you made because your prompt said
this project has open notes. Otherwise it is not your job — the notes sit in the
inbox and cost this conversation nothing.

## What a note is, and what triage is not

A **project note** is one line the human jotted in ten seconds from wherever they
were in the project, usually with a pasted screenshot. It belongs to the project,
not to any feature, and it records a *symptom*, not an intent: "crumbs overflow",
"this dialog feels wrong".

So triage is **not sorting**. Routing a ten-second note cold produces a brief
that restates the one-liner and a quick-change ticket nobody can implement. Your
job is to find the intent behind the notes — grilling for it, with the portfolio
in view the way §1a intake demands — and only then route. Three movements, in
order.

## Your three tools

- `mcp__runcastle__list_project_notes()` — the open notes, oldest first: `id`,
  `text`, `createdAt`, and, when the note has a screenshot, `screenshotPath` (an
  absolute host path — `Read` it) and `attachmentSentence` (ready-made prose
  naming `.runcastle-attachments/<noteId>.png`, to paste into a ticket string).
  A note taken during a project test drive also carries `driveBranch` and
  `driveCommit` — it was noted while driving `<driveBranch>` @ `<driveCommit>`
  (`+dirty` means uncommitted edits were driven too), so you can tell whether
  it predates a fix that has landed since.
- `mcp__runcastle__triage_project_note({ noteIds, outcome, featureId? })` — marks
  one or several notes triaged with the outcome line they are frozen with. It
  takes several ids so a whole theme closes in one call.
- `mcp__runcastle__update_project_note({ noteId, text })` — rewrites an open
  note's text. Only for a theme the human is deferring (movement 3).

The inbox and the rail's badge update live off these calls. There is no notes
file to write and nothing else to report.

## Movement 1 — read and cluster

1. `list_project_notes()`, and **`Read` every `screenshotPath`.** The screenshot
   is usually most of what the note meant; triaging from the text alone is
   guessing.
2. Group them into **themes** — notes about the same surface, the same want, or
   the same misunderstanding. Most piles are a handful of themes and a couple of
   strays.
3. **Play the grouping back, and let the human correct it before any grilling:**

   > 9 notes, 4 themes: ticket-card density (4), the rail's empty states (2), two
   > separate asks about the burn log, and one stray about Windows paths. Does
   > that grouping look right?

   Take their correction. A theme you split is often one thing, and one you
   merged is often two — and the idea worth building usually lives in the theme,
   not in any single note, so the grouping has to be right before the questions
   start.

## Movement 2 — grill theme by theme

Take the themes one at a time and work each until its **intent** is clear enough
to route. This is the one place this session grills, and it grills about what the
human wanted, never about how it should be built — the design still belongs to
the feature's own `/runcastle:ideate` session.

- **One question at a time, always with your recommended answer attached.** A
  bare question with no recommendation hands the work back to the human.
- **Consult the portfolio, as §1a requires**: `get_project_context` for the
  feature index and the live ADRs, `read_adr` for the one that binds this
  surface, `get_work_record({ featureSlug })` or `({ seam })` for what a
  neighbour actually did and what it left undone, and `docs/features/<slug>/` on
  disk for a merged feature's argument. "`ticket-cards` shipped a density pass in
  August — is this a regression, or a new want?" is the question only this
  session can ask.
- A note may change under grilling, and should:
  - **Drop** it — already fixed, already decided, or no longer wanted. Triage it
    on the spot with `dropped: <why>`.
  - **Merge** it into its theme — it is the same want said twice, and the theme's
    outcome closes it along with the rest.
  - **Reframe** it — what it says and what it meant are different. Carry the
    reframed understanding into the destination in movement 3.
- A theme is done when you can say what the human actually wants and which
  destination it belongs in. One that is still ambiguous after a couple of
  questions is a theme to defer, not one to route on a guess.

## Movement 3 — route, and carry the reasoning

Every theme goes to one of §2's five destinations. **Grilling that is not written
into the destination is lost the moment this terminal closes**, so what you just
worked out has to land in whatever that destination carries.

**Never create work the human has not confirmed.**

### New feature

A theme with real design questions. `create_feature({ title, oneLiner, brief,
baseBranch })` exactly as §1c describes — one call per feature, the base stated,
`draft: true` for the ones they want parked.

The `brief` carries the grilled reasoning, not the jotted line: why this exists,
what the human actually wants, what it must not swallow, what the portfolio
already settles. **Name screenshots by absolute path** — the `screenshotPath`
from `list_project_notes`, verbatim. Ideation runs on the host and `Read`s it
from there.

### Quick changes — one batch per triage session

Every quick-sized theme of **this** triage session goes into **one**
`create_feature({ title, oneLiner, tickets })` call: one feature, one rail row,
one **Burn**, one **Merge** for the whole pass. This is where §2's "one call per
quick change, not per ticket" widens — inside triage, the batch *is* the quick
change, and calling it once per theme would give you a feature each.

- Title it for the pass ("Triage batch — card density and empty states"), with a
  one-liner the human would recognise a week from now.
- Every quick-sized theme contributes its ticket strings to that one `tickets`
  array — the grilled version, carrying the repro or the expected/got the
  grilling produced, never the ten-second line.
- A ticket whose note has a screenshot ends with that note's
  `attachmentSentence`, **pasted verbatim**. That sentence is the whole contract:
  the burner scans it back out of the ticket and puts the PNG in its sandbox.
- Pass `baseBranch` the way §1c requires. The batch's review is then an ordinary
  feature test drive of its branch.

### A revisit, or another lap

Destinations 3 and 4 have no tool. Give the human a **handoff line** to paste
into that feature's own session, carrying the grilled reasoning — not "see the
notes":

> Paste this into `burn-log-readability`'s revisit: "Timestamps in the burn log
> are unreadable at a glance; we settled that the want is relative ages with the
> absolute time on hover, and that the run header keeps its absolute start time."

Then say which button opens it: **revisit** on the feature, or **Iterate** on its
review page for another lap.

### Nothing

Already decided, already built, or not worth doing. Say so with the address — the
ADR or the shipped feature that settles it — and triage the theme as
`dropped: <why>`.

## Marking the notes

As each theme resolves, close it in one call:

`triage_project_note({ noteIds: [ ...the theme's notes ], outcome, featureId? })`

The `outcome` is one line and it is the inbox's permanent record of where the
note went. Use these forms:

| Destination | Outcome line |
|---|---|
| New feature | `→ new feature <title>` |
| The batched quick change | `→ batch quick change <title>` |
| A revisit | `→ revisit of <slug> (handoff given)` |
| Another lap | `→ another lap of <slug> (handoff given)` |
| Dropped, or nothing | `dropped: <why>` |

**Pass `featureId` whenever the destination is a feature.** `create_feature`
returns the new feature's `id`: the batch's id goes on every note routed into it,
and a new feature's id on every note in its theme. That link is what lets the
inbox show which work a note became.

A triaged note is **frozen** — no edit, no delete, no re-triage (only the human
can reopen one from the inbox). Get the outcome line right the first time.

## Deferring and skipping

- **A theme the human wants to leave for later stays open** — but do not leave it
  as the line it was jotted as. Offer the sharpened version and, **with their
  OK**, write it with `update_project_note({ noteId, text })`, so the next triage
  starts from what you both worked out instead of re-grilling it.
- **A note the human skips stays open.** There is no partial state and nothing to
  record; it comes back next triage.

## Close

Tell them what this pass produced: the batch and how many tickets it carries,
each new feature, each handoff line still to paste, and how many notes are still
open. Then stop — you never launch what you created (§1c), and the cards
appearing in the rail are the handoff.
