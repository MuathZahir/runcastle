# Audit report — periphery: `scripts/**`, root config/hygiene, the stray `packages/server/~` artifact

Leaf agent. Static analysis only; nothing was executed, edited, or deleted.

Scope:
1. `scripts/dev.ts`, `scripts/devtool.ts`, `scripts/release.ts`, `scripts/postinstall-node-pty.ts`,
   `scripts/smoke.ts`, `scripts/fix-feature-phase.ts`, `scripts/vendor-node-pty-prebuilds.ts` (all read in full)
2. Root config / hygiene: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`,
   `.github/**`, `.bun-version`, `patches/`, per-workspace `package.json` + `tsconfig.json`
3. The committed artifact `packages/server/~/.claude/…`

Out of scope (sibling owns): `packages/server/scripts/**` — listed and skimmed only, see §H.

---

## A. Flow map

### A1. `bun run dev` — the dev launcher

```
package.json:15  "dev": "bun run scripts/dev.ts"
  └─ scripts/dev.ts:71   import.meta.main → startDev()
       ├─ devEnv()                    scripts/dev.ts:35-40
       │    └─ devDataDir()           packages/core/src/paths.ts:35   (~/.runcastle-dev)
       ├─ spawn(process.execPath, devArgs(f))   scripts/dev.ts:48-50
       │    ├─ child A: bun run --filter @runcastle/server dev
       │    │     └─ GRANDCHILD: bun --hot src/bin/runcastle.ts serve   (packages/server/package.json:18)  → port 4512
       │    └─ child B: bun run --filter @runcastle/web dev
       │          └─ GRANDCHILD: vite                                    (apps/web/package.json)           → port 4513, strictPort
       └─ teardown: process.on('SIGINT'|'SIGTERM') → stop() → child.kill(signal)   scripts/dev.ts:53-59
            ^^^ kills the DIRECT child only; the grandchildren that hold 4512/4513 are not signalled
```

### A2. `bun run dev:tool <cmd>` — dev-state surgery

```
package.json:16  "dev:tool": "bun run scripts/devtool.ts"
  └─ scripts/devtool.ts:54-63   devDataDir() + sameDataDir(prodDataDir()) guard → pin RUNCASTLE_DATA_DIR
       ├─ parseArgs()                packages/server/src/dev/args.ts
       ├─ createDb(dbPath()) + runMigrations()   packages/server/src/db/{client,migrate}.ts
       ├─ dev.* operations           packages/server/src/dev/state.ts
       ├─ setPhase / setFeatureStatus  packages/server/src/services/repo.ts  (emits timeline events)
       ├─ git identity via execFileSync('git', …)   scripts/devtool.ts:345,382,406
       └─ warnIfServerRunning() → fetch http://localhost:<serverPort>/health   scripts/devtool.ts:439-454
```

### A3. `bun run release <version>` → CI

```
package.json:20  "release": "bun run scripts/release.ts"
  └─ scripts/release.ts:61  main()
       ├─ semver regex          :69
       ├─ git status --porcelain / tag --list / ls-remote   :83-96   (Bun `$`, auto-quoted)
       ├─ prompt() confirmation :113
       └─ git tag -a && git push origin <tag>   :119-120
            └─ .github/workflows/release.yml  (on: push tags v*)
                 bun install → bun run typecheck → bun run test
                 → packages/server/scripts/build-package.ts (build:pkg)
                 → npm publish --provenance  → gh release create
```

### A4. `postinstall` (every `bun install`)

```
package.json:21  "postinstall": "bun scripts/postinstall-node-pty.ts"
  └─ scripts/postinstall-node-pty.ts:27  applyLinuxPrebuildBridge({vendorRoot, ptyRoot, musl, fs})
       ├─ packages/server/src/pty/install-check.ts  (resolvePtyRoot, detectMusl)
       ├─ packages/server/src/pty/prebuild-bridge.ts (pure logic, injected fs)
       └─ source of the vendored binary: scripts/vendor-node-pty-prebuilds.ts (manual, linux-only)
```

### A5. `bun run scripts/smoke.ts` (manual; not a package.json script — documented at README.md:238)

```
scripts/smoke.ts:40-57   redirect USERPROFILE/HOME to tmpdir; delete RUNCASTLE_DATA_DIR; pin CLAUDE_CONFIG_DIR
  → dynamic imports (:61-70) so lazy homedir() reads the temp home
  → createDb + runMigrations + buildApp(ctx) + createCallerFactory(appRouter)
  → git target repo → project.init → feature.create → launchSession(spawn:false)
  → POST /api/hooks/session-start → /mcp emit_tickets + complete_phase
  → feature.burn (REAL host claude) → poll run.get/events.list → testDrive start/stop → merge
  → mappedFlow(): escalate_to_map → emit_waypoints → resolve_waypoint ×2 → converge
```

---

## B. Dead code

### B1. `dead-code:fix-feature-phase-script` — kind: **violation** — confidence: **high**

`scripts/fix-feature-phase.ts` (whole file, 56 lines) is a one-off repair for a single hard-coded
feature id, referenced by nothing.

```
scripts/fix-feature-phase.ts:25
  const FEATURE_ID = process.argv[2] ?? 'feat_Oq7SVoUpPTvf'
```

Verification: repo-wide grep for `fix-feature-phase` (excluding `node_modules`) returns exactly one
hit — the script's own docstring at `scripts/fix-feature-phase.ts:15`. It is not in root
`package.json` scripts (which are exactly `dev, dev:tool, typecheck, test, test:watch, release,
postinstall`), not in `.github/workflows/release.yml` (the only workflow), not in `README.md`, and
not in `docs/`.

Two aggravating facts, both worth keeping in the finding:

- It targets the **production** data dir, not the dev tree. `scripts/fix-feature-phase.ts:27`
  `const db = createDb(dbPath())` with no `RUNCASTLE_DATA_DIR` pin — contrast `scripts/devtool.ts:54-63`,
  which refuses to run if the resolved dir is the real install. This script is the exact footgun
  devtool was built to prevent, sitting one `bun run` away.
- Its capability is already a first-class, documented devtool command:
  `README.md:264` — `bun run dev:tool feature phase my-feature tickets  # gates not checked`
  → `scripts/devtool.ts:242-258 featurePhase()`, which also routes through `setPhase` so the forced
  move lands in the timeline. Same mechanism, generalised, guarded.

Effort S, risk low. Deleting it removes nothing any caller depends on.

### B2. `dead-field:smoke-step-result` — kind: violation — confidence: high — (trivial)

`scripts/smoke.ts:74` declares `type StepResult = { name: string; ok: boolean; detail: string }`, but
`record()` (`:86-89`) is the only writer and always sets `ok: true`; `printSummary` (`:490`) prints
`PASS` unconditionally for every entry and appends the failure separately (`:492`). The `ok` field is
never false and never read as a discriminator.

### B3. NOT dead — verified, recorded so the parent does not re-litigate

- `scripts/smoke.ts` — referenced by `README.md:238`, `docs/SPEC.md:206`, and
  `packages/server/test/mapped-smoke.test.ts:22`. It is a documented manual gate. Alive.
- `scripts/vendor-node-pty-prebuilds.ts` — referenced by `vendor/node-pty/README.md:75`,
  `packages/server/src/pty/install-check.ts:105`, `packages/server/src/pty/prebuild-bridge.ts:120`
  (both quote it as the operator remediation string). Alive, deliberately manual.
- `scripts/dev.ts` exports `DEV_FILTERS` / `devArgs` / `devEnv` — imported by
  `packages/server/test/dev-script.test.ts:4`. Alive (the exports exist purely to be unit-testable;
  that is a legitimate seam, not speculative generality).

---

## C. Redundancy & repeated logic

### C1. `redundant:process-teardown` — kind: **violation** — confidence: **high** — effort S/M, risk low

`scripts/dev.ts` re-implements process teardown, badly, next to a correct implementation that already
exists in the repo.

`scripts/dev.ts:53-57`:
```ts
const stop = (signal: NodeJS.Signals): void => {
  if (down) return
  down = true
  for (const c of children) c.kill(signal)
}
```

`packages/server/src/pty/dev-pane.ts:159-170` — the same problem, solved:
```ts
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGTERM')   // negative pid → whole process group
    }
  } catch { /* tree already gone */ }
}
```
and its own doc comment (`dev-pane.ts:150-157`) states the exact failure mode `scripts/dev.ts` has:
*"On Windows nothing signals a tree… the dev server itself is a GRANDCHILD and survives, holding its
port and its file locks. `taskkill /T` walks the child list, so it is the only teardown that actually
frees the port."*

Suggested shared module: **`killProcessTree(pid)`** lifted out of `packages/server/src/pty/dev-pane.ts`
into a platform util (e.g. `packages/server/src/util/process-tree.ts`, or `packages/core` if it must
be importable from `scripts/`) and called from both. Two real callers exist today → a real seam, not
a hypothetical one. See §D1 for the latent bug this causes.

### C2. `redundant:repo-root-resolution` — kind: judgement call — confidence: high — effort S, risk low

Four scripts each hand-roll "where is the repo root", using **three different idioms**, one of which
is unsound:

| file:line | expression |
|---|---|
| `scripts/release.ts:33` | `resolve(fileURLToPath(import.meta.url), '..', '..')` |
| `scripts/postinstall-node-pty.ts:23` | `join(dirname(fileURLToPath(import.meta.url)), '..')` |
| `packages/server/scripts/build-package.ts:32-33` | `resolve(dirname(fileURLToPath(import.meta.url)), '..')` then `resolve(SERVER_DIR,'..','..')` |
| `scripts/vendor-node-pty-prebuilds.ts:33` | `join(import.meta.dirname ?? '.', '..')` ← **cwd-dependent fallback** |

The last one is the outlier and the bug seed: if `import.meta.dirname` is ever undefined the fallback
`'.'` makes `repoRoot` resolve against the **process cwd**, so
`join(repoRoot, 'vendor', 'node-pty', …)` (`:47`) silently writes the vendored `pty.node` into
whatever directory the operator happened to be standing in. Every other script uses the
`fileURLToPath(import.meta.url)` form that cannot do this.

Suggested shared module: a single exported `repoRoot()` (one file, one idiom) that all four import.
All four are near-neighbours; this is a genuine consolidation with two-plus callers.

### C3. `redundant:script-logging` — kind: judgement call — confidence: medium — effort S, risk low

Five bespoke console front-ends, no two alike:

- `scripts/devtool.ts:65-68` — `log()` via `process.stdout.write` + `notes()` (`  note: …`)
- `scripts/smoke.ts:77-89` — `log()` + `banner()` (`=` ×72 + `▶`) + `record()` (`  ✓ name — detail`)
- `scripts/release.ts:37-44` — `die()` (`✗ …` + `process.exit(1)`) + `step()` (`▶ …`)
- `scripts/fix-feature-phase.ts:30-32` — its own `log()`, identical body to devtool's
- `scripts/postinstall-node-pty.ts:35,39` / `scripts/vendor-node-pty-prebuilds.ts:24,38,53` — bare
  `console.log`/`console.warn` with `[node-pty bridge]` / `> ` prefixes

Suggested shared module: **`scripts/lib/log.ts`** exposing `log`/`step`/`ok`/`die`. Low value on its
own; it matters because it is the same cluster as C2 and C4 — one `scripts/lib/` earns its keep once
three concerns move into it. Flagged rather than pushed.

### C4. `redundant:script-entry-epilogue` — kind: judgement call — confidence: medium — effort S

Three different top-level entry conventions across five entry scripts:

- `scripts/dev.ts:71` — `if (import.meta.main) startDev()` (no error handling at all)
- `scripts/release.ts:128-130` — `main().catch(err => die(…))`
- `scripts/smoke.ts:498-507` — `main().then(→ exit 0).catch(→ print + exit 1)`
- `scripts/devtool.ts:456-457` — top-level `await main(...)` + conditional `process.exit(exitCode)`, **no `.catch`**
- `packages/server/scripts/build-package.ts:103-106` — `main().catch(err => { console.error(…); process.exit(1) })`

`scripts/devtool.ts:456` is the odd one: a throw out of `main()` becomes an unhandled top-level
rejection rather than a formatted `error: …` line, so the carefully-written `UsageError` handling at
`:76-82` covers only the parse and nothing else.

---

## D. Latent bugs (called out distinctly, per brief), inconsistencies & structural smells

### D1. `leaked-process:dev-launcher` — kind: **violation** — confidence: **high** — LATENT BUG

`scripts/dev.ts:56` kills only its two direct children. Those children are
`bun run --filter <pkg> dev` shims; the processes that actually **hold ports 4512 and 4513** are their
grandchildren (`bun --hot src/bin/runcastle.ts serve` per `packages/server/package.json:18`, and
`vite` per `apps/web/package.json`).

```ts
// scripts/dev.ts:53-57
const stop = (signal: NodeJS.Signals): void => {
  if (down) return
  down = true
  for (const c of children) c.kill(signal)   // ← direct child only
}
```

On Windows `ChildProcess.kill()` maps to `TerminateProcess` on that one pid — grandchildren are
orphaned outright. The repo already knows this: `packages/server/src/pty/dev-pane.ts:150-157`
documents the identical trap in prose and fixes it with `taskkill /T /F`.

Blast radius is not theoretical, because `apps/web/vite.config.ts:15` sets `strictPort: true`: after
an orphaning Ctrl-C, the *next* `bun run dev` gets an immediate "port 4513 in use" failure, and the
stale 4512 server keeps answering `/health` — which is exactly the signal
`scripts/devtool.ts:439-454 warnIfServerRunning()` reads, so the dev tool will report a live server
against a dev tree nobody is looking at.

Contributing detail: teardown has no escalation. There is no timeout → `SIGKILL`/force step, and no
`child.on('error')` handler, so a spawn failure surfaces as an unhandled `'error'` event on the
ChildProcess rather than a diagnosable message.

Fix: call the shared `killProcessTree` from §C1 on `child.pid` instead of `child.kill(signal)`.

### D2. `swallowed-exit:dev-launcher` — kind: judgement call — confidence: medium — effort S

`scripts/dev.ts:61-68`:
```ts
child.on('exit', (code) => {
  if (down) return
  stop('SIGTERM')
  process.exitCode = code ?? 1
})
```
Two consequences worth naming:
- A child killed by a **signal** reports `code === null` and `signal === 'SIGTERM'`; the handler
  collapses that to exit 1 and never inspects the signal argument, so "vite was OOM-killed" and
  "vite exited 1" are indistinguishable to the operator.
- If either child exits **0** (a `bun run --filter` shim can exit 0 when the filter matches nothing),
  the launcher tears everything down and reports success. `bun run dev` would exit 0 having started
  no dev server at all.

### D3. `windows-path:vendor-script` — kind: **violation** — confidence: high — effort S

`scripts/vendor-node-pty-prebuilds.ts:33`:
```ts
const repoRoot = join(import.meta.dirname ?? '.', '..')
```
The `?? '.'` fallback makes the destination path (`:47`) cwd-relative. See §C2. Everything else in
this file uses `join`/`dirname` correctly, which makes the one fallback look accidental rather than
considered.

### D4. `npm-invocation:vendor-script` — kind: **violation** — confidence: high — effort S

`scripts/vendor-node-pty-prebuilds.ts:40`:
```ts
execFileSync('npx', ['--yes', 'node-gyp@10', 'rebuild'], { cwd: ptyRoot, stdio: 'inherit' })
```
House rule (CLAUDE.md §Conventions, BRIEFING §House conventions): *"Bun everywhere (`bun add`,
`bunx`); never npm/yarn/pnpm."* This is the only `npx`/`npm` invocation in `scripts/**`. `bunx --yes
node-gyp@10 rebuild` is the direct replacement.

(Secondary, currently masked: `execFileSync` with a bare `'npx'` and no `shell: true` cannot resolve
`npx.cmd` on Windows — it would throw ENOENT. Masked because `:22-28` hard-refuses on non-linux
hosts. Worth keeping in the fix so the guard is not the only thing standing between this and a
confusing ENOENT.)

Note the same rule is broken in CI at `.github/workflows/release.yml:85,91`
(`npm install -g npm@latest`, `npm publish`) — but there it is **deliberate and documented**
(`release.yml:83-88`: OIDC trusted publishing needs npm ≥ 11.5.1, and bun has no publish equivalent).
Not a finding; recorded so a sibling does not report it as one.

### D5. `posix-only:smoke-transcript-path` — kind: violation — confidence: high — effort S, risk low

`scripts/smoke.ts:240` and `:416`:
```ts
transcript_path: '/tmp/smoke-transcript.jsonl',
transcript_path: '/tmp/smoke-mapped-transcript.jsonl',
```
Hard-coded POSIX absolute paths in a file whose entire header (`:21-26`) is about *not* assuming a
platform, and whose own `SCRATCH` correctly uses `join(tmpdir(), …)` (`:40`). Impact is low — these
strings are hook payload only; the server stores them (`packages/server/src/routes/hooks.ts:128-133`)
and never opens them — so this is a correctness-of-fixture issue, not a runtime break. Fix:
`join(tmpdir(), 'smoke-transcript.jsonl')`.

### D6. `leaked-process:smoke-budget-guard` — kind: judgement call — confidence: medium — effort M

`scripts/smoke.ts:315,336-340`:
```ts
const DEADLINE = Date.now() + 10 * 60 * 1000
…
if (Date.now() > DEADLINE) {
  cancelRun(runId)
  throw new Error('BUDGET GUARD: burn exceeded 10 minutes — cancelled')
}
```
`cancelRun(runId)` is invoked and **not awaited/observed**; the throw immediately unwinds to
`:503-507`, which calls `process.exit(1)`. The smoke deliberately runs a **real host `claude`**
(`:306` `RUNCASTLE_SANDBOX = 'noSandbox'`), so the guard's failure path force-exits the parent while
the actual burn child may still be running — the leaked-child shape of §D1 again, this time with a
paid model attached. Same for the success path (`:501 process.exit(0)`). Worth at least awaiting the
cancellation and giving it a bounded grace window before the hard exit.

### D7. `stale-config-snapshot:smoke` — kind: judgement call — confidence: medium — effort S

`scripts/smoke.ts:100` calls `loadConfig()` and pins it into `ctx`; `:306` then mutates
`process.env.RUNCASTLE_SANDBOX = 'noSandbox'` — *after* the snapshot. It happens to work, because the
burner re-reads config at run time (`packages/server/src/workflows/ticket-burner.ts:2210`
`const config = loadConfig()`), but the smoke's own `ctx.config.sandbox` and the burner's disagree
for the rest of the run. `ctx.config` is what `resolveModel('smoke', config)` (`:105`) and
`warnIfServerRunning`-style port reads use. Setting the env var **before** line 100 removes the
divergence and the reader's doubt.

### D8. `verification-gate-hole:root-typecheck` — kind: **violation** — confidence: **high** — effort S, risk low

Re-verified from source. `package.json:17`:
```json
"typecheck": "bun run --filter '@runcastle/core' --filter '@runcastle/server' typecheck"
```
Two workspaces have a real `typecheck` script that **no automation ever invokes**:
- `apps/web/package.json` → `"typecheck": "tsc --noEmit"` (~15.6k TS lines)
- `packages/design-system/package.json` → `"typecheck": "tsc -p tsconfig.json --noEmit"` (~1.2k TS lines)

And `.github/**` does **not** close the gap. There is exactly one workflow file —
`.github/workflows/release.yml` — with `on: push: tags: ['v*']` (`:15-18`). It runs
`bun run typecheck` (`:62-63`) and `bun run test` (`:65-66`), i.e. the *same* root scripts with the
*same* two-package filter. Consequences:

1. `apps/web` and `packages/design-system` are typechecked by **nothing** — not locally via the root
   script, not in CI.
2. There is **no PR / push CI at all**. Typecheck and tests run only when a human pushes a release
   tag. A broken `main` is discoverable only at release time, on the same run that publishes to npm.

Doc drift rides along: `README.md:235` describes `bun run typecheck` as *"`tsc --noEmit` across the
typed packages"* — which reads as "all of them" and is not what the script does.

Recommended: add the two filters to root `typecheck`, and add a `ci.yml` on `pull_request` +
`push: [main]` running `bun install --frozen-lockfile && bun run typecheck && bun run test`.

### D9. `untypechecked-tests` — kind: violation — confidence: high — effort S, risk low

The test directories are excluded from typechecking by the `include` arrays:

```
packages/server/tsconfig.json:  "include": ["src"]                       ← 78 test files not typechecked
apps/web/tsconfig.json:         "include": ["src", "vite.config.ts"]     ← 16 test files not typechecked
packages/core/tsconfig.json:    "include": ["src", "test"]               ← correct
```

`packages/core` is the only one that gets it right, which makes this an inconsistency rather than a
policy. 94 of 99 test files are outside every `tsc` invocation, so type errors in tests surface only
as vitest runtime failures (or not at all, in a skipped block — e.g.
`packages/server/test/dev-pane.test.ts:106` `describe.skipIf(!AVAILABLE)`).

### D10. `divergent-tsconfig:design-system` — kind: violation — confidence: high — effort S

`packages/design-system/tsconfig.json` is the only workspace tsconfig that does **not**
`extends: "../../tsconfig.base.json"`. It re-declares everything by hand and drifts on five settings:

| setting | `tsconfig.base.json` | `packages/design-system/tsconfig.json` |
|---|---|---|
| `target` | `ESNext` | `ES2020` |
| `moduleResolution` | `bundler` | `Bundler` (casing differs; same meaning) |
| `isolatedModules` | `true` | *absent* |
| `resolveJsonModule` | `true` | *absent* |
| `noUnusedLocals` / `noUnusedParameters` | *absent* | `true` (stricter than every sibling) |

It also has its own pinned `typescript: 7.0.2` devDependency duplicating the root one. Fix: extend
the base and keep only the genuinely package-specific keys (`jsx`, `lib` + DOM, `declaration`,
`outDir`, `rootDir`).

### D11. `lib-dom-answer` (root brief question) — **no finding, verified**

`tsconfig.base.json` sets `"lib": ["ESNext"]`, `"types": []`. Every extending workspace opts back in
explicitly and correctly:
- `apps/web/tsconfig.json` → `"lib": ["ESNext","DOM","DOM.Iterable"]`, `"types": ["node","vite/client"]`, `"jsx": "react-jsx"`
- `packages/core/tsconfig.json` → `"types": ["node"]`
- `packages/server/tsconfig.json` → `"types": ["bun-types"]`
- `packages/design-system` → `"lib": ["ES2020","DOM","DOM.Iterable"]` (via its standalone config, see D10)

The empty-by-default base is a deliberate, working design. Recorded so a sibling does not report it.

### D12. `orphan-package:design-system` — kind: judgement call — confidence: **medium-high** — effort M, risk medium

`packages/design-system` (~1.2k TS lines) has **no importer in shipped code**. Repo-wide grep for
`@runcastle/design-system` outside the package itself returns only `.design-sync/config.json:2` and
21 files under `.design-sync/previews/*.tsx` — the design-sync staging area, not the app.
`apps/web/package.json` does not depend on it. It is also never built (`build` is not called from any
root script or from `packages/server/scripts/build-package.ts`) and never typechecked (§D8).

I am **not** claiming it dead — it is plausibly an intentional in-flight redesign surface, and
`.design-sync/` is live tooling. Flagging it as a question for the parent to resolve against the
`apps/web` sibling's report and `CONTEXT.md`: *is design-system the source of truth apps/web is
migrating to, or residue?* Whatever the answer, it should be in root `typecheck`.

### D13. `weak-guard:release-not-pushed` — kind: judgement call — confidence: medium — effort S, risk low

`scripts/release.ts` checks a clean tree (`:83-88`) and a free tag locally + on the remote
(`:92-97`), then tags `HEAD` and pushes only the tag (`:118-120`). It never checks that `HEAD` is on
the main branch or that it is an ancestor of `origin/<main>`. `git push origin <tag>` ships the
*objects* the tag reaches, so CI can build it — but the released commit can be one that exists on no
remote branch and is on nobody's `main`. Given the docstring's own emphasis (`:15-19`) on how
un-walk-backable a `latest` publish is, one `git merge-base --is-ancestor HEAD origin/main` is cheap
insurance.

### D14. `stale-doc:posix-verification` — kind: violation (doc drift) — confidence: high — effort S

`docs/research/POSIX-VERIFICATION.md:216-218` reports:
> **`scripts/smoke.ts:38` — hardcoded absolute path** [STATIC]: `C:/Users/user/AppData/Local/Temp/claude/…/scratchpad` … Should derive from `os.tmpdir()`.

Already fixed — `scripts/smoke.ts:40` is now `const SCRATCH = join(tmpdir(), 'runcastle-smoke')`. The
research note is stale. (The neighbouring `/tmp/…` finding, §D5, is *not* fixed and is not the one the
note describes.)

---

## E. Wrong-tool & weak-typing findings

### E1. `weak-typing:smoke-any` — kind: **violation** — confidence: high — effort M, risk low

`scripts/smoke.ts` is the single densest `any` cluster in scope. House rule: *"No `any` unless
quarantined with a comment"* — none of these carry one.

| file:line | hunk |
|---|---|
| `scripts/smoke.ts:111` | `async function postHook(event: string, body: unknown): Promise<any>` |
| `scripts/smoke.ts:122-123` | `data: any` / `raw: any` (in `interface McpCallResult`) |
| `scripts/smoke.ts:125` | `async function mcp(sessionId: string, body: unknown): Promise<any>` |
| `scripts/smoke.ts:150` | `let data: any = text` |
| `scripts/smoke.ts:252` | `liveSession.sessions.find((s: any) => s.id === sessionId)` |
| `scripts/smoke.ts:292` | `afterEmit.tickets.find((t: any) => t.seq === 2)` |
| `scripts/smoke.ts:351-352` | `afterBurn.tickets.filter((t: any) => t.status === 'done')` … `.map((t: any) => t.status)` |
| `scripts/smoke.ts:459-461` | `.find((e: any) => e.type === 'waypoint.unblocked' && e.data?.id === wp2Id)` |
| `scripts/smoke.ts:480` | `converged.sessions.find((s: any) => s.id === conv.sessionId)` |

The `(s: any)`/`(t: any)` annotations are the costly ones: the tRPC caller returns fully-typed
results, so each `: any` **discards** inference the smoke could otherwise have used to assert shape at
compile time. Dropping the annotation is usually a zero-cost fix.

### E2. `weak-typing:smoke-ctx-cast` — kind: violation — confidence: high — effort M

Five `as never` casts on the app context, all to bypass a type the file could construct properly:
`scripts/smoke.ts:102` `buildApp(ctx as never)`, `:103` `createCallerFactory(appRouter)(ctx as never)`,
`:214` and `:410` `launchSession(ctx as never, …)`, `:476` `converge(ctx as never, …)`.

Root cause is `:101`: `const ctx = { db, config } as { db: typeof db; config: typeof config }` —
a hand-rolled structural stand-in instead of importing `AppCtx` from
`packages/server/src/db/types.ts`, which `scripts/devtool.ts:50,105` and
`scripts/fix-feature-phase.ts:21,28` both do correctly:
```ts
// scripts/devtool.ts:105
const ctx: AppCtx = { db, config: loadConfig() }
```
Importing `AppCtx` should delete all five `as never`. Same-scope precedent exists → clean fix.

### E3. `no-schema-json-parse:scripts` — kind: **violation** — confidence: high — effort S

Zod is the repo's schema lib; three `JSON.parse` sites in scope validate nothing:

```
scripts/devtool.ts:401
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; email?: string }
```
This one is read back from a file the tool itself wrote (`:379`) and then fed straight into
`execFileSync('git', ['config','--global', key, value])` (`:406`). A corrupted/edited
`dev-saved-git-identity.json` puts unvalidated strings into a global `git config` write. A 3-line
`z.object({ name: z.string().nullable(), email: z.string().nullable() })` closes it.

```
scripts/vendor-node-pty-prebuilds.ts:32
  const version = JSON.parse(readFileSync(join(ptyRoot,'package.json'),'utf8')).version as string
```
`JSON.parse` → implicit `any` → property access → `as string`. Cosmetic only (it is printed at `:53`),
but it is three weak-typing smells in one expression.

```
scripts/smoke.ts:151-155
  try { data = JSON.parse(text) } catch { /* leave as raw text */ }
```
Empty catch that silently swallows the error; every downstream assertion then reads properties off a
string. When an MCP tool returns a non-JSON error body, the smoke fails with a confusing
`expected 2, got undefined` instead of naming the parse failure.

(For contrast: `packages/server/scripts/build-package.ts:41` does the same `JSON.parse(...) as
PackageJson` — see §H, same key.)

### E4. `weak-typing:release-shell-cast` — kind: violation — confidence: high — effort S

`scripts/release.ts:48` and `:56`:
```ts
const result = await $(strings, ...(values as never[])).nothrow()
```
`as never[]` twice, uncommented, to force Bun's `$` template signature. It works and the values are
still shell-escaped by `$`, so there is no injection risk — but per house rules an unavoidable cast
needs a quarantine comment saying *why*.

### E5. `weak-typing:devtool-index-cast` — kind: violation — confidence: high — effort S — (minor)

`scripts/devtool.ts:239` `return found[0] as FeatureRow` — the length checks at `:231-238` make this
provably safe; a comment or `noUncheckedIndexedAccess`-friendly destructure would remove the cast.

### E6. `stringly-typed:prebuild-bridge-action` — kind: judgement call — confidence: medium — effort S

`scripts/postinstall-node-pty.ts:33`:
```ts
const loud = result.action === 'copied' || result.action.startsWith('skipped-no')
```
The caller branches on a **prefix** of a string field owned by
`packages/server/src/pty/prebuild-bridge.ts`. Renaming a `skipped-no*` variant there silently changes
this script's output with no type error. A discriminated union (or a `loud: boolean` returned by the
bridge, which already knows the answer) puts the decision where the knowledge is.

---

## F. Shallow modules / deletion-test candidates

### F1. `shallow:fix-feature-phase-script` — kind: violation — confidence: high

Deletion test: remove `scripts/fix-feature-phase.ts` → nothing reappears anywhere, because
`scripts/devtool.ts:242-258 featurePhase()` already does the same thing through the same
`setPhase(ctx, id, phase, event, message)` call, generalised over any feature and guarded against the
production tree. Pure pass-through with a hard-coded argument. Fails the deletion test → delete. (Same
item as §B1; repeated here because the *reason* is shallowness, not merely absence of importers.)

### F2. `shallow:smoke-mcp-wrapper` — kind: judgement call — confidence: low — effort S

`scripts/smoke.ts:125-136 mcp()` is a thin `app.request('/mcp', …)` + `res.json()`. It earns its keep
only because `mcpToolCall` (`:137-157`) builds on it and `main()` calls it directly once for
`initialize` (`:259`). Two callers → real seam, keep. Recorded so the parent does not double-count it
against §E1.

### F3. Not shallow — recorded as positive evidence

`scripts/postinstall-node-pty.ts` is the model in this scope: all logic lives in the injectable,
unit-tested `applyLinuxPrebuildBridge` (`packages/server/src/pty/prebuild-bridge.ts`); the script is a
20-line wiring shim that only supplies real `fs`, real paths, and real musl detection, and cannot
throw out of `bun install` (`:36-44`). `scripts/dev.ts` follows the same pattern in miniature
(pure `devArgs`/`devEnv` exports, tested at `packages/server/test/dev-script.test.ts`). Worth naming
as the target shape for the rest of `scripts/`.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G1. Extract `killProcessTree` and use it in `scripts/dev.ts`** — value **high**, effort **S**, risk **low**, confidence **high**
Key: `redundant:process-teardown` / `leaked-process:dev-launcher`.
The implementation already exists and is documented (`packages/server/src/pty/dev-pane.ts:159-170`);
this is a lift into a shared util plus a one-line call-site change at `scripts/dev.ts:56`. Two real
callers today. Fixes the orphaned-4512/4513 bug (§D1) — the highest-value single change in scope, and
the most likely to be duplicated a third time in a sibling's scope (see §H).

**G2. Close the typecheck gap + add PR CI** — value **high**, effort **S**, risk **low**, confidence **high**
Key: `verification-gate-hole:root-typecheck`.
Add `--filter '@runcastle/web' --filter '@runcastle/design-system'` to `package.json:17`, add
`test`/`src` to the `include` arrays in `packages/server/tsconfig.json` and `apps/web/tsconfig.json`
(§D9), and add a `pull_request` workflow. Blast radius: the first run will surface real errors in
~16.8k previously-unchecked lines plus 94 test files — that is the point, but it should be landed as
its own change, not folded into another. Sequence it *after* the sibling scopes report, so the errors
land on code the audit has already characterised.

**G3. Introduce `scripts/lib/` (repo root, logging, entry epilogue)** — value **medium**, effort **S/M**, risk **low**, confidence **medium**
Keys: `redundant:repo-root-resolution`, `redundant:script-logging`, `redundant:script-entry-epilogue`.
Individually each is thin. Together — 4 repo-root idioms (one unsound, §D3), 5 logging front-ends, 3
entry conventions across 7 scripts plus 2 in `packages/server/scripts/` — a single `scripts/lib/`
with `repoRoot()`, `log/step/ok/die`, and a `runScript(main)` epilogue concentrates all of it and
gives every future script a correct default. Locality: "how does a runcastle script find the repo
root / report failure" becomes one file instead of nine judgement calls.

**G4. Delete `scripts/fix-feature-phase.ts`** — value **medium**, effort **S**, risk **low**, confidence **high**
Keys: `dead-code:fix-feature-phase-script`, `shallow:fix-feature-phase-script`.
Value is disproportionate to size: it is dead, superseded by a documented devtool command, and it is
the one script in the repo that mutates the **production** database with no guard and no
confirmation. Removing it removes a footgun, not just a file.

**G5. Type the smoke against `AppCtx` and drop the `any`s** — value **medium**, effort **M**, risk **low**, confidence **high**
Keys: `weak-typing:smoke-ctx-cast`, `weak-typing:smoke-any`.
Importing `AppCtx` (`packages/server/src/db/types.ts`) as `scripts/devtool.ts:105` already does
should remove all five `as never`; dropping the `(x: any)` annotations restores tRPC's inference and
turns several runtime assertions into compile-time ones. Speculative caveat: the smoke is not
currently typechecked by anything (§D8/§D9), so this only pays off once G2 lands — sequence it after.

**G6. Await cancellation before the smoke's hard exit** — value **low/medium**, effort **M**, risk **low**, confidence **medium**
Key: `leaked-process:smoke-budget-guard`. See §D6. Real money is attached (host `claude`), but the
script is manual and rarely run.

---

## H. Cross-cutting candidates to pass UP

Each of these is something I saw in `scripts/**` or root config that is **very likely present in
`packages/server` and/or `apps/web`**. Canonical keys chosen so sibling reports collide with mine.

### H1. `redundant:process-teardown` — **highest-confidence cross-cutting item**
Shared module: **`killProcessTree(pid)`** — cross-platform process-tree kill
(`taskkill /pid <pid> /T /F` on win32, `process.kill(-pid, SIGTERM)` on POSIX).
Sightings so far: `packages/server/src/pty/dev-pane.ts:159-170` (correct, canonical) vs
`scripts/dev.ts:56` (naive `child.kill`). The server scope owns several more process lifecycles —
PTY registry (`packages/server/src/pty/`), `packages/server/src/services/drive-hooks.ts:165` (its
comment already talks about processes that "survived the kill"), the sandcastle burner
(`packages/server/src/workflows/ticket-burner.ts`) and `research.ts`. **Parent: ask the server leaf
how many independent kill paths exist.** If ≥2 more turn up, this is a repo-wide extraction, not a
scripts fix.

### H2. `verification-gate-hole:root-typecheck`
Not a shared *module* but a repo-wide gate: root `typecheck` covers 2 of 4 typed workspaces; the only
CI workflow fires on release tags only; 94 of 99 test files sit outside every `tsc` `include`.
Every leaf's "tsc already enforces this, skip it" assumption is **false for `apps/web`,
`packages/design-system`, and all test dirs**. **Parent: tell the `apps/web` leaf that nothing
typechecks its 15.6k lines** — findings it would otherwise discard as tool-enforced are live.

### H3. `no-schema-json-parse`
Shared module: a zod-validated **`readJsonFile(path, schema)`**.
Sightings in my scope: `scripts/devtool.ts:401` (feeds a global `git config` write),
`scripts/vendor-node-pty-prebuilds.ts:32`, `scripts/smoke.ts:151-155` (empty catch),
`packages/server/scripts/build-package.ts:41` (`as PackageJson`). Given the server reads config,
prep manifests, MCP payloads, hook payloads and sandcastle output as JSON, I expect several more.
**Parent: match against the server leaf's `JSON.parse` inventory.**

### H4. `redundant:repo-root-resolution`
Shared module: **`repoRoot()` / asset-path resolution**. Four idioms across four files (§C2), one
cwd-dependent (§D3). `packages/server/scripts/build-package.ts:32-35` computes `SERVER_DIR`,
`REPO_ROOT`, `CORE_DIR`, `SKILLS_DIR`, `WEB_DIR` independently. The server also resolves
runtime-asset paths at boot (bundled vs checkout: `RUNCASTLE_WEB_DIST`, skills packs, drizzle dir,
`hook-client.ts`, `pty-host.cjs` — all listed in `build-package.ts:79-95`), which is the same
question asked in a second dimension. **Parent: this is likely one `assetPaths` module, not two.**

### H5. `redundant:script-logging`
Shared module: **console reporter** (`log`/`step`/`ok`/`die`). Five variants in `scripts/**` (§C3),
plus `packages/server/scripts/build-package.ts` (`•`/`✓` prefixes) and the server's doctor CLI
(`packages/server/src/doctor/cli.ts`) which is another human-facing console surface. Low individual
value; promote only if a sibling names it too.

### H6. `windows-path` (family key; sub-key per site)
My sightings: `windows-path:vendor-script` (§D3), `posix-only:smoke-transcript-path` (§D5). The
repo has a whole research note on this class (`docs/research/POSIX-VERIFICATION.md`) which itself
lists live server-side instances — `packages/server/src/services/git.ts:65-73` `canon()` lowercasing
paths, and six tests that set only `USERPROFILE` and not `HOME` (so they read the developer's real
`~/.runcastle`). **Parent: the server leaf should be told that note exists and which of its items are
still open** — I confirmed at least one item in it (smoke.ts:38) is already fixed and stale (§D14),
so the note cannot be trusted item-by-item without re-verification.

### H7. `stale-doc:readme-vs-scripts` / doc drift
`README.md:235` mis-describes root `typecheck`; `docs/research/POSIX-VERIFICATION.md:216` describes a
fixed bug as open. Both are the same class the brief calls doc/contract drift. **Parent: worth one
consolidated drift pass across `README.md` / `docs/SPEC.md` / `docs/research/*` once all leaves
report, rather than N per-leaf drift findings.**

### H8. `orphan-package:design-system`
`packages/design-system` has no importer outside `.design-sync/previews/*` (§D12). Only the
`apps/web` leaf can say whether it is a migration target or residue. **Parent: cross-check with the
`apps/web` report before anyone acts on it.**

---

## Appendix — the stray artifact `packages/server/~/.claude`

### What it is (exact)

One file, 284,541 bytes, tracked in git:

```
packages/server/~/.claude/projects/C-Users-user-Projects-exam-forge/
    7e2f128f-b539-43ac-b115-5572eed7b3db.jsonl
```

It is a **Claude Code session transcript** in Claude Code's own on-disk layout
(`<config-dir>/projects/<flattened-cwd>/<session-uuid>.jsonl`). Read as data:

- Session UUID `7e2f128f-b539-43ac-b115-5572eed7b3db`, Claude Code `"version":"2.1.218"`, first
  entry timestamped `2026-07-28T10:40:07Z`.
- Every record carries `"cwd":"C:\\Users\\user\\Projects\\exam-forge"` — an **unrelated user project**,
  not runcastle.
- Content: a runcastle **project-preparation** agent run. The first record is the rendered prep
  prompt, whose own comment names its generator: *"Rendered per project-preparation run … filled in by
  the project-prep workflow (`packages/server/src/workflows/project-prep.ts`)"*. The last record is the
  agent's report about the exam-forge repo (npm-workspaces + Turborepo, `npm ci`/`npm install` both
  failing, an `ERESOLVE` peer conflict).
- No secrets observed in the head/tail I read; I did not read the middle 284KB in full, so treat it as
  **unreviewed third-party-project content** rather than certified clean.

### How it got committed

```
$ git log --oneline --diff-filter=A -- "packages/server/~"
a509d06 latest      # 2026-07-28 — adds the exam-forge transcript (the file present today)
e25e128 latest      # 2026-07-19 — added 3 earlier transcripts under
                    #   packages/server/~/.claude/projects/C-Users-user-Projects-_Active_-terminal-wait-game/
$ git log --oneline -- "packages/server/~"
a509d06 / e00d012 / e25e128
                    # e00d012 (2026-07-19) deleted that first batch
```

So it happened **twice**: cleaned up once (`e00d012`), then recurred nine days later and was never
cleaned up again. Both times it rode in on a bulk `git add -A`-style commit titled `latest` —
`a509d06` touches 24+ files across web, core, server, drizzle and launcher, with the transcript
buried among them. `.gitignore` has no pattern that would catch `~` or `.claude/` (verified: the file
has 24 entries, none matching), so nothing stopped it.

### The cause — and why it is a genuine path bug

Claude Code resolves its config dir as `CLAUDE_CONFIG_DIR` or else `join(homedir(), '.claude')`. The
transcript landed at `packages/server/~/.claude/...`, i.e. the config dir resolved to the **literal
relative string `~/.claude`**, which the OS then resolved against the writing process's cwd —
`packages/server`, which is exactly the cwd of the dev server child (`bun run --filter
@runcastle/server dev` → `packages/server`). Two separate failures had to coincide: a home directory
that expanded to a bare `~` (unset/blanked `HOME`+`USERPROFILE` in a spawned child on Windows), and a
child whose cwd was the server package rather than the target repo.

The writer was `packages/server/src/workflows/project-prep.ts`, and **that file no longer exists** —
it was removed in `b55ecbf` *("ticket(1): retire the AFK preparation run — the conversation is the
only one")*. So the specific code path that produced this artifact is gone.

What survives, and what I would hand to the server leaf as the live suspect, is the env-construction
shape it used, still present in `packages/server/src/workflows/ticket-burner.ts:1529-1532`:

```ts
const opts: ClaudeCodeOptions = {
  ...(token ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
  ...(onHost ? { permissionMode: 'bypassPermissions' as const } : {}),
}
```

This builds a **replacement** env containing one variable — not a merge over `process.env`. If the
agent runner passes it through as the child's complete environment, the child has no `HOME` and no
`USERPROFILE`, which is precisely the condition under which `~` stops expanding. `buildBurnAgent` is
used by both the burner (`ticket-burner.ts:1839,2020`) and research (`research.ts:268`), so if the
hypothesis holds it is still reachable today.

I rate the **artifact + its provenance as high confidence** (git history and file contents are
direct evidence) and the **`env:` replacement as the surviving mechanism as medium confidence** — the
original writer is deleted, so I cannot close the loop statically. Recorded here as
`windows-path:claude-config-dir` for the parent to route to the `packages/server` leaf, who can check
what `@ai-hero/sandcastle`'s `noSandbox` provider does with `ClaudeCodeOptions.env`.

### Is it safe to delete?

**Yes.** Verified:
- No code reads it: repo-wide grep for `.claude/projects` / `claude/projects` across
  `packages/**`, `apps/**`, `scripts/**` (excluding `node_modules`) returns **zero** hits.
- No test fixture references it; the only `transcriptPath` handling in the server
  (`packages/server/src/routes/hooks.ts:128-133`, `packages/server/src/launcher/sessions.ts:102,129`)
  stores whatever string a hook payload supplies and never opens a file.
- It is not in `packages/server/package.json`'s `files: ["src","drizzle"]`, so it never shipped to
  npm; and `packages/server/scripts/build-package.ts` copies an explicit allow-list of assets that
  does not include it.
- Nothing under `~` is a build input, a migration, or a runtime asset.

Recommended alongside deletion: add `.gitignore` entries so recurrence #3 cannot happen —
```
~/
.claude/
```
(the first is the specific accident; the second guards the general one).
