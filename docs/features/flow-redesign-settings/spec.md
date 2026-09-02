# Flow redesign: settings

## Problem

Settings is one long autosaving overlay with four stacked sections and no way to find anything. Every field carries a paragraph of help; the per-project prepared fields render their full preparation evidence inline (hundreds to thousands of words per field), so the "Commands" area is several screens of prose around six inputs. The same five fields appear twice (global and project) with duplicated help, a note saying "Inherited from global", an OVERRIDDEN badge and a "Clear override" link — three signals for one fact, and nothing that shows what will actually run. The multi-model flow that the tickets agent depends on — a roster where a model with a use-case note may be picked per ticket — is invisible: a note can only be entered through the "Custom…" branch of a model dropdown, and a curated model cannot be annotated at all. Two per-step model rows render raw keys (`revisit`, `project`), the per-step comboboxes have no accessible name, saves are silent, the restart-required badge is always on, and the AFK prerequisites card, when its doctor probe fails, collapses to one un-retryable error line that every "Settings → AFK burns" pointer in the app sends people to. The human's summary: dreadful, hard to find things, too much useless text, unprofessional.

This is an information-architecture problem first and a styling problem second. Config *semantics* are not the problem and are not changed.

## Approach

### What the human gets

Settings opens as one large dialog (a new `xl` size, ~940×700, the page body being the only scroll container) with a **left rail of four task pages** and a **filter box** above the rail. Typing in the filter hides non-matching fields on every page, shows a match count beside each page name, and jumps to the first page with a hit; an empty result says so. `Esc` and the backdrop return to whatever was underneath. The approved visual reference is `docs/features/flow-redesign-settings/prototype.html` (artifact v4); the implementation follows it on the foundation's tokens and primitives.

**General** — Server port, Sandbox, Sandbox image, MCP servers in sessions. Grouped *Server* / *Sessions*.

**Models** — top to bottom:
1. A **Default model card** (accent-tinted): the default-model select and one line, "Runs every step that has no model of its own below — and every project that has not set one."
2. The **roster** as a table: model id · runtime chip · editable use-case note (inline; a curated model's note is written by upserting an entry with that id into the `models` roster) · "Used for" (the steps that resolve to it, "Default" first) · a **Default** column carrying a `DEFAULT` chip on the default row and a "Make default" action on hover/focus for the others · remove (custom entries only). An "Add model…" row takes id, a **required** runtime, and an optional note. Curated models with no note and no use are collapsed behind "N curated models not shown: show all". One line above the table: only models with a note are offered to the tickets agent, which may pick per ticket; models without a note are never picked automatically.
3. **Per step** as a bordered table grouped *Sessions* (Ideation, Q&A, Waypoint, Converge, Revisit, Project chat) and *Unattended* (Research, Implement, Review, Prepare, Smoke). Every one of the eleven steps is always listed — no collapsed "Advanced", no "Add an override" picker. Each row: step name with a one-line plain-language description, a model select reading "Default (<model>)" when unset, the effective runtime chip, and ✕ to reset. When the open project has its own model, an amber line above the table says it runs everything on that model and these apply to other projects.

**Burns** — a **prerequisites checklist** at the top (container runtime, sandcastle image, Claude Code token, Codex sign-in, burn cache): a one-line summary ("3 of 4 ready — …") with a segment meter, then one row per prerequisite with a status dot, a one-line detail and one action. Terminals (image build, `setup-token`, sign-in) open inline under their row and end with "Done — re-check", as today. A failed doctor run shows the error *and a Retry button*. Below, *Width & retries*: Concurrency (ghost placeholder is this machine's default, with "default on this machine: N" beside it), Iterations per attempt, Attempts per ticket, Conflict resolver passes, CPU limit per burn — each a small numeric input with a unit label.

**This project** — grouped *Model & sandbox* (Model, Sandbox), *Commands* (Setup, Verify, Known failing tests, Dev server, Before a test drive, After a test drive, Reset dev database), *Project chat* (Commits land on). A field with a global twin is **one control**: unset, it shows the global value as ghost text (selects: a first option "Use global (<value>)") with a `Global` chip; set, the chip reads `This project` with a "Use global" link beside it. No Clear-override button, no OVERRIDDEN badge, no "Inherited from global" sentence. Project-only fields carry no chip. Every command field has a mono placeholder with an example value.

**Text policy, everywhere.** Label + placeholder, at most one short help line where the label alone is ambiguous (iterations vs attempts), the full explanation behind an ⓘ tooltip. Prepared-field provenance is a **chip** on the row (`Prepared · 11d ago · main +213`, `Set in a session · 11d ago · verified by a dry run 10d ago`, `You · 17d ago`, `… · unverified`, plus a `Stale` chip past the staleness threshold); clicking it opens a **popover** with the preparation evidence. Evidence is never inline.

**Feedback.** Autosave-on-blur (Enter commits, Escape reverts, selects on pick) stays; the explanatory banner goes. A "Saved ✓" fades in beside the label after a commit; a rejected value shows a persistent inline error until the next edit and the draft snaps back. Server port shows an amber "Restart the server to apply" line under the field only after it has been changed. Env-locked fields render disabled with a lock icon and an `Env` chip whose tooltip names the variable.

**Deep links.** The dialog opens on a requested page and, optionally, scrolls to and highlights a requested field/row. The stale-image error and the burner's "Rebuild it from Settings → AFK burns" messages become links that open Settings → Burns on the image row. The titlebar and palette open it on General.

**Bugs fixed in passing** (this surface's rendering): `revisit` and `project` step labels; accessible names on every per-step select; the doctor-failed dead end.

### Shape of the change

- **Web only, plus one server contract addition.** The `settings.get` / `settings.update` value·source·editable contract, `project.prep`, `setup.doctor`, `setup.startTerminal`, `setup.afkToken`, `system.burnCache.*` and `setup.runtimeGuide` are consumed as they are. The only server-side change is the *message text* of the two "Settings → AFK burns" pointers, which now need to carry a machine-readable target the web can turn into a link (the message keeps its human wording; how the target rides along — a structured field beside the message, or a stable token in it — is the implementer's call, with the structured field preferred).
- **The settings overlay becomes a folder of components**: the dialog shell (rail, filter, page switching, deep-link entry), one component per page, a shared **setting row** built on the foundation's `Field` primitive that renders any `SettingRow` (control kind, chips, ⓘ, saved/error, ghost global), the **roster table**, the **per-step table**, the **prerequisites checklist** (the reshaped `EnableAfkCard`, still the component the first-run wizard renders with `onDismiss`), and the **evidence popover**. Every `settings-*`, `afk-*` and `peek.settings` rule is deleted from the legacy stylesheet; styling is Tailwind utilities on `theme.css` tokens, exactly one `solid` button visible per page.
- **Presentation logic stays pure and moves apart**: the settings helpers keep deriving rows from the `settings.get` view but now also derive *pages* (which keys on which page, in which group, with label / placeholder / short help / tooltip / unit), the roster table rows (including "Used for" from the resolved step→model map and the default), the per-step table rows, the filter (a case-insensitive match over label + key + tooltip → per-page hit counts), and the chip text for provenance, source and env. The prep-finding helpers that preparation, review and the next-step bar import (`describeFinding`, `driveCapabilities`, `unverifiedDriveKeys`, `verificationBadge`, staleness) move to their own `lib/prep-findings` module; their behaviour is unchanged and their existing tests move with them.
- **Workspace state** gains the requested page/field alongside the existing "settings open" flag, so any caller can open Settings at a location.
- **Dialog** gains an `xl` size. `podman` remains unoffered (a config semantics question, recorded as a finding).

Decision-pinning shapes from the ideation (illustrative, not file paths):

```
SettingsLocation = { page: 'general' | 'models' | 'burns' | 'project'; field?: string }

SettingRow (extended) += {
  page, group, placeholder, shortHelp, tooltip, unit?,
  ghostValue?: string          // the inherited global value, project scope only
  sourceChip?: 'global' | 'project' | 'env'
  provenanceChip?: { text, tone: 'ok' | 'muted' | 'warn', evidence?: string }
}

RosterRow = { id, runtime, note, usedFor: ModelStep[], isDefault, custom }
StepRow   = { step, label, description, group: 'sessions' | 'unattended', value: string | null, effectiveRuntime }
```

## Seams

- **`settings.get` / `settings.update` (existing, unchanged).** The one data boundary. Component tests drive the UI with fixture views (the value / source / editable / scope / restartRequired shape) and assert the mutations the UI issues: `{ key, value }` for global writes, `{ projectId, key, value }` for project writes, `value: null` for "Use global" and per-step reset, and the sequential roster write (`models` upsert, then the select) for a custom or newly-annotated model.
- **Pure presentation helpers (existing module, extended).** Page/group assignment, `describeField` chips and ghost values, roster rows and "Used for", step rows and the effective-runtime chip, filter hit counts, provenance chip text. Unit-tested without a DOM — this is where most behaviour lives.
- **`lib/prep-findings` (new module, old behaviour).** The moved helpers; tests move with them and pass unchanged.
- **Settings dialog component tests (existing tier, new suite).** Render the dialog with fixture queries and assert: the four pages and filter, a11y names on every control (including per-step selects), the `Saved ✓` / error / restart-line states, the override chip flip and "Use global", the evidence popover open/close, the prerequisites summary and Retry, and that opening with a `SettingsLocation` lands on the page and highlights the field.
- **`setup.doctor` and friends (existing, unchanged).** The checklist maps probe status to dot/summary/action exactly as the current card does; the existing `ImageBuildAction` / `BurnCacheRow` component tests are kept or re-homed.
- **Deep-link targets (new, small).** Wherever an error message points at Settings, the web resolves it to a `SettingsLocation`; a test asserts the stale-image message and the burner's missing-binary message both open Burns on the image row.

## Out of scope

- Config semantics and new settings: no new options, no changed defaults, no `podman` in the dropdown, no exposing `burnGuard` / `burnWorkspace` / `burnCache`. Findings recorded: `podman` valid-but-unoffered; the doctor's ENOENT on `assets/sandcastle/Dockerfile` under a dev-instance asset environment.
- Preparation behaviour (what findings mean, staleness threshold, verification) — only their placement here.
- The first-run wizard beyond consuming the reshaped prerequisites component.
- Server config loading.
- Light theme (the app is single dark theme).

## Open questions

- Whether the "Used for" column should also list per-ticket assignments (tickets currently stamped with that model) — deferred; it lists steps only.
- Exact staleness wording in the chip beyond "main +N" — implementer's choice within the text policy.

## Later laps

None planned — this lap is the whole feature.
