## Why this exists

The human's words, 2026-08-27: "the review system is SO BAD. The agent reviews, then adds to test notes for some reason. So when the burn finishes and we move to the review phase, I see a wall of text. Many of the text is not even review details, sometimes just a summary, or an important note. Not something to fix. I want the review notes to be immediately fixed, I don't want the user to have to go through the loop manually." And the goal: "the best experience and the most streamlined flow so users don't get confused, they don't waste context, time, etc.. It should feel like runcastle is saving the users time and effort rather than being ceremonious."

The screenshot that prompted this: the test-drive notes panel with 7 open notes, each a ~200-word paragraph such as "[Code review — Standards axis] `approvalPolicyFor` closes its return type but leaves its domain open… What I did: read … What happened: … What I expected: … Citation — smell: Primitive Obsession…". Every one requires reading in full to learn whether it is a defect or a remark.

## Why it looks like this today — the decisions being changed

`docs/features/improve-workflow/decisions.md`:
- Decision 2, "Review findings land as test notes": the review agent writes findings through the human's test-notes channel via `add_test_note` (packages/server/src/mcp/server.ts, `toolAddTestNote`) so promote-to-fix-ticket works unchanged.
- Decision 6, "Review is advisory and best-effort": the human consumes the notes and chooses Merge / Fix / Rethink. Teeth were deferred "until the agent's findings have earned that authority." The human now says they have — this feature SUPERSEDES decision 6 and amends decision 2.
- The prompt (`packages/skills/burner/review-ticket.md`) then requires each note to be self-sufficient — what you did / what happened / what you expected / citation — which is why every note is a paragraph; it asks for a closing SUMMARY NOTE (step 4) and sends "adjacent things you notice" there, which is why non-defect remarks sit in the notes list beside defects. The note shape has no way to say "this is a defect" vs "this is a remark".

What is NOT wrong: the review skill itself. `review-ticket.md` is a faithful inline of `/runcastle:code-review` (Standards axis + Spec axis, citation-or-drop, two sub-agents one level deep). Keep it.

The charter already asks for this outcome. CONTEXT.md decision 9: "Review findings auto-feed fix cycles inside the burner; only hard blockers surface." improve-workflow lap 1 deliberately stopped short of it; this feature finishes it.

## The shape agreed at intake (the grill refines, it does not reopen)

1. Findings are structured and typed, not prose notes. Each finding the review emits carries at least: kind (`defect` | `observation`), a one-line title, severity, a location (file+hunk, or screen+steps), the citation the skill already demands, and the detail. A `defect` is something a fix ticket can act on — a cited hunk, a reproducible drive step. An `observation` is everything else: the summary, "worth your attention", deferred scope, could-not-verify, partially-built-feature warnings. Observations go into the DIGEST (already exists, already rendered first on the review page — step 6 of the prompt) and never into the notes list. The step-4 summary note goes away; the digest is the summary.

2. Defects are burned automatically, in the same run, no click. The review ticket's defects become implementation (fix) tickets in the current lap, blockedBy the review, and the run continues into them. Machinery that exists and should be reused rather than rebuilt: promote-note-to-ticket in packages/server/src/services/test-notes.ts (~307–345), the review→implementation loop-back the Fix verb uses (ADR-0010), the burner's blockedBy scheduler (ADR-0002/0006), landing via the serialized merge queue. The lap does not change — fixes are the same lap (ADR-0010: Fix does not increment `lap`).

3. No second review pass — intake decision, recorded here so the grill does not re-litigate it lightly. Each fix ticket's burner already runs the verify gates on its own change and writes its own digest; those digests roll into the lap digest the human reads. The human's own test drive is the second pass. A full re-review would roughly double review cost for the ceremony the human is asking to remove. If the grill finds a cheap targeted check (e.g. the fix burner re-runs only the finding's repro step / cited test), that is in scope; a whole-review loop is not.

4. What the human sees on arrival at the review phase: the digest; a line like "N defects found and fixed automatically, M still open, K observations"; and ONLY the still-open items as notes — defects whose fix ticket failed, or hard blockers the review could not act on (e.g. a spec contradiction that needs a decision). Fix / Rethink / Merge remain for what the human finds themselves. "Only hard blockers surface" (charter 9) is the test.

5. Notes UI renders a finding as title + severity + one line, with the detail expandable — for the human's own notes too, so the panel stops being a wall in every case. Keep the human's own note-capture flow (quick-capture, per-lap append to `test-notes.md`, injection into the next lap) exactly as it is.

## Things the grill must settle

- Wire shape: a new MCP tool (`report_finding`?) that replaces `add_test_note` for review agents, or `add_test_note` growing structured fields. Human notes stay free text.
- Where defects live before their fix ticket exists (a note with status `promoted` immediately? a ticket directly?), so the review page can count found/fixed/open from one source.
- Failure handling: a fix ticket that fails leaves its defect open and visible with the failure reason; a review that dies mid-way must not lose the defects already reported (each is sent as found — keep that property).
- Bounds: a cap on auto-fix tickets per review (a review that finds 30 defects on a lap is a Rethink signal, not 30 burns) — surface above the cap as open.
- Whether the tickets session still emits the review ticket (improve-workflow decision 1) or the burner appends it — unchanged unless the grill finds a reason.
- ticket `kind` naming for fixes (`implementation` with an origin pointer to the finding is probably enough).

## Collisions to read before designing

- `review-fixes` (quick change, in flight): its ticket 3 rewrites the same prompt (drive OR gates); ticket 1 fixes the uncommitted brief.md that blocks the drive; ticket 4 adds `ticket.timing` for reviews. Land it first and read its outcome; do not redo those.
- `burn-reliability` (draft): A2 "resume at digest when ≥1 note exists" and A5 "supersede notes from failed attempts" assume the prose-note channel. This feature redefines the channel; that draft follows it.
- `burn-guard-and-prompt-rules` (quick change): burn prompt edits, not the review prompt — no overlap, but fix tickets burned here inherit whatever it lands.

## What this must NOT swallow

- The review skill's judgement (axes, citations, smell list) — unchanged.
- The drive / video walkthrough machinery (improve-workflow decisions 3, 4, 8).
- The human's own test-drive notes flow and the Fix / Rethink / Merge verbs (ADR-0010).
- Review reliability (provider outages, orphaned agents) — `burn-reliability`.
- Any merge gate with teeth: merge is still one click; open items are information, not a block (changing that would be its own decision).
