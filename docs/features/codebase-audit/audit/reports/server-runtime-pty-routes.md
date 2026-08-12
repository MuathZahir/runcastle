# Audit report — `packages/server/src/pty/**` + `packages/server/src/routes/**`

Leaf node. Scope: `pty/{pty,pty-host.cjs,pty-sidecar,registry,ring-buffer,ws,dev-pane,end-session,install-check,prebuild-bridge,index}` and `routes/{hooks,stream,web}`, plus a skim of `patches/node-pty@1.1.0.patch`.
Cross-referenced (NOT audited — siblings own them): `launcher/{launcher,artifacts,hook-client,reconcile,asset-paths,sessions}`, `services/{git,drive-env,events,bus,setup}`, `util/resolve-executable`, `src/index.ts`, `docs/UI-SPEC.md §5`.

Analysis only. Nothing was edited. No tests or servers were run.

---

## A. Flow map

### Flow 1 — PTY lifecycle (create → stream → teardown → reap)

```
CREATE
 launcher/launcher.ts:1006 spawnEmbeddedPty()
   ├─ launcher.ts:1015  claudeSpawnTarget() → util/resolve-executable.ts:142 spawnTargetFor()
   │      .exe → spawn direct | .cmd/.bat → cmd.exe /c | .ps1 → powershell.exe -File   ← SHIM INTERPOSED
   ├─ launcher.ts:1016  env = { ...process.env, RUNCASTLE_SESSION_ID, RUNCASTLE_SERVER_URL }
   ├─ launcher.ts:1021  for (key of CC_NESTING_ENV) delete env[key]     ← scrubs CLAUDE_* only
   └─ launcher.ts:1023  ptyRegistry().create({ sessionId, cmd, args, opts, onExit })

  (parallel entry) services/git.ts:1545 / :1689 startDevPane()
   └─ pty/dev-pane.ts:94 startDevPane()
        ├─ dev-pane.ts:96   paneId = drivePaneId(featureId|projectId)   → "drive:<id>"  (NOT a session id)
        ├─ dev-pane.ts:62   devSpawnTarget() → win32: cmd.exe /d /s /c <devCommand> | posix: /bin/sh -c
        ├─ dev-pane.ts:104  opts.env = env ?? process.env               ← env from services/drive-env.ts:147
        └─ dev-pane.ts:100  ptyRegistry().create({ sessionId: paneId, ... })

BACKEND SELECTION
 pty/registry.ts:56  createPtySession(...)
 └─ pty/pty.ts:147 createPtySession → pty.ts:120 selectBackend()
      ├─ 'sidecar'  (Bun + win32, or RUNCASTLE_PTY_BACKEND=sidecar)
      │    pty/pty-sidecar.ts:73 createSidecarPtySession
      │      ├─ :36 resolveNodeExecutable()  (RUNCASTLE_NODE_BIN | process.execPath | PATH scan)
      │      ├─ :22 HOST_PATH = resolveAsset(ASSET_ENV.ptyHost, ./pty-host.cjs)
      │      ├─ :82 child_process.spawn(node, [pty-host.cjs, nodePtyEntry])
      │      └─ :188 stdin frame { t:'spawn', file, args, opts{cwd,cols,rows,useConpty,env} }
      │           └─ pty/pty-host.cjs:62 handleSpawn → :85 node-pty spawn → :103 { t:'ready', pid }
      │                                              → :105 onData → { t:'data', d:<base64> }
      │                                              → :110 onExit → { t:'exit', code, signal }
      └─ 'native'   (off-win32, or a node runtime e.g. vitest)
           pty/pty.ts:164 createNativePtySession → :169 loadNodePty() (lazy createRequire)

BUFFER + FANOUT
 pty/registry.ts:67  pty.onData → entry.buffer.push(chunk)              → pty/ring-buffer.ts:19 (512 KiB cap)
                                → for (sink of entry.sinks) sink.sendData(chunk)
 pty/registry.ts:72  pty.onExit → entry.exited = true; entry.exitCode = code
                                → sinks.sendControl({t:'status',status:'ended',exitCode})
                                → input.onExit?.()  → launcher/launcher.ts:951 handlePtyExit

STREAM TO XTERM
 src/index.ts:107  Bun.serve fetch → :108 tryUpgradeTerminal(req, srv)
 └─ pty/ws.ts:43 tryUpgradeTerminal → :27 extractSessionId('/ws/terminal/:id')
 └─ pty/ws.ts:49 terminalWebSocket
      ├─ open   :62 ptyRegistry().attach(id, sink) → registry.ts:96 buffer.snapshot() replay + status frame
      ├─ message:74 text  → JSON.parse → {t:'resize'} → entry.pty.resize()
      │         :87 binary→ entry.pty.write(Buffer.from(msg).toString('utf8'))   ← utf8 round-trip
      └─ close  :93 ptyRegistry().detach(id, sink)
 client: apps/web/src/lib/terminal.ts:74 (backoff reconnect, onReset clears screen before replay)

TEARDOWN
 (user) trpc feature.endSession → pty/end-session.ts:24 endSession
      ├─ :26 registry.kill(id)   → registry.ts:114 → entry.pty.kill()
      │        native  : pty.ts:206 proc.kill()      (ConPTY teardown, DIRECT child only)
      │        sidecar : pty-sidecar.ts:231 sendToHost({t:'kill'}) → pty-host.cjs:140 proc.kill()
      │                  + :235 setTimeout(500ms) child.kill()   ← backstop kills the HOST
      ├─ :27 registry.remove(id)  (synchronous, BEFORE the process has actually died)
      ├─ :29 markSessionEnded → :33 releaseForSession → :35 landProjectSession
      └─ :38 emitForSession('session.ended')
 (drive) pty/dev-pane.ts:177 stopDevPane
      ├─ :180 killProcessTree(entry.pty.pid)  → win32 taskkill /pid /T /F | posix kill(-pid, SIGTERM)
      ├─ :181 reg.kill(paneId)
      └─ :182 reg.remove(paneId)
 (shutdown) src/index.ts:129 ptyRegistry().killAll() → registry.ts:127 kill each + entries.clear()

REAPING
 boot     : launcher/reconcile.ts:28 reconcileStaleSessions — DB rows only; the registry is empty at cold boot
 in-flight: NOTHING. registry.ts:72 onExit sets `exited=true` but never `entries.delete()`;
            launcher.ts:951 handlePtyExit does not call remove().    ← see finding B/D below
```

### Flow 2 — Hook callback

```
Claude Code fires a hook (registered by launcher/artifacts.ts:715 renderSettings)
  SessionStart(×5 sources) → 'session-start'   artifacts.ts:726
  UserPromptSubmit         → 'user-prompt'     artifacts.ts:728
  Stop                     → 'stop'            artifacts.ts:729
  SessionEnd               → 'session-end'     artifacts.ts:730
  PreToolUse(EDIT_TOOL_MATCHER, kind-gated) → 'pre-tool'  artifacts.ts:732
     command: `bun run "<hookClient>" <event>`   (timeout 10s for start/end, 5s otherwise)
        │
        ▼
launcher/hook-client.ts:36 main()
  ├─ :41 readStdin() (2.5s cap)  → :44 JSON.parse(raw) or { raw }
  ├─ :38 serverUrl = RUNCASTLE_SERVER_URL ?? http://localhost:4512
  ├─ :39 sessionId = RUNCASTLE_SESSION_ID
  └─ :49 POST ${serverUrl}/api/hooks/${event}  body { event, sessionId, payload }, 3s AbortSignal
        │
        ▼
src/index.ts:61  app.route('/api/hooks', hooksApp)
routes/hooks.ts:37 charset middleware (application/json → + charset=utf-8)
routes/hooks.ts:50 POST /:event
  ├─ :52 event = c.req.param('event')          ← body.event is NEVER read (dead wire field)
  ├─ :53 body = await c.req.json().catch(()=>({})) as HookBody      ← cast, no zod
  ├─ :55 if (!sessionId) return c.json({})
  ├─ :57 ctx = await getRuntimeCtx()           (launcher/runtime.ts; boot-injected by index.ts:35)
  ├─ :58 session = getSessionRow(ctx, sessionId); :59 if (!session) return c.json({})
  ├─ :65 'user-prompt' → markAgentWorking      (launcher/sessions.ts:87 → :96 DB write, NO event)
  ├─ :66 'stop'        → markAwaitingInput + return {}   (sessions.ts:92 → :96 DB write, NO event)
  ├─ :77 featureless (kind prepare|project) branch
  │     :80 session-start → handleProjectScopedSessionStart :159
  │     :82 user-prompt   → handleProjectScopedUserPrompt   :188
  │     :84 session-end   → handleProjectScopedSessionEnd   :203
  │     :86 pre-tool      → handlePreToolUse                :308
  │     :88 default       → {}                              (200, silently)
  ├─ :92 feature = tryGetFeature(); :93 if (!feature) return {}
  └─ :95 feature branch
        :97  session-start → handleSessionStart :121 → markSessionLive + emit('session.started')
                             → :333 sessionStartContext (brief/phase/lap/branch/tickets)
        :99  user-prompt   → handleUserPrompt   :272 → noteKickoffPrompt + listByFeature count
        :101 session-end   → handleSessionEnd   :289 → markSessionEnded + releaseForSession + emit
        :103 pre-tool      → handlePreToolUse   :308 → launcher/edit-guard.ts evaluateEditGuard
        :105 default       → {}
  └─ :107 catch { return c.json({}) }           ← total silence, no log

RESPONSE CONTRACT (what hook-client.ts:57 writes verbatim to Claude Code's stdin)
  session-start → { hookSpecificOutput: { hookEventName:'SessionStart',      additionalContext } }
  user-prompt   → { hookSpecificOutput: { hookEventName:'UserPromptSubmit',  additionalContext } }
  pre-tool      → editDenyResponse(denial) | {}
  stop/session-end/unknown/any error → {}

EVENT EMISSION → services/events.ts:111 emitForSession / :135 emit
                 → services/events.ts:144 publishLive({kind:'event',...})
                 → services/bus.ts:55 publishLive → routes/stream.ts:50 subscribeLive
                 → SSE GET /api/stream (index.ts:63) → apps/web
```

Boundary notes for the parent: the *spawn-target* logic (`util/resolve-executable.ts`), the *env assembly* (`launcher/launcher.ts:1016`, `services/drive-env.ts:143`), the *hook registration table* (`launcher/artifacts.ts:715`) and the *`Bun.serve` options* (`src/index.ts:105`) all sit outside my scope but are where several of my findings must be fixed. Flagged in H.

---

## B. Dead code

### B1. `packages/server/src/pty/index.ts` — the entire barrel has zero importers
**Canonical key:** `dead:pty-barrel` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

`pty/index.ts:1-40` is a 40-line public-surface barrel:

```ts
/**
 * Embedded-terminal PTY layer (UI-SPEC §5, owner W1). Public surface:
 * - `createPtySession` — the one backend interface (bun-native node-pty).
 ...
export { ptyRegistry, type ControlFrame, ... } from './registry'
export { endSession, type EndSessionResult } from './end-session'
export { terminalWebSocket, tryUpgradeTerminal } from './ws'
```

**How verified.** Repo-wide search for any import of the directory specifier:
`grep -rn "from '\.\./pty'|from '\./pty'|from '\.\./\.\./pty'|pty/index"` over `packages/ apps/ scripts/` (excluding `node_modules`) returns **three hits, all of them `./pty` meaning the sibling *file* `pty.ts`**, not the directory: `pty/index.ts:15`, `pty/pty-sidecar.ts:7`, `pty/registry.ts:1`. Every real consumer imports the concrete module instead:

- `src/index.ts:11-12` → `'./pty/registry'`, `'./pty/ws'`
- `launcher/launcher.ts:13-14` → `'../pty/end-session'`, `'../pty/registry'`
- `launcher/reconcile.ts:5`, `launcher/sessions.ts:6`, `trpc/routers/setup.ts:5` → `'../pty/registry'`
- `services/git.ts:11` → `'../pty/dev-pane'`; `services/features.ts:35` → `'../pty/end-session'`
- `scripts/postinstall-node-pty.ts:20-21` → `'.../pty/prebuild-bridge.ts'`, `'.../pty/install-check.ts'`
- all 8 test files → concrete modules
- `@runcastle/server`'s only external consumers are `apps/web/src/lib/api.ts:4` and `apps/web/src/trpc.ts:6`, both `import type { AppRouter }` — the package root, not this barrel.

The barrel is also *stale as documentation*: its header at `pty/index.ts:6` still says "`createPtySession` — the one backend interface (bun-native node-pty)", which predates the two-backend split (`pty.ts:106 type Backend = 'native' | 'sidecar'`). It documents a surface nobody imports and describes it wrongly.

### B2. `RingBuffer.clear()` — no caller anywhere
**Canonical key:** `dead:ring-buffer-clear` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty/ring-buffer.ts:40
  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
```

**How verified.** `grep -rn "clear()"` across `packages/ apps/ scripts/`: the only `.clear()` calls are `launcher/sessions.ts:398 d.timers.clear()`, `pty/registry.ts:131 this.entries.clear()`, `routes/stream.ts:82 pending.clear()`, `services/agent-stream.ts:106 transcripts.clear()`. None is a `RingBuffer`. `pty.test.ts` (the only file that constructs a `RingBuffer` directly, lines 68-90) exercises `push`/`snapshot`/`byteLength` only. Notable because a `clear()` on PTY exit is exactly the missing eviction in D2 — the method exists, it is simply never wired.

### B3. `assertPtyInstalled` — exported for production gates that were never built
**Canonical key:** `dead:assert-pty-installed` · **Kind:** violation (production-dead; tests keep it green) · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty/install-check.ts:168-175
/**
 * Throw {@link checkPtyInstall}'s remediation message unless the binary is
 * present. For call sites that want a hard gate (doctor `--strict`, boot preflight).
 */
export function assertPtyInstalled(probe?: PtyInstallProbe): void {
```

**How verified.** Full-repo grep for `assertPtyInstalled`: definition (`install-check.ts:172`), the dead barrel (`pty/index.ts:17`), its own docstring, and `test/pty-install-check.test.ts:5,117,119,124`. **No doctor path, no boot preflight, no tRPC route calls it** — the two call sites its own docstring names do not exist. `checkPtyInstall` fares slightly better but is also production-unreferenced: `scripts/postinstall-node-pty.ts:21` imports only `detectMusl` + `resolvePtyRoot`, and the `checkPtyInstall` mention at `postinstall-node-pty.ts:37` is a *comment*, not a call. Classic speculative generality (taxonomy #4) — a documented gate with zero gates.

### B4. `HookBody.event` — declared on the wire, never read
**Canonical key:** `dead:hook-body-event` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// routes/hooks.ts:44-48
interface HookBody {
  event?: string
  sessionId?: string
  payload?: Record<string, unknown>
}
```

`hook-client.ts:52` faithfully sends it (`body: JSON.stringify({ event, sessionId, payload })`), but the route reads the **path param** instead — `hooks.ts:52 const event = c.req.param('event')` — and `body.event` is never referenced in the file. So the event name travels twice on every hook call and the redundant copy is silently discarded. See D5: this is one of four places the same stringly-typed event name is spelled out.

**Nothing else in scope is dead.** `registry.has()` / `registry.ids()` are test-only but are self-declared as such (`registry.ts:134 "Live session ids (diagnostics/tests)"`); `createNativePtySession` is live (dispatched from `pty.ts:154` off-win32 and exercised by tests, as its docstring claims); `prebuild-bridge.ts` is live via `scripts/postinstall-node-pty.ts:20`; `routes/web.ts` is live via `index.ts:68 mountWebAppIfBuilt`.

---

## C. Redundancy & repeated logic

### C1. Three near-identical hook handler pairs (feature-scoped vs project-scoped)
**Canonical key:** `redundant:hook-session-lifecycle` · **Kind:** judgement call · **Confidence:** high · **Effort:** M · **Risk:** low

`routes/hooks.ts` implements each lifecycle event twice — once for a session with a feature, once for one without. The file's own comment admits the split is cosmetic:

```ts
// hooks.ts:156-157
 * kind-appropriate brief instead of a feature one. The bookkeeping is
 * kind-agnostic; only the injected context and the event wording are not.
```

The three pairs, and their only real differences:

| Feature path | Project-scoped path | Difference |
|---|---|---|
| `handleSessionStart` :121-148 | `handleProjectScopedSessionStart` :159-186 | emit helper + message noun + context builder |
| `handleUserPrompt` :272-287 | `handleProjectScopedUserPrompt` :188-201 | the `additionalContext` string only |
| `handleSessionEnd` :289-300 | `handleProjectScopedSessionEnd` :203-211 | `releaseForSession` present / absent; noun |

The start pair is ~28 duplicated lines including the identical three-field payload extraction:

```ts
// hooks.ts:127-133 (feature)                   // hooks.ts:164-171 (project-scoped)
const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
const transcriptPath = typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
const source = typeof payload?.source === 'string' ? payload.source : undefined
const wasLive = getSessionRow(ctx, sessionId)?.status === 'live'
markSessionLive(ctx, sessionId, { ccSessionId, transcriptPath })
if (!wasLive) { emit/emitForSession(... 'session.started' ...) }
```

Two adapters exist → this is a **real seam**, not a hypothetical one. Suggested module: `hookLifecycle(event, ctx, session, payload) → { …bookkeeping }` plus a per-scope `contextFor(session, feature?)` strategy, collapsing the `!session.featureId` fork (`hooks.ts:77-90`) into one switch. Note that `emitForSession` (`services/events.ts:111-115`) already routes on `featureId ?? projectId`, so it can serve *both* branches — the feature path's use of raw `emit(ctx, feature.id, …)` at `hooks.ts:135` and `:294` is gratuitous divergence (see D4).

### C2. Newline-JSON frame reader implemented twice, byte-for-byte
**Canonical key:** `redundant:ndjson-frame-reader` · **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

The same accumulate-and-split loop appears on both ends of the sidecar protocol:

```ts
// pty-sidecar.ts:113-127                        // pty-host.cjs:155-171
let acc = ''                                     let acc = ''
child.stdout?.on('data', (chunk: string) => {    process.stdin.on('data', (chunk) => {
  acc += chunk                                     acc += chunk
  let nl: number                                   let nl
  while ((nl = acc.indexOf('\n')) !== -1) {        while ((nl = acc.indexOf('\n')) !== -1) {
    const line = acc.slice(0, nl)                    const line = acc.slice(0, nl)
    acc = acc.slice(nl + 1)                          acc = acc.slice(nl + 1)
    if (!line) continue                              if (!line) continue
    try { msg = JSON.parse(line) } catch { continue }  try { msg = JSON.parse(line) } catch { … }
```

Mitigating: the host is a `.cjs` file deliberately kept dependency-free and un-bundled (`pty-sidecar.ts:19-21`), so sharing a module across the boundary costs more than it saves. Report it as *known duplication with a stated reason*, effort S, and low priority — but the reason is not written down at either site, which is the actual gap.

### C3. `env values must be strings` filter, three copies
**Canonical key:** `redundant:env-stringify` · **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty/pty.ts:97-104
function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) { if (typeof v === 'string') out[k] = v }
  return out
}
// pty/pty-sidecar.ts:184-187 — same loop, inline, no helper
const env: Record<string, string> = {}
for (const [k, v] of Object.entries(opts.env)) { if (typeof v === 'string') env[k] = v }
// pty/pty-host.cjs:78-82 — same loop again, third time
const env = {}; const src = opts.env || process.env
for (const k of Object.keys(src)) { if (typeof src[k] === 'string') env[k] = src[k] }
```

Two of the three are on the same side of the process boundary (`pty.ts` and `pty-sidecar.ts`) and could trivially share `cleanEnv` — `pty-sidecar.ts` already imports types from `./pty`. The third (`pty-host.cjs:78`) is defensive re-filtering of data that already crossed a JSON boundary as strings, i.e. redundant work rather than duplicated logic.

### C4. `resolve node-pty's package root` reimplemented in `services/setup.ts`
**Canonical key:** `redundant:module-root-resolution` · **Kind:** judgement call · **Confidence:** medium · **Effort:** S · **Risk:** low

`install-check.ts:75-82 resolvePtyRoot()` resolves a dependency's package root by `require.resolve('<pkg>/package.json')` + `dirname`. `services/setup.ts:162` does the same job for sandcastle and says so in prose rather than sharing code:

```
 * (sandcastle stays external, so it's a real installed dependency either way),
 * mirroring {@link resolvePtyRoot}'s `require.resolve('node-pty/package.json')`.
```

Two callers → real seam for a `resolvePackageRoot(specifier)` helper in `util/`. Caveat lowering confidence: `setup.ts` cannot use the CJS form (its comment explains sandcastle is ESM-only with no `./package.json` export), so the shared helper would need both strategies. Worth it only if a third caller shows up — flag to the parent, since sibling scopes may hold that third caller.

---

## D. Inconsistencies & structural smells

### D1. ⚠️ Session PTYs are killed WITHOUT a tree kill — the dev-pane fix was never generalized
**Canonical key:** `leak:session-pty-tree-kill` · **Kind:** violation (latent bug) · **Confidence:** high (code path) / medium (field frequency) · **Effort:** M · **Risk:** medium

`dev-pane.ts:150-158` states the Windows rule in full:

```
 * Kill the process tree rooted at `pid`, best-effort. … On Windows nothing signals a
 * tree, and killing the PTY is not enough: ConPTY teardown reaches only its DIRECT
 * child, which `devSpawnTarget` always makes the `cmd.exe` shim — the dev server
 * itself is a GRANDCHILD and survives, holding its port and its file locks.
 * `taskkill /T` walks the child list, so it is the only teardown that actually frees the port.
```

The session PTY hits **exactly the same shape** and gets none of that treatment. `launcher/launcher.ts:1015` builds the spawn target via `util/resolve-executable.ts:142`:

```ts
export function spawnTargetFor(resolved: string, args: string[]): SpawnTarget {
  if (/\.(cmd|bat)$/i.test(resolved)) {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/c', resolved, ...args] }
  }
  if (/\.ps1$/i.test(resolved)) {
    return { file: 'powershell.exe', args: ['-NoProfile','-ExecutionPolicy','Bypass','-File', resolved, ...args] }
  }
  return { file: resolved, args }
}
```

and `WIN_EXTS = ['.exe', '.cmd', '.bat', '.ps1', '']` (`resolve-executable.ts:44`) means an **npm-global-installed `claude` resolves to `claude.cmd`** — so the PTY's direct child is `cmd.exe` and the real `claude` (node) is a grandchild, verbatim the dev-pane situation. Teardown then does:

```ts
// pty/end-session.ts:25-27
  const registry = ptyRegistry()
  const killed = registry.kill(sessionId)      // → registry.ts:117 entry.pty.kill()
  registry.remove(sessionId)
```

`registry.kill` → `pty.ts:206 proc.kill()` (native) or `pty-host.cjs:140 proc.kill()` (sidecar) — ConPTY teardown of the direct child only. **The `claude` node process orphans**, keeping the talk worktree's files open. That is a plausible mechanism behind the repo's recorded `EPERM`-on-worktree-teardown pain (commit `feature/…-project-session-eperm-teardown`): Windows cannot delete a directory a live process holds handles in.

`killProcessTree` (`dev-pane.ts:159-170`) is a **private function in `dev-pane.ts`** — not exported, not reachable from `registry.kill`, not used by `end-session.ts`, `killAll()`, or `handlePtyExit`. The fix landed on one of the two spawn paths.

The `killAll()` shutdown path (`registry.ts:127-132`) has the same hole *plus* a synchronous-exit hole: it calls `entry.pty.kill()` and then `process.exit(0)` two statements later (`index.ts:129-131`), so on the sidecar backend the `{t:'kill'}` frame may not even be flushed before the server dies — see D3.

### D2. ⚠️ Registry entries are never reaped when a PTY exits on its own
**Canonical key:** `leak:pty-registry-entries` · **Kind:** violation (unbounded growth) · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty/registry.ts:72-77
    pty.onExit(({ exitCode, signal }) => {
      entry.exited = true
      entry.exitCode = exitCode
      for (const sink of entry.sinks) sink.sendControl({ t: 'status', status: 'ended', exitCode })
      input.onExit?.({ exitCode, signal })
    })
```

No `this.entries.delete(input.sessionId)`. The only `remove()` callers in the repo are `end-session.ts:27` and `dev-pane.ts:182` — both **user-initiated** teardowns. The `onExit` consumer, `launcher.ts:951 handlePtyExit`, marks the row ended, releases waypoints, lands the project session and emits `session.pty_exited`, but **never touches the registry**.

Consequence: every session that ends *naturally* (user types `/exit`, `claude` crashes, sidecar host dies) leaves a permanent `PtyEntry` holding its `RingBuffer` — **up to 512 KiB each** (`ring-buffer.ts:10 DEFAULT_CAPACITY = 512 * 1024`) — for the life of the server process. Session ids are unique per session (`registry.ts:50-54`'s reclaim-on-recreate only helps the *reused* `drive:<id>` pane ids), so nothing ever reclaims them. `killAll()` clears the map only at shutdown.

Partly intentional: `attach()` (`registry.ts:96-106`) deliberately serves an ended entry so a late reconnect still sees the final scrollback plus an `ended` frame. But that argues for a **TTL / bounded retention**, not for infinite retention. `RingBuffer.clear()` (B2) is the unused method that would blunt it. Deletion test on `RingBuffer`: it **passes** (see F1) — but it is the thing that makes this leak cost megabytes rather than bytes.

### D3. Teardown is fire-and-forget everywhere except `landProjectSession` — the half-fix
**Canonical key:** `race:pty-teardown-fire-and-forget` · **Kind:** violation (latent bug) · **Confidence:** medium-high · **Effort:** M · **Risk:** medium

`endSession` (`end-session.ts:24`) is **synchronous** and returns `{ sessionId, ok, killed }` the instant `registry.kill()` returns — long before the process actually dies. Three consequences:

1. **`remove()` before death.** `end-session.ts:26-27` kills then removes in adjacent statements. A WS client that reconnects in the window between (`ws.ts:62 attach()` returns false) gets `{t:'status',status:'ended',exitCode:0}` **and an immediate `ws.close(1000,'no such session')`** (`ws.ts:66-68`) instead of the real final scrollback + real exit code. The `exitCode: 0` there is a fabricated value, not an observed one.
2. **`killed` is a lie about the future.** `EndSessionResult.killed` is documented as "Whether a live PTY was found and killed" (`end-session.ts:10-11`), but `registry.kill` returns `true` merely for *entry found* (`registry.ts:114-119`) — it never observes the process actually terminating. On the sidecar path `kill()` is literally a `sendToHost({t:'kill'})` write onto a pipe (`pty-sidecar.ts:233`).
3. **Shutdown races the kill.** `index.ts:128-132`:
   ```ts
   const shutdown = (): void => {
     ptyRegistry().killAll()
     server.stop()
     process.exit(0)
   }
   ```
   On the sidecar backend `killAll()` only queues `{t:'kill'}` frames on child stdins; `process.exit(0)` two lines later can beat the flush. The sidecar's own compensating design — `pty-host.cjs:176-185 process.stdin.on('end')` kills its PTY child when the server detaches — *does* cover this, but only because the host survives the server. That safety net is undocumented at the `index.ts` shutdown site.

The commit "let teardown await the landing instead of racing it" fixed the **`landProjectSession`** ordering inside `endSession` (`end-session.ts:35`) — the DB/git side. The **process** side was never made awaitable: `PtySession.kill(): void` (`pty.ts:45-46`) has no completion signal at all, so no caller *can* await it. That is the remaining half of the fix, and it is an interface-level gap, not a call-site oversight.

### D4. Two emit helpers used for the same job in the same file
**Canonical key:** `inconsistent:event-emission` · **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

`routes/hooks.ts` uses the raw feature emitter on the feature path and the session emitter on the project path:

```ts
// hooks.ts:135 (feature)                    // hooks.ts:173 (project-scoped)
emit(ctx, feature.id, { type: 'session.started', … })
                                              emitForSession(ctx, session, { type: 'session.started', … })
// hooks.ts:294 (feature)                    // hooks.ts:205 (project-scoped)
emit(ctx, feature.id, { type: 'session.ended', … })
                                              emitForSession(ctx, session, { type: 'session.ended', … })
```

`services/events.ts:111-115` shows `emitForSession` handles both cases (`featureId` → `emit`, else `projectId` → `emitProject`), so one helper would do throughout and would let C1's extraction proceed. `end-session.ts:38` and `reconcile.ts:43` both already use `emitForSession` uniformly — `hooks.ts` is the outlier.

### D5. The hook event name is a bare string spelled out in four places, with no shared union
**Canonical key:** `stringly:hook-event-name` · **Kind:** judgement call (drift risk) · **Confidence:** high · **Effort:** S · **Risk:** low

The same five-value vocabulary appears, unlinked, at:

1. `launcher/artifacts.ts:726,728,729,730,732` — `cmd('session-start')`, `cmd('user-prompt')`, `cmd('stop')`, `cmd('session-end')`, `cmd('pre-tool')` (the producer)
2. `launcher/hook-client.ts:37,49` — `argv[0]` pass-through into the URL
3. `routes/hooks.ts:65,66,79-87,96-104` — the two switches (the consumer)
4. `routes/hooks.ts:45` — `HookBody.event`, sent but never read (B4)

Nothing type-checks (1) against (3). A typo in `artifacts.ts` produces a `default: return c.json({})` at `hooks.ts:88`/`:105` — a silent 200 with an empty body — and the session simply never gets its context. A `HookEvent` union in `@runcastle/core` (where the wire types live per `CLAUDE.md`'s package map) would make the producer/consumer pair a compile-time contract. Classic primitive obsession on a cross-process contract (taxonomy #4).

### D6. Unknown/invalid input is answered `200 {}` with zero observability
**Canonical key:** `swallowed:hook-errors` · **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// hooks.ts:107-110
  } catch {
    // Never break the session on our account.
    return c.json({})
  }
```

The golden rule (`hooks.ts:28-29`) justifies never *failing* — but the handler logs nothing on the way out. A throw inside `sessionStartContext` (`hooks.ts:333`, which calls `listByFeature`), inside `evaluateEditGuard`, or inside `getRuntimeCtx()` is completely invisible: the session opens, gets no briefing, and nobody ever learns why. Contrast the discipline elsewhere in this scope — `pty-sidecar.ts:142` and `:166` both write the failure to `process.stderr` *and* into the PTY stream so the user sees it; `pty-host.cjs:39-45` has a dedicated `log()` on stderr. The hook route is the only "must never throw" path in the scope with no diagnostic channel. Minimum fix: `catch (err) { console.error('[hooks]', event, err); … }`. Better: emit a `session.hook_failed` event so it lands on the timeline the UI already polls.

### D7. Turn-state mutation emits nothing — house-convention deviation
**Canonical key:** `inconsistent:event-emission` (same key as D4, different site) · **Kind:** violation (convention) · **Confidence:** high · **Effort:** S · **Risk:** low

`CLAUDE.md` / SPEC §12: "**Every service function that mutates emits an event** — events are the UI's lifeblood." The two hottest mutations in the hook path do not:

```ts
// hooks.ts:65-68
    if (event === 'user-prompt') markAgentWorking(ctx, sessionId)
    if (event === 'stop') { markAwaitingInput(ctx, sessionId); return c.json({}) }
```
```ts
// launcher/sessions.ts:87-98
export function markAgentWorking(ctx: AppCtx, id: string): void { setAwaitingInput(ctx, id, false) }
export function markAwaitingInput(ctx: AppCtx, id: string): void { setAwaitingInput(ctx, id, true) }
function setAwaitingInput(ctx: AppCtx, id: string, awaitingInput: boolean): void {
  ctx.db.update(sessions).set({ awaitingInput }).where(eq(sessions.id, id)).run()
}
```

A bare DB write, no `emit`, and — critically — **no `publishLive`**. `services/bus.ts:22-35 LiveSignal` has only `'event'` and `'transcript'` kinds, and `publishLive` is called from exactly two places (`services/events.ts:144`, `services/agent-stream.ts:60,82,89`), so there is no signal-without-event escape hatch. The "agent working / awaiting you" badge therefore lags a full poll tick every single turn while `routes/stream.ts` — which exists precisely to kill that lag — sits idle. I read the omission as deliberate (a per-turn timeline event would be noise) but then the correct move is a third `LiveSignal` kind, not silence. Flagged to the parent because the same "mutate silently, let polling find it" pattern likely recurs in sibling service scopes.

### D8. Hook docstring lists 4 of the 5 events it handles (confirmed doc drift)
**Canonical key:** `drift:hook-docstring` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// routes/hooks.ts:20-22
/**
 * Hook receiver (SPEC §5.6): `POST /api/hooks/:event` for `session-start`,
 * `user-prompt`, `stop` and `session-end`. The request body is what the
```

`pre-tool` is missing, though it is registered at `artifacts.ts:732` and handled at `hooks.ts:86` and `hooks.ts:103`. (Confirmed per the parent's ground truth; recorded here for completeness.) The `PreToolUse` handler is also the only one that is *conditionally* registered (`artifacts.ts:731 kind === undefined || guardsEdits(kind)`), which is exactly the nuance a docstring should carry.

### D9. `UI-SPEC §5` describes a runtime probe; the code ships a deterministic switch
**Canonical key:** `drift:pty-backend-selection` · **Kind:** violation (doc drift) · **Confidence:** high · **Effort:** S · **Risk:** low

```
docs/UI-SPEC.md:65 — "Try under Bun first; if native module fails under Bun, run a sidecar"
```
```ts
// pty/pty.ts:25-27 (the code's own correction)
 * Selection is deterministic (no async probe — the write failure is not flaky
 * but a fixed Bun↔node-pty incompatibility) and overridable via
 * `RUNCASTLE_PTY_BACKEND=sidecar|native`.
```

The shipped `selectBackend` (`pty.ts:120-140`) never probes: it branches on `isBun() && process.platform === 'win32'`. The deviation is well-reasoned and documented *in the code* — per the briefing that makes it doc drift, not a code bug, but "names in the spec are law" and this one is stale. `UI-SPEC.md:65` also lists only 3 of the 8 protocol frames (`data`, `resize`, `exit`); the shipped protocol adds `spawn`, `write`, `kill`, `ready`, `error` (`pty-host.cjs:12-21`).

### D10. `patches/node-pty@1.1.0.patch` carries an *undocumented* second hunk the Windows kill path leans on
**Canonical key:** `drift:node-pty-patch` · **Kind:** violation (doc drift with a regression trap) · **Confidence:** high · **Effort:** S · **Risk:** medium

The patch has two hunks. Hunk 2 (`package.json` `install` → `node -e "process.exit(0)"`) is documented at length in `prebuild-bridge.ts:11-26`. **Hunk 1 is documented nowhere in the repo except inside the patch file itself:**

```
+// runcastle patch (issue #54): AttachConsole throws when this forked agent has no
+// console attached (headless service, CI worker, the Bun->node PTY sidecar). The
+// throw was uncaught, so node's crash report … leaked to the parent's inherited stderr
+// on every ConPTY kill, and the parent then waited out its 5s fallback timeout.
```

**How verified.** `grep -rn "AttachConsole|conpty_console_list|issue #54"` over `packages/ apps/ scripts/ docs/`: the only `issue #54` hits are three *unrelated* Windows-path comments in `test/pty-install-check.test.ts:27`, `test/pty-prebuild-bridge.test.ts:23`, `test/web-serve.test.ts:74`. No source file mentions ConPTY console-list behaviour.

Why it matters: this hunk is a **kill-path** fix. Every ConPTY kill (`pty-host.cjs:140 proc.kill()`, the sidecar's normal teardown) forks node-pty's `conpty_console_list_agent`; without the patch that fork throws, spews a node crash report onto the parent's inherited stderr — which `pty-sidecar.ts:158-160` pipes straight into the **server's** stderr — and the parent then eats a 5-second fallback timeout before the kill lands.

And the retirement instruction actively invites the regression:

```ts
// pty/prebuild-bridge.ts:33-36
 * RETIREMENT. node-pty 1.2 is expected to ship `linux-*` prebuilds. When bumping
 * to it, delete this bridge, the vendored binaries, and the `patchedDependencies`
 * patch, confirm `bun install` still lands `pty.node` on stock glibc, and
 * re-verify the Windows sidecar path (`pty-sidecar.ts`).
```

Deleting "the `patchedDependencies` patch" deletes hunk 1 too. The checklist says "re-verify the Windows sidecar path" but names neither the symptom (5s kill latency + stderr crash spam) nor the upstream condition to check (that node-pty ≥1.2 guards `getConsoleProcessList`). **Fix:** a comment at `pty-sidecar.ts:231` (`kill()`) and/or `pty-host.cjs:140` pointing at the patch, plus an explicit retirement precondition.

### D11. `write()` is stringly-typed while `onData()` is byte-transparent — an asymmetric interface
**Canonical key:** `lossy:pty-write-encoding` · **Kind:** violation (latent bug, low severity) · **Confidence:** medium-high · **Effort:** M · **Risk:** low

The read side is deliberately byte-exact (`ring-buffer.ts:4-7`: "Data is stored as opaque byte chunks … xterm's decoder reassembles it, so we never decode here"; `pty.ts:158-161`: "node-pty is spawned WITHOUT an encoding so bytes pass through untouched"). The **write** side is the opposite. `PtySession.write(data: string)` (`pty.ts:41`) forces a decode at the transport edge and then re-encodes twice on the sidecar path:

```
ws.ts:87       entry.pty.write(Buffer.from(message).toString('utf8'))   // WS bytes → string  (decode #1)
pty-sidecar.ts:226  sendToHost({ t:'write', d: Buffer.from(data,'utf8').toString('base64') })  // → bytes → base64
pty-host.cjs:125    proc.write(Buffer.from(msg.d,'base64').toString('utf8'))                   // → string (decode #2)
```

Two failure modes: (a) a keystroke/paste payload split across two WebSocket frames breaks a multi-byte codepoint and each half decodes to `U+FFFD` — `ws.ts:87` decodes each frame independently with no accumulator, unlike the carefully-accumulated read path; (b) any non-UTF-8 byte sequence (a Latin-1 bracketed paste, a binary paste) is irrecoverably replaced. In practice xterm sends whole keystrokes per frame so (a) is rare, but the asymmetry is a genuine interface defect: making `write(data: string | Buffer)` byte-transparent end-to-end would delete two decodes and the whole class.

### D12. Sidecar exit reports the wrong `signal` value
**Canonical key:** `wrong:sidecar-exit-signal` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty-sidecar.ts:170-172
  child.on('exit', (code, signal) => {
    fireExit(code ?? 0, signal ? 1 : undefined)
  })
```

`signal` here is Node's `NodeJS.Signals` **string** (`'SIGTERM'`, `'SIGKILL'`, …) and it is collapsed to the literal `1` for every signal — so the `PtySession.onExit` contract's `signal?: number` (`pty.ts:37`) reports `1` for a SIGKILL. The native backend (`pty.ts:196`) forwards node-pty's real numeric signal, so the two backends disagree on the same field. Currently harmless only because **nothing consumes it**: `registry.ts:76` forwards it to `input.onExit`, and the sole consumer destructures `({ exitCode })` only (`launcher.ts:1028`). A quiet trap for the next person who reads the field.

### D13. `pty-sidecar.kill()` backstop can orphan the tree on Windows, and can double-fire
**Canonical key:** `race:sidecar-kill-backstop` · **Kind:** judgement call (latent bug) · **Confidence:** medium · **Effort:** S · **Risk:** medium

```ts
// pty-sidecar.ts:231-244
    kill() {
      if (killed) return
      sendToHost({ t: 'kill' })
      // Backstop: if the host doesn't exit promptly, kill the host process.
      setTimeout(() => {
        if (!exitFired && !child.killed) {
          try { child.kill() } catch { /* ignore */ }
        }
      }, 500)
    },
```

Three problems, in descending severity:

1. **The backstop kills the supervisor, not the tree.** `child.kill()` terminates the *node host*. Its ConPTY grandchildren (`cmd.exe` → `claude`) are not signalled. Whether Windows tears them down depends on ConPTY handle-close semantics rather than on anything this code does — and the graceful teardown that `pty-host.cjs:176-185` implements (`stdin.on('end')` → `proc.kill()`) is precisely what killing the host **skips**. 500 ms is also exactly the window the D10 patch exists to shorten: unpatched, node-pty's own kill takes ~5 s, so the backstop would fire *every time* and always take the orphaning path. The patch and this timeout are coupled and neither says so.
2. **`killed` guards nothing useful.** `killed` is set only inside `fireExit` (`pty-sidecar.ts:107-108`), so `if (killed) return` blocks re-entry only *after the process is already dead*. Two `kill()` calls before exit → two `{t:'kill'}` frames (harmless, `pty-host.cjs:140` is idempotent) **and two 500 ms timers**, both racing to `child.kill()`.
3. **The timer is not `unref()`d**, so it pins the event loop for up to 500 ms after an otherwise-clean teardown. Compare `hook-client.ts:32`, which does `if (typeof t.unref === 'function') t.unref()` for exactly this reason — the discipline exists in the codebase, just not here.

### D14. `Bun.serve` sets no `idleTimeout` for either the SSE stream or the terminal WebSocket
**Canonical key:** `config:bun-idle-timeout` · **Kind:** judgement call · **Confidence:** medium (root cause already established as E2E F14; this is the code-side seam) · **Effort:** S · **Risk:** low

Not re-deriving F14. Code-side facts in and adjacent to my scope:

- `routes/stream.ts:31 const HEARTBEAT_MS = 25_000` — the SSE keepalive interval.
- `src/index.ts:105-112` — the **only** `Bun.serve` call in the server, and it passes `port`, `fetch`, `websocket` and nothing else. There is no `idleTimeout` anywhere in the repo. So `HEARTBEAT_MS` is tuned against a value that is never configured; the single-line fix seam is `index.ts:105`, not `stream.ts`.
- The same omission covers the **terminal WebSocket**: `pty/ws.ts:49 terminalWebSocket` declares no `idleTimeout`, and neither side sends a keepalive — `ws.ts` has no ping/pong, and the client (`apps/web/src/lib/terminal.ts:77-114`) has a connect timeout, a stall timer and a reconnect ladder but no periodic ping. An idle terminal (a user reading output) therefore emits zero bytes in either direction for arbitrarily long.
- If the socket is reaped, the cost is not just a reconnect: `registry.attach` (`registry.ts:96-98`) replays the **entire ring buffer** on every attach, and the client fires `onReset()` to clear the screen first (`terminal.ts:96-99`). So the failure mode is a periodic full-scrollback re-render, up to 512 KiB, rather than a visible error — easy to miss, expensive when it happens.

I could not verify Bun's effective WS idle default without running a server (out of bounds). Recorded as: **the knob is unset at `index.ts:105`, and no keepalive exists on the WS path** — both are code-side facts; the consequence is the part that needs a runtime check.

### D15. `env: env ?? process.env` — confirmed hazard, but the fallback is not where the leak is
**Canonical key:** `leak:child-env-inheritance` · **Kind:** violation (latent bug) · **Confidence:** high · **Effort:** M · **Risk:** medium

```ts
// pty/dev-pane.ts:104
      opts: { cwd: repoPath, env: env ?? process.env, cols: 80, rows: 24, useConpty: true },
```

**Confirmed, and worse than the line suggests.** Both production callers *do* pass `env` (`services/git.ts:1550 env: driveEnv`, `services/git.ts:1694 env`), so the `?? process.env` branch is near-dead — but the passed value is itself `process.env` plus an overlay:

```ts
// services/drive-env.ts:143-148
export function driveProcessEnv(
  overrides: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, ...overrides }
}
```

So a drive pane inherits the server's **entire** environment either way. Nothing in the repo scrubs `RUNCASTLE_*` from any child. The only scrub that exists is Claude-specific and lives on the other spawn path:

```ts
// launcher/launcher.ts:1016-1021
  const env: Record<string, string | undefined> = { ...process.env, RUNCASTLE_SESSION_ID, RUNCASTLE_SERVER_URL }
  for (const key of CC_NESTING_ENV) delete env[key]     // CLAUDE_CODE_*, CLAUDECODE, CLAUDE_EFFORT
```

Concrete consequences, in severity order:

1. **Asset vars poison nested runcastle-shaped work.** `launcher/asset-paths.ts:73-77 applyInstalledAssetEnv` *mutates the server's own `process.env`* at bin boot in a published install:
   ```ts
   for (const [envVar, path] of Object.entries(vendoredAssetPaths(pkgRoot))) {
     if (process.env[envVar] === undefined && existsSync(path)) process.env[envVar] = path
   }
   ```
   That sets `RUNCASTLE_MIGRATIONS_DIR`, `RUNCASTLE_WEB_DIST`, `RUNCASTLE_SKILLS_DIR`, `RUNCASTLE_PTY_HOST`, `RUNCASTLE_HOOK_CLIENT`, `RUNCASTLE_SANDCASTLE_TEMPLATE` (`asset-paths.ts:20-33`) **globally**, after which every PTY child — talk session *and* dev pane — inherits them. A drive pane running `bun run test` or `bun run dev` in a runcastle-like project then reads the **installed runcastle's** migrations dir instead of its own. This is not hypothetical: the user's own operating note records it verbatim — *"Tests in talk sessions read stale migrations — unset the inherited `RUNCASTLE_*` asset env vars or get hundreds of phantom failures."*
2. **Data-dir/port overrides redirect nested servers.** `core/paths.ts:34,44` honour `RUNCASTLE_DEV_DATA_DIR` / `RUNCASTLE_DATA_DIR`, and `core/config-load.ts:30` honours `RUNCASTLE_SERVER_PORT`. A dev pane that boots any runcastle process inherits the parent's data dir and port — the dogfooding footgun `index.ts:113-115` prints a banner to defend against, defeated one process down.
3. **Behaviour overrides propagate.** `RUNCASTLE_PTY_BACKEND` (`pty.ts:121`), `RUNCASTLE_NODE_BIN` (`pty-sidecar.ts:37`), `RUNCASTLE_CLAUDE_BIN`, and the whole `RUNCASTLE_BURN_*` / `RUNCASTLE_MODEL` block (`config-load.ts:31-62`) all leak into every child.

The structural root is that `applyInstalledAssetEnv` uses the ambient `process.env` as its resolution channel, which makes leakage the default and containment opt-in. The fix pattern already exists as `CC_NESTING_ENV` — it simply needs a `RUNCASTLE_ASSET_ENV`/`RUNCASTLE_CONFIG_ENV` sibling applied at **both** spawn sites, ideally inside `registry.create` so no future spawn path can forget.

### D16. Windows shell construction: `cmd.exe /d /s /c <devCommand>` — quoting and injection
**Canonical key:** `shell:dev-command-construction` · **Kind:** judgement call · **Confidence:** medium-high · **Effort:** M · **Risk:** medium

```ts
// pty/dev-pane.ts:62-67
export function devSpawnTarget(devCommand: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', devCommand] }
  }
  return { file: '/bin/sh', args: ['-c', devCommand] }
}
```

Assessing the **pty/hook-execution side** only (F10 covers the prep-prompt side; not re-derived):

- **Injection is by design, not a bug.** `devCommand` is a project setting the user types (`services/settings.ts`), it is meant to be a shell command line, and it runs with the server's privileges in the user's own repo. Chaining (`&&`, `|`) is a *feature* here. Not a vulnerability — worth stating explicitly so it isn't re-flagged.
- **`/s` is doing real work and is undocumented.** With `/s`, `cmd.exe` strips the first and last quote of the command string and takes the rest literally. That is what makes `"C:\Program Files\nodejs\npm.cmd" run dev` work — but it also means a command that *legitimately* both starts and ends with a quote (`"my dev" && "my other"`) is mangled. The comment at `dev-pane.ts:54-61` explains why `cmd.exe` is used at all but never mentions `/d /s`.
- **Variable expansion differs by platform, silently.** `$PORT` expands under `/bin/sh -c` and is a literal under `cmd.exe /c`; `%PORT%` is the reverse. A `devCommand` written on one platform silently misbehaves on the other, and nothing warns. The overlay from `driveProcessEnv` (`drive-env.ts:147`) is delivered as real environment variables, so a user's natural instinct — reference the drive var in the command — is exactly the case that breaks cross-platform.
- **Path handling itself is clean.** No hand-concatenation in this scope: `cwd` is passed as `repoPath` (a real path, never interpolated into the command string), and `install-check.ts:141`, `prebuild-bridge.ts:109-110,134`, `routes/web.ts:60,72,89`, `asset-paths.ts:43,57-62` all use `node:path` `join`/`resolve`/`normalize` per house convention. `routes/web.ts:53-63 safeJoin` correctly guards traversal with a `normalize` + `startsWith(root + sep)` check after `decodeURIComponent`.

---

## E. Wrong-tool & weak-typing findings

### E1. `routes/hooks.ts` validates a cross-process JSON contract entirely by hand — no zod
**Canonical key:** `wrongtool:hook-validation` · **Kind:** violation · **Confidence:** high · **Effort:** M · **Risk:** low

House convention: "Zod is the schema lib." The hook route — the server's only **untrusted-ish, cross-process, cross-version** JSON boundary (Claude Code's own hook payload shapes, which change between CC releases) — uses none of it.

```ts
// hooks.ts:44-53
interface HookBody { event?: string; sessionId?: string; payload?: Record<string, unknown> }
…
    const body = (await c.req.json().catch(() => ({}))) as HookBody
```

An unchecked `as` cast on parsed JSON (taxonomy #5 and #6 in one line), then hand-rolled `typeof` guards repeated **eight** times across four handlers:

```ts
hooks.ts:127  const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
hooks.ts:128  const transcriptPath = typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
hooks.ts:130  const source = typeof payload?.source === 'string' ? payload.source : undefined
hooks.ts:164-167  (the same three, verbatim, for the project-scoped path)
hooks.ts:193  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : undefined
hooks.ts:278  (the same, for the feature path)
hooks.ts:313  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : undefined
hooks.ts:315-320  (a nested ternary for file_path / notebook_path)
```

plus a second unchecked cast on the nested object:

```ts
// hooks.ts:314
  const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>
```

A zod schema per event (`SessionStartPayload`, `UserPromptPayload`, `PreToolUsePayload`) with `.safeParse` would replace all of it, give the parse failure a name for D6's missing log line, and — combined with D5's `HookEvent` union — turn the whole route into a discriminated dispatch. The `.catch(() => ({}))` at `hooks.ts:53` already swallows malformed JSON, so the golden rule survives a schema unchanged.

### E2. `ws.ts` control frames: `JSON.parse` + hand-rolled shape check
**Canonical key:** `wrongtool:ws-control-frame` · **Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty/ws.ts:76-83
      try {
        const frame = JSON.parse(message) as { t?: string; cols?: number; rows?: number }
        if (frame.t === 'resize' && typeof frame.cols === 'number' && typeof frame.rows === 'number') {
          entry.pty.resize(frame.cols, frame.rows)
        }
      } catch { /* ignore malformed control frames */ }
```

`registry.ts:17-19` already defines the `ControlFrame` union as a *type*, so the wire vocabulary exists — it is just not a schema, and the inbound direction re-declares an ad-hoc third shape rather than using it. A zod `ControlFrameSchema` in `@runcastle/core` would serve both directions and the client. Note the accidental-safety here: `resize` is clamped downstream (`pty.ts:204`, `pty-sidecar.ts:229`, `pty-host.cjs:133` all `Math.max(1, …)`), so a hostile `cols: -1` cannot reach ConPTY — but that is three separate clamps compensating for one missing validation, itself a small redundancy.

### E3. `pty-sidecar.ts` host frames: hand-rolled optional-field interface
**Canonical key:** `wrongtool:sidecar-frame-validation` · **Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// pty-sidecar.ts:59-66
interface HostMessage { t?: string; d?: string; pid?: number; code?: number; signal?: number | null; message?: string }
// pty-sidecar.ts:124
        msg = JSON.parse(line) as HostMessage
```

Every field optional, a cast, then per-branch `typeof` re-checks (`:130`, `:133`, `:136`). Weakest link: `signal?: number | null` **is a lie** — the value that reaches `fireExit` from `child.on('exit')` is Node's signal *string* (D12), and the type says otherwise. The counter-argument is real: the peer is our own `pty-host.cjs` and keeping zod out of the sidecar boundary is defensible. But then the *type* should at least be honest, and the union should be discriminated on `t` so the `switch` at `:128-152` narrows instead of re-checking.

### E4. `pty.ts` declares a structural mirror of node-pty's API to preserve lazy loading
**Canonical key:** `weaktype:node-pty-structural` · **Kind:** judgement call (justified) · **Confidence:** high · **Effort:** — · **Risk:** low

```ts
// pty.ts:61-63
// --- node-pty shape (structural; avoids depending on its exported types at the
// import graph level so the lazy-load boundary is honoured) --------------------
…
// pty.ts:93
  cached = require('node-pty') as NodePtyModule
```

A hand-maintained duplicate of a third-party type surface plus a cast — normally a finding, but the reason is stated and load-bearing (`pty.ts:28-30`: importing the launcher must never touch the native binding). The residual risk is that the mirror drifts from node-pty's real API across a version bump with no compile error, and the retirement checklist (`prebuild-bridge.ts:33-36`) does not list "re-check the structural mirror in `pty.ts:61-85`". Report as a **documentation gap on a justified deviation**, not as weak typing to fix.

**Clean bill elsewhere.** No `any`, no `as any`, no `@ts-ignore`, no non-null `!` assertions anywhere in the 11 pty files or the 3 route files. Every exported function in the scope carries an explicit return type. `install-check.ts` and `prebuild-bridge.ts` are exemplary: injected `exists`/`fs`/`platform`/`arch` seams (`PtyInstallProbe`, `PrebuildBridgeFs`) make both pure and testable on any OS, with discriminated result types (`PrebuildBridgeAction`) instead of booleans. `routes/web.ts` is likewise clean.

---

## F. Shallow modules / deletion-test candidates

### F1. `ring-buffer.ts` — **passes** the deletion test (deep, correctly)
**Canonical key:** `depth:ring-buffer` · **Kind:** judgement call · **Confidence:** high

44 lines, 4 methods, and the interface is genuinely smaller than the behaviour. Delete it and `registry.ts` must inline: chunk accumulation, a byte counter, oldest-first eviction, and the non-obvious invariant at `ring-buffer.ts:22-27`:

```ts
    // Keep at least the newest chunk even if it alone exceeds the cap, so a
    // single huge burst is never dropped wholesale.
    while (this.bytes > this.capacity && this.chunks.length > 1) {
```

plus the `snapshot()` fast path that avoids a `Buffer.concat` for the single-chunk case (`:32`). It also **hides a decision** — that PTY output is stored as opaque bytes and never decoded (`:4-7`) — which is precisely the kind of knowledge a deep module should own. It has one caller (`registry.ts:60`) but is separately unit-tested (`pty.test.ts:68-90`), which is the point: the seam is a *test surface*, not an abstraction for reuse. **Keep as is.** Its one gap is that nothing ever calls `clear()` (B2) or bounds retention (D2).

### F2. `registry.ts` — **passes**, though `has()`/`ids()` are thin
**Canonical key:** `depth:pty-registry` · **Kind:** judgement call · **Confidence:** high

Delete it and the complexity does not vanish, it *multiplies* across `index.ts`, `launcher.ts`, `reconcile.ts`, `sessions.ts`, `trpc/routers/setup.ts`, `services/git.ts`, `end-session.ts` and `dev-pane.ts` — eight callers, each needing the same wiring the registry does once at `create()` (`registry.ts:67-77`): buffer-push + sink-fanout on data, exited/exitCode + `ended` broadcast + launcher callback on exit. `attach()` (`:94-106`) hides a real ordering invariant (replay **then** status **then** subscribe — get it wrong and you drop or duplicate output), and the `globalThis` symbol pinning (`:140-148`) hides a `bun --hot` survival concern that would otherwise be smeared across every caller. Genuinely deep.

Two nits, neither worth acting on alone: `has()` (`:86-88`) and `ids()` (`:134-137`) are pure pass-throughs to the Map used only by tests (self-declared at `:134`), and `remove()` (`:122-124`) is a one-liner whose *absence of a caller* on the natural-exit path is the actual problem (D2).

### F3. `dev-pane.ts` `drivePaneId` / `isDrivePaneId` — thin, and earning it
**Canonical key:** `depth:drive-pane-id` · **Kind:** judgement call · **Confidence:** medium

```ts
// dev-pane.ts:28-35
export function drivePaneId(ownerId: string): string { return `${DRIVE_PREFIX}${ownerId}` }
export function isDrivePaneId(id: string): boolean { return id.startsWith(DRIVE_PREFIX) }
```

One line each — but they are the *only* thing keeping the `drive:` id space disjoint from the `sess_` one, which the whole design leans on (`dev-pane.ts:8-12`: the one-live-session guard, `--resume` semantics and session-end hooks must never see a pane). A shared prefix constant with two named accessors is the right size for that. **Keep.** The real observation is that `isDrivePaneId` has **no production caller** (only `dev-pane.test.ts:57-58,109,177`) — the guards it exists to protect (`launcher/sessions.ts`, `trpc/routers/setup.ts`) key on session *rows* instead, which is a different and arguably better mechanism. So the id-space discipline is enforced by the DB, not by this predicate; the predicate is belt to the DB's braces. Borderline B-section material; I left it out of B because the constant it guards is live and the design intent is explicit.

### F4. `routes/web.ts` `contentType` / `isFile` — trivially thin, correctly so
**Canonical key:** `depth:web-static` · **Kind:** judgement call · **Confidence:** high

`contentType` (`:40-42`) and `isFile` (`:44-50`) are one-liners over a MIME table. Deleting them would inline a `try/catch` into a hot handler for no gain. `safeJoin` (`:53-63`) is where the module's real depth lives (traversal defence). Fine as is; the file is 108 lines and does exactly one job.

**No pass-through wrappers found in this scope.** The one module that *could* have been a shallow adapter — `pty.ts` — is not: `createPtySession` (`:147-155`) is a three-line dispatcher, but `createNativePtySession` (`:164-221`) behind it adds spawn-failure explanation (`:184`), an exit-latch (`:187-190`), `Buffer`-normalisation of node-pty's `string | Buffer` output (`:194`), the ConPTY zero-dimension clamp (`:203-204`) and double-kill protection (`:206-213`) — five behaviours node-pty does not provide.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G1. `killProcessTree` → a shared process-teardown module, used by every PTY kill.**
*Value: high · Confidence: high · Effort: M · Blast radius: medium.*
`dev-pane.ts:159-170` already holds the correct Windows/POSIX tree-kill and the reasoning for it (`:150-158`); it is private and used on one of two spawn paths. Move it to `pty/kill-tree.ts` and call it from `registry.kill()` so **every** entry — session, drive pane, `killAll()` — gets tree semantics. Two adapters exist today (dev pane wants it, session PTY needs it per D1) → **real seam**. Locality: the "how do you actually kill a process on this OS" knowledge lands in one file instead of being a comment in `dev-pane.ts` that the session path never read. Leverage: `end-session.ts`, `index.ts`'s shutdown and `launcher`'s failure paths all inherit the fix for free. Pairs naturally with giving `PtySession.kill()` a completion signal (D3), which is what would let `endSession` finally *await* teardown.

**G2. A child-environment policy module (`launcher/child-env.ts`).**
*Value: high · Confidence: high · Effort: M · Blast radius: medium.*
Today: `launcher.ts:1016-1021` spreads `process.env` and scrubs 8 `CLAUDE_*` keys; `drive-env.ts:147` spreads `process.env` and scrubs nothing; `dev-pane.ts:104` falls back to raw `process.env`. Three spawn paths, one policy, zero shared code. Extract `childEnv({ base, overrides, scrub })` with the `CC_NESTING_ENV` **and** a new `RUNCASTLE_ASSET_ENV`/`RUNCASTLE_CONFIG_ENV` list (D15), and apply it inside `registry.create()` so no future spawn path can forget. Locality: "what a child may inherit" becomes one auditable list. Leverage: kills the documented stale-migrations class of failure outright. Two callers already exist → real seam. Consider also making `applyInstalledAssetEnv` (`asset-paths.ts:73`) return a resolved-asset record instead of mutating global `process.env`, which is what makes the leak structural — that is a larger change, flag as phase 2.

**G3. A shared hook-event contract (`HookEvent` union + per-event zod payloads) in `@runcastle/core`.**
*Value: high · Confidence: high · Effort: M · Blast radius: medium.*
Collapses D5 (4 spellings, no compile-time link), E1 (8 hand-rolled `typeof` guards + 2 casts), B4 (the dead `body.event`) and D8 (docstring drift) into one change. `CLAUDE.md`'s package map says core owns wire types, so the home is unambiguous. Producer `artifacts.ts:715-735` and consumer `hooks.ts:78-105` become two ends of one typed contract; a typo stops compiling instead of silently 200-ing.

**G4. Collapse the feature / project-scoped hook handler pairs.**
*Value: medium · Confidence: high · Effort: M · Risk: low.*
C1 in full: ~60 lines across three pairs, whose only genuine variation is the injected context string and the event noun — as `hooks.ts:156-157` itself says. Land after G3 so the dispatch is already typed. Also standardise on `emitForSession` throughout (D4), which is a prerequisite for the merge since the two branches currently differ only in emitter choice.

**G5. Bound registry retention of exited entries.**
*Value: medium · Confidence: high · Effort: S · Risk: low.*
D2 + B2: on `onExit`, either schedule an eviction (TTL) or call the already-written `RingBuffer.clear()` once no sink has been attached for N minutes. Preserves the deliberate "late reconnect still sees the final scrollback" behaviour (`registry.ts:96-106`) while bounding memory. Smallest high-certainty win in this report.

**G6. Set `idleTimeout` on `Bun.serve` and add a WS keepalive.**
*Value: medium · Confidence: medium · Effort: S · Risk: low.*
D14. One option at `index.ts:105` fixes the SSE side (F14's code seam); the WS side additionally wants either a server ping or a client-side periodic frame, since `ws.ts` and `apps/web/src/lib/terminal.ts` currently have neither. Held below G5 only because the runtime behaviour needs confirming first.

**G7. Share `cleanEnv` between `pty.ts` and `pty-sidecar.ts`.**
*Value: low · Confidence: high · Effort: S · Risk: none.*
C3, restricted to the two same-process copies. `pty-sidecar.ts` already imports from `./pty`. Leave `pty-host.cjs` alone — its isolation is deliberate.

**G8. `resolvePackageRoot(specifier)` helper.**
*Value: low · Confidence: medium · Effort: S · Risk: low.*
C4. Two callers (`install-check.ts:75`, `services/setup.ts:165`) but they need *different* resolvers (CJS vs ESM), so the shared module must carry both strategies. **Speculative until a third caller appears** — flagged to the parent in case a sibling scope holds one.

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely I think the same shape recurs in sibling scopes.

**H1. `leak:child-env-inheritance` — no single policy for what a spawned child inherits.**
Three spawn paths in this scope + adjacent (`launcher.ts:1016`, `drive-env.ts:147`, `dev-pane.ts:104`) each build a child env by spreading `process.env`; only one scrubs anything, and only Claude-specific keys. `asset-paths.ts:73-77` makes it structural by mutating global `process.env` at boot. **Suspected sibling module: "child process environment / spawn options builder."** Ask other agents whether the burner/sandcastle path (`workflows/ticket-burner.ts`), the doctor probes (`doctor/system-exec.ts`) and the drive hooks (`services/drive-hooks.ts`) do the same spread — I saw `drive-hooks.ts:63` explicitly say it "mirrors `devSpawnTarget`", which suggests at least a fourth copy of the neighbouring shell-construction logic too.

**H2. `leak:process-teardown` / `race:pty-teardown-fire-and-forget` — process kill is per-feature, not a module.**
Tree-kill exists once (`dev-pane.ts:159`, private) and is missing on the session path (D1); `PtySession.kill(): void` offers no completion signal so nothing downstream *can* await teardown (D3); the sidecar backstop kills the supervisor rather than the tree (D13). **Suspected sibling module: "process spawn/teardown."** Anyone auditing `workflows/`, `services/git.ts` (worktree removal, where Windows `EPERM` bites) or `doctor/` almost certainly sees another hand-rolled kill or another fire-and-forget teardown. This is the repo's most-repaired area per commit history and the repairs are still local.

**H3. `wrongtool:json-boundary-validation` — hand-rolled `typeof` guards instead of zod at process boundaries.**
`hooks.ts` (8 guards + 2 casts, E1), `ws.ts:77` (E2), `pty-sidecar.ts:59-66` (E3). House convention says zod. **Suspected sibling module: "wire-payload schemas."** Likely also true of the MCP tool boundary (`mcp/server.ts` — SPEC §6 claims zod-validated, worth confirming), the workflow/burner event stream, and anywhere `JSON.parse` meets an external producer.

**H4. `stringly:hook-event-name` (generalises to `stringly:cross-process-contract`) — vocabularies duplicated as bare strings across producer and consumer.**
The hook event name appears four times with no shared type (D5). The taxonomy predicts the same for `phase`, `session kind`, `gate id`, `event type`. `hooks.ts` itself already carries two `switch (kind)` blocks (`:219-228 projectScopedNoun`, `:231-235 projectScopedPromptLabel`) that will need editing every time a `SessionKind` is added — a **repeated switch on `SessionKind`** that other agents will very likely find more instances of.

**H5. `inconsistent:event-emission` — mutations that skip the event/live-signal contract.**
`setAwaitingInput` (`sessions.ts:96-98`) writes the DB and emits nothing, so the UI's turn-state badge waits for a poll while the SSE stream idles (D7). Separately, `hooks.ts` uses `emit` and `emitForSession` interchangeably for the same event type (D4). **Suspected sibling module: "event emission / live-signal publication."** Two questions for the parent to pose repo-wide: (a) which other mutating service functions skip `emit`, and (b) does `LiveSignal` need a third kind for high-frequency state that must not spam the timeline?

**H6. `drift:docstring-vs-registration` — docs listing N of N+1 handled cases.**
`hooks.ts:20-22` names 4 of 5 events (D8); `pty/index.ts:6` describes a single-backend PTY layer that has had two backends since `pty.ts:106` (B1); `UI-SPEC.md:65` describes a runtime probe the code deliberately replaced (D9) and 3 of 8 protocol frames. Same failure mode three times: **a hand-maintained list next to a machine-checkable one.** The parent should check whether sibling scopes' route/tool/skill docstrings enumerate their cases correctly — and whether the fix is a shared union (H4) rather than better prose.

**H7. `drift:patched-dependency` — vendored patch behaviour the runtime depends on, documented only inside the patch.**
`patches/node-pty@1.1.0.patch` hunk 1 (the ConPTY `AttachConsole` guard) is load-bearing for Windows kill latency and stderr cleanliness, is referenced by **no** source file or doc, and would be deleted by following `prebuild-bridge.ts:33-36`'s retirement checklist verbatim (D10). **Generalises to: "does every patch/vendored fork have a code-side pointer and a retirement precondition?"** `packages/skills` vendors forked skill packs and `vendor/` is excluded from this audit — worth someone confirming those carry provenance notes.

**H8. `config:bun-idle-timeout` — one `Bun.serve` call, no timeout knobs, two long-lived transports depending on them.**
`index.ts:105-112` configures `port`/`fetch`/`websocket` only; `stream.ts:31`'s 25 s heartbeat is tuned against an unset default and `ws.ts` has no keepalive at all (D14). Whoever audits `src/index.ts` owns the fix; both of my transports are downstream of it. Note for the parent: F14's fix is **one option on one line**, and it fixes the terminal WS at the same time as the SSE stream.
