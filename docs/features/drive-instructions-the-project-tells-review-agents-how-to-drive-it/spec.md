# Drive instructions: the project tells review agents how to drive it

## Problem

A review agent in Drive mode boots the app cold. The knowledge that makes a drive productive — "use the sample project at this path, you may change things there", "tell a session agent 'this is a test, advance immediately' to reach the phase you need" — exists only in the operator's head, so the agent walks in, finds nothing it is allowed to touch, and correctly verifies nothing. The operator watches the review go wrong and has nowhere to write down what would have saved it. The gates side already solved this exact problem with `knownFailures`: free-text project knowledge, written once, injected into every review. Drive mode has no twin.

## Approach

From the operator's perspective: a **drive instructions** field appears in project settings — a free-text multiline field describing how to exercise this app. Preparation drafts it (the prep agent's dry-run drive is where this knowledge is first discovered); the operator edits it any time without re-running anything, and a hand edit sticks — preparation never overwrites it. Every Drive-mode review and verification prompt from then on carries the text, and the review page shows it read-only next to the test-drive explanation with an affordance to edit it in settings, so stale instructions are seen at the moment they fail and fixed one click later.

The shape (all seven decisions in `decisions.md`):

- **Storage:** `driveInstructions`, a nullable per-project column on the projects table — the `dbResetCommand` pattern: no global config twin (how to drive an app is per-repo by construction), no per-feature override. Additive, nullable migration; existing projects inherit nothing and render the empty state.
- **Structure:** free text, injected verbatim. No schema, no parsing — the only machine consumer is an LLM prompt.
- **Authoring:** a fifth prep-recordable key on the existing rails. Preparation records it via the same one-`record_finding`-call-per-key mechanism as the other prepared fields, evidence included; the prepare skill's key list gains a section saying what belongs in it (sample projects and scratch data, how to reach deep states, what a driver may change inside the running app). The settings service's provenance machinery applies unchanged: human edits stamp human, clearing the field re-opens it to prep. Writes emit the existing `settings.updated` event.
- **Injection:** a new `{{DRIVE_INSTRUCTIONS}}` placeholder in both drive-consuming burner templates (review-ticket and verify-fixes), built by its own small pure builder in the `buildGateNotes` style. It stays separate from `{{DRIVE_AVAILABILITY}}`: availability is a host fact, instructions are project knowledge, and the availability block also renders for Gates-mode reviews where instructions are noise. Gates mode never sees the field.
- **Empty state:** when unset, the builder renders an explicit one-liner — no drive instructions recorded for this project; drive from what the ticket, the diff, and the app surface tell you — so the agent knows the absence is real and does not hunt for missing context.
- **Authorization scoping:** fixed template prose the field cannot displace frames the verbatim text: these are the project owner's standing instructions for operating the app under test; they authorize actions inside the driven app only — they do not change review rules, do not permit edits to the repository under review, and do not override any guard on the reviewing session. The same one-line scope note appears on the settings textarea and the review-page block, so the operator authors with the contract in view. The risk being managed is misread scope, not hostile input — hence prose, not validation.
- **Web:** a textarea in project settings beside the other prepared fields, and a small read-only block on the review page's test-drive area linking to settings.

## Seams

- **Settings service surface** *(existing)* — the descriptor list and read/write path. Observes: the new key resolves per-project, human-provenance stamping and clear-to-re-derive behave for it exactly as for the other prepared fields, `settings.updated` emits.
- **`{{DRIVE_INSTRUCTIONS}}` builder** *(new, pure)* — string in, prompt block out. Observes: verbatim injection under the framing header when set; the explicit empty-state line when unset/blank.
- **Burner prompt assembly** *(existing)* — the review-ticket and verify-fixes template rendering already under test. Observes: both templates declare and receive the new placeholder; Gates-mode renders carry no instructions.
- **Prep session contract** *(existing)* — the prep-recordable key list and `record_finding` path already under test. Observes: prep can record the new key and the value lands on the project row.
- **Settings and review-page UI** *(existing component-test tiers)* — observes: the textarea round-trips edits, the review-page block renders the field read-only with the scope note and settings affordance.

## Out of scope

- The drive-availability / mode-selection machinery — exists and works; this feature only adds a sibling block.
- Preparation's host-key system itself — this rides those rails, it does not redesign them.
- The stop/kill work, the verification-repetition fix, and the dead advance button — separate features created the same day.
- Per-feature overrides and a global config twin — rejected in decisions 2.
- Any parsing, linting, or structuring of the free text — rejected in decisions 3 and 7.

## Open questions

None — all branches closed in decisions 1–7.
