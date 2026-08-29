# Decisions — Flow redesign: settings

## 1. Flow map confirmed; one lap, whole feature
**Decision:** The as-is flow map (titlebar/palette entry → one `peek` overlay with four stacked sections: Global 13 fields, collapsed per-step models, This project 10 fields with inline preparation evidence, AFK burns card) and its field inventory are confirmed by the human as complete. The feature is specced whole as one lap — no thin skeleton.
**Why:** The human's problems are clear and stable (hard to find things, too much text, clunky overrides, model-annotation flow undiscoverable, unprofessional visuals); scope is one surface. Nothing is uncertain enough to need a walking skeleton.

## 2. Problems the redesign must solve (the human's words, verified in the walk)
**Decision:** The redesign is judged against these: (a) finding a setting is hard — no grouping by task, no tabs, no search; (b) text noise — every field carries a help paragraph, and prepared project fields render 500–3000-word evidence blobs inline; (c) overrides are clunky — the same five fields appear twice with duplicated help, "Inherited from global" notes and a "Clear override" link, and nothing shows the effective value; (d) the multi-model-with-notes flow (annotated roster → tickets agent picks per ticket) is invisible: notes can only be entered through the "Custom…" branch of a dropdown, and curated models cannot be annotated at all; (e) visuals — no placeholders, no hierarchy, no icons, flat spacing.
**Why:** Recorded so spec and tickets optimise for the stated pain, not for a generic settings makeover.

## 3. Information architecture: four task pages in one dialog
**Decision:** Settings becomes one dialog with a left rail of four pages — **General** (server port, sandbox, sandbox image, MCP servers in sessions), **Models** (roster table with runtime + use-case note, default model, step→model grid), **Burns** (concurrency, iterations, attempts, conflict passes, CPU limit, and the AFK prerequisites card), **This project** (the ten per-project fields grouped as Model & sandbox / Commands / Project chat branch) — plus a filter box that searches field labels across pages. Global-vs-project is expressed inside "This project" (inherited value shown as ghost text, a source chip, one "Use global" action), never by rendering a field twice.
**Why:** Pages cut by task match how the human looks for a setting; the config file's global/project split is an implementation fact. The Models page is what makes the annotated-roster → per-ticket model flow discoverable. Chosen over the plainer Global/Project two-tab cut the human first suggested; they agreed to four.

## 4. HTML prototype before spec
**Decision:** Once design decisions lock, an HTML prototype of the settings dialog is produced under `docs/features/flow-redesign-settings/` (and published as an artifact) so the human can experience the design before spec/tickets.
**Why:** Human's explicit request; a visual surface is judged by looking, not by reading.

## 5. Text policy: help on demand, provenance as a chip, evidence in a popover
**Decision:** A field shows its label, a placeholder with an example value, and at most one short help line where the label alone is ambiguous (e.g. iterations vs attempts). The full explanation lives behind an ⓘ tooltip per field. Prepared-field provenance collapses to a chip on the row (`Prepared · 11d ago · verified`, `You · 17d ago`, `Stale`); the preparation evidence is never inline — the chip opens a popover/expander holding it. The autosave banner is replaced by per-field saved/failed feedback (see later decision).
**Why:** The inline help paragraphs and evidence blobs are the bulk of the "useless text"; the evidence is still the only thing that distinguishes a measured value from a guess, so it stays reachable in one click rather than deleted.

## 6. Models page: default → roster table → full step grid
**Decision:** The Models page is, top to bottom: (1) the Default model combobox; (2) the roster as a table — model id · runtime badge · editable use-case note (curated entries included; annotating a curated model writes a roster entry with the note, no re-adding) · "Used for" steps · remove for custom entries — with an "Add model…" row (id, required runtime, note); (3) a per-step grid listing all eleven steps always, each a combobox reading "Default (<model>)" when unset and an ✕ reset when set — no collapsed Advanced section and no "Add an override" picker. One line above the table states that only models with a note are offered to the tickets agent. When the open project sets its own model, the grid carries an amber line saying these apply to other projects.
**Why:** The per-ticket model flow was invisible because notes lived only inside the "Custom…" branch of a dropdown. Showing every step removes a two-step discovery. Semantics untouched: runtime required and never inferred; project model beats global per-step (reflected, not re-decided).

## 7. Overrides: one control, ghost global value, source chip, "Use global"
**Decision:** On "This project", a field with a global twin (model, sandbox, setup/verify/known failures) is a single control. Unset: the global value shows as ghost text with a `Global` chip; selects show a first option "Use global (<value>)". Set: the chip reads `This project` with a "Use global" link beside it. No "Clear override" button, no OVERRIDDEN badge, no "Inherited from global" sentence. Project-only fields (dev command, DB reset, drive setup/teardown, project chat branch) carry no chip.
**Why:** The override was expressed by three redundant signals and a second copy of the field; one control that shows the effective value answers "what will actually run" directly.

## 8. Save feedback replaces the autosave banner
**Decision:** Autosave-on-blur stays. The top banner goes; each field shows a brief "Saved ✓" fade beside its label after a commit and a persistent inline error until the next edit. Restart-required (server port) is an amber "Restart the server to apply" line under the field, shown only after it has been changed.
**Why:** Silent saves and the always-on RESTART REQUIRED badge were the audit's F17.7/F25.4 complaints; feedback at the field, at the moment, is what a reader notices.

## 9. Burns page: prerequisites checklist, retry, deep links
**Decision:** The AFK prerequisites render as a checklist at the top of the Burns page — container runtime, sandcastle image, Claude Code token, Codex sign-in, burn cache — each a status dot, one-line detail and one action, under a one-line summary ("3 of 4 ready"). The kicker/title/intro paragraph goes. Terminals (build, setup-token, sign-in) open inline under their row as now. A failed doctor run shows a Retry button. The first-run wizard keeps the same component. The dialog accepts an initial page (+ optional field) so error messages that say "Settings → Burns (Rebuild image)" become links landing on that row.
**Why:** Same behaviour, less prose, and no dead end: the walk found the card reduced to one un-retryable error line, and every pointer to it was text.

## 10. Shell: a large Dialog with a left rail, not a route
**Decision:** Settings stays a `Dialog` (size `lg`) with fixed height: page rail on the left, scrolling page on the right, filter box above the rail. Esc/backdrop return to whatever was underneath.
**Why:** Settings is opened from the middle of work, like the palette; a route would lose the place.

## 11. Env-locked fields
**Decision:** A field set by an environment variable renders as a disabled control with a lock icon and an `Env` chip; the chip's tooltip names the variable ("Set by RUNCASTLE_SERVER_PORT").
**Why:** Read-only mono text with a sentence under it read like a value, not a lock.

## 12. Code shape and stylesheet migration
**Decision:** `SettingsOverlay.tsx` becomes a `components/settings/` folder — the dialog shell + rail, one file per page, a shared field row on the foundation's `Field` primitive, and the AFK checklist (`EnableAfkCard` reshaped, still shared with the first-run wizard). The prep-finding helpers (`describeFinding`, `driveCapabilities`, `unverifiedDriveKeys`, `verificationBadge`, …) leave `lib/settings.ts` for a `lib/prep-findings.ts` the preparation/review surfaces import. Every `settings-*`, `afk-*` and `peek.settings` rule is deleted from `styles.css`; styling is Tailwind utilities on `theme.css` tokens.
**Why:** The brief puts code quality and the styles.css migration in scope; three oversized files were the symptom.

## 13. Bugs found in the walk, fixed here
**Decision:** In scope as part of the redesign: the `revisit` and `project` steps render raw keys (missing labels); per-step model comboboxes have no accessible name; the doctor-failed state has no retry. Out of scope, recorded as findings for their own features: the doctor's ENOENT on `assets/sandcastle/Dockerfile` under a dev-instance asset env; `podman` is a valid `sandbox` value the dropdown never offers.
**Why:** The first three are this surface's rendering; the last two are server/config semantics the brief forbids swallowing.

## 14. Prototype approved; dialog is wider than `lg`
**Decision:** The HTML prototype (`docs/features/flow-redesign-settings/prototype.html`, artifact v2) is the approved visual reference: rail 184px + page, dialog ~940×700 (a new `xl` Dialog size, since `lg` 780 was too tight for the five-column roster), 210px label column, roster note column given the flexible width. The page body is the one scroll container.
**Why:** The human reviewed v1 and asked for a roomier model table and working in-panel scrolling; both are in v2, which they can experience before spec.

## 15. Models page v3: default by radio in the roster; per-step as a grouped table
**Decision:** Amends decision 6. There is no separate Default-model combobox: the roster table's first column is a radio (●) that marks the default, so the default is chosen where the models are listed. The per-step section is a bordered table grouped **Sessions** (Ideation, Q&A, Waypoint, Converge, Revisit, Project chat) and **Unattended** (Research, Implement, Review, Prepare, Smoke); each row carries the step name, a one-line plain-language description of what the step does, a mono model select reading "Default (<model>)" when unset, the effective runtime chip, and ✕ to reset. The roster fits the pane without horizontal overflow (fixed columns for radio / model / runtime / used-for / remove; the note column flexes).
**Why:** The human found v2's Models page horizontally tight ("DEFAULT" clipped) and the two-column select grid "feels like a prototype". One place for the default removes a duplicate; the descriptions make the eleven step names self-explanatory without help text.

## 16. The default model is stated twice, explicitly
**Decision:** Amends decision 15. The Models page opens with a **Default model card** — accent-tinted, the select, and one line: "Runs every step that has no model of its own below — and every project that has not set one." The roster's last column is headed **Default**: the default row carries a `DEFAULT` chip; every other row shows a "Make default" action on hover/focus. Changing either updates the other. No unlabeled radio.
**Why:** The human: the radio "isn't very obvious — most people wouldn't read the small text that explains the default". The concept has to be visible without reading a note.
