# One file per feature, and reviews that scale

## Problem
A small fix leaves about 5,000 words across five docs that the human rarely
reads, and every change pays for a full drive review plus a verify review
whatever its size. The lead's own notes also travel into the review, so the
reviewer shares the lead's blind spots.

## Approach
From the human's side: a new feature has one file, `brief.md`, that grows from
their words to the decisions, short build notes and, at merge, a review summary
runcastle writes itself (decisions 1, 5, 6, 7). Reviews get lighter: one
review, driven only when users would meet the change, a second one only after
a large fix set (decisions 2, 9).

Its shape:

- **The feature file.** The lead's rules (feature skill and its references)
  stop asking for `decisions.md` and `spec.md` on new features. The reference
  page on decisions and spec becomes a page on the feature file: its four parts,
  the decision format and marks (unchanged, now under `## Decisions`), the
  "Check first" line, and what build notes hold. Planning alone writes into
  `brief.md`. Wording that names `decisions.md`/`spec.md` (the launcher's docs
  line, the session-start digest, the compaction note, the edit guard's denial
  text, the conflict kickoff text, the excerpt handed to workers) names the
  feature file, and the old files only when they exist.
- **Old-shape detection** (decision 8). One pure helper in core says whether a
  feature folder is old-shape (has `decisions.md` or `spec.md`). The merge step,
  the orchestrator's "add to the brief" tool and any prompt text branch on it.
  The digest and docs list already inline or list whatever files exist, so they
  need no branch.
- **"Add to the brief"** inserts into the brief part, above `## Decisions` when
  that heading exists; otherwise it appends as today.
- **The merge stamp** (decision 7). The outcome composer gains a short form:
  ship date, commit and file count, and each review with its findings and their
  resolution. For a one-file feature, the merge step appends it to `brief.md` as
  `## Review summary` in the same `runcastle: outcome for <slug>` commit and
  records `brief.md` as the outcome path; the epic's merge news points there.
  Old-shape features get `outcome.md` exactly as today.
- **The reviewer** (decisions 3, 9). The review templates point the reviewer at
  the human's words and decisions in `brief.md` (falling back to spec and
  decisions for old features) and the repo's standards. The reviewer's feature
  read stops including the lead's latest turns, so it starts empty of the lead's
  conversation. `start_review` requires the lead to choose drive or read (today
  "gates"), with the rule from decision 9 in the tool's description; a drive
  request on a machine that cannot drive is still refused with why. The review
  instructions tell a reading reviewer to raise a finding when the diff changes
  something a user meets. The code-review skill's Spec axis reads the brief's
  human words and decisions, and `spec.md` only for old features.
- **The second review** (decision 2). The `start_review` description and the
  feature skill stop saying a verify review always follows fixes; they give the
  "large fix set" rule. The scenario rule moves to "before ready" (decision 10).
- **Talk rules** (decision 4), all wording: the feature skill tells the lead to
  quote the human's words in each assignment, to bring the base branch in before
  the review and before ready, and to skim the diff's shape instead of reviewing
  it line by line. The worker briefing asks for a short handback: what was done,
  what was not, where to look, no logs or file lists (runcastle already appends
  commits and files). Nothing pings anyone when the base branch moves; that is
  already true and stays so.
- **The web.** Details → Docs keeps listing whatever files exist, outcome first
  for old features. The merge dialog's "later" scope reads from the spec only
  when one exists. No screen changes layout.
- **Other skills.** The qa skill reads `brief.md` first; the project skill's
  brief shape notes that leads grow the file below it.

## Seams
- The outcome composer (existing, pure): given reviews and findings, the short
  form's text. Tests pin both forms.
- The merge step (existing, server tests with a temp repo): a one-file feature
  ends with `## Review summary` in `brief.md` and no `outcome.md`; an old-shape
  one gets `outcome.md`.
- The review assignment renderer (existing, pure): the template text it fills,
  and that the mode is required.
- The reviewer's feature read (existing, worker tools tests): no lead turns.
- Skill text tests (existing `feature-skill`, `never-guess`, `preview-skill`):
  pin the new rules' key phrases.

## Out of scope
The plan approval and the Plan tab; the optional plan page (`preview.html`)
stays as it is. Listing "decided without you" in the review package. Migrating
shipped features' docs. A registry of migration numbers, an agreements file, a
separate screen-review pass. `CONTEXT.md` and the ADRs, which the orchestrator
rewrites at merge.

## Open questions
None blocking. Skill changes reach live sessions only once runcastle is
published and reinstalled, so the human's drive starts the branch's server by
hand.
