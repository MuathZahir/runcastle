# Outcome — Burn cache volume covers JVM, Python and Rust caches

Extend the persistent per-project burn cache volume (see docs/features/persistent-burn-cache-volume/ for where the mounts are declared) to also mount ~/.m2, ~/.gradle, ~/.cache/pip and ~/.cargo inside burn sandboxes, so JVM/Python/Rust projects get warm dependency installs and the current workaround — pre-warming caches into custom image layers — is unnecessary. CONSTRAINT (ADR-0004, docs/adr/0004-burner-dependency-caching.md): these are download caches and they ride the existing Docker NAMED VOLUME, which the ADR explicitly blesses; do NOT add host bind mounts, and do NOT add the pnpm store — the ADR's hardlink rationale still stands for bind mounts and the pnpm decision is re-raised-and-re-rejected. Leave PM_CACHE_SANDBOX_PATHS semantics alone; put a pointer comment at the new paths citing the ADR. Add unit tests asserting the new cache paths appear in the sandbox mount config alongside the existing ones.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

5 commits · 3 files

### Lap 1
- 2 tickets landed: #1 Extend the persistent per-project burn cache volume (see…; #3 The ~/.cargo volume mount can hide the Cargo executable
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d8b65bf141ac9ac612a1a9a2a5484da1857e9cd6
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 669a9d2ae03ec698ba628d4958a9c49c198cb1ae
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Extend the persistent per-project burn cache volume (see…

# ticket(1) — burn cache volume covers JVM, Python and Rust caches

## What was done

Added `TOOLCHAIN_CACHE_SANDBOX_PATHS` to `packages/server/src/workflows/ticket-burner.ts`,
a sibling of `PM_CACHE_SANDBOX_PATHS` listing the four container cache paths
`~/.m2`, `~/.gradle`, `~/.cache/pip`, `~/.cargo`, with a doc comment citing
ADR-0004 for why these ride a named volume and never a bind mount, and why the
pnpm store stays out. `buildBurnCacheMounts` now attaches the project's existing
named volume (`runcastle-<projectId>`) again at each of those paths in its
cache-on branch. The cache-off branch is untouched — it still yields exactly the
ADR-0004 bind mount for the detected manager and no env. `PM_CACHE_SANDBOX_PATHS`
itself is unchanged in both shape and semantics.

Tests in `packages/server/test/burn-slot-workspace.test.ts`: a new case asserts
the exact mount list (volume mount point plus the four toolchain paths), that no
mount names the pnpm store, and that all five reach `buildSandboxOptions`
intact. The existing "mounts the project volume" case had asserted the volume
mount was the *only* mount; its `toEqual` was narrowed to the first entry, with
its real intent — no `hostPath` mount alongside the volume — still asserted as
it was.

## Surprises

The sandcastle named-volume patch (and the `-v name:/path` flag underneath it)
has no subpath form, so each of the four mounts exposes the **volume root**, not
a private subdirectory. In practice Maven, Gradle, pip and Cargo will create
their own top-level dirs (`repository/`, `caches/`, `http-v2/`, `registry/`)
directly beside the volume's existing `slots/`, `store/`, `tmp/` and
`node-compile/`. Nothing collides by filename today — the only shared name is
`wrapper/` between Maven and Gradle, whose contents are versioned distribution
dirs — but the namespace is now shared, which the persistent-burn-cache-volume
spec did not anticipate. There is no alternative within the ticket's constraint
that these ride *the existing* named volume: giving each cache its own volume
would mean new volumes in the host-side lifecycle (ensure/chown/size/remove),
which is well outside this ticket.

`bun run test` is not fully green here, but not because of this change:
`packages/server/test/dev-pane.test.ts > kills the child process tree so the
port-holder is not orphaned` fails on its own too (`expect(pidAlive(-pgid)).toBe(false)`),
and that file imports nothing from `ticket-burner`/`burn-cache` — it spawns a
real shell with a backgrounded `sleep` and asserts the process group is reaped,
which looks like PID-reaping behaviour in this container. Everything else passed:
`bun run typecheck` clean, 236 of 238 test files passing, 3444 tests. The
prompt's stated baseline (118 files / 1768 tests) is stale against this tree.

Drive machinery: this change adds no service, required env var, seed or extra
process, so nothing under `.runcastle/` needed editing. I did not run the drive
scripts (no services in this sandbox); I confirmed by inspection that the change
introduces none of the four triggers.

## Left undone

- Mounting over `~/.cargo` shadows whatever is at that path in the image. A
  custom sandbox image that installs Rust via rustup puts `cargo` itself in
  `~/.cargo/bin`, and that binary would disappear behind the volume on the first
  burn. The same hazard does not apply to `~/.m2`, `~/.gradle` or `~/.cache/pip`,
  which hold no executables. Worth a decision before anyone ships a Rust image.
- `docs/features/persistent-burn-cache-volume/spec.md` still describes the volume
  as holding only `slots/<n>`, `store/<pm>` and the stamp. Updating a landed
  feature's spec was not in this ticket.
- `burn-cache-probe` only measures the Node-side caches; nothing exercises a
  warm Maven/Gradle/pip/Cargo install end to end. The probe's fixtures would need
  a JVM or Rust repo to prove the win the way decision 7 proves the Node one.

#### 3. The ~/.cargo volume mount can hide the Cargo executable

# ticket(3) — the ~/.cargo volume mount can hide the Cargo executable

## What was done

The Rust entry in `TOOLCHAIN_CACHE_SANDBOX_PATHS` (`packages/server/src/workflows/ticket-burner.ts`)
moved from `~/.cargo` to `~/.cargo/registry`. A mount overlays its mount point and
everything under it, and rustup installs the executable *inside* the cargo home at
`~/.cargo/bin/cargo` — so the previous entry took the binary and the user's
`~/.cargo/config.toml` with it. `~/.cargo/registry` holds only the crate index,
downloaded archives and unpacked sources, so a Rust burn still gets its warm cache
while `~/.cargo/bin` stays as the image left it. Maven, Gradle and pip keep their
binaries outside the directories they cache into, so those three still attach at the
top and were not touched. The constant's docblock gained a paragraph stating the rule
("each path must hold nothing but cache") so the next path added here gets checked
against it; the ADR-0004 pointer ticket 1 wrote is unchanged.

The seam test in `packages/server/test/burn-slot-workspace.test.ts` asserts the
property rather than the literal, via a `hidesInImage(mounts, path)` helper: no mount
hides `~/.cargo/bin/cargo` or `~/.cargo/config.toml`, and `~/.cargo/registry` is
present. It was confirmed red against the old constant before the fix. Two commits:
the fix, then a self-review commit folding the type import into the value import the
way the surrounding test files do.

## Surprises

- **The repro could not be run as written — there is no container engine in this
  sandbox** (`docker` and `podman` are both absent), so `cargo --version` inside a
  cache-on burn container was not executable here. I re-ran it as far as the
  environment allows, one level closer to Docker than the unit test: a scratch probe
  drove the *real* patched sandcastle docker provider with `child_process` mocked (the
  seam `sandcastle-volume-mount.test.ts` already uses) and captured the emitted argv.
  Before the fix the burn emits `-v runcastle-<proj>:/home/agent/.cargo`, which
  overlays `/home/agent/.cargo/bin`; after it, `-v
  runcastle-<proj>:/home/agent/.cargo/registry`, which does not. The probe also
  settled a question the mount config alone does not answer: sandcastle *does* expand
  `~` in `sandboxPath` to `/home/agent`, so the nested path reaches Docker as an
  absolute path (Docker itself would have rejected a literal `~/...`, since execFile
  passes argv with no shell). The probe was deleted, not committed.
- **All five mounts are the same volume root.** The patch emits a plain
  `-v <name>:<path>` with no subpath support, so `~/.m2`, `~/.gradle`, `~/.cache/pip`
  and `~/.cargo/registry` all show the *same* directory tree — the volume root, which
  also holds `slots/`, `store/` and `tmp/`. It persists downloads correctly and the
  toolchains' subdirectory names do not collide, but each toolchain sees the others'
  files. That is the design ticket 1 landed and ticket 2's review accepted; I did not
  change it.
- **`packages/server/test/dev-pane.test.ts` is red and it is not mine.** One test
  (`expect(pidAlive(-pgid)).toBe(false)`, line 183) fails on process-group teardown,
  in isolation as well as in the full suite. The file is byte-identical to its
  pre-feature version and imports only `src/pty/*` and `src/services/events` —
  nothing this branch or ticket 1 touches. Note also that the baseline quoted in the
  burn prompt is stale: it says 118 files / 1768 tests, but the suite here is 238
  files / 3450 tests.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 238 files, 3445
passed, 1 failed (the pre-existing `dev-pane.test.ts` case above), 4 skipped.
Drive machinery: no edit needed — the change adds no service, required env var, seed,
or process. `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` still exist and
are untouched by this branch; I did not run them (no services in this sandbox).

## Left undone

- The `docs/features/persistent-burn-cache-volume/` docs still describe the volume as
  Node-only and do not mention the JVM/Python/Rust paths at all. Ticket 2's review
  flagged this; it belongs to whoever owns those docs, not to this fix.
- Nothing verifies the "each path holds nothing but cache" rule mechanically — it is a
  docblock plus one test naming Cargo's two files explicitly. If a fifth toolchain
  path is added, the same class of bug can return silently.
- `~/.gradle` is the remaining path worth a second look by someone with a Gradle
  image: it is a home directory rather than a pure cache dir (it holds
  `gradle.properties` and init scripts alongside `caches/`), so it is overlaid the way
  `~/.cargo` was. No executable normally lives there, so it did not meet this ticket's
  bar, and I left it.
