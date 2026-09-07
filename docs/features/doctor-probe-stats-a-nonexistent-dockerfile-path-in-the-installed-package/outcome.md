# Outcome — Doctor probe stats a nonexistent Dockerfile path in the installed package

Bug (runcastle 1.3.2 installed via bun add -g): the setup doctor crashes with ENOENT stat '<pkgRoot>/assets/sandcastle/Dockerfile', which 500s the tRPC doctor query and leaves the home page stuck on 'loading projects…'. Root cause: runDoctor in packages/server/src/doctor/doctor.ts:606-608 falls back to a hardcoded fileURLToPath('../assets/sandcastle/Dockerfile') relative to the bundle, but the published package ships the template as <pkgRoot>/sandcastle-template (see packages/server/src/launcher/asset-paths.ts:62). sandcastleTemplateDir() in packages/server/src/services/setup.ts:355 already resolves the template correctly (RUNCASTLE_SANDCASTLE_TEMPLATE env override, resolveAsset fallback) — the doctor just never uses it. Fix: (1) both callers pass burnerDockerfile explicitly — the tRPC setup router at packages/server/src/trpc/routers/setup.ts:43 and resolveDoctorEnv in packages/server/src/doctor/cli.ts:47 — built as join(sandcastleTemplateDir(), 'Dockerfile'); (2) change runDoctor's own fallback to also go through the resolver (or at least point at the layout that exists in both dev src/ and the published package) so a bare call still works. Regression test: runDoctor's resolved burnerDockerfile in the no-env case must be a path that exists in the published package layout — simulate by asserting the fallback derives from sandcastleTemplateDir(), not a hardcoded assets/sandcastle path. Note: works in dev because src/assets/sandcastle/ exists in the repo; only the published tarball renames it, so verify against the package.json files list / publish layout.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

4 commits · 9 files

### Lap 1
- 2 tickets landed: #1 Bug (runcastle 1.3.2 installed via bun add -g): the setup doctor…; #3 Bare runDoctor still resolves an absent Dockerfile in the published no-env layout
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: aaeebef5b06e4b70bb6f69d09d265c68699abe14
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 2f9edad818fb8ffbc25061bdbc7cb90cabd1f48a
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Bare runDoctor still resolves an absent Dockerfile in the published no-env layout

# ticket(3) — the bare-runDoctor fallback now names a path the tarball ships

## What was done

`sandcastleTemplateDir()` still fell back to `../assets/sandcastle` relative to its own
module, which is the source-checkout layout only. I replaced that with a new exported
`sandcastleTemplateFallback(moduleDir)` in `packages/server/src/launcher/asset-paths.ts`.
It tries three candidates and returns the first that exists on disk: the source
`assets/sandcastle` dir, and the vendored `<pkgRoot>/sandcastle-template` computed from
`vendoredAssetPaths()` for two package roots — the module's own dir (the bundled
`index.js` lands at the package root) and its parent (the bin lands at `<pkgRoot>/bin`).
Deriving the installed candidates from `vendoredAssetPaths()` keeps them from drifting
from what `scripts/build-package.ts` actually writes. The fallback takes `moduleDir` as
a parameter so both layouts are testable without building a tarball; the new tests live
in `packages/server/test/asset-paths.test.ts` and cover the installed layout from both
module positions and the contributor checkout, all with the env var unset.

**I re-ran the reviewer's repro step for real.** I built the actual publish layout
(`bun run build:pkg`), bundled `doctor/doctor.ts` into that layout the same way the build
bundles its entrypoints (once at the package root, once under `bin/`), unset
`RUNCASTLE_SANDCASTLE_TEMPLATE`, imported the built module and called `runDoctor` with no
`burnerDockerfile` while capturing `fileMtime`'s path. Both positions now resolve to
`<pkgRoot>/sandcastle-template/Dockerfile`, and it exists. Evaluating the pre-fix
expression from the same two positions gives `packages/server/assets/sandcastle/Dockerfile`
and `<pkgRoot>/assets/sandcastle/Dockerfile` — neither exists, which is the reported ENOENT.

## Surprises

- The published bundle has *two* module positions, not one: `index.js` at the package root
  and `bin/runcastle.js` one level under it, and each entrypoint gets its own inlined copy
  of `asset-paths`. A single relative fallback cannot be right for both, which is why the
  candidate list carries `moduleDir` and its parent.
- `packages/server/test/dev-pane.test.ts > "kills the child process tree so the port-holder
  is not orphaned"` fails, both in the full suite and run alone. It is not in my prompt's
  baseline list, but it is untouched by this diff (I changed only `asset-paths.ts` and its
  test) and it is a process-group reaping assertion — an environment fault in this sandbox.
  Everything else is green: `bun run typecheck` 0 errors; the suite is 222 files / 3284
  passed with that one failure. Note the prompt's baseline numbers (118 files, 1768 tests)
  are stale for this branch, which now runs 224 files / 3289 tests.
- Running the repro needed a stub `nanoid` under the build dir — `nanoid` is a
  `@runcastle/core` dependency that is not installed in this sandbox's `node_modules` at
  all, so the built bundle could not resolve it. Nothing to do with this ticket, but it
  would bite anyone else trying to execute the published bundle here.

## Left undone

- `sandcastleImageProbe` calls `fileMtime(burnerDockerfile)` unguarded, so *any* missing
  Dockerfile — a deleted template, a `RUNCASTLE_SANDCASTLE_TEMPLATE` pointing at a dir
  without one — still throws ENOENT out of the tRPC doctor query and hangs the home page.
  This ticket only guarantees the path is right; making the probe report `missing` instead
  of throwing would make the doctor unhangable, and is a natural follow-up.
- The published-install test in `doctor.test.ts` still sets the env var first. I left it —
  it is a valid case (the CLI path) and the no-env case is now covered where it can
  actually be exercised, in `asset-paths.test.ts`.
- Drive machinery: no edit needed and none made. This change adds no service, no required
  env var, no seed and no process — it only changes how an existing optional env var is
  fallen back on. I did not run `.runcastle/drive-setup.ts` (no services in this sandbox).
