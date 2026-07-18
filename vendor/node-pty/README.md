# `vendor/node-pty/` — Linux prebuild bridge (issue #39)

`node-pty@1.1.0` ships prebuilt native addons for `darwin-{arm64,x64}` and
`win32-{arm64,x64}` but **no `linux-*` prebuild**. Its `install` hook is
`node scripts/prebuild.js || node-gyp rebuild`; on Linux `prebuild.js` finds no
`prebuilds/linux-<arch>/` and exits 1, so it falls through to compiling from
source — which needs a C++ toolchain **and node ≥22** (node-gyp 13's bundled
undici calls `webidl.util.markAsUncloneable`, absent on node 20). On a stock
glibc box that fails, and because a failing dependency `install` hook aborts the
*whole* `bun install`, nothing else lands either.

## How the bridge works (no compiler needed)

1. **Neutralise node-pty's install hook** with a bun `patchedDependencies` patch.
   `patches/node-pty@1.1.0.patch` rewrites node-pty's `install` script to a no-op
   (`node -e "process.exit(0)"`), so the `node scripts/prebuild.js || node-gyp
   rebuild` compile-from-source path never runs on any platform. The root
   `package.json` wires the patch in via
   `"patchedDependencies": { "node-pty@1.1.0": "patches/node-pty@1.1.0.patch" }`;
   bun applies it during install (from `package.json`, whether or not `bun.lock`
   records it).
   - **Why a no-op, not a deleted script.** Removing the `install` key does *not*
     disable the hook: node-pty ships a `binding.gyp`, and bun (like npm) falls
     back to an *implicit* `node-gyp rebuild` for gyp packages with no install
     script — so a toolchain-less install still aborts. An explicit no-op is what
     actually stops the compile. On win/mac the original hook was already a no-op
     (its prebuild ships in the tarball), so the rewrite is behaviour-preserving
     there.
2. **Vendor the binary.** The prebuilt `pty.node` for each supported arch lives
   here as a real committed file: `vendor/node-pty/linux-<arch>/pty.node`.
3. **Bridge on postinstall.** The root `postinstall`
   (`scripts/postinstall-node-pty.ts` → `applyLinuxPrebuildBridge`, a unit-tested
   pure function) copies the vendored binary into the resolved node-pty's
   `prebuilds/linux-<arch>/` — exactly where node-pty's runtime loader looks
   (`build/Release` → `prebuilds/<platform>-<arch>`). Root lifecycle scripts
   always run. The copy is **idempotent** and a **no-op on Windows/macOS** (their
   prebuilds ship in the tarball) and on **musl/Alpine** (a glibc prebuild can't
   load there). It never throws — a thrown postinstall would abort `bun install`.

`bun install` then succeeds on stock glibc Linux with no compiler and node 20,
and the embedded terminal works. (Linux needs only `pty.node`; `spawn-helper` is
macOS-only — `src/unix/pty.cc` uses it solely under `#if defined(__APPLE__)`.)

> **Why the patch only edits `package.json`.** bun's `patchedDependencies` cannot
> *create* a new directory (`prebuilds/linux-x64/`) inside an installed package
> when applying a patch (bun #13770/#22137) — that was attempt 1 and is a dead
> end. Editing an existing file (node-pty's `package.json`) is the mechanism's
> standard, working case, so the patch does only that; the binary copy is done
> separately by the root postinstall (step 3).

## Coverage & gaps

- ✅ **linux-x64** — vendored and verified (loads + spawns a real PTY).
- ⚠️ **linux-arm64** — not yet vendored (no arm64 build host was available). On
  arm64 the bridge reports the gap and node-pty stays uncompiled; add the arm64
  addon with the regen recipe below to close it.
- **musl / Alpine** — a glibc prebuild will not load under musl. There is no
  bridge for musl; install a toolchain and rebuild from source:
  `apk add build-base python3` then `bun install`. `checkPtyInstall()` detects
  musl and points at exactly this.

## Completeness check

`checkPtyInstall()` / `assertPtyInstalled()`
(`packages/server/src/pty/install-check.ts`) verify `pty.node` exists **on disk**
in the loader's search path — catching the "lying retry" where a second
`bun install` exits 0 against a still-broken tree — and return remediation text
for doctor / first-run.

## Regenerating (or adding arm64)

Run once per arch on a matching glibc host and commit the result:

```sh
bun scripts/vendor-node-pty-prebuilds.ts   # writes vendor/node-pty/linux-<arch>/pty.node
```

It builds `pty.node` for the host arch (via `node-gyp rebuild`) and copies it into
`vendor/node-pty/linux-<arch>/`. To add linux-arm64, run it on an arm64 host.

## Retirement — re-verify at node-pty 1.2

This bridge exists **only** because 1.1.0 has no linux prebuild. node-pty 1.2 is
expected to publish `linux-*` prebuilds; when bumping to it, **delete this dir,
the `patchedDependencies` patch (`patches/node-pty@1.1.0.patch` + the
`package.json` entry), the root `postinstall`, and
`scripts/postinstall-node-pty.ts`**, confirm `bun install` still lands the binary
on stock glibc Linux, and re-verify the **Windows sidecar** path
(`packages/server/src/pty/pty-sidecar.ts`) still selects correctly. Track via the
`checkPtyInstall()` completeness check.
