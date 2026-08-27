# Test notes

## Lap 1

- [ ] Standards axis — a live ADR now states a default the code no longer honours, and nothing surfaces the conflict.

What I did: read `docs/adr/0002-burn-concurrency.md` on the feature branch (`git show feature/burn-concurrency-default-by-core-count:docs/adr/0002-burn-concurrency.md`) and checked `git diff main...feature/burn-concurrency-default-by-core-count --name-only`.

What happened: ADR-0002 §5, line 43, still reads "**Configurable width.** `burnConcurrency` (int 1–8, default 3) — global-only setting". The diff touches no file under `docs/adr/`, and no new or superseding ADR was added. On any host with ≤8 logical CPUs the ADR is now simply false.

What I expected: the conflict surfaced somewhere. Citation: `docs/agents/domain.md:58-62`, "## Flag ADR conflicts — If your output contradicts an existing ADR, surface it explicitly rather than silently overriding." The implementer's own digest names this under "Left undone" and argues an ADR records a decision as it was made — a fair position, but the rule asks for the contradiction to be recorded (a superseding note or a new ADR), not for the old text to be edited. Right now a reader of ADR-0002 gets the wrong number with nothing pointing them onward.

Fix is one or two lines: a "Superseded in part by …" note on ADR-0002 §5, or a short new ADR for the host-aware rule.
- [ ] Standards axis — the 8 / 1 / 3 rule is transcribed in three packages, one of them as hand-written English in the UI.

Smell: Shotgun Surgery (with Duplicated Code underneath). Hunks, all on the feature branch:

1. `packages/core/src/config.ts:353-372` — the one place it is code:
   `const SMALL_HOST_LOGICAL_CPUS = 8` … `return Number.isFinite(logicalCpus) && logicalCpus > SMALL_HOST_LOGICAL_CPUS ? 3 : 1`
2. `packages/core/src/config.ts:205` — the schema JSDoc: "Default: 3, or 1 on ≤8 logical CPUs."
3. `apps/web/src/lib/settings.ts:187` — the help string, prose, derived from nothing:
   `help: 'Max tickets burned in parallel per run (1–8). Each is a full agent. Until you set one it follows this machine: 1 on hosts with 8 logical CPUs or fewer, 3 above — parallel agents each size their test workers from the whole core count.'`

What I did: read all three on the branch and grepped for `SMALL_HOST_LOGICAL_CPUS` — it is not exported and has exactly one reader.

What happened: moving the threshold (say to 12, or making the wide width 2) means editing three files in three packages, and nothing fails if you miss the web one — the UI would confidently tell an operator a rule the burner no longer follows. The `Default on this machine: N.` note is safe, because it reads N off the value the server resolved; the *help* sentence beside it is not.

What I expected: the number to be stated once. Exporting `SMALL_HOST_LOGICAL_CPUS` (and the two widths) from core and interpolating them into the help string would collapse 2 and 3 into the constant.

Judgement call, not a hard violation — I checked ADR-0008 §2's "Rules live in one TS table … so there is no second transcription to drift" and that rule is scoped to the burn-guard rule table, so it does not govern here. This finding rests on the smell alone.
- [ ] Spec axis (and Standards, raised independently by both) — `node:os` landed in core, not on the server, and core's documented IO exception was widened with no correction recorded.

Spec line: "Core is IO-free, so the CPU count has to be resolved where config is loaded **on the server** (`os.availableParallelism()` / `os.cpus().length` via node:os) and applied as the default there, not in the zod schema".

What I did: read `packages/core/src/config-load.ts` and `packages/server/src/services/settings.ts` on the branch, plus `packages/core/package.json`.

What happened: `import { availableParallelism } from 'node:os'` is at `packages/core/src/config-load.ts:2`, and the new `hostLogicalCpus()` export at the bottom of the same file is imported *back out of core* by the server — `packages/server/src/services/settings.ts:17`, `import { hostLogicalCpus } from '@runcastle/core/config-load'`. So the host read lives in core.

What I expected: the host read on the server side of the boundary. Standards citation: `CLAUDE.md`, package map — "`@runcastle/core` is the only package with no IO (except `paths.ts` pure path computation and `config.ts` lazy file read inside `loadConfig`)". `node:os` core counting is a third exception, and `docs/research/CORRECTIONS.md` (which CLAUDE.md names as where format/contract corrections go) is untouched by this diff.

Mitigating, and why I rate this low severity rather than a bug: `config-load.ts` is a Node-only subpath export (`"./config-load": "./src/config-load.ts"` in `packages/core/package.json`) that already imports `node:fs`, and it is *not* re-exported from the barrel (`packages/core/src/index.ts` exports `./config` only). So the browser-safe barrel is unaffected, and `resolveDefaultBurnConcurrency` itself is pure and lives in `config.ts` as the criterion asked. Nothing misbehaves at runtime.

Cheapest fix that satisfies the letter: move `hostLogicalCpus()` to a server module and pass the count into `loadConfig`'s existing second parameter — or, if the current placement is the better design, add a line to `docs/research/CORRECTIONS.md` and to CLAUDE.md's exception list saying so.
- [ ] Standards axis — the schema still carries a rival hard-coded default, so `RuncastleConfig.parse({})` remains a silent flat-3 trap.

Smell: Duplicated Code. The wide width is written twice, in two packages' worth of distance from each other:

- `packages/core/src/config.ts:210` — `burnConcurrency: z.number().int().min(1).max(8).default(3),`
- `packages/core/src/config.ts:372` — `… ? 3 : 1` inside `resolveDefaultBurnConcurrency`

What I did: grepped the branch for `RuncastleConfig.parse({})` / `RuncastleConfigSchema.parse({})`.

What happened: two non-test-file readers still exist and one of them is a fixture the whole server suite runs on — `packages/server/test/helpers/db.ts:20`, `return { db, config: RuncastleConfig.parse({}) }` — which hands every server test a config whose `burnConcurrency` is 3 whatever the host is. The production reader, `packages/server/src/services/settings.ts:252`, is correctly patched by the new `hostDefaults()`, so nothing user-facing is wrong today.

What I expected: one number. As it stands, whoever next changes the wide default from 3 has to know to change it in both places, and whoever next writes `parse({})` gets the host-blind value with no compiler or test complaint. The JSDoc at `config.ts:205-209` does warn about this in prose ("the `.default(3)` below is only the floor a raw `parse({})` sees"), which is why this is a judgement call and not a hard violation — but a comment is the weakest available guard.

Worth considering: have the schema default to the small-host width (1) instead, so an unresolved default fails safe rather than fast, or derive both literals from the same constant.
- [ ] Standards axis — `hostDefaultNote` is documented as a general mechanism but is a one-key special case.

Smell: Mysterious Name / Speculative Generality. Hunk, `apps/web/src/lib/settings.ts:507-518`:

```
/**
 * The note under a field whose default the SERVER resolved from this host — only
 * `burnConcurrency`, whose width depends on the machine's core count.
 * …
 */
function hostDefaultNote(field: SettingField): string | null {
  if (field.key !== 'burnConcurrency' || field.source !== 'default') return null
  return `Default on this machine: ${toDisplay(field.value)}.`
}
```

What I did: read the function and its single call site, the new `else` arm of `describeField` (`apps/web/src/lib/settings.ts:556-558`).

What happened: the name and the first line of the doc promise a rule over "a field whose default the SERVER resolved from this host", but the body is a hard-coded equality test on one key, and there is no table or predicate a second such field could join. A reader looking for what makes a field host-resolved finds a string literal.

What I expected: either the narrower honest name (`burnConcurrencyDefaultNote`), or — if more host-resolved defaults are actually coming — the key set expressed as data next to `FIELD_ENV_VAR` (`settings.ts:27`), which is the file's existing idiom for exactly this shape of per-key fact.

Lowest-severity finding in this pass; behaviour is correct. I confirmed the `else` arm is safely last: `field.source === 'env'` is tested first, so the env-locked note ("Set by RUNCASTLE_BURN_CONCURRENCY") is not clobbered, and `field.scope === 'project'` is tested before it too.
- [ ] The drive could not start, and the reason is a trap in the review flow itself — writing a note dirties the working tree, which is the precondition `review_drive start` refuses on.

What I did, in this order:
1. `git status --porcelain` before starting anything → empty output, tree clean.
2. Ran the code review, then called `add_test_note` four times, as the review prompt instructs ("Write notes as you find things, not in a batch at the end").
3. Called `review_drive({ action: "start" })`.

What happened: `{"ok": false, "deniedReason": "Working tree has uncommitted changes — commit or stash first", "drive": null}`. Re-running `git status --porcelain -uall` now shows one entry:

    ?? docs/features/burn-concurrency-default-by-core-count/test-notes.md

That file is 7 KB, dated to the minute I filed the first note, and its contents are my four notes under a `# Test notes` / `## Lap 1` heading. So `add_test_note` mirrors notes into an untracked file inside the repo, and the first note I wrote is what made the tree dirty.

What I expected: either the notes mirror to live outside the checkout (the review prompt is explicit that the agent's own outputs belong at `~/.runcastle/reviews/<ticket>/`, "never inside the repo"), or `review_drive`'s cleanliness check to ignore runcastle's own generated artifacts — the notes mirror, at minimum. As it stands, a review agent that follows the prompt's ordering (code review first, notes as you go, drive second) can never start a drive: the notes it was told to write are what lock it out. An agent that happened to drive before filing any note would have got in.

I did not retry the refusal, and I did not delete or stash the file — it is the human's data and the review prompt forbids editing the repo.

Consequence for this lap: the one user-visible acceptance criterion — "Note in the settings UI … what the effective default is on this machine" — is unverified by driving. I verified its render path statically instead (`hostDefaultNote` → `describeField`'s new `else` → `SettingRow.note` → `SettingsOverlay.tsx:305`, where `{row.note && <div className="settings-field-note">{row.note}</div>}` renders it) and `burnConcurrency` has no `projectColumn`, so its scope is always `'global'` and that arm is reachable. But nobody has seen the sentence on a screen.

This finding is about the review machinery, not about the feature under review.
- [ ] SUMMARY — review pass on `feature/burn-concurrency-default-by-core-count` (4 commits, 8 files, +241/−11).

**Code review: ran in full, both axes.** Base pinned as instructed (`main...feature/burn-concurrency-default-by-core-count`); diff non-empty. Note that the checkout is on `main`, so every file I quote I read via `git show <branch>:<path>` — reading the working tree here silently gives you the base, which is worth knowing if you re-check any of this.

Standards axis — 5 findings, 1 hard violation and 4 judgement calls. Worst within this axis: **ADR-0002 §5 (`docs/adr/0002-burn-concurrency.md:43`) still states "default 3"**, which the branch makes false on small hosts, and no ADR was amended or added — against `docs/agents/domain.md:58-62`'s "Flag ADR conflicts". The implementer names this under "Left undone" and their reasoning is defensible; the rule still wants the contradiction recorded somewhere. The other four: the 8/1/3 rule transcribed in three packages (one of them hand-written UI prose that nothing derives); the schema's rival `.default(3)` leaving `parse({})` a flat-3 trap; `hostDefaultNote`'s general name over a one-key body; and the `node:os` placement below.

Spec axis — 1 finding, low severity, no missing and no wrong requirements. Worst within this axis: **the CPU read landed in core, not on the server.** The criterion says "resolved where config is loaded **on the server**"; `availableParallelism()` is at `packages/core/src/config-load.ts:2` and the server imports `hostLogicalCpus` back out of `@runcastle/core/config-load`. Nothing misbehaves — that module is a Node-only subpath export outside the browser-safe barrel — but it widens CLAUDE.md's stated core-IO exception with no `docs/research/CORRECTIONS.md` entry. Everything else the criterion asked for is present and correct: the pure resolver in `config.ts`, unit tests at exactly 6/8/12/16, explicit-wins precedence (the loader only fills `burnConcurrency` when it is still `undefined` after the file/env spread, so both win), the schema doc restated as "3, or 1 on ≤8 logical CPUs", and the settings-UI note. I raised the `node:os` placement once with both citations rather than twice; the per-axis counts above keep the axes separate.

**Central mechanism verified statically.** The width that actually burns comes from `loadConfig()` at `packages/server/src/workflows/ticket-burner.ts:3375` → `concurrency: config.burnConcurrency` at `:3426`, so the host-aware default really does reach the worker pool. The settings view's separate `parse({})` path is patched by the new `hostDefaults()` (`packages/server/src/services/settings.ts:261`), so UI and burner agree — the implementer flagged that divergence as their main surprise and it checks out.

**Drive: could not start** — refused for a dirty tree, caused by `add_test_note`'s own repo-side notes mirror. Filed separately; it is a review-machinery problem, not a feature one. So the one user-visible criterion (the "Default on this machine: N." note in Settings → Global) is verified only by reading the render path through to `SettingsOverlay.tsx:305`, not by seeing it. Someone should open Settings once.

**Not verified: the test suite.** I did not run it — doing so would have meant checking out the branch or adding a worktree in the human's repo. The implementer reports typecheck clean and 2254 passed / 4 skipped, with `dev-pane.test.ts` failing in their sandbox on process-reaping and `pty-teardown.test.ts` flaking under load. Those claims are unconfirmed by me.

**Worth your attention, not a finding:** `burnCpus` is still unset by default, so the audit's actual root cause — each container sizing its worker pools from the host's full core count — is mitigated by burning narrower, not fixed. `docs/adr/0008-burn-performance.md:105-110` already records `burnCpus` as the remedy for exactly that sentence. The implementer says so plainly in their digest. Whether one lever is enough is a call for you, not a defect in this diff.

No implementation ticket in this lap failed; this is a review of a fully-built change.
