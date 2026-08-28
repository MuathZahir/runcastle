# Test notes

## Lap 1

- [ ] [Code review — Spec axis] Every burn container gets TMPDIR and NODE_COMPILE_CACHE pointing at directories nothing ever creates.

What I did: read `burnCacheEnv` in `packages/server/src/workflows/burn-cache.ts`, then traced who creates the paths it hands out.

What happens: `burnCacheEnv` returns `TMPDIR: ${BURN_CACHE_MOUNT}/tmp` and `NODE_COMPILE_CACHE: ${BURN_CACHE_MOUNT}/node-compile`. Neither directory is created anywhere. `ensureBurnCacheVolume` only chowns the mount root (`burn-cache.ts`, the one-shot `run --rm --user root ... chown -R 1000:1000 /home/agent/cache`), and `buildSlotSetupCommand` only does `mkdir -p ${slotDirPath(slot)}` — the slot dir, not `tmp`. So on a fresh volume the install step runs with `$TMPDIR` set to a path that does not exist.

What I expected: the volume init or the slot sync script does `mkdir -p` for both, the way it already does for the slot dir. Spec §Approach asks for "`TMPDIR` and `NODE_COMPILE_CACHE` on the volume so jest's default cache dir and Node's compile cache follow" — it gets the env var but not the directory.

Why it matters: jest and Node's compile cache `mkdir -p` their own subdirectory and survive, but any tool that calls `mkdtemp(os.tmpdir())` without creating the parent gets ENOENT — and the install command (npm/pnpm extracting tarballs) runs with this env. Ticket 4's own digest flags this as deliberately left undone ("Nothing creates $TMPDIR on the volume ... I deliberately did NOT mkdir -p it in the probe: that would hide the defect the probe exists to surface"), and names the fix: one line in `buildSlotSetupCommand`.
- [ ] [Drive — probe run] BLOCKER: the burn cache volume can never be initialised. `ensureBurnCacheVolume`'s chown one-shot passes its argv to the image's `sleep infinity` entrypoint, so the first burn on a fresh volume always throws.

What I did: on the feature branch with Docker 28.5.2 and `sandcastle:runcastle` present, ran `bun run burn-cache:probe packages/server/test/fixtures/burn-cache/pnpm-monorepo --keep`.

What happened — the probe died on its first container, before any cache measurement:

```
probe volume: runcastle-probe-776cd4f42b9e (kept)
error: docker run --rm --user root -v runcastle-probe-776cd4f42b9e:/home/agent/cache sandcastle:runcastle chown -R 1000:1000 /home/agent/cache failed: sleep: invalid option -- 'R'
Try 'sleep --help' for more information.
    at execOrThrow (packages/server/src/workflows/burn-cache.ts:133:15)
    at async ensureBurnCacheVolume (packages/server/src/workflows/burn-cache.ts:165:9)
```

Root cause, confirmed directly:
```
$ docker image inspect sandcastle:runcastle --format '{{json .Config.Entrypoint}}'
["sleep","infinity"]
```
The image has an ENTRYPOINT, so the `chown -R 1000:1000 /home/agent/cache` that `ensureBurnCacheVolume` appends is passed as *arguments to `sleep`*, not run as the command. `sleep` rejects `-R` and exits non-zero. I reproduced the exact failing argv by hand and got the identical `sleep: invalid option -- 'R'`.

What I expected: the one-shot actually chowns the mount point, as spec §Approach requires — "a one-shot `run --rm --user root` of the sandbox image that chowns the mount point ... idempotent and cheap on an existing volume."

Impact: this is on the only path that initialises a volume, and `ensureBurnCacheVolume` throws rather than degrading, so with `burnCache: 'volume'` (the default) the **first burn against any fresh volume fails outright** — the feature's headline path is dead on arrival on a real engine, on every host. It was invisible to the unit tests because they assert the *argv* `ensureBurnCacheVolume` issues, and that argv is exactly what was asserted; nothing executed it.

Fix: add `--entrypoint chown` before the image name and pass `-R 1000:1000 /home/agent/cache` as the args (verified this form is accepted by the engine), or `--entrypoint sh -c '...'`. The unit test in `packages/server/test/burn-cache.test.ts` that pins the argv needs the same update.

Note the probe DID do its job — decision 7's "a mounted cache that is never hit looks identical to no cache; only a real cold→warm pair proves it" is exactly why this was caught. Everything downstream in this review had to be run past this defect by pre-chowning the volume by hand.
- [ ] [Code review — Standards axis] `burnCacheEnv` points all four package managers' store/cache variables at the *same* directory, which the function directly above it says is exactly what must not happen.

What I did: read `storePath` and `burnCacheEnv` in `packages/server/src/workflows/burn-cache.ts`.

What happens: `burnCacheEnv(pm)` computes `const store = storePath(pm)` once and hands that single path to five variables belonging to four different managers:

```js
npm_config_store_dir: store,
pnpm_config_store_dir: store,
BUN_INSTALL_CACHE_DIR: store,
npm_config_cache: store,
YARN_GLOBAL_FOLDER: store,
```

Twelve lines above, `storePath`'s own doc comment states the rule this breaks:

> "The package manager's store/cache directory on the volume. One directory per manager rather than one shared: pnpm's is a content-addressed store, npm's and yarn's are tarball caches and bun's is its own format, and **mixing them in one directory is how you get a manager rejecting the lot**."

`storePath` is per-manager by its argument, but every caller gets the *detected* manager's directory for all five variables. In a pnpm repo, `npm_config_cache` and `YARN_GLOBAL_FOLDER` both resolve to `<vol>/store/pnpm`, so an npm invocation writes its `_cacache` tree inside pnpm's content-addressed store.

The function's own comment argues for setting all of them ("an unused one costs nothing, while a per-manager switch would silently miss a repo that shells out to a second manager") — that reasoning is sound and is the reason the variables should each get `storePath('npm')`, `storePath('yarn')`, `storePath('bun')` rather than one shared path. Spec §Approach describes the layout as `store/<pm>`, plural: "the pnpm store, bun cache, npm cache, yarn global folder."

Smell: Duplicated Code / Primitive Obsession — one `store` string reused for four distinct concepts. Judgement call, but the contradiction with the adjacent doc comment makes it look unintentional rather than chosen. This is latent today because monorepos usually shell out to one manager; it surfaces the first time a repo's install script calls a second one.
- [ ] [Drive — probe run] BLOCKER (runtime confirmation of the TMPDIR finding): with the volume chowned by hand past the entrypoint bug, the slot setup hook then dies on every install because `$TMPDIR` does not exist. `pnpm install` never gets as far as fetching a package.

What I did: after manually chowning the probe volume, re-ran `bun run burn-cache:probe packages/server/test/fixtures/burn-cache/pnpm-monorepo --keep`. It failed with only `the slot setup hook left no timing marker — it did not complete, so nothing can be measured`. To find out why, I rebuilt the container by hand — same volume, same `buildBurnCacheMounts` env, `sh -c "<buildSlotSetupCommand(...)>"` — and captured stderr.

What happened: the sync half succeeded (fetch, reset --hard, clean), then the install step crashed:

```
Error: ENOENT: no such file or directory, lstat '/home/agent/cache/tmp'
    at Object.realpathSync (node:fs:2791:29)
    at ../node_modules/.pnpm/temp-dir@2.0.0/node_modules/temp-dir/index.js (.../pnpm/10.15.0/dist/pnpm.cjs)
    at ../pkg-manager/client/lib/index.js
    at ../store/store-connection-manager/lib/createNewStoreController.js
  errno: -2, code: 'ENOENT', syscall: 'lstat', path: '/home/agent/cache/tmp'
```

pnpm resolves `temp-dir` at module load, before any work, so this is unconditional: **every pnpm install inside a burn with `burnCache: 'volume'` crashes.** It is not the lazy-mkdir case ticket 4's digest hoped for — pnpm calls `realpathSync(os.tmpdir())`, which requires the directory to already exist.

What I expected: the install runs. Spec §Approach: "plus `TMPDIR` and `NODE_COMPILE_CACHE` on the volume so jest's default cache dir and Node's compile cache follow" — the env var landed without the directory behind it.

Fix: `mkdir -p /home/agent/cache/tmp /home/agent/cache/node-compile` in `buildSlotSetupCommand` (beside the existing `mkdir -p ${slotDirPath(slot)}`), or in the volume-init one-shot. I verified the whole setup script then runs to completion with those two directories present.

Also worth fixing while here: the probe's own diagnostic. `readSetupMarker` throws "the slot setup hook left no timing marker" and discards the hook's stderr entirely, so the operator gets no cause at all — I only found this by rebuilding the container by hand. Since the probe is meant to be the rerunnable proof for every future burner change (decision 7), it should surface the hook's stderr on failure.
- [ ] [Drive — probe run] EVIDENCE: with both blockers worked around by hand, every cache type does warm as promised. Probe tables verbatim, plus the volume inspection.

Important caveat first: neither table below is reachable on an unmodified checkout. I had to (a) chown the volume manually with `--entrypoint chown` and (b) `mkdir -p /home/agent/cache/tmp /home/agent/cache/node-compile` on the volume. Those are the two blocker notes. Past them, the mechanism works.

**pnpm-monorepo** — `bun run burn-cache:probe packages/server/test/fixtures/burn-cache/pnpm-monorepo --keep`, from a wiped volume (slots and store removed, so run 1 is genuinely cold):

```
run 1/2 — slot 1 cold, synced in 0.3s, installed in 3.0s
run 1/2 — typecheck: 0.5s     test: 0.8s     build: 0.7s
run 2/2 — slot 1 warm, synced in 0.1s, installed in 1.2s
run 2/2 — typecheck: 0.3s     test: 0.7s     build: 0.3s

cache            cold                       warm                       hit
---------------  -------------------------  -------------------------  ---
install          3.0s (cold slot)           1.2s                       yes
tsbuildinfo      2 file(s), typecheck 0.5s  2 file(s), typecheck 0.3s  yes
vitest           1 results.json             1 results.json             yes
turbo            6 file(s), 6 file(s), cache hit                       yes
store-hardlinks  2 link(s)                  2 link(s)                  yes
```
All five rows hit. Exit 0.

**jest-app** — same command against the jest fixture, exit 0:

```
run 1/2 — slot 1 cold, synced in 0.3s, installed in 2.6s
run 1/2 — typecheck: 0.6s     test: 1.1s
run 2/2 — slot 1 warm, synced in 0.1s, installed in 1.7s
run 2/2 — typecheck: 0.3s     test: 0.7s

cache        cold                       warm                       hit
-----------  -------------------------  -------------------------  ---
install      2.6s (cold slot)           1.7s                       yes
tsbuildinfo  1 file(s), typecheck 0.6s  1 file(s), typecheck 0.3s  yes
jest         6 file(s), test 1.1s       6 file(s), test 0.7s       yes
```

**Slot persistence between runs** (`docker run --rm -v runcastle-probe-776cd4f42b9e:/c alpine ...`):
```
/c/slots/1/repo: node_modules, package.json, packages, pnpm-lock.yaml, ...
tsbuildinfo: /c/slots/1/repo/packages/app/dist/tsconfig.tsbuildinfo
             /c/slots/1/repo/packages/lib/dist/tsconfig.tsbuildinfo
vitest:      /c/slots/1/repo/node_modules/.vite/vitest/da39a3.../results.json
turbo:       /c/slots/1/repo/.turbo/cache
stamp:       sandcastle:runcastle node=v22.23.1 pm=pnpm@10
store:       96.1M  /c/store
```
So decision 2's central bet holds: keeping the whole checkout does make every cache persist with no per-tool tricks, and the store hardlinks rather than copies.

One criterion NOT met as written: AC2 asks that "the install time drops by an order of magnitude". It drops 3.0s → 1.2s (2.5×) on the pnpm fixture and 2.6s → 1.7s (1.5×) on jest. The fixtures are 55 and ~300 packages, so the floor is container and corepack startup, not download — an order of magnitude is not observable at this size. I'd call the criterion unproven rather than failed, but it is unproven: nothing here measures the spec's real target of "75–240 s" installs, and no fixture in the repo can.
- [ ] [Drive — operator surface] The burn-cache tRPC surface works against a live Docker engine, and it resolves ticket 1's open caveat about the size parser. But I could not reach it through the AFK card in the UI.

(If this note appears twice, the first submission timed out on my side — same finding.)

What I did: with the drive running and the kept probe volume present, called the two procedures the AFK card is backed by, through the dev server's `/api/trpc` proxy.

`system.burnCache.status`:
```
{"mode":"volume","engine":"docker","volumeName":"runcastle-probe-776cd4f42b9e","sizeBytes":99780000}
```
Docker's own view: `docker system df -v | grep 776cd4f42b9e` → `99.78MB`. 99.78MB → 99,780,000 bytes. **This closes the caveat tickets 1 and 3 both flagged** ("`burnCacheVolumeSize`'s parse is still unverified against a live engine ... the `system df -v --format json` shape is inferred"). The inferred shape is correct on Docker 28.5.2; `findVolumeSize` needs no change.

`system.burnCache.clear` (POST, on the jest probe volume):
```
before: runcastle-probe-589a319114f3, runcastle-probe-776cd4f42b9e
result: {"volumeName":"runcastle-probe-589a319114f3"}
after:  runcastle-probe-776cd4f42b9e
status afterwards: sizeBytes: null
```
The volume is genuinely removed and `status` then reports `null` rather than erroring. Clear works.

What I could NOT verify, and why:
1. **The AFK card's burn-cache row was never rendered in a browser.** The drive gets a fresh per-branch database, so the app opens on the first-run wizard, and the wizard's "Continue to your first project" button does nothing — clicked three times from fresh snapshots, no console output, no page change. Without a project I cannot reach Settings, and the row is deliberately absent in the wizard (ticket 3: the wizard "does not [pass projectId], because it can run before any project exists" — I confirmed the row is absent there, which is intended). `FirstRunWizard.tsx` is **not** in this lap's diff, so this is a pre-existing blocker in the drive path, not something this feature broke — but it cost me the visual half of AC6.
2. **The refused-Clear-while-a-slot-is-held path.** Holding a real slot needs a live burn and the allocator is in-process, so I could not induce it over HTTP. It is covered by a unit test (`packages/server/test/burn-cache-router.test.ts:156`, "refuses while a burn holds a slot, names the slots, and issues no removal", asserting `PRECONDITION_FAILED`) and I read the wiring: `clear` passes `getBurnSlotAllocator(...).held()` into `removeBurnCacheVolume`, which throws `BurnCacheBusyError` before issuing any `volume rm`. Verified by test and code read, not by driving.
- [ ] [Code review — Standards + Spec axes] The slot allocator is a process-wide singleton while the cache volume is per-project, so two projects contend for the same slot numbers and one project's burn blocks the other's Clear.

What I did: read `getBurnSlotAllocator` in `packages/server/src/workflows/burn-cache.ts` and its two call sites (`ticket-burner.ts`, `trpc/routers/system.ts`).

What happens: the allocator is keyed on nothing but width —
```js
let sharedAllocator: SlotAllocator | undefined
export function getBurnSlotAllocator(capacity: number): SlotAllocator {
  if (!sharedAllocator) sharedAllocator = createSlotAllocator(capacity)
  else sharedAllocator.resize(capacity)
  return sharedAllocator
}
```
while `burnCacheVolumeName(projectId)` makes the volume per-project, and spec §Approach says "One Docker named volume per project (`runcastle-<projectId>`)". Two consequences, both confirmed in the code:

1. **Slot contention across projects.** Project A burning takes slot 1; project B burning concurrently is handed slot 2 — on a *different* volume, where slot 1 is free and warm. B pays a needless cold checkout, and the pair exhausts `burnConcurrency` at half the intended width.
2. **Cross-project Clear refusal.** `system.burnCache.clear` passes `getBurnSlotAllocator(ctx.config.burnConcurrency).held()` straight into `removeBurnCacheVolume` with no project filter, so clearing project B's volume is refused because project A is mid-burn — and the error names slots that have nothing to do with B's volume.

Citations:
- CONTEXT.md:60 — "**Parallelization is a first-class goal** — the architecture must never assume one live feature, even where M1's UI does." CONTEXT.md:69 lists multi-project as in flight (GH #12).
- Decision 6 — "one clear button ... refused with a clear reason while any burn is active" is written per-volume; the implementation reads "any burn anywhere".

Smell: Primitive Obsession — the allocator's identity is a bare width where it needs to be (projectId, width).

Fair to the implementers: nothing in the spec spells the multi-project case out, and the singleton's own doc comment argues correctly that clear and claim must share one instance. The fix keeps that property — key the map by projectId — rather than reversing it. Low urgency today (one project at a time in M1's UI), but it is the kind of thing that is far cheaper to fix now than after the multi-project UI lands.
- [ ] [Code review — Spec axis] The toolchain stamp is weaker than decision 5 specifies in two ways, so the two invalidations it exists to catch can both be missed.

What I did: read `buildSlotStamp` (`packages/server/src/workflows/ticket-burner.ts:1228`) and its only call site (`:3307`).

```js
export function buildSlotStamp(imageName: string, packageManagerField?: string): string {
  const pm = packageManagerField?.split('@')[0] ?? 'none'
  const major = packageManagerField?.split('@')[1]?.split('.')[0] ?? 'any'
  return `${imageName} node=$(node --version 2>/dev/null) pm=${pm}@${major}`
}
// call site:
const slotStamp = buildSlotStamp(resolveSandboxImage(config), toolchain.packageManagerField)
```
I read the stamp off the live volume after the probe run and it is exactly:
`sandcastle:runcastle node=v22.23.1 pm=pnpm@10`

**1. It keys on the image TAG, not the image ID.** Spec §Approach: the stamp holds "the toolchain the slot was last used with (**sandbox image id**, Node version, package manager name + major)". `resolveSandboxImage(config)` returns `sandcastle:runcastle` — a tag that the AFK card's own "Rebuild image" button rewrites in place. So rebuilding the sandbox image, the single most likely way the ground shifts under a slot, produces an identical stamp and never wipes. The embedded `$(node --version)` catches an image rebuild only if it also bumped Node — it would miss, say, a new glibc or a rebuilt native toolchain, which is decision 5's stated concern ("a new Node ABI breaks native modules").

**2. It ignores the package manager actually detected for the repo.** Decision 5: the stamp carries "package manager name + major, **package manager detected for the repo**" — two facts. Both `pm` and `major` here derive from `toolchain.packageManagerField` alone, so a repo with no `packageManager` field in its package.json stamps `pm=none@any` even though `detectPackageManager` resolved one from the lockfile. Switching such a repo from npm to pnpm leaves the stale `node_modules` layout in place with a matching stamp — precisely the "a pnpm major changes the store and `node_modules` layout" case decision 5 says the stamp exists to catch. Note `buildSlotSetupCommand` already receives the detected `pm` as its own parameter; it just never reaches the stamp.

Both are one-line fixes (pass the resolved image id, and include the detected pm), and the wipe path they gate is already implemented and correct — the stamp mismatch does wipe-then-restamp in the right order, which I confirmed both by reading the script and by watching it run cold in a container.
- [ ] [Code review — Spec axis] Clearing the cache mid-run leaves the next burn with a root-owned volume it cannot write to, because the volume-init promise is memoized for the whole run.

What I did: read `ensureCacheVolume` in `packages/server/src/workflows/ticket-burner.ts` (~:3925) alongside `ensureBurnCacheVolume` in `workflows/burn-cache.ts:159`.

```js
let cacheVolumeReady: Promise<void> | undefined
const ensureCacheVolume = (): Promise<void> => {
  if (resolveBurnCacheMode(config) !== 'volume') return Promise.resolve()
  const engine: BurnCacheEngine = config.sandbox === 'podman' ? 'podman' : 'docker'
  return (cacheVolumeReady ??= ensureBurnCacheVolume({ ... }))
}
```
and `ensureBurnCacheVolume` chowns **only** when the volume did not already exist (`if (existed) return` before the chown one-shot).

The sequence: Clear is refused only while a slot is *held*, and slots are held per ticket — so between two tickets of the same run the allocator is empty and Clear succeeds, destroying the volume. The next ticket calls `ensureCacheVolume()`, gets the already-resolved memoized promise, and issues no `volume create` and no chown. Docker then auto-creates the volume from the `-v name:/path` flag on `docker run` — **root-owned** — and the container runs `--user 1000:1000`. Every write to the cache mount fails.

I have direct evidence that a root-owned mount is fatal rather than merely slow: that is the same state the entrypoint bug leaves, and the setup script cannot proceed from it.

The same memo also caches a *rejection*: if the first `ensureBurnCacheVolume` fails for any reason, every remaining ticket in the run re-awaits the identical rejected promise and fails identically, with no retry.

Spec §Approach asks for the opposite property: "Before a burn's first container, runcastle ensures the volume exists ... This is **idempotent and cheap on an existing volume**." An idempotent-and-cheap ensure does not need memoizing at all — `volume inspect` plus `volume create` on an existing volume is two fast local calls, which is what the memo was avoiding.

Suggested fix, smallest first: drop the memo (or key it so a failed attempt is not cached), and have Clear invalidate it. The refusal window is also arguably wrong — decision 6 says refused "while any burn is active", but the implementation refuses only while a *slot* is held, which is narrower than a run.
- [ ] [Code review — Spec axis, scope] Slot exhaustion silently degrades a ticket to a cold burn. It is a defensible call, but it is unspecified, unobservable, and it makes the concurrency criterion untestable from the outside.

What I did: read `withBurnCacheSlot` (`packages/server/src/workflows/ticket-burner.ts:3147`, added by commit 72fe921).

```js
try { slot = allocator.claim() }
catch (err) { if (!(err instanceof BurnSlotsExhaustedError)) throw err }
if (slot === undefined) return body(undefined)
```

What happens: when every slot is taken, the ticket runs with no slot at all — no volume mount, no cache env, back to ADR-0005 isolated/mounted behaviour — and nothing anywhere says so. Ticket 2's digest argues the case well ("failing a ticket because a *cache* is busy inverts decision 4's own rule ... the worst a cache may ever cost is one cold burn"), and I agree with the direction. Two problems remain:

1. **It is not in the spec or decisions.** Decision 4 defines slots as "numbered `1..burnConcurrency` ... A ticket claims the lowest free slot before its first iteration" and says nothing about exhaustion; the exhaustion path is new behaviour introduced during implementation. Worth the human ratifying it into decisions.md rather than leaving it as an undocumented fallback.
2. **The degrade is invisible.** `burn.setup` carries `{ slot, cold, syncMs, installMs }` per decision 9, but a ticket that got no slot emits nothing distinguishable from the cache being switched off. An operator seeing burns mysteriously running at cold prices has no signal to look at. Given decision 9's whole point is that "the feature's headline number would otherwise be unobservable", the fallback should emit something — `slot: null` with a reason.

This also affects acceptance criterion 5 as written ("two tickets burning in parallel would claim slots 1 and 2"). That holds within one feature, and I confirmed the mechanics: `claim()` scans `for (let slot = 1; slot <= width; slot++)` and returns the lowest free one, `withBurnCacheSlot` releases in a `finally` so success, throw and abort all free it, and the unit tests pin both ("hands out the lowest free slot, starting at 1", "re-hands a released slot before an untouched higher one", `packages/server/test/burn-cache.test.ts:231`/`:250`). But because `hasActiveRun` is per feature and the allocator is shared process-wide, two *features* burning together can silently become "slot 1 and no slot" instead of "slots 1 and 2".
- [ ] [Code review — Standards axis] "Which engines own volumes" is transcribed in three places, against ADR-0008's explicit one-table rule.

What I did: grepped the diff for the docker/podman decision and found three independent statements of it.

1. `packages/core/src/config.ts` — the canonical one:
```js
const BURN_CACHE_SANDBOXES: readonly RuncastleConfig['sandbox'][] = ['docker', 'podman']
export function resolveBurnCacheMode(config) {
  return BURN_CACHE_SANDBOXES.includes(config.sandbox) ? config.burnCache : 'off'
}
```
2. `packages/server/src/trpc/routers/system.ts`:
```js
function burnCacheEngine(sandbox) {
  return sandbox === 'docker' || sandbox === 'podman' ? sandbox : null
}
```
3. `packages/server/src/workflows/ticket-burner.ts` (in `ensureCacheVolume`):
```js
const engine: BurnCacheEngine = config.sandbox === 'podman' ? 'podman' : 'docker'
```

Citation — `docs/adr/0008-burn-performance.md:95` — "Rules live in one TS table that drives both `grep -E` in the container and the unit tests, so there is **no second transcription to drift**."

Severity, honestly: (3) reads as though any non-podman sandbox is docker, but it sits behind an early `if (resolveBurnCacheMode(config) !== 'volume') return`, so it is unreachable for a non-docker/podman sandbox today. It is not a live bug — it is a trap for whoever adds a third volume-capable engine, who will find (1) and (2) by grep and miss (3), because (3) names neither `docker` nor the list. Smell: Duplicated Code tending to Shotgun Surgery.

Suggested fix: export `burnCacheEngine()` once from `workflows/burn-cache.ts` (where `BurnCacheEngine` is already defined) and have both the router and the burner call it; keep `resolveBurnCacheMode` in core as the mode-level reader it already is.
- [ ] [Code review — Standards axis] The burner fabricates a fake config value to express "this ticket has no slot", which makes a false statement about the operator's configuration.

What I did: read the workspace-mode resolution in `burnTicket` (`packages/server/src/workflows/ticket-burner.ts:3191`).

```js
const workspaceMode = resolveBurnWorkspaceMode(
  slot === undefined ? { ...config, burnCache: 'off' } : config,
)
```

What happens: to say "no slot was claimed", the code hands `resolveBurnWorkspaceMode` a config object claiming the operator set `burnCache: 'off'` — which may be false, and is false in exactly the interesting case (the cache is on, the allocator was exhausted). The intent is right and the accompanying comment is clear about it ("the SLOT, not the config, is what says the cache is on"), but the mechanism encodes that intent as a lie about a user setting, in a value that could later be read for anything else — logging, telemetry, an error message — and would then misreport the operator's configuration.

Citation — smell: Mysterious Name / Primitive Obsession. `resolveBurnWorkspaceMode`'s parameter is a `RuncastleConfig`, so "no slot" has to be smuggled through a config field because there is no parameter for it. CLAUDE.md's conventions put a premium on the spec's names being law; `burnCache: 'off'` has a specific documented meaning in decision 6 ("a config-only kill switch ... `'off'` is exactly today's behaviour") and this reuses it to mean something else.

Suggested fix: give `resolveBurnWorkspaceMode` a second argument for slot presence (`resolveBurnWorkspaceMode(config, { hasSlot: slot !== undefined })`), so the config passed through is always the real one. Small, and it removes the only place in the diff where a config value is invented rather than read.

Judgement call, not a hard violation — no current caller reads the fabricated object beyond the one function.
- [ ] [SUMMARY — review pass over persistent-burn-cache-volume, lap 1]

All four implementation tickets landed; nothing is missing outright, so this is a review of a complete feature, not a partial one. The mechanism works — and it cannot currently run unassisted.

**Two blockers, both found by running real containers, both one-liners.** (1) `ensureBurnCacheVolume`'s chown one-shot appends its argv to the image's `["sleep","infinity"]` entrypoint, so `sleep: invalid option -- 'R'` and the volume is never initialised; it throws rather than degrading, so the first burn on any fresh volume fails outright. (2) With that chowned by hand, every install then dies on `ENOENT ... lstat '/home/agent/cache/tmp'` — `burnCacheEnv` sets `TMPDIR` to a directory nothing creates, and pnpm resolves `temp-dir` at module load, so it is unconditional. Neither was reachable by the unit tests, which assert the *argv* issued and never execute it. Ticket 4 predicted (2) exactly and left it deliberately for this review.

**Past both, the feature does what it promised.** Probe on pnpm-monorepo: all five rows (install, tsbuildinfo, vitest, turbo, store-hardlinks) hit warm, exit 0. Probe on jest-app: install and jest hit, exit 0. Tables verbatim in their own note. Slot persistence on the volume confirmed by direct inspection — node_modules, both `dist/tsconfig.tsbuildinfo`, the vitest `results.json`, `.turbo/cache`, a 96 MB shared store.

**Criteria verified:** 1 (`bun install --frozen-lockfile` clean with the patch applied — confirmed `mount.volume` in the installed chunk; `bun run typecheck` 0 errors; `bun run test` **141 files, 2398 passed, 19 skipped, 0 failed**. Note the `dev-pane.test.ts` failure all three implementers reported does NOT reproduce on the host — they were right that it was their container's process-group reaping); 2 and 3 (with the caveat below); 4; 5 by code read and unit tests; 6 server-side against a live engine; 7 by unit tests. The sandcastle patch is a clean two-arm union and host-path behaviour is pinned by two tests — and it is empirically proven, since the probe's containers really did run with `-v <volume>:/home/agent/cache`.

**Criteria not fully met:** AC2's "install time drops by an order of magnitude" is unproven — 3.0s→1.2s (2.5×) and 2.6s→1.7s (1.5×). The fixtures are too small for the spec's 75–240s target to be visible; no fixture in the repo can show it. AC6's visual half was unreachable: the drive's fresh database opens the first-run wizard and its "Continue to your first project" button does nothing, so I never reached Settings. `FirstRunWizard.tsx` is not in this diff — pre-existing, but it blocked the browser walkthrough.

**Code review, kept per axis.** Spec axis: 4 findings; worst is the TMPDIR directory (above) — it is the difference between the feature working and not. Then the toolchain stamp keying on the image *tag* so "Rebuild image" never invalidates a slot, a mid-run Clear leaving the next burn a root-owned volume via the memoized `ensureCacheVolume`, and one piece of unratified scope (silent degrade to a cold burn on slot exhaustion). Standards axis: 4 findings; worst is the process-wide slot allocator against a per-project volume — today it makes one project's burn refuse another project's Clear, citing slots on a different volume (CONTEXT.md:60). Then `burnCacheEnv` pointing four managers' cache vars at one directory in flat contradiction of the doc comment twelve lines above it, three transcriptions of the docker/podman rule against ADR-0008:95's one-table rule, and a fabricated `burnCache:'off'` used to mean "no slot". Three lesser Standards items I confirmed but did not raise as separate notes: `burnTicket`/`realExecuteTicketRun` now take 10 and 11 positional parameters (Data Clumps), `buildWorkspaceNotes` defaults to `ISOLATED_REPO_PATH` which is the wrong path in slot mode (harmless today), and the shipped `system.burnCache.status`/`.clear` names differ from spec seam 6's `burnCache.size` and decision 6's `system.clearBurnCache` — the code is fine, the docs were not reconciled.

One thing I resolved rather than raised: tickets 1 and 3 both flagged `burnCacheVolumeSize`'s parser as unverified against a live engine. It is correct on Docker 28.5.2 — `status` returned 99,780,000 against docker's own `99.78MB`. No change needed.

Housekeeping: a recorder left running by an earlier review (`tkt_XPFK9w5fQLsm`) was still active when I started; I stopped it and it saved. Not this lap's doing.
