# Outcome — Drive instructions: the project tells review agents how to drive it

A per-project, human-editable drive-instructions field — authored by preparation, editable in settings, injected into every drive-mode review/verification prompt — so agents know how to exercise this app instead of walking in cold.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

11 commits · 26 files

### Lap 1
- 3 tickets landed: #1 driveInstructions: prep-recordable, human-editable project field; #2 {{DRIVE_INSTRUCTIONS}} injected into both drive-mode prompts; #3 Settings textarea and review-page drive-instructions block
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: b0bb35d978e15b08e0034404c645d87655049991
- Landed since: 0
- Outcome: done

- **Drive-instructions settings field passes its full edit lifecycle** — open
- **Review-page instructions block could not be exercised without burning a newly created feature** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. driveInstructions: prep-recordable, human-editable project field

# ticket(1) — driveInstructions: prep-recordable, human-editable project field

## What was done

`driveInstructions` is now the eighth prepared key, riding the `dbResetCommand` rails end to
end: a nullable `drive_instructions` text column on `projects` (migration
`packages/server/drizzle/0036_project_drive_instructions.sql`), an entry in `PREPARED_KEYS` and
on the `Project` wire schema, both findings column maps, `rowToProject`, and a project-only
settings descriptor with no `configKey` and no `envVar` — so a global write is refused and there
is nothing machine-wide to inherit. It is deliberately absent from `DRIVE_LOOP_KEYS`: prose has
no exit code, so it carries no verification badge. `resolvePreparedSettings` in core was not
touched, as the ticket specified. The prepare skill's key list gained an eighth bullet saying
what belongs in the field (sample project / scratch data, how to reach deep states, what a
driver may change inside the running app), that its evidence is the closing dry-run drive, and
that it authorizes actions inside the app under test and nothing else.

Provenance and clear-to-re-derive needed no code, as predicted — `recordHuman` is per-descriptor
— so the work there was proving it: new tests in `settings.test.ts` (project-only, verbatim
multiline round-trip, refused without a projectId, absent from the global view, emits
`settings.updated`), `findings.test.ts` (prep writes it, a human edit locks it, clearing re-opens
it), and `prepare-session.test.ts` (`record_finding` accepts the key and lands the prose, blank
lines intact). Two commits, both green.

## Surprises

- **`bun run db:generate` re-emitted three columns that already exist.** The last migration on
  this branch, `0034_review_evidence_stamps.sql`, was hand-written without a drizzle-kit snapshot
  or journal entry, so the generator's picture of `tickets` was three columns behind and it tried
  to `ADD pass_kind / reviewed_commit / completed_at` again — which would have thrown on any
  existing database. I trimmed the generated SQL to my one `ALTER` and renamed it descriptively,
  but kept the generated snapshot and journal entry: the snapshot now matches the real schema, so
  the *next* `db:generate` on this repo comes out clean instead of repeating the same collision.
  That is why the diff carries a 1128-line `meta/0036_snapshot.json` for a one-line migration.
- **`docs/SPEC.md` §14's prepared-key list is already stale** — it names five keys and omits
  `driveSetupCommand` / `driveStopCommand`, which have been in `PREPARED_KEYS` for a while. I did
  not add mine to it rather than half-fix a list two keys behind; CLAUDE.md flags these as
  build-era documents.
- **One pre-existing test failure, not in my baseline:**
  `packages/server/test/dev-pane.test.ts` → "kills the child process tree so the port-holder is
  not orphaned" fails on `expect(pidAlive(-pgid)).toBe(false)`. It reproduces on a targeted
  single-file run and is unrelated to this diff — it exercises `src/pty/pty`, `src/pty/registry`
  and `src/pty/dev-pane`, none of which this ticket touches; it is a POSIX process-group reaping
  artifact of this container. Everything else is green: full suite 3368 passed / 1 failed / 4
  skipped, workspace typecheck 0 errors.

## Left undone

- **`apps/web/src/lib/prep-findings.ts`'s `PREPARED_LABEL` has no entry for the new key**, so the
  preparation workspace will render the raw string `driveInstructions` where it shows a human
  label (both call sites fall back with `?? key`, so nothing breaks). That is web work and the
  ticket assigned the web surfaces to ticket 3 — whoever takes it should add the label there as
  well as the `FIELD_META` row in `apps/web/src/lib/settings.ts`, and consider whether the key
  belongs in `HOST_ONLY_PREPARED` (it is never executed at all, so "proposed, not measured" is
  arguably the wrong frame for it).
- **Drive machinery: checked, not run.** No edit was needed — this ticket adds no service, no
  required env var, no seed and no extra process, only a migration, and `.runcastle/drive-setup.ts`
  already points `RUNCASTLE_MIGRATIONS_DIR` at the checkout and runs `bun install` plus the
  migration unconditionally, so a branch that adds a migration is covered by design. I verified
  offline that both scripts named by the setup/stop commands exist and that
  `.runcastle/drive.env` is gitignored; I did not execute them (no services in this sandbox).
- `{{DRIVE_INSTRUCTIONS}}` and its builder are ticket 2's; the settings textarea and the
  review-page block are ticket 3's. Nothing here presumes their shape beyond the column.

#### 2. {{DRIVE_INSTRUCTIONS}} injected into both drive-mode prompts

# ticket(2) — {{DRIVE_INSTRUCTIONS}} injected into both drive-mode prompts

## What was done

`buildDriveInstructions(instructions)` is a new exported pure builder in
`packages/server/src/workflows/review-ticket.ts`, sitting next to `buildDriveAvailability` and
built in the `buildGateNotes` style: trimmed-empty (or null/undefined) renders exactly the
one-line empty state — "No drive instructions recorded for this project — drive from what the
ticket, the diff, and the app surface tell you." — and set renders a fixed framing sentence
followed by the operator's prose verbatim inside a fenced block. The framing carries decision 7's
scope contract word for word: the instructions authorize actions inside the driven app only, do
not change the reviewer's review rules, do not permit edits to the repository under review, and
do not override any guard on the reviewing session. `DRIVE_INSTRUCTIONS` joined the workflow's
`PLACEHOLDERS` list with a doc comment and is built from `project.driveInstructions` at the render
site beside `DRIVE_AVAILABILITY`. Both burner templates declare it inside their own Drive-mode
material — directly under `### 2a. Drive mode — walk the app` in `review-ticket.md`, and between
the Drive-mode and Gates-mode paragraphs in `verify-fixes.md`. Nothing in the Gates-mode content
or `{{GATE_NOTES}}` moved. Three commits, each green.

The only deviation from the ticket's letter is placement in `review-ticket.md`: the ticket said
"near where `{{DRIVE_AVAILABILITY}}` renders", but in that template availability renders up in
`## Whether a drive is available`, before mode selection, so putting instructions there would
hand a sample project's path to every Gates-mode review. The ticket's other phrasing — "inside
the Drive-mode material" — and decision 5's reasoning both point at step 2a, so that is where it
went. `verify-fixes.md` has no such split, so the block sits with its Drive-mode paragraph.

## Surprises

- **`bun test <file>` is not this repo's runner.** The ticket's suggested
  `bun test packages/server/test/...` runs bun's own test runner, under which
  `ticket-burner-units.test.ts` reports 3 spurious failures (`vi.unstubAllEnvs is not a
  function`). The repo's `test` script is `vitest run`; under `bunx vitest run` those same two
  files are 200/200 green. Anyone verifying this ticket should use vitest, not `bun test`.
- **No test asserted the full placeholder list**, so nothing had to "learn the new name" — but the
  two `renderReviewPrompt` tests take a `Record<(typeof PLACEHOLDERS)[number], string>`, so adding
  the key failed typecheck until both call sites supplied it. That is the same guard by a
  different route, and it is worth keeping.
- **The pre-existing failure ticket 1 reported is still there and still not in the baseline:**
  `packages/server/test/dev-pane.test.ts` → "kills the child process tree so the port-holder is
  not orphaned". Full suite: 1 failed / 3371 passed / 4 skipped; typecheck 0 errors. That file
  exercises `src/pty/*`, which this diff does not touch.

## Left undone

- The free text is fenced with ``` for the same reason `knownFailures` is, which means operator
  prose containing its own ``` fence would break the block. The exposure is identical to the
  existing gate-notes path, so fixing it here alone would have been half a fix outside this
  ticket's scope; if anyone cares, both builders want the same treatment.
- The review-page read-only block and the settings textarea are ticket 3's; nothing here presumes
  their shape beyond the builder's output being prompt-only.
- **Drive machinery: checked, not run.** This ticket adds no service, no required env var, no seed
  and no extra process — only prompt content — so no `.runcastle/` edit was triggered. I confirmed
  offline that both scripts named by the configured setup/stop commands (`.runcastle/drive-setup.ts`,
  `.runcastle/drive-stop.ts`) exist in the repo; I did not execute them, as this sandbox has no
  services or app.

#### 3. Settings textarea and review-page drive-instructions block

# ticket(3) — the settings textarea and the review page's drive-instructions block

## What was done

`driveInstructions` is now a `FIELD_META` row in `apps/web/src/lib/settings.ts`: label "How to
drive this app", `control: 'textarea'`, on the "This project" page in the Commands group between
`dbResetCommand` and `sessionBranch`, with no env-var entry and no global twin — so it renders as
a multiline field with no source chip and no ghost. Its `shortHelp` is the scope note, exported
as `DRIVE_INSTRUCTIONS_SCOPE_NOTE` ("Applies inside the app under test only — it changes no review
rule and permits no edit to the repo under review.") so the settings row and the review page carry
one string rather than two copies that drift. `PREPARED_LABEL` in `lib/prep-findings.ts` gained
the matching label, which ticket 1 flagged as left undone; I left the key OUT of
`HOST_ONLY_PREPARED` deliberately — that set exists to caption values a sandbox could not execute,
and prep writes this one from the drive it just did, so "Established by preparation" is the honest
note.

On the review page, `DriveInstructions` is a new export in `components/review/drive-parts.tsx` —
the section title, the text as `whitespace-pre-wrap` prose, the scope note, and a `SettingsLink`
("Edit in settings") pointing at `{ page: 'project', field: 'driveInstructions' }`. It returns
null on a blank or whitespace-only value, so an unset project gets no empty shell. `ReviewBody`
renders it directly under the `StatusStrip`, which is where the Test drive control lives now that
decision 6 retired the test-drive explainer band, and reads the project row from
`trpc.project.list` — the same query key the shell already polls, so the page pays for no extra
fetch.

Tests: `settings.test.ts` (row order, control kind, the exact scope note, placeholder, no
chip/ghost), `settings-project.test.tsx` (tier 2 — the field is a `TEXTAREA` holding the stored
prose, an edit issues the project-scoped write, clearing issues an unset), `review-bands.test.ts`
(tier 1 — the block with text, scope note and settings affordance when set; nothing at all when
unset or whitespace).

## Surprises

- **"Clear empties" did not work for any project field, not just mine.** `fieldCommit` committed a
  blanked text/textarea as `''`, and every string descriptor server-side is `z.string().min(1)`,
  so emptying a project-only field came back as a validation refusal instead of clearing the
  value. Since clearing a prepared field is also how you hand it back to preparation, I made
  `fieldCommit` send `null` for a blank **textarea** — the narrowest change that meets the
  criterion. `text` controls are untouched, so the existing "blank included" assertion still
  stands; the incidental effect is that blanking a *global* `verifyCommands`/`knownFailures` now
  errors with "cannot be cleared" rather than with a min-length message. Blanking a project-scoped
  twin now drops the override, which is what "Use global" already did.
- The block renders on a readonly (shipped-history) review view too. Decision 33a bars live
  *controls* there; this is a description of the project plus a link into settings, and the ticket
  says nothing about readonly, so I took the smaller reading rather than inventing a rule.
- A `not.toContain('<textarea')` assertion on the review page is a trap — the note composer has
  one. The read-only claim is asserted on the paragraph markup instead.

## Left undone

- Ticket 2's `{{DRIVE_INSTRUCTIONS}}` builder had not landed when I finished; nothing here depends
  on it, and the scope-note wording in `DRIVE_INSTRUCTIONS_SCOPE_NOTE` is the web's own — if the
  template's framing header ends up phrased differently, the two are worth reading side by side.
- **Drive machinery: checked, not run.** No edit needed — this ticket adds no service, no required
  env var, no seed and no extra process, only web rendering. I confirmed `.runcastle/drive-setup.ts`
  and `.runcastle/drive-stop.ts` (the two scripts the configured commands invoke) exist in the
  tree; I did not execute them, as this sandbox has no services.
- Verification: `bun run typecheck` 0 errors; `env -u GIT_ASKPASS bun run test` → 3373 passed, 1
  failed, 4 skipped. The one failure is `packages/server/test/dev-pane.test.ts` "kills the child
  process tree…", the POSIX process-group reaping artifact ticket 1 already reported — it is
  outside my diff (server PTY code) and outside the stated baseline.
