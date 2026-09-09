# ADR-0011: The sandcastle named-volume patch is permanent

> Destination: `docs/adr/0011-sandcastle-patch-is-permanent.md`. Written under
> the feature docs because the ideation session cannot edit `docs/adr/`.

- **Status:** accepted (2026-08-28)
- **Deciders:** Muath + ideation session for `upstream-named-volume-mounts-to-sandcastle` (feature dropped)
- **Supersedes:** decision 3 of `docs/features/persistent-burn-cache-volume/decisions.md` ("upstream later")

## Context

`persistent-burn-cache-volume` ships `patches/@ai-hero%2Fsandcastle@0.12.0.patch`
(root `package.json` → `patchedDependencies`). It lets a `MountConfig` name a
Docker/Podman *named volume* (`{ volume, sandboxPath }`) instead of a host path:
`resolveUserMounts` skips expansion and the existence check for it, the docker
provider carries the marker through, and `formatVolumeMount` drops the SELinux
`:z` label for a volume (relabelling a multi-GB cache on every container start
is ruinous). The burner mounts the cache in `ticket-burner.ts`
(`mounts: [{ volume: burnCacheVolumeName(projectId), sandboxPath: BURN_CACHE_MOUNT }]`)
and `packages/server/test/sandcastle-volume-mount.test.ts` pins the emitted
`-v <name>:<path>` argv (verified red without the patch, green with it).

The plan was to upstream the change and retire the patch. Measured on
2026-08-28: `mattpocock/sandcastle` last pushed 2026-06-29 (two months of
silence after ~100 commits in May–June), 30 open PRs, 139 open issues, one
maintainer. An upstream PR has no predictable timeline, so a feature whose
deliverable is "retire the patch" cannot be kept.

Alternatives considered and rejected:

- **Hard fork sandcastle** — owning an Effect-ts codebase plus 30 other people's
  open PRs is a standing cost far out of proportion to a five-line change.
- **Replace sandcastle** — the only real peer is
  [rivet-dev/sandbox-agent](https://github.com/rivet-dev/sandbox-agent)
  (Rust binary, HTTP control of Claude Code/Codex/OpenCode/Amp in
  Docker/E2B/Daytona/Modal). It has no git-worktree / commit-collection /
  merge-to-host / session-resume layer — exactly what runcastle's burn path
  (`ticket-burner.ts`, `review-ticket.ts`, `research.ts`, ADR-0002/0004/0005/0008)
  is built on. Docker Sandboxes is a Docker Desktop feature, not a library, and
  runcastle needs Podman/Linux. The Claude Agent SDK has no sandboxing.

## Decision

1. The patch is runcastle's **permanent** mechanism for named-volume mounts.
   No upstream PR, no pin bump, no patch deletion is planned. `@ai-hero/sandcastle`
   stays exactly pinned (`0.12.0`).
2. **Bumping sandcastle means regenerating the patch.** It diffs `dist/` bundle
   chunks (`chunk-VOG34SRF.js`, `chunk-CP3TYXZA.js`, `chunk-NGBM7T3E.js`,
   `index.js`, four `.d.ts`) whose hashes change every release. The route that
   works in this repo (from the parent feature's outcome — `bun patch` does
   **not** work here because Bun 1.3.x installs this workspace with the isolated
   linker and dies with
   `error overwriting folder in node_modules: FileNotFound`):
   - copy the pristine package (`~/.bun/install/cache/@ai-hero/sandcastle@<ver>@@@1`)
     into a scratch git repo, `git add -A && git commit`;
   - re-apply the hunks (see the current patch for the exact shape). The
     named-volume ones: `resolveUserMounts` early return on `m.volume`, the
     docker provider forwarding `volume`, `formatVolumeMount` skipping the
     SELinux label, `MountConfig` as a `HostPathMountConfig | VolumeMountConfig`
     union with doc updates in `docker.d.ts`/`podman.d.ts`. And the
     setup-diagnostics one: `formatExecFailureMessage` next to `MAX_TAIL_CHARS`
     in `chunk-NGBM7T3E.js`, rendering `execOk2`'s message with the command's
     base64 payloads elided and stdout appended to stderr, re-exported from
     `index.js`/`index.d.ts` so `sandcastle-exec-failure.test.ts` can pin it.
     That formatter's tail is bounded by the cap the *provider* was configured
     with, which takes a chain of small hunks: every provider (`noSandbox`,
     `docker`, `podman`, `vercel`, `daytona`) publishes its resolved
     `maxOutputTailChars` on the handle it creates, `makeSandboxFromHandle`
     carries it onto the sandbox, `execOk2` passes it as the formatter's third
     argument, and the three handle interfaces in
     `SandboxProvider-EkSMuBp8.d.ts` declare the field. Drop any link and the
     bound silently reverts to the 64 KiB default;
   - `git diff --cached --full-index > patches/@ai-hero%2Fsandcastle@<ver>.patch`
     and update the `patchedDependencies` key to the new version;
   - upstream ships every `dist/*.js` bundle with its `//# sourceMappingURL=`
     comment twice, so the regenerated `chunk-NGBM7T3E.js` hunk — the one that
     ends at EOF — picks both copies up as trailing context. Trim that hunk back
     to one line of trailing context (dropping the `\ No newline at end of file`
     marker with it) so the duplicate is not carried in our patch; it applies to
     the same bytes and the patched bundle is unchanged. `git apply` and bun's
     own applier match that hunk exactly; GNU `patch` needs its default fuzz for
     it, which is why the trim is written down rather than guessed at;
   - a plain `bun install` does not always re-apply a changed patch:
     `rm -rf node_modules/.bun/@ai-hero+sandcastle@<ver> && bun install --force`;
   - `sandcastle-volume-mount.test.ts` and `sandcastle-exec-failure.test.ts` must
     go red with the patch removed and green with it back (they rely on
     `server.deps.inline: ['@ai-hero/sandcastle']` in `vitest.config.ts`).
3. **The patch ships by bundling, and the build proves it.** `patchedDependencies`
   reaches only this workspace's `node_modules`: a user's `bun add -g runcastle`
   resolves every external dependency from the registry, unpatched. v1.2.11
   shipped exactly that — sandcastle external, patch absent — and every burn
   with the cache on died in `resolveUserMounts` (`undefined is not an object
   (evaluating 'p.startsWith')`: a `{ volume }` mount has no `hostPath` to
   tilde-expand). So `@ai-hero/sandcastle` is listed in `BUNDLED_DEPENDENCIES`
   (`packages/server/scripts/publish-manifest.ts`): `build-package.ts` inlines it
   into `index.js`, folds its own runtime deps (`@clack/prompts`) into the
   published manifest, and fails the build unless the emitted bundles contain
   the patch's code (one regex marker per hunk above) and no longer
   import sandcastle from `node_modules`. The same check fails the build for any
   *new* `patchedDependencies` entry that is neither bundled nor listed in
   `PATCHED_EXTERNAL_DEPENDENCIES` with the reason its patch is not needed in
   the published package (node-pty is the one such entry today).
   Regenerating the patch (item 2) therefore also means checking the markers
   still match the new hunks — the manifest test pins them against both a
   patched and an unpatched bundle shape.
4. **Triggers to revisit** (fork, or migrate to sandbox-agent): a *second* patch
   becomes necessary; an upstream bug blocks a burn and no fix is coming; or
   Claude Code changes something sandcastle's `claudeCode()` adapter cannot
   follow. Until one fires, a stalled dependency that does what we need is a
   low-severity problem — we can pin forever.

## Consequences

- One known maintenance tax, paid only on a sandcastle bump, with the procedure
  written down here rather than in a feature outcome doc.
- The published `index.js` carries sandcastle (~2 MB of Effect-ts) rather than
  installing it; `@clack/prompts` becomes a direct dependency of `runcastle`.
- `docs/research/SANDCASTLE-NOTES.md` remains accurate for 0.12.0; anyone
  bumping should re-verify §1/§9 there and this ADR's hunks together.
- The `upstream-named-volume-mounts-to-sandcastle` feature is deleted, not
  shipped; this ADR is its only artefact.
