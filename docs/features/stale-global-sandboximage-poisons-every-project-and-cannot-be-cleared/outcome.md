# Outcome — Stale global sandboxImage poisons every project and cannot be cleared

Burns in unrelated projects fail with another project's image (observed: `pnpm is not installed in image sandcastle:runcastle-bl` in one install; `claude is not installed in image sandcastle:runcastle-demo` for project JanaLearn on this machine, event 9/11). Cause: resolveSandboxImage (packages/core/src/config.ts:395) resolves project column → RUNCASTLE_SANDBOX_IMAGE → global ~/.runcastle/config.json → DEFAULT_SANDBOX_IMAGE, and older runcastle versions wrote built project images (then tagged by project NAME, e.g. sandcastle:runcastle-demo) into the GLOBAL config file; current code writes only the project column with id-based tags (services/project-image.ts, projectImageTag = sandcastle:runcastle-<projectId>), but nothing heals the stale global value, so every project without its own column inherits a foreign image. Compounding bug: the doctor's fix text says 'clear the sandbox image setting to go back to sandcastle:runcastle', but updateSettings (packages/server/src/services/settings.ts:465) throws '<key> cannot be cleared' for any global-scope null, and clearing the PROJECT override just falls through to the poisoned global value again — the prescribed remedy is impossible from the UI. Fix, two parts. (1) Make the global sandboxImage clearable: a null-value updateSettings without projectId for sandboxImage removes the key from config.json and refreshes ctx.config in place, emitting settings.updated; decide whether to allow this for all config-file keys with optional schema defaults or just sandboxImage — keep it minimal, sandboxImage alone is fine, but say so in the code. Make sure the settings UI actually offers the clear affordance at global scope for this field. (2) Startup heal for legacy values: on server boot, if the global config sandboxImage matches the legacy name-based pattern sandcastle:runcastle-<something> and is neither DEFAULT_SANDBOX_IMAGE nor any known project's projectImageTag(id), emit a loud warning event (and doctor row) naming it as legacy residue — do NOT silently delete a value a human may have typed deliberately; the doctor's unmanagedImage path (services/sandbox-image.ts:161) already classifies it, so wire the message there rather than inventing a new classifier. Do NOT touch how image builds adopt tags into the project column (project-image.ts / setup.ts adoptProjectImage) — that path is correct. Tests: updateSettings global-clear removes the key from the config file and the field resolves back to default; project-clear still writes the column; the doctor fix text and the clear affordance agree.

- Shipped: 2026-09-14
- Laps run: 1

## What shipped

5 commits · 12 files

### Lap 1
- 1 tickets landed: #1 Burns in unrelated projects fail with another project's image…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 404f829182c4c910a3176a0b3e0a48dfb975ae8e
- Landed since: 0
- Outcome: done

- **Startup legacy-image warning and doctor wording were not exposed by the live Settings walk** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Burns in unrelated projects fail with another project's image…

# ticket(1) — stale global sandboxImage

## What was done

Both halves of the fix landed, in four commits on the ticket branch.

**The global value is now clearable.** `updateSettings` used to throw
`<key> cannot be cleared` for *any* null write without a `projectId`. It now
routes those to a new `clearGlobal`, which removes the key from
`~/.runcastle/config.json`, deletes it from the shared `ctx.config` object (so
the next launch resolves without it, not just the next server boot), and emits
`settings.updated` with `value: null` on the global timeline. A
`GLOBAL_CLEARABLE_KEYS` set gates it, and — as the ticket allowed — it holds
`sandboxImage` alone, with a comment saying why every other config-file key was
typed deliberately and has nothing to un-type. Project-scope clears are
untouched and still write the column.

**Legacy values are named, never deleted.** `legacyGlobalImage(imageName,
knownProjectIds)` in `services/sandbox-image.ts` is `unmanagedImage`'s question
asked of the global layer with "this project" widened to every project: a
`sandcastle:runcastle-<x>` that is neither the stock image nor any known
project's `projectImageTag(id)`. `warnLegacyGlobalImage(ctx)` runs at boot from
`startServer` — `console.warn` plus a `settings.legacyImage` event on the global
timeline — and the doctor's existing `custom` image row swaps its detail and fix
text for the legacy wording rather than gaining a row of its own. Nothing
deletes the value.

**The UI offers the clear the doctor prescribes.** `describeField` gained a
`clearable` flag (global scope, source `file`, key in the web's mirror of
`GLOBAL_CLEARABLE_KEYS`) and `SettingRow` renders a `Clear` link for it. The
existing null-write handler was already there as "Use global"; since clearing is
the same act in both scopes, the prop was renamed `onUseGlobal` → `onClear` and
global scope simply got its own label.

Deviation from the ticket's sketch: the ticket said to wire the message through
`unmanagedImage` rather than invent a new classifier. `unmanagedImage` takes a
`StoredProjectImage` and answers about a project *column*, so it cannot be
handed a global value as-is. I added `legacyGlobalImage` as an explicit
one-layer-down restatement of the same rule (documented as such, reusing
`projectImageTag`/`DEFAULT_SANDBOX_IMAGE`) and wired its message into the
doctor's existing unmanaged-image row — no new doctor row, no second
classification of project columns.

## Surprises

- The doctor probe could not answer "is this legacy?" from what it already had:
  the rule needs *every* project id, and the probe only ever receives the one
  project whose card is open. `DoctorEnv`/`ImageProbeInput` gained an optional
  `knownProjectIds`, supplied by the setup tRPC router via the existing
  `allProjects`. It is deliberately optional rather than defaulting to `[]`:
  `runcastle doctor` (the CLI) has no database, and an empty list would make it
  call every `sandcastle:runcastle-<x>` it met legacy residue. Absent means "say
  nothing", which is tested.
- The doctor row's legacy branch also flips severity. A custom image that *is*
  built locally is `info`, but residue nobody chose is worth acting on however
  buildable the tag happens to be, so the legacy path is always `error`.
- The pre-existing-failure baseline in the burn prompt is stale: it claims 118
  files / 1768 tests, and this tree runs 250 files / 3678 tests.
- `packages/server/test/dev-pane.test.ts > "kills the child process tree so the
  port-holder is not orphaned"` fails, both in the full suite and in isolation.
  It is an environment fault, not mine: it kills a real process group and
  asserts it was reaped, and it imports only `src/pty/*`, `services/events` and
  the test helpers — none of which this diff touches. Everything else is green
  (3673 passed), and `bun run typecheck` is 0 errors.

## Left undone

- `GLOBAL_CLEARABLE_KEYS` is duplicated in `packages/server/src/services/
  settings.ts` and `apps/web/src/lib/settings.ts`, each commenting that it
  mirrors the other. Sharing it would mean a new export from `@runcastle/core`;
  with exactly one key in the set that seemed more surface than the ticket
  wanted. Worth revisiting the moment a second key becomes clearable.
- `warnLegacyGlobalImage` lives in `services/settings.ts` rather than
  `services/sandbox-image.ts`. `sandbox-image.ts` is deliberately db-free and is
  imported by the doctor CLI; putting a `ctx`-reading emitter there would drag
  drizzle into that import graph. The pure classifier stayed in
  `sandbox-image.ts`, the IO in `settings.ts`.
- The boot warning fires on every boot for as long as the value is there. That
  is intentional (the value is never deleted), but nobody de-duplicates it, so a
  long-lived install that ignores the advice accumulates one event per restart.
- Drive machinery: checked, not changed, and not run (the sandbox has no
  services). This ticket adds no service, no required env var, no seed and no
  extra process — `warnLegacyGlobalImage` only reads config that already loads —
  so none of the four triggers apply. I confirmed `.runcastle/drive-setup.ts`
  and `.runcastle/drive-stop.ts` are both present and that `drive-setup` still
  writes `.runcastle/drive.env`. They are TypeScript, so there is no `bash -n`
  equivalent to parse-check them offline.
