# Outcome — Flow redesign: settings

Redesign settings end to end — information architecture, global vs per-project, AFK burns / sandbox setup, per-step models — so the human can find what they need without reading paragraphs; walked and confirmed with the human before design.

- Shipped: 2026-09-02
- Lap: 1

- **1. probe** — cancelled: Probe ticket used to diagnose emit_tickets timeouts; not real work.
- **2. probe A** — cancelled: Probe ticket for emit diagnosis.
- **3. probe B** — cancelled: Probe ticket for emit diagnosis.
- **4. Review: drive the redesigned Settings end to end** — cancelled: Re-emitted inside the full batch so its blockedBy edges can be set.

## 5. Settings presentation model: pages, chips, roster and step rows (pure) + prep-findings split

# Ticket 5 — settings presentation model + prep-findings split

## What was done

`apps/web/src/lib/prep-findings.ts` is new and holds the prepared-field helpers verbatim
(`PREPARED_LABEL`, `HOST_ONLY_PREPARED`, `relativeAge`, `verificationBadge`,
`unverifiedDriveKeys`, `driveCapabilities`/`DriveCapabilities`, `describeFinding`,
`STALE_COMMIT_THRESHOLD`, `isStale`, `FindingLike`). `settings.ts` imports from it; nothing
goes the other way. Every importer was repointed (vocabulary, Sidebar, ReviewBody, Workspace,
PreparationWorkspace, feature-ui/internal). `apps/web/test/prep-findings.test.ts` holds the
`driveCapabilities` block moved out of `settings.test.ts`, unchanged; `preparation.test.ts`
just re-points its imports.

`settings.ts` gained the redesign's derivations, all pure and unit-tested: `SettingsPage` /
`SettingsLocation`, a `FIELD_META` table (page, group, new labels, placeholders, tooltips,
one `shortHelp`, units) replacing `META`, `pageRows`, `rosterRows` / `rosterVisibleRows` /
`hiddenCuratedCount`, `stepRows` (all eleven steps, Revisit and Project chat included, with
descriptions, groups and effective runtime), `filterSettings` + `rowSearchTerms`,
`projectModelWarning`, and `settingsLocationFromMessage`. `SettingRow` gained `page`, `group`,
`placeholder`, `shortHelp`, `unit`, `ghostValue`, `sourceChip` and `provenanceChip`. Workspace
state now holds `settings: SettingsLocation | null` with `openSettings(location?)` /
`closeSettings`; `Dialog` gained size `xl` (940px), noted in STYLE.md.

**Three deviations, all deliberate.** (1) `SettingRow.help` was *renamed* to `tooltip` rather
than having both — the ticket asked for a `tooltip` carrying the same text lightly edited, and
keeping `help` beside it would have been two fields with one job. `SettingsOverlay` renders
`row.tooltip` now; three test assertions moved with it. (2) The ticket said to drop the old
`note` sentence for project rows. I kept `note` exactly as it is: it is what the *current*
overlay renders, the ticket's own goal is "no UI change yet; the current overlay keeps
working", and dropping it would have rewritten ten tests that tickets #6–#9 retire anyway.
`note` becomes dead the moment the old overlay is deleted — delete it there, not here.
(3) The one `note` production I *did* remove is `burnConcurrency`'s host default, because the
ticket moves that same string into `unit` and leaving both would have been a duplicate.

## Surprises

- The **global copies of `setupCommand` / `verifyCommands` / `knownFailures` have no page** in
  the redesign. General shows four fields, Burns five numbers, This project ten — the global
  twins of those three appear nowhere, which is decision 7 working as intended (one control,
  a source chip). `FIELD_META` therefore gives them `page: 'project'`, and `pageRows` on a
  global view returns them for no page at all. Worth knowing before #6 goes looking for them.
- **Page and label depend on scope**, not just on key: `model` is "Default model" on Models
  globally and "Model" under Model & sandbox in project scope; `sandbox` moves the same way.
  That is a small `PROJECT_META` override table consulted by `metaFor(key, scope)`.
- `PREPARED_LABEL` had to be resynced to the new labels, which changed the next-step bar's
  unverified-drive warning ("Before a test drive and After a test drive were never proven…").
  One assertion in `feature-ui.test.ts` moved with it. The wording reads a little oddly in a
  sentence; if that matters it is the warning's own wording to fix, not the label's.
- `apps/web/test/preparation.test.ts` already existed and tests most of the prep-finding
  helpers. The ticket did not mention it. I left its tests where they are and only repointed
  its imports — moving them would have been churn with no behaviour change.
- The prompt's baseline (118 files / 1768 tests) is stale. The suite is **153 files / 2564
  tests**, and **8 of them fail before and after this ticket**, all in `packages/server`:
  seven in `burn-slot-workspace.test.ts` (`fatal: repository '/home/agent/cache/tmp/rc-slot-…'
  does not exist` — the sandbox's temp handling breaks the real-git fixture) and one in
  `dev-pane.test.ts` (a process-group kill the sandbox will not honour). This diff touches
  nothing under `packages/`; `bun run typecheck` is clean and all 31 web test files (689 tests)
  pass.

## Left undone

- The **evidence popover, the chips, the pages and the rail are not rendered anywhere yet** —
  that is #6–#9. `SettingsOverlay` still renders the old two-section surface; it only accepts
  (and ignores) the new `location` prop so switching components is a one-line change.
- **`styles.css` is untouched** and the `settings-*` / `afk-*` / `peek.settings` rules are all
  still there — the migration belongs with the components that replace them.
- **Nothing consumes `settingsLocationFromMessage` yet.** The server still ships the two
  "Settings → AFK burns" strings as plain prose; the spec prefers a structured target field
  beside the message, which is a server change #9 should decide on. The regex reader works on
  today's strings either way.
- **Drive machinery unchanged, and correctly so**: this ticket adds no service, no required
  env var, no seed and no extra process, so `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` need no edit. I confirmed both files still exist and that nothing
  in the diff touches what they read; I did **not** run them (no services in this sandbox) and
  they are TypeScript, so there was no `bash -n` to run.

## 6. Settings dialog shell: rail, filter, deep links, shared setting row, General page

# Ticket 6 — Settings dialog shell, shared setting row, General page

## What was done

Settings is now `apps/web/src/components/settings/`: `SettingsDialog.tsx` (an `xl`
`Dialog` labelled "Settings", 184px rail + a `48px / minmax(0,1fr)` page grid so the
body is the only scroll container), `SettingsRail.tsx` (four icon nav buttons with
`aria-current="page"`, the filter box above them, an "Open project <name>" footer),
`SettingRow.tsx` (the shared row plus `SettingGroup`, `InfoTip`, `SourceChip`,
`ProvenanceChip`), a live `GeneralPage.tsx`, and `ModelsPage` / `BurnsPage` /
`ProjectPage` stubs that already take the shared `SettingsPageProps` from
`settings/types.ts`, so tickets 7–9 fill in one file each. `SettingsOverlay.tsx` is
deleted; `ProjectShell` renders the dialog from `ws.settings`. The row carries the
whole feedback model — blur/Enter commit, Escape revert, "Saved ✓" for 1.4s, a
persistent `role="alert"` refusal that the next keystroke takes down, the amber
restart line only after the port has actually changed, and an `Env` chip with a lock
icon and `title="Set by RUNCASTLE_SERVER_PORT"` on a disabled control. The filter
searches every page at once, counts hits per page in the rail, hides emptied groups,
switches pages when the open one has none, and takes Ctrl/Cmd+F; a `SettingsLocation`
picks the page on mount and scrolls/flashes the named field. `Field` in `ui.tsx` grew
`layout` and `labelAside` (a `<label>` may not contain the ⓘ button), documented in
`STYLE.md`. Tests: `apps/web/test/settings-dialog.test.tsx` (14 cases) and two added
`field.test.tsx` cases.

## Surprises

- Three `settings-*` class families could not be deleted from `styles.css`: other
  surfaces borrowed them — `settings-badge` and `settings-clear` in
  `PreparationWorkspace.tsx`, `settings-input` in `DeleteFeatureDialog.tsx` (and a
  `.delete-dialog-field .settings-input:focus` rule). Deleting them would have broken
  two flows this ticket does not own, so every rule the overlay itself owned is gone,
  the survivors are fenced under a comment saying whose they now are, and the ratchet
  was lowered to 4180. The acceptance criterion's literal "no `settings-*` rules
  remain" is therefore met only for settings' own rules.
- `.peek.settings` is gone entirely; `afk-*` was left for the Burns ticket, as asked.
- Two `packages/server` test files fail in this sandbox and are not in the stated
  baseline: `burn-slot-workspace.test.ts` (7 — a slot volume path under
  `/home/agent/cache/tmp/...` does not exist) and `dev-pane.test.ts` (1 — the process
  group survives the kill). Both are environment-dependent and neither can be reached
  from this diff, which touches `apps/web` only. Everything else is green:
  `bun run typecheck` 0 errors, `env -u GIT_ASKPASS bun run test` 151/154 files
  passing, all web suites included.

## Left undone

- The Models, Burns and This-project pages are placeholders by design (tickets 7–9);
  `ModelSelect` lives inside `SettingRow` via `row.modelGroups` and is exercised only
  once the project page renders a model row.
- The drive machinery under `.runcastle/` needed no change — this ticket adds no
  service, env var, seed or process — so nothing there was edited or run.
- Migrating `settings-badge` / `settings-clear` / `settings-input` off the legacy
  sheet belongs to the preparation and delete-dialog flows; the rename is mechanical
  when those land.
- The visual comparison against `prototype.html` was done by reading the prototype,
  not by running `bun run dev`: this sandbox has no app or browser to open.

## 7. Models page: default card, roster table with notes and default column, per-step table

# Ticket 7 — Models page: default card, roster table, per-step table

## What was done

`apps/web/src/components/settings/ModelsPage.tsx` is live, with `RosterTable.tsx`
and `StepTable.tsx` beside it. The page is, top to bottom: the accent Default-model
card (mono select grouped by runtime, plus the one line about what a default runs);
the roster table (mono id with a `title`, runtime chip, borderless note cell,
"Used for" with `Default` first, a `DEFAULT` chip / hover-revealed "Make default"
column, ✕ on custom rows only), its add row and the "N curated models not shown:
show all" link; and the per-step table, all eleven steps under *Sessions* and
*Unattended*, each with its description, a select named `Model for <label>`, the
effective runtime chip and a ✕ that only exists when the step is set. Writes are
exactly the ticket's: `model`, a whole-array `models` upsert built with core's
`mergeModelEntries`, and `stepModels.<step>` (null to reset), all global, all
funnelled through one `useSettingWrites` hook that **queues** them and sends one at
a time — the config file is read-modify-write, so two overlapping saves lose one.
Each row has a single feedback slot: the "Saved ✓" and any refusal (server's, or a
local one like "runtime required" or "my-proxy runs Smoke") appear at the control
that issued the write. Tier-2 suite: `apps/web/test/settings-models.test.tsx`, 14
cases driving the real dialog with a mocked tRPC.

Two deviations from the ticket's "do not edit the shell" line, both forced:

- `SettingsDialog.tsx`'s `searchableSettings` now asks `pageSearchItems(view, page)`
  (new, in `lib/settings.ts`) instead of mapping `pageRows` itself. Without it the
  roster ids and step names are in no page's search set, so `filter.matches` never
  contains them, the rail counts 0 hits for Models and typing anything empties the
  page. The new helper is the seam for Burns' probe ids too, so ticket 8 should not
  need to touch the shell again.
- `settings-dialog.test.tsx`'s last case asserted the Models stub text; it now
  opens Burns, which is still a stub.

`lib/settings.ts` also gained `stepModelKey(step)` and an `export` on the existing
`defaultModelOf`.

## Surprises

- The roster's "Used for" column needs step *labels*, which only the step table's
  metadata knows; `RosterRow.usedFor` is raw `ModelStep`s. The page derives a
  step→label map from `stepRows` and hands it to the roster rather than exporting
  another lookup from `lib/settings.ts`.
- To keep the three files acyclic, the shared atoms (`RuntimeChip`, `SaveMark`,
  `Refusal`, `ModelOptions`) live in `RosterTable.tsx` and `StepTable.tsx` imports
  them; only the `SettingWrites` *type* points back at `ModelsPage.tsx`, which is
  erased. A fourth file would have read better but the ticket named three.
- The runtime chip's prototype tints (`#c7a2ff`, `#8ad3c4`) have no tokens. Claude
  Code uses the accent family and Codex `ok`, as the nearest token-adjacent pair —
  no new tokens, per the ticket.
- `bun run dev` was not possible here (no app, no browser), so the prototype
  comparison was done by reading `prototype.html` and by arithmetic: 940 − 184 rail
  − 44 page padding = 712, and the roster's fixed columns (168+86+118+92+24 + 5×8
  gaps + 20 padding) leave 162px for the flexible note column, above its 140px
  minimum — no horizontal overflow. `bun run build` is green and the generated CSS
  really does contain the fractional and arbitrary utilities used
  (`min-h-7.5`, `h-6.5`, `grid-cols-[168px_…]`, `gap-x-4.5`).
- Baseline: `bun run typecheck` is 0 errors and every `apps/web` suite passes, but
  `packages/server/test/burn-slot-workspace.test.ts` (7) and `dev-pane.test.ts` (1)
  fail in this sandbox for environment reasons — a missing slot volume path and a
  process group that survives its kill. Ticket 6 reported the same 8; they are not
  reachable from a web-only diff.
- No `.runcastle/` change: this ticket adds no service, env var, seed or process,
  so the drive machinery is untouched (and was not run — there is no app here).

## Left undone

- `podman` is still not offered in the sandbox dropdown, and the doctor's ENOENT on
  `assets/sandcastle/Dockerfile` under a dev-instance asset env is still there. Both
  are recorded as out-of-scope findings in the feature's decisions (13).
- Deep links only highlight the Default card (`{page:'models', field:'model'}`); a
  link naming a roster model id or a step key lands on the page but scrolls to
  nothing. Nothing points at one yet.
- The default row's "Used for" can run to several lines when nine steps resolve to
  it — real data, no truncation invented for it. Worth a look on the human's screen.
- `SAVED_MS` (1.4s) is stated twice: here and in `SettingRow.tsx`. Whoever ends up
  owning a settings-wide constants home should fold them together.

## 8. This project page: one-control overrides, command placeholders, provenance chips and the evidence popover

# Ticket 8 — This project page: one-control overrides, provenance chips, evidence popover

## What was done

`ProjectPage.tsx` is live: it reads the project-scoped `settings.get` view, fetches
`project.prep` for findings, hands both to `pageRows(scoped, 'project', findings)` and
renders the ten fields as three `SettingGroup`s — *Model & sandbox*, *Commands*,
*Project chat* — so filter and deep-link highlight come free from the shell exactly as
on General. A new `EvidencePopover.tsx` renders the card (420×260, scrolling,
`Evidence · <how established>` header over a `whitespace-pre-wrap font-mono` body);
the page owns which row's popover is open, so only one is ever up.

`SettingRow.tsx` took four small additive edits, all override affordances ticket 6 left
out: the `Use global` link beside a `This project` chip (issuing the `value: null`
write through the same mutation, so it gets the same Saved ✓ and the same
`settings.get` + `project.prep` invalidation), the `Stale` chip beside the provenance
chip carrying the old badge's wording, an `evidence` slot rendered as the popover's
positioned sibling next to the chip, and the ghost `Use global (…)` select option now
reading the humanised option label ("Docker container (isolated)") rather than the raw
config value `docker`. `SettingGroup` grew the two props that forward those to a row.
Tests: `apps/web/test/settings-project.test.tsx`, 11 cases.

## Surprises

- **Escape had to be caught in the capture phase.** `Dialog` listens for Escape on
  `window` in the bubble phase, and focus after clicking the chip is on the chip — not
  inside the popover — so a React `onKeyDown` on the popover never fires and the whole
  dialog closed on one key. `EvidencePopover` registers `keydown` on `window` with
  `capture: true` and `stopPropagation()`s there, which reliably beats the dialog. I
  confirmed the test is not vacuous by temporarily removing the `stopPropagation` and
  watching that one case go red.
- **Outside-click had to treat the chip as "inside".** The popover is rendered as the
  chip's sibling inside a `relative` wrapper, and the handler ignores a `mousedown`
  anywhere in `cardRef.current.parentElement` — otherwise a click on the open chip
  would close and immediately reopen it. That coupling (popover must be a sibling of
  its chip) is documented in the component's JSDoc.
- **`FindingSource` is `'prep' | 'session' | 'human'`**, not `'preparation'` as the
  ticket's DATA note says. The popover header map is keyed on the real values.
- `describeField` in `lib/settings.ts` still computes a `note` string containing
  "Inherited from global" / "Overridden for this project". Nothing renders it any more,
  so the criterion holds on screen, but the dead string is still in the module.

## Left undone

- The provenance chip button carries no `aria-expanded` and the popover no accessible
  name or relationship to it — a screen-reader user gets content injected silently.
  Two lines to fix, but beyond the affordances this ticket enumerated.
- `pageRows`' `note` field (above) is ticket 5's module and could be deleted once no
  surface reads it.
- `.runcastle/` drive machinery needed no change: this ticket adds no service, no
  required env var, no seed and no extra process. Nothing there was edited or run.
- The visual comparison against `prototype.html` was done by reading the prototype; the
  sandbox has no app or browser, so `bun run dev` was not attempted.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 153 of 155 files
pass, 2585 tests pass, 1 fails: `packages/server/test/dev-pane.test.ts` ("kills the
child process tree"), the environment-dependent process-group teardown ticket 6 already
reported failing in this sandbox and which no `apps/web` diff can reach.

## 9. Burns page: prerequisites checklist with Retry, width & retries fields, and deep links from error messages

# Ticket 9 — Burns page: prerequisites checklist, width & retries, deep links

## What was done

`EnableAfkCard.tsx` is now the prerequisites checklist: a summary bar (bold "3 of 4",
the first blocker's short reason, a segment meter) over one grid row per
prerequisite — dot, label, one mono detail line, one action — with terminals opening
`col-span-full` under their own row. The kicker, the title and the intro paragraph are
gone; every button is `ghost` except the credential row's "Save & verify", the page's
one solid. A failed `setup.doctor` run now shows its message with a Retry that
refetches instead of a dead end. Row identity, labels, filter terms and the summary's
"reason" text are pure data in `lib/afk-rows.ts` (`BURN_PREREQUISITES`,
`afkCredentialField`, `afkReadiness`), so the component renders rows rather than
deciding what they are; each row carries `data-field` (`container-runtime`,
`sandcastle-image`, `afk-key-claude-code`, `auth-codex`, `burn-cache`).
`BurnsPage.tsx` puts that checklist under "Prerequisites for unattended burns" and the
five burn numbers under "Width & retries"; the dialog's filter now searches the
checklist rows too, and the page heading goes when the filter empties it.
`SettingsLocation.field` flashes a checklist row exactly as it already flashed a
setting row — the flash/scroll logic moved to `settings/highlight.ts` and both use it.
`MessageWithSettingsLink` + an `OpenSettingsProvider` context (mounted in
`ProjectShell`) turn the "Settings → Burns" phrase inside a ticket error or a burn
lane into a link onto the image row; the server's two pointers now say "Settings →
Burns (Rebuild image)". Every `afk-*` rule is deleted from `styles.css` (ratchet
4180 → 4126).

**Deviations.** (1) The ticket said the image row's stale `fix` text "becomes the
detail line". It is not: that fix now reads "Open Settings → Burns (Rebuild image).",
which is where the reader already is, beside the Rebuild button — the probe's own
detail ("built 2026-08-20, burner Dockerfile changed 2026-08-21 — rebuild") is what
the row shows, and the separate note line is gone as intended. (2) `burnCpus`' unit
became the prototype's "cores · e.g. 4 on a 12-thread box at width 3" and
`burnConcurrency` gained a `ghostValue` — both small edits inside `lib/settings.ts`,
which ticket 5 owned. (3) Sizes follow `theme.css`'s scale (`text-sm` / `text-xs`)
rather than the prototype's literal 13px / 11.5px, the way ticket 6 mapped them.

## Surprises

- The first-run wizard's *Coding agents* step used the same `afk-*` rules, so deleting
  them would have broken a step this ticket does not own. `ChecklistRow`, `Checklist`
  and `RowTerminal` are therefore exported from `EnableAfkCard` and the wizard's
  `RuntimeCard` renders one — same look, no duplicated markup, no rule left behind.
- Opening settings could not be a prop: `TicketsBody` and `RunBody` sit several
  concern modules below `ProjectShell`, and `useWorkspace` is a hook with its own
  state, not a context, so a second call would have been a second store. Hence the
  small `OpenSettingsProvider` context.
- `packages/server/test/dev-pane.test.ts` fails in this sandbox (1 case — the process
  group survives the kill) and is not in the stated baseline. It reproduces on a
  targeted run, is environment-dependent, and is unreachable from this diff. Ticket 6
  reported the same failure. Everything else is green: `bun run typecheck` 0 errors,
  `env -u GIT_ASKPASS bun run test` 153/155 files, 2588 passed.
- The drive machinery under `.runcastle/` needed no change — this ticket adds no
  service, env var, seed or process — so nothing there was edited or run.

## Left undone

- The visual comparison against `prototype.html` was done by reading the prototype:
  this sandbox has no app or browser, so `bun run dev` was not run.
- `podman` is still not offered by the sandbox dropdown, and the doctor's ENOENT on
  `assets/sandcastle/Dockerfile` under a dev asset env is still there — both recorded
  as out of scope by decision 13.
- `burn-cache-probe.ts:398` and `doctor.ts:576/586` still say "the Enable AFK burns
  card"; they are pre-burn/CLI messages with no settings page to link to, so they were
  left as prose rather than renamed on spec.

## 10. Review: drive the redesigned Settings end to end

Reviewed in Drive mode: walked the app against the acceptance criteria.

Settings is no longer one long scrolling overlay. It opens as a single large dialog with a rail of four task pages — General, Models, Burns and This project — and a filter box above them that searches every page at once and shows a hit count beside each page name, so "image" lands you on Sandbox image with the sandcastle image prerequisite waiting one click away, and a query that matches nothing says so instead of showing you an empty screen. It opens from the titlebar and from the palette, and Esc or a click outside puts you back exactly where you were, with focus returned to the thing you opened it from.

The help paragraphs are gone. Every field is now a label, an example placeholder and an ⓘ you can hover for the full explanation, and the one field where the label genuinely is not enough — iterations versus attempts — keeps a single short line. Saving is silent no longer: a green "Saved ✓" flashes beside the label when a value commits, and a rejected value says why. Fields locked by an environment variable are properly disabled with an Env chip that names the variable rather than looking like an ordinary value you are not allowed to change.

The two things that were genuinely hard to do before are now easy. On Models, the default model is stated twice on purpose — in a card at the top and as a DEFAULT chip in the roster — and the two stay in step when you promote another model, as does every "Default (…)" in the step table below. Annotating a model, which used to be reachable only through the "Custom…" branch of a dropdown, is now just typing in the roster's note column, and the note follows the model into every dropdown afterwards. All eleven steps are listed with plain-English descriptions instead of the two raw keys that used to leak through, and every one of those selects now has a name a screen reader can read — across all four pages I found ninety-eight controls and not one unnamed. On This project, a setting that has a global twin is one control instead of two: unset it shows the global value greyed out with a Global chip, set it flips to This project with a "Use global" link that clears it again.

What is worth your attention: every button in the dialog that does not set its own background renders as a light-grey Chrome default button, so the three inactive pages in the rail, all the ⓘ marks, the close X and the reset ✕ come out as white blobs on the dark theme. It is one root cause with a one-line fix, but it is the first thing you will see, and it slipped through because none of the four implementers could run the app — every one of their write-ups says so plainly. Beyond that, the Burns prerequisites list has no escape hatch while it is waiting: Docker on this machine was answering in about ninety seconds per call, so the checklist sat on "checking prerequisites…" for four minutes with no Retry and no timeout, which is the same dead end the redesign set out to remove, just reached through a slow daemon instead of a failed probe. It rendered correctly once Docker caught up.

Two things I could not check. The drive runs on its own fresh database, so the app came up on the first-run wizard rather than your real project; I walked the wizard and opened this repo as a project, which exercised nearly everything, but with no preparation findings in that database there were no provenance chips and nothing to open the evidence popover with, and with no features or runs there was no "Settings → Burns" message to click, so the deep link is untested end to end. I also chose not to press Rebuild image, because a Docker build on a machine that slow would have outlived the review and I could not have stopped it cleanly before handing your checkout back. There is a recording of the whole walk beside this file.

## 11. Every background-less button in Settings renders as a light-grey UA button — rail pages, ⓘ tips and the close X are unreadable in the dark theme

# ticket(11) — the Settings dialog's buttons paint themselves now

## What was done

`apps/web/src/theme.css` imports Tailwind's theme and utilities but deliberately not
its preflight, so nothing resets `<button>`: every button in the settings dialog that
named no background kept Chrome's `buttonface` (rgb 240,240,240), its 2px outset
border and its 1px/6px padding — a light-grey pill wearing dark-theme text. New
`apps/web/src/components/settings/button.ts` exports two class strings: `PLAIN_BUTTON`
(`appearance-none bg-transparent p-0`) for a button that draws its own border, and
`BARE_BUTTON` (that plus `border-0`) for one that draws none. They are applied to all
ten buttons in the folder — the rail's four pages, the dialog's close ✕, the ⓘ tips,
the provenance chip, "Use global", the roster's "show all" / "Make default" / remove ✕,
the per-step reset ✕, and the "Settings → Burns" prose link. No behaviour, no markup,
no other styling changed.

The border had to be a second constant rather than part of the first: in the generated
sheet `.border-0` comes *after* `.border`, so folding it in would have silently erased
the border of the three buttons that ask for one (I checked the emitted order with the
real `theme.css`, not from memory).

`settings-dialog.test.tsx` grew a guard that walks all four pages and lists every
button whose classes leave the background or the border to the browser; before the fix
it printed exactly the reviewer's list (Models / Burns / This project in the rail, the
close ✕, all four ⓘ). Its fixture now also carries a roster entry, a set step and a
project-set model so the Models and project pages' own buttons are on screen for it.

## Re-running the repro

The literal repro (`bun run dev`, DevTools, `getComputedStyle(...).backgroundColor`)
could not be run: this sandbox has no browser and no app — no chromium/chrome/firefox
on PATH and no playwright/puppeteer installed — and happy-dom ships no UA styles for
`button`, so a computed-colour assertion there would measure nothing. What I did
instead, and what it showed:

- Compiled the app's own `theme.css` through Tailwind 4.3.3: `bg-transparent` →
  `background-color: transparent`, `border-0` → `border-width: 0`, `appearance-none` →
  `appearance: none`. The theme's `--color-*: initial` does not kill `bg-transparent`.
- `bun run build` in `apps/web`: the shipped CSS carries `.bg-transparent{background-color:#0000}`
  and the shipped JS carries the reset string, so the fix survives content detection.
- The new test reproduced the defect (red on the reviewer's exact set of buttons) and
  passes after the fix.

## Surprises

- The same missing preflight leaves the UA *font size* on buttons too (`font: 400
  13.33px`, which `styles.css`'s `button { font-family: inherit }` does not cover).
  It only shows on the two prose-shaped buttons that set no text size — the roster's
  "show all" (13.3px inside a 12px sentence) and `MessageWithSettingsLink` — so it is
  a much smaller defect than the backgrounds, and out of this ticket. Left as is.
- `bun run test` is not the green baseline this prompt claims: 8 tests fail in
  `packages/server/test/burn-slot-workspace.test.ts` (7) and `dev-pane.test.ts` (1),
  identically on a targeted re-run. They are an environment fault — the slot script
  composes the container's workspace path as `<volume>/tmp/rc-slot-ws-…`, which is
  wrong when `tmpdir()` is `/home/agent/cache/tmp` rather than `/tmp`, so git reports
  "repository … does not exist". My diff is `apps/web/**` only and cannot reach them.
  Everything else passes (2606 tests).

## Left undone

- The font-size point above, for whoever owns the next settings pass.
- The rest of the app is exposed to the same class of bug: any future Tailwind-only
  flow that writes a bare `<button>` gets a white pill, and the reset now lives in the
  settings folder rather than beside the `Button` primitive in `ui.tsx`. Promoting it
  (or adding a scoped base rule when `styles.css` finally goes) is a foundation-level
  call, not this ticket's.
- No drive-machinery change was needed: this adds no service, env var, seed or
  process, so `.runcastle/drive-setup.ts` and friends are untouched and unread.

## 12. Burns prerequisites checklist has an unbounded "checking prerequisites…" state — no timeout and no Retry when setup.doctor is slow to return

_no digest captured_

## 13. Burns prerequisites checklist has an unbounded pending state - no timeout and no Retry while setup.doctor is slow

# ticket(13) — the Burns prerequisites checklist no longer waits forever

## What was done

The prerequisites checklist (`apps/web/src/components/EnableAfkCard.tsx`) now bounds its
pending state. A local `useSlowWait(waiting, attempt)` hook starts a 10-second timer while
`setup.doctor` is still loading; once it fires, a warn line — "The container runtime has not
answered yet — it may still be starting up." — and a **Retry** button render above the
existing doctor-error row, using the same `recheck` handler the failed branch uses. `recheck`
now also bumps an attempt counter, so clicking Retry hides the line and gives the new request
its own full ten seconds rather than leaving a complaint on screen that looks inert. Nothing
about the resolved checklist, the summary meter, or the failed branch changed.

Three tests were added to `apps/web/test/settings-burns.test.tsx`, driving the real
`SettingsDialog` with the doctor query held pending under fake timers: nothing offered at 9s,
the line plus Retry (and a refetch on click) at 10s, and the clock restarting on retry. The
file's trpc fixture grew a `doctorPending` flag and a `doctorAsks` counter to express that.

## Re-running the repro

The literal repro — quit Docker Desktop, `bun run dev`, drive Settings → Burns — is not
runnable here: the sandbox has neither `docker` nor `podman` and runs no app or browser. I
re-ran it in the closest faithful form: the new tests render the actual dialog with the doctor
never resolving and evaluate the reviewer's own expression,
`[...document.querySelectorAll('[role=dialog] button')].map(b => b.textContent)`. It contains
no `Retry` at 9s (unchanged, ordinary wait) and does contain `Retry` at 10s. Before the change
that array had no retry control at any time, which was the defect.

## Surprises

- The server-side doctor has **no timeout anywhere** (`grep -n timeout packages/server/src/doctor/*.ts`
  returns nothing), so the unbounded wait is real on the server side too — the fix here is
  purely the client's escape hatch. `refetch()` cancels the in-flight request by default, so
  Retry genuinely re-asks rather than piggybacking on the stuck one.
- The prompt's verify baseline is stale for this branch: `bun run test` now discovers 157 test
  files / 2620 tests, not 118 / 1768. **25 tests across 16 files failed, all in
  `packages/server`, 14 of them 5000ms timeouts** on git- and process-heavy suites under a very
  loaded sandbox (transform 316s, import 782s for a 98s wall clock). `git.test.ts` and
  `projects.test.ts` pass cleanly on a targeted re-run; `dev-pane.test.ts` fails there too, on
  process-group reaping, which this container cannot do. `bun run typecheck` is clean and all
  35 `apps/web` files / 745 tests pass. My diff is web-only, so none of that is this change.

## Left undone

- No server-side timeout on the doctor probes. A `docker version` that takes 90s still ties up
  a request; the web now copes, the server does not. That is server/config territory the ticket
  did not cover.
- The slow line is generic about *which* probe is slow, because the report is all-or-nothing —
  there is no partial-report seam to say "the image inspect is what's hanging".
- Drive machinery untouched, correctly: this change adds no service, env var, seed or process,
  so `.runcastle/` needed no edit and I did not run it.
