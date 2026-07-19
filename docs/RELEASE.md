# Releasing runcastle

> **Build-time document.** The mechanical runbook for cutting a runcastle
> release to npm. Written for the 1.0.0 cut (issue #53, spec #35); the steps
> generalize to every later release. It captures the pieces that need
> credentials and judgment — the parts a machine cannot do for you — plus the
> gotchas that will bite if you skip them.

## What ships

One npm package named `runcastle`, assembled from `packages/server` by
`scripts/build-package.ts` (issue #51). The source manifest is `private` and
named `@runcastle/server`; the build step flattens it into a public, installable
package under `packages/server/build/` (public name, no `workspace:*`, core
bundled in, runtime assets vendored as real files). **You never publish the
workspace directly — you publish the `build/` output.**

The npm name is **already owned** by the maintainer account (`muathzaher`):
`runcastle@0.1.0` and `0.2.0` are the abandoned "castellan" CLI. Reclaiming the
name is not a dispute — it is publishing a higher version over your own package
and deprecating the old ones.

## Preconditions

- [ ] All release-blocking issues closed (for 1.0.0: #51, #40, #42, #52).
- [ ] `bun --version` ≥ the pin in `package.json` `engines.bun` (currently
      `>=1.3.14`). The published manifest inherits this floor, so a user on an
      older Bun is refused at install — build on a Bun that satisfies it.
- [ ] Clean tree on the release commit; `bun run test` green (480+ passing).
- [ ] Logged in to npm as the owner account: `npm whoami` returns `muathzaher`
      (run `npm login` if not). Bun publishes through the npm auth token, so an
      `npm login` session is what authorizes the publish.

## Step 1 — Build and inspect the tarball

Stamp the release version through the `RUNCASTLE_RELEASE_VERSION` env var. It is
**not** read from any file — omit it and the manifest defaults to `0.0.0`. It
must be a real **environment** variable the `bun` child inherits, so the syntax
differs by shell.

PowerShell (Windows — the primary dev shell):

```powershell
cd packages\server
$env:RUNCASTLE_RELEASE_VERSION = "1.0.0"
bun run build:pkg
# cleanup (optional): Remove-Item Env:RUNCASTLE_RELEASE_VERSION
```

bash / zsh (macOS, Linux):

```sh
cd packages/server
RUNCASTLE_RELEASE_VERSION=1.0.0 bun run build:pkg
```

> **Gotcha — do not use `$RUNCASTLE_RELEASE_VERSION=1.0.0; bun run build:pkg` in
> PowerShell.** That sets a PowerShell *variable*, not an environment variable,
> so `bun` never sees it and the manifest silently falls back to `0.0.0`. Use
> `$env:` as above.

This bundles the server + bin (core inlined, deps external), builds the web SPA,
and vendors drizzle migrations, the hook client, the PTY sidecar, the skills
pack, the built SPA, and the sandcastle template into `build/`.

Verify before packing (PowerShell):

```powershell
cd build
Select-String '"version"|"name"' package.json   # -> "version": "1.0.0", "name": "runcastle"
bun pm pack                                      # -> runcastle-1.0.0.tgz
tar tzf runcastle-1.0.0.tgz | Select-String 'bin/runcastle.js|index.js|pty-host.cjs|web/index.html'
```

bash equivalent: `grep '"version"' package.json`, `tar tzf … | grep -E …`.

**Gotcha — never run `bun pm pack` from `packages/server` (the source dir).**
The source manifest has a `prepack` script that re-runs the build *without*
`RUNCASTLE_RELEASE_VERSION`, resetting the version to `0.0.0` and clobbering your
tarball. The `build/` manifest has no scripts, so packing from there is safe.
Always pack from `build/`.

## Step 2 — Deprecate the old versions

Point the abandoned castellan CLI at the new app so anyone who lands on it knows
where to go. Deprecating does **not** unpublish — the tarballs stay installable,
they just carry a warning.

```sh
npm deprecate "runcastle@0.2.0" "Old 'castellan' CLI. runcastle is now a local agent app — install runcastle@latest and run 'runcastle'."
npm deprecate "runcastle@0.1.0" "Old 'castellan' CLI. runcastle is now a local agent app — install runcastle@latest and run 'runcastle'."
```

## Step 3 — Publish

```sh
cd packages/server/build
npm publish            # publishes runcastle-1.0.0 from this dir
# or, to stay on Bun: `bun publish` (same npm auth token). `deprecate` in
# Step 2 has no Bun equivalent, so the npm CLI is required there regardless.
```

Because `1.0.0 > 0.2.0`, npm moves the `latest` dist-tag to `1.0.0`
automatically — no `--tag` needed. Confirm:

```sh
npm view runcastle version        # -> 1.0.0
npm view runcastle dist-tags      # -> { latest: '1.0.0' }
```

## Step 4 — Make the repo public

This is a one-way, outward-facing decision — confirm the maintainer wants it
before running. Git history was audited clean of secrets (spec §J), and the
build corpus carries "build-time document" headers.

```sh
gh repo edit MuathZahir/runcastle --visibility public --accept-visibility-change-consequences
```

## Step 5 — Tag and cut the GitHub release

```sh
git tag -a v1.0.0 -m "runcastle 1.0.0"
git push origin v1.0.0
gh release create v1.0.0 --title "runcastle 1.0.0" --notes "First public release. Install: bun add -g runcastle"
```

## Step 6 — Verify on a machine that never saw the repo

The real acceptance test. On a clean machine (or a fresh container / VM):

```sh
bun add -g runcastle
runcastle --version        # -> 1.0.0
runcastle doctor           # names any missing prerequisite
runcastle                  # boots the server, serves the app on :4512
```

Then confirm the **update banner** path against the live registry: a fresh
1.0.0 install must show **no** banner (it is current). The check hits
`https://registry.npmjs.org/runcastle/latest` and compares `.version` to the
running version (`checkForUpdate` in `src/services/update-check.ts`); with
`latest` now `1.0.0`, an up-to-date install reports `updateAvailable: false`,
and only an older install is prompted with `bun add -g runcastle@latest`.

## Notes / open decisions

- **System `node` is required on Windows** for the PTY sidecar — documented in
  the README; the doctor reports it.
- **Linux install** relies on the vendored node-pty prebuild bridge (glibc
  x64/arm64); musl/Alpine has a documented compile fallback. First-run asserts
  the PTY native binary actually exists rather than trusting the install exit
  code.
- Changelog format and release cadence are **not yet decided** (spec §"Further
  Notes"). This runbook covers the mechanical cut only; slot a CHANGELOG in when
  that decision lands.
