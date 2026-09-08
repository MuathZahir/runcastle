# Decisions — drive instructions

## 1. One lap, spec the whole thing
**Decision:** Sure and small — the full feature is specced in lap 1; no deferred laps, no map.
**Why:** The shape was already locked at intake (a prep-authored, human-editable project field injected into the drive-mode prompts) and every rail it rides exists: the prepared-settings columns and provenance, `record_finding`, the template placeholder machinery. The design tree is narrow enough to converge in one session.

## 2. Project-only, no global twin, no per-feature override
**Decision:** `driveInstructions` is a per-project field on the `projects` table, like `dbResetCommand` — no global config twin, no per-feature override.
**Why:** How to exercise *this* app is per-repo by construction; a global fallback could only inject some other project's instructions into a review. Per-feature overrides are YAGNI — no concrete case surfaced.

## 3. Free text, injected verbatim
**Decision:** Free text (multiline textarea in settings), injected verbatim into the prompt — no schema.
**Why:** The knowledge is irreducibly prose-shaped and the only consumer is an LLM prompt. `knownFailures` is the explicit precedent. Any structure invented today would be guessed and fought tomorrow.

## 4. A fifth prep-recordable key on the existing rails
**Decision:** `driveInstructions` joins the prep-recordable key list: prep records it via the existing `record_finding` mechanism (evidence included), the prepare skill documents what belongs in it, the settings service's human-provenance stamping applies unchanged, and the settings UI adds a textarea beside the other prepared fields.
**Why:** No new tool or mechanism — it is one more descriptor on rails built for exactly this: prep authors, human edits stick, clearing re-opens to prep.

## 5. Own placeholder: `{{DRIVE_INSTRUCTIONS}}` in both drive-mode templates
**Decision:** A new `{{DRIVE_INSTRUCTIONS}}` placeholder with its own small host-side builder (the `buildGateNotes` pattern), added to review-ticket.md and verify-fixes.md. Unset renders an explicit "no drive instructions recorded — drive from the ticket, the diff, and the app surface" one-liner; set injects the text verbatim under a short framing header.
**Why:** Availability is a host fact (can a drive happen); instructions are project knowledge (how to drive) — folding them into `{{DRIVE_AVAILABILITY}}` would blur that and drag instructions into Gates-mode renders where they are noise. The explicit empty state stops agents hunting for context that genuinely does not exist.

## 6. Three consumers: review Drive, verify Drive, and the human's test drive
**Decision:** The two drive-mode prompts consume it via `{{DRIVE_INSTRUCTIONS}}`, and the review page shows it as a small read-only block next to the test-drive explanation with an edit affordance pointing at settings. Gates mode never sees it.
**Why:** The knowledge serves a human drive exactly as it serves an agent drive, and surfacing it where drives happen is what closes the amend-after-a-bad-review loop — stale instructions are seen at the moment they fail, one click from the fix. Cost is near zero: the field rides the project row the page already loads.

## 7. Authorization scoping is fixed template prose, not validation
**Decision:** The `{{DRIVE_INSTRUCTIONS}}` framing header carries the scope contract in fixed prose the field cannot displace: the instructions authorize actions inside the driven app only — they do not change review rules, do not permit edits to the repository under review, and do not override any guard on the reviewing session. The same one-line scope note appears on the settings textarea and the review-page block. No parsing or linting of the free text.
**Why:** The field is operator-authored, so the risk is not hostile input but misread scope — an agent taking "you may change things" as license beyond the drive target. Fixed surrounding prose is the right tool for that; linting free text is not.
