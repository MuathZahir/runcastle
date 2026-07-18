# patches/

Bun `patchedDependencies` patches, applied at **install time, before the patched
package's own lifecycle scripts run** (`package.json` → `patchedDependencies`).

## `node-pty@1.1.0.patch` — the Linux prebuild bridge (issue #39)

`node-pty@1.1.0` ships prebuilt native addons for `darwin-{arm64,x64}` and
`win32-{arm64,x64}` but **no `linux-*` prebuild**. Its install hook is
`node scripts/prebuild.js || node-gyp rebuild`; `prebuild.js` exits 1 when
`prebuilds/<platform>-<arch>` is absent, so on Linux it always falls through to
compiling from source — which needs a C++ toolchain **and node ≥22** (node-gyp
13's bundled undici calls `webidl.util.markAsUncloneable`, absent on node 20).
On a stock glibc box that fails, and — because node-pty's install hook failing
aborts the *whole* `bun install` — nothing else lands either.

This patch **vendors the linux-x64 `pty.node` addon** into
`prebuilds/linux-x64/`. Bun applies it while extracting node-pty, *before* the
install hook, so `prebuild.js` sees the dir, exits 0, and **no compile is ever
attempted**. `bun install` then succeeds on stock glibc Linux with no compiler
and node 20. (Linux needs only `pty.node`; `spawn-helper` is macOS-only —
`src/unix/pty.cc` uses it solely under `#if defined(__APPLE__)`.)

### Coverage & gaps

- ✅ **linux-x64** — vendored and verified (loads + spawns a real PTY).
- ⚠️ **linux-arm64** — not yet vendored (no arm64 build host was available). On
  arm64 the install still compiles from source; add the arm64 addon with the
  regen recipe below to close it.
- **musl / Alpine** — a glibc prebuild will not load under musl. There is no
  bridge for musl; install a toolchain and rebuild from source:
  `apk add build-base python3` then `bun install`. See
  `docs/research/POSIX-VERIFICATION.md` (musl fallback).

### Regenerating (or adding arm64)

`patchedDependencies` embeds the binary in the patch, so regenerate whenever the
node-pty version bumps or a new arch is added:

```sh
bun scripts/vendor-node-pty-prebuilds.ts   # rebuilds patches/node-pty@<v>.patch
```

The script builds `pty.node` for the host arch (via `node-gyp rebuild`) and folds
it, plus any binaries already staged under `prebuilds/<platform>-<arch>/`, into
the patch. To add linux-arm64, run it once on an arm64 host (or drop a
cross-built `pty.node` into `prebuilds/linux-arm64/`) and commit the result.

### Retirement — re-verify at node-pty 1.2

This bridge exists **only** because 1.1.0 has no linux prebuild. node-pty 1.2 is
expected to publish `linux-*` prebuilds; when bumping to it, **delete this patch
and the `patchedDependencies` entry**, confirm `bun install` still lands the
binary on stock glibc Linux, and re-verify the **Windows sidecar** path
(`packages/server/src/pty/pty-sidecar.ts`) still selects correctly. Track via the
`checkPtyInstall()` completeness check (`packages/server/src/pty/install-check.ts`).
