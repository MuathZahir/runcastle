# Audit report — `packages/server/src/launcher/*` (server runtime: session launcher)

Leaf agent. Scope audited in full: `launcher.ts` (1052), `sessions.ts` (885),
`artifacts.ts` (800), `asset-paths.ts`, `edit-guard.ts`, `hook-client.ts`,
`reconcile.ts`, `runtime.ts`, `skills-root.ts`.

Read for cross-reference only (siblings own them): `pty/pty.ts`,
`pty/pty-sidecar.ts`, `pty/registry.ts`, `pty/end-session.ts`, `pty/dev-pane.ts`,
`routes/hooks.ts`, `trpc/routers/feature.ts`, `services/git.ts`, `index.ts`,
`util/resolve-executable.ts`, `docs/SPEC.md` §5, `E2E-FINDINGS.md`.

---

## A. Flow map

### A.1 Launch → live (the happy path, feature session)

```
apps/web  →  trpc `feature.launchSession`
  trpc/routers/feature.ts:59-67       .mutation(({ctx,input}) => launchSession(ctx, input))
    │                                  (NB: no spawn guard here — see D-1)
    ▼
launcher.ts:352  launchSession(ctx, input, opts)
  :357  getFeatureRow / projectForFeature            → services/repo.ts
  :360  ensureWorktree(ctx, project, feature)        → services/git.ts:337 ensureTalkWorktree
  :331-350   └─ NotImplementedError fallback → worktreeDir() + `session.worktree_pending`
  :361  createSessionRow(...)                        → sessions.ts:31  (status `launching`)
  :371  planKickoff({kind, lap, kickoffLine})        → sessions.ts:284
  :381-405  waypoint branch: getWaypoint / assertSpawnable / claimWaypoint
  :412-427  revisit branch: assertSpawnable + mostRecentResumableSession
  :437-439  every other kind: mostRecentResumableSession(kind)  ← NO assertSpawnable
  :446-447  setKickoffOverride(session.id, line)     → sessions.ts:330 (before spawn, by design)
  :449-477  emit session.launching / session.resumed / session.resume_unavailable
  :479-486  writeSessionArtifacts({session, feature, project, config, waypoint, lap})
  :487      serverUrlFor(ctx.config)                 → artifacts.ts:64
  :489-503  BuildLaunchInput { pluginDir: resolvePluginDir(), model: resolveModel(...), … }
  :506-517  opts.spawn === false → emit `session.launched` with a joined command string, return
  :519      spawnEmbeddedPty(ctx, feature, session, worktreePath, serverUrl, buildClaudeArgs(…), meta)
```

Artifact generation (`artifacts.ts:767 writeSessionArtifacts`):

```
artifacts.ts:771  sessionDir(session.id)             → @runcastle/core/paths
artifacts.ts:772  mkdirSync(dir, {recursive:true})
artifacts.ts:781-789  system prompt selection (nested ternary + throwing IIFE):
        feature      → renderSystemPrompt(feature, kind, waypoint, lap)   :97
                         ├ kind==='waypoint'  → renderWaypointPrompt      :162
                         ├ kind==='converge'  → renderConvergePrompt      :217
                         ├ kind==='revisit'   → renderRevisitPrompt       :277
                         └ else (ideation|qa) → inline body               :107-152
        prepare      → renderPreparePrompt(prepare)                       :384
        projectBrief → renderProjectPrompt(projectBrief)                  :524
artifacts.ts:791  writeFileSync(system-prompt.md)
artifacts.ts:792-796 writeFileSync(settings.json)  ← renderSettings(hookClientPath(), session.kind) :715
                       hookClientPath() :59  → resolveAsset(ASSET_ENV.hookClient, …)  asset-paths.ts:40
                       permissions.allow = RUNCASTLE_MCP_ALLOW_RULES :612 + sessionBashAllowRules(kind) :668
                       hooks = SessionStart×5 sources :686 | UserPromptSubmit | Stop | SessionEnd
                               + PreToolUse when guardsEdits(kind)  ← edit-guard.ts:36
artifacts.ts:797  writeFileSync(mcp.json)  ← renderMcpConfig(session, config) :753
                       headers { 'X-Runcastle-Session': session.id }
```

Env assembly + PTY spawn handoff:

```
launcher.ts:1006 spawnEmbeddedPty
  :1015  claudeSpawnTarget(args) → :201 → spawnTargetFor(resolveTool('claude'), args)
                                          util/resolve-executable.ts:142 (.cmd→cmd.exe /c, .ps1→powershell -File)
  :1016-1020  env = { ...process.env, RUNCASTLE_SESSION_ID, RUNCASTLE_SERVER_URL }
  :1021       delete CC_NESTING_ENV keys (8 Claude Code vars)   ← RUNCASTLE_* NOT scrubbed (E-1)
  :1023-1029  ptyRegistry().create({sessionId, cmd, args, opts:{cwd,env,cols:80,rows:24,useConpty:true}, onExit})
                pty/registry.ts:49 → pty/pty.ts:147 createPtySession
                   selectBackend() :120 → Bun+win32 ⇒ sidecar (pty-sidecar.ts:73, spawns system node + pty-host.cjs)
                                        → else native node-pty (pty.ts:164)
  :1030-1034  emit `session.launched` {pid}
  :1039       armSessionReadyWatchdog(ctx, session)   → sessions.ts:606  (25 s, unref'd, never cleared)
  :1040-1051  catch → markSessionEnded + releaseForSession + `session.spawn_failed`
```

SessionStart hook round trip:

```
claude (in PTY) fires SessionStart
  → settings.json hook command: `bun run "<abs>/hook-client.ts" session-start`   artifacts.ts:718
  → hook-client.ts:36 main(): reads stdin JSON, POSTs {event, sessionId, payload}
       to `${RUNCASTLE_SERVER_URL}/api/hooks/session-start`  (3 s timeout, prints body verbatim)
  → routes/hooks.ts:50  POST /:event
       :57  getRuntimeCtx()                        → launcher/runtime.ts:42
       :58  getSessionRow                          → sessions.ts:52
       :77  featureless (prepare|project) → handleProjectScopedSessionStart :159
       :96  feature                       → handleSessionStart :121
              markSessionLive(ctx, id, {ccSessionId, transcriptPath})  → sessions.ts:117
                 :135 promoteLastSession (waypoint lastSessionId)      → services/waypoints
                 :136 scheduleKickoff                                  → sessions.ts:620
                        attemptKickoff (1500 ms) :435 → writeKickoffSequence :342 (text, then `\r`)
                        armConfirmation :482 (12 s) → retry ≤3 with CLEAR_INPUT, else
                        settleUndelivered → `session.kickoff_undelivered` :496
              returns hookSpecificOutput.additionalContext (sessionStartContext :333)
  UserPromptSubmit → hooks.ts:272 handleUserPrompt → noteKickoffPrompt :528 (delivery receipt)
  Stop            → hooks.ts:66 markAwaitingInput → sessions.ts:92
  PreToolUse      → hooks.ts:308 handlePreToolUse → edit-guard.ts:63 evaluateEditGuard
                                                  → edit-guard.ts:93 editDenyResponse
  SessionEnd      → hooks.ts:289 handleSessionEnd → markSessionEnded + releaseForSession
                    (project-scoped variant: hooks.ts:203 — does NOT landProjectSession)
```

### A.2 Teardown, two paths + boot reconcile

```
(1) user clicks End session
    trpc feature.endSession → launcher.ts:58 re-export → pty/end-session.ts:24 endSession
      :26 registry.kill(sessionId)        (async: process has not exited yet)
      :27 registry.remove(sessionId)      ← entry dropped BEFORE onExit fires (D-4)
      :29 markSessionEnded  → sessions.ts:739 → forgetKickoff :402 → drops timers + override
      :31 releaseForSession / :37 landProjectSession (sessions.ts:686, fire-and-forget git merge)
      :38 emit `session.ended`
    … later the process really exits →

(2) PTY exit
    registry.ts:72 pty.onExit → input.onExit → launcher.ts:1028 → handlePtyExit :951
      :958 diedBeforeLive = row.status === 'launching'
      :959 markSessionEnded   :963 releaseForSession   :966 landProjectSession
      :967-979 `session.resume_failed` when a --resume died before live
      :980-984 `session.pty_exited` (ptyExitMessage :76)

(3) server restart
    index.ts:89 reconcileStaleSessions → reconcile.ts:28
      skips entries whose PTY survived a `bun --hot` reload
      markSessionEnded + releaseForSession + `session.reconciled`
      ← does NOT landProjectSession (D-5)

(4) SIGINT/SIGTERM
    index.ts:126-131  ptyRegistry().killAll(); server.stop(); process.exit(0)
      ← synchronous exit; no onExit handler ever runs, no landing, no await (D-6)
```

### A.3 Asset resolution (three near-identical resolvers)

```
asset-paths.ts:40  resolveAsset(envVar, fallback)          — env override wins, validated
asset-paths.ts:73  applyInstalledAssetEnv(pkgRoot)         — called by src/bin/runcastle.ts:54
                                                             WRITES 6 RUNCASTLE_* vars into process.env
skills-root.ts:27  resolveSkillsRoot(fromDir)              — env override + 8-level ascent
launcher.ts:212    resolvePluginDir(fromDir)               — env override + 8-level ascent  (C-1 duplicate)
routes/web.ts:70   webDist override                        — a fourth copy of the same idea
```

Boundaries where this scope hands off to siblings: `services/git` (worktrees,
landing), `services/waypoints` (claim/release/promote), `services/events`
(`emit`/`emitProject`/`emitForSession`), `pty/*` (spawn, kill, registry, WS),
`routes/hooks.ts` (hook receiver), `workflows/runner` (AFK runs).

---

## B. Dead code

**B-1 — `HooksSettings` type alias has no importers.**
`packages/server/src/launcher/artifacts.ts:600-601`

```ts
/** Kept as an alias so existing importers of the old name keep compiling. */
export type HooksSettings = SessionSettings
```

*Verified*: `grep -rn "HooksSettings" --include=*.ts --include=*.tsx --include=*.md .`
across `packages/`, `apps/`, `scripts/`, `docs/` and `site/` returns exactly one
hit — the declaration itself. The comment states its whole purpose ("existing
importers of the old name") and there are none.
Key: `dead:hooks-settings-alias` · **violation** · confidence **high** · effort S · risk low.

**B-2 — `handlePtyExit`'s `feature` parameter is never read, and is threaded through two functions and three call sites to reach it.**
`packages/server/src/launcher/launcher.ts:951-957`

```ts
export function handlePtyExit(
  ctx: AppCtx,
  feature: Feature | undefined,   // ← never referenced in the body (:958-985)
  session: SessionRow,
```

The body uses only `ctx`, `session`, `meta`, `exitCode` — every emission goes
through `emitForSession(ctx, session, …)` (`:969`, `:980`). The parameter is fed
by `spawnEmbeddedPty(ctx, feature, …)` (`:1008`, `:1028`), which itself only
forwards it; the three call sites pass `feature` (`:519`) or a literal
`undefined` (`:626`, `:729`).
*Verified*: read the whole function body; tsc cannot see it — the repo tsconfig
(`tsconfig.json`) sets `strict: true` but **not** `noUnusedParameters`.
Key: `dead:pty-exit-feature-param` · **violation** · confidence **high** · effort S · risk low.

**B-3 (soft) — `awaitProjectLandings` has no production caller.**
`packages/server/src/launcher/sessions.ts:664-668`

```ts
export async function awaitProjectLandings(): Promise<void> {
  while (inFlightLandings.size > 0) { await Promise.allSettled([...inFlightLandings]) }
}
```

Its doc (`:649-657`) justifies it by "anything about to delete the repo can wait
for it… On Windows an open handle fails a directory removal with EPERM".
*Verified*: `grep -rn "awaitProjectLandings" packages apps scripts` → the
declaration, its two doc references, and four call sites, **all in
`packages/server/test/project-session.test.ts`**. No server code awaits it —
notably `index.ts`'s shutdown (`:126-131`) does not, and neither does
`reconcile.ts`. So the EPERM hazard it was written for is currently unguarded in
production and the export exists only to make the test suite's teardown
deterministic. Not deletable (see D-6 — it is the fix, not the cruft), but it is
speculative generality until a real caller lands.
Key: `speculative:await-project-landings` · **judgement call** · confidence **high** · effort S · risk low.

No other export in scope is dead — `resolveSkillsRoot`, `hasCompletedProjectSession`,
`mostRecentLiveSession`, `vendoredAssetPaths`, `clearRuntimeCtx`, `lapKickoff`,
`planKickoff`, `resumeKickoffLine`, `kickoffLineFor`, `promptMatchesKickoff`,
`writeKickoffSequence`, `kickoffDeliveryFor`, `sessionBashAllowRules`, `EDIT_TOOLS`
all have real (non-test) importers, checked by name across `packages/`, `apps/`
and `scripts/`.

---

## C. Redundancy & repeated logic

**C-1 — `resolvePluginDir` re-implements `resolveSkillsRoot`; the plugin dir is literally `<skillsRoot>/packs/runcastle`.**
`launcher.ts:212-240` vs `skills-root.ts:27-48`

```ts
// launcher.ts:215
const rel = join('packages', 'skills', 'packs', 'runcastle')
const override = process.env[SKILLS_DIR_ENV]
if (override) { const dir = join(resolve(override), 'packs', 'runcastle'); … }
let dir = fromDir
for (let i = 0; i < 8; i += 1) { const candidate = join(dir, rel); … }
```

```ts
// skills-root.ts:18 / :28-46
export const SKILLS_MARKER = join('packs', 'runcastle')
const override = process.env[SKILLS_DIR_ENV]
if (override) { const root = resolve(override); if (existsSync(join(root, SKILLS_MARKER))) return root; … }
let dir = fromDir
for (let i = 0; i < 8; i += 1) { const candidate = join(dir, 'packages', 'skills'); … }
```

Same env var, same 8-level bound, same "searched:\n  " error prose, same
`packs/runcastle` marker — one written as `SKILLS_MARKER`, the other spelled out
twice. `resolvePluginDir()` is exactly `join(resolveSkillsRoot(here), SKILLS_MARKER)`.
Two independent ascents also means two chances to drift when the workspace layout
moves. Suggested single module: keep `skills-root.ts` as the only ascent and make
`resolvePluginDir` a two-line wrapper (or move it into `skills-root.ts` as
`resolvePackDir`).
Key: `redundant:skills-root-resolution` · **judgement call** · confidence **high** · effort S · risk low.

**C-2 — three launch functions duplicate ~40 lines of build-input + spawn:false + spawn each.**
`launcher.ts:479-523` (`launchSession`), `:591-635` (`launchPrepareSession`), `:692-732` (`launchProjectSession`)

```ts
// :489-503, :599-611, :700-714 — same 11-field literal, three times:
const buildInput: BuildLaunchInput = {
  sessionId: session.id, serverUrl, featureTitle: …, worktreePath,
  pluginDir: resolvePluginDir(), settingsPath: artifacts.settingsPath,
  mcpConfigPath: artifacts.mcpConfigPath, systemPromptPath: artifacts.systemPromptPath,
  model: resolveModel(<kind>, ctx.config, project), resumeSessionId,
  strictMcp: ctx.config.sessionMcp === 'runcastleOnly',
}
if (opts.spawn === false) { emit…({ command: ['claude', ...buildClaudeArgs(buildInput)].join(' '), spawned:false }); return { sessionId: session.id } }
spawnEmbeddedPty(ctx, …, buildClaudeArgs(buildInput), …)
```

The only real differences are which emitter is used (`emit` vs `emitProject`),
the `featureTitle` string, `permissionMode` (project only), and the meta. A
change to the flag set or the spawn:false contract is a three-file-region edit —
textbook shotgun surgery inside one file. Suggested module: a private
`finishLaunch(ctx, {session, project, artifacts, kindOpts, emitter, meta})`.
Key: `redundant:launch-pipeline` · **judgement call** · confidence **high** · effort M · risk medium.

**C-3 — the "render the command line" expression is written three times, unquoted, and the house convention says quote paths in shell commands.**
`launcher.ts:512`, `:619`, `:722`

```ts
command: ['claude', ...buildClaudeArgs(buildInput)].join(' '),
```

`buildClaudeArgs` returns absolute paths (`<sessionDir>/settings.json`,
`<pkg>/packs/runcastle`, …). On Windows the session dir is under the user profile,
so `C:\Users\John Smith\.runcastle\sessions\sess_x\settings.json` renders as two
tokens. This string is the SPEC §11 smoke driver's record of what would have run
and is surfaced on the timeline, so it is at best misleading and at worst
uncopyable. It is also the one place in the launcher that builds a shell string,
against `CLAUDE.md` ("quote paths in shell commands").
Key: `unquoted:command-render` · **violation** · confidence **high** · effort S · risk low.

**C-4 — `e instanceof Error ? e.message : String(e)` is inlined 4× despite an `errMsg` helper existing in the same file.**
`launcher.ts:873-875` defines it:

```ts
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e) }
```

Re-inlined at `launcher.ts:1048` (`${err instanceof Error ? err.message : String(err)}`),
`sessions.ts:729` and `sessions.ts:731` (twice in the same emit — once for the
message, once for `data.error`). One shared `errMsg` in a util module (there are
already sibling copies elsewhere in the server) removes the choice.
Key: `redundant:err-message` · **violation** · confidence **high** · effort S · risk low.

**C-5 — five near-identical drizzle session queries differ only by predicate + projection.**
`sessions.ts:64` `activeSessionsForFeature`, `:763` `mostRecentResumableSession`,
`:790` `activeProjectSession`, `:816` `hasCompletedProjectSession`, `:846`
`mostRecentResumableProjectSession`, plus `:876` `mostRecentLiveSession`.

```ts
// :846-865, representative
const row = ctx.db.select().from(sessions)
  .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, kind),
             eq(sessions.status,'ended'), isNotNull(sessions.ccSessionId)))
  .orderBy(desc(sql`rowid`)).limit(1).get()
return row ? rowToSession(row) : null
```

`orderBy(desc(sql`rowid`)).limit(1).get()` + `row ? rowToSession(row) : null`
appears four times verbatim. The feature/project split exists for a real reason
(`:841-845` explains the NULL-never-equals problem), but that argues for one
`findLatestSession(ctx, filters)` taking a scope discriminator, not six
hand-rolled queries. `sql\`rowid\`` also leaks raw SQL into an otherwise
pure-drizzle module (six occurrences) — the real fix is a `createdAt` column,
which the comments at `:759-762` and `:873-875` already admit is missing.
Key: `redundant:session-queries` · **judgement call** · confidence **medium** · effort M · risk low.

**C-6 — `wasLive` / `getSessionRow(...)?.status === 'live'` re-derived at every lifecycle edge.**
`hooks.ts:132`, `hooks.ts:170` (sibling scope) and `launcher.ts:958`
(`diedBeforeLive = getSessionRow(ctx, session.id)?.status === 'launching'`) each
re-read the row to learn a transition that `markSessionLive`/`markSessionEnded`
already computed internally (`sessions.ts:133` — `const firstTimeLive = existing.status !== 'live'`).
Returning the transition (`{ row, firstTimeLive }`) from those two mutators would
delete three re-reads and the race window between the read and the write.
Key: `redundant:session-transition-detection` · **judgement call** · confidence **medium** · effort S · risk low.

---

## D. Inconsistencies & structural smells

**D-1 — LATENT BUG: the "one live HITL session per feature" guard is not applied on the ideation / qa / converge launch path.**

`assertSpawnable` (`launcher.ts:269-282`) is invoked in exactly two places inside
`launchSession`:

```ts
// launcher.ts:381-405  (waypoint branch)
if (input.waypointId) { … assertSpawnable(ctx, feature, session.id); waypoint = claimWaypoint(…) }
// launcher.ts:412-418 (revisit branch)
if (input.kind === 'revisit') { try { assertSpawnable(ctx, feature, session.id) } … }
// launcher.ts:437-439 — EVERY OTHER KIND: no guard at all
if (input.kind !== 'waypoint' && input.kind !== 'revisit' && !plan.explicit) {
  resumeSessionId = mostRecentResumableSession(ctx, feature.id, input.kind)?.ccSessionId
}
```

and the tRPC route that opens an ideation/qa terminal calls straight through with
no guard of its own:

```ts
// trpc/routers/feature.ts:59-67
launchSession: publicProcedure
  .input(z.object({ featureId: z.string(), kind: SessionKind, kickoffLine: … }))
  .mutation(({ ctx, input }) => launchSession(ctx, input)),
```

`converge` (`launcher.ts:821-871`) likewise reaches `launchSession(kind:'converge')`
(`:859`) with no `assertSpawnable` — only its sibling `reconverge` (`:903-908`)
checks `activeSessionsForFeature`. So two "Start grill" clicks (or a grill plus a
qa terminal) both succeed: two `claude` processes, same `cwd` (both resolve to
the same `worktreeDir(project.id, feature.slug)` via `ensureTalkWorktree`), both
writing `decisions.md`. The invariant is documented as absolute at `:260-268`
("another session row is `launching`/`live` … one talk worktree, git forbids two
checkouts of one branch") — but git forbids two *worktrees* on one branch, not
two processes in one worktree, so nothing downstream catches it either.

This is also the inconsistency: three kinds of launch, three different guard
regimes (waypoint = race-free recheck adjacent to the claim; revisit = recheck;
everything else = nothing), for no reason the comments give.
Key: `missing-guard:spawn-ideation` · **violation** · confidence **high** · effort S · risk low.

**D-2 — LATENT BUG: `sessionFinished` is constant-`true` for every non-waypoint kind at its only call site, so "Work waypoint" silently kills a live qa/revisit conversation and calls it "finished".**

```ts
// launcher.ts:294-298
function sessionFinished(ctx, feature, session): boolean {
  if (session.kind !== 'waypoint') return feature.mapped
  …
}
```

Its only caller is `sweepActiveSessions` (`:311-328`), whose only caller is
`workWaypoint` (`:795`) — which has already thrown unless the feature is mapped:

```ts
// launcher.ts:772-774
if (!feature.mapped) throw new GateError(`feature ${feature.slug} is not mapped …`)
```

So `feature.mapped` is `true` by construction and every non-waypoint live session
is "finished". `sweepActiveSessions` then ends it without the `endLive`
confirmation and emits

```ts
// launcher.ts:319
message: `ended the finished ${session.kind} session to work the next waypoint`
```

A human mid-conversation in a `qa` or `revisit` terminal on a mapped feature
loses it to one click on Work, and the timeline claims the session was finished.
The docstring (`:285-292`) intends this only for "the session that charted the
map"; the code does not distinguish.
Key: `wrong-predicate:session-finished` · **violation** · confidence **medium-high** · effort S · risk low.

**D-3 — LATENT BUG (Windows): killing a session drops the registry handle before the process is confirmed dead, so a failed kill orphans `claude` with nothing left to kill it.**

```ts
// pty/end-session.ts:25-27
const registry = ptyRegistry()
const killed = registry.kill(sessionId)
registry.remove(sessionId)
```

`kill()` is asynchronous by nature — under the win32 default backend it is a
`{t:'kill'}` JSON frame written to the node sidecar's stdin
(`pty/pty-sidecar.ts:231-243`), with a 500 ms `child.kill()` backstop that kills
only the *sidecar host*, never the `claude` grandchild. `remove()` deletes the
entry on the next line, so:

- `ptyRegistry().killAll()` at shutdown (`index.ts:129`) iterates `this.entries`
  and can no longer see it;
- `reconcileStaleSessions` (`reconcile.ts:38-39`) checks `ptyRegistry().get(id)`
  and finds nothing, so it decides the process is gone;
- `resendKickoff`'s `ptyIo(sessionId).alive()` (`sessions.ts:409-416`) reports dead.

Nothing in the codebase ever tree-kills a session PTY. The repo *does* tree-kill
elsewhere — `pty/dev-pane.ts:156-162`:

```ts
// `taskkill /T` walks the child list, so it …
execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
```

That fix ("tree-kill the dev pane on Windows") was applied to the drive pane
only. The session launcher — which spawns a `claude` that itself spawns `bun`
hook clients, MCP children and subagents, and which may be reached through a
`cmd.exe /c` shim (`util/resolve-executable.ts:143-145`) whose PID is the shim's,
not claude's — got no equivalent. This is the remaining half of that fix.
Key: `leaked:windows-process-tree` · **violation** · confidence **medium-high** · effort M · risk medium.

**D-4 — `registry.remove` before `onExit` also means the exit handler runs against a registry that has forgotten the session.**
Same hunk as D-3. `handlePtyExit` still fires (the callback is captured in the
`create()` closure, `pty/registry.ts:72-77`), so the row bookkeeping survives —
but `entry.exited = true` is set on an object no one holds, and a WS client
attaching in the kill→exit window gets `attach() === false` instead of a final
`{t:'status',status:'ended'}` frame. The registry's own contract (`:121-124`
"Forget an entry (**after** its process has exited / on endSession cleanup)")
concedes the two cases are different and then treats them the same.
Key: `race:registry-remove-before-exit` · **judgement call** · confidence **medium** · effort S · risk low.

**D-5 — boot reconciliation ends stale sessions but never lands a stale `project` session's commits, unlike both live teardown paths.**

```ts
// reconcile.ts:41-42
markSessionEnded(ctx, session.id)
const released = releaseForSession(ctx, session.id)
```

versus the two paths it says it "mirrors":

```ts
// launcher.ts:959-966            // pty/end-session.ts:29-37
markSessionEnded(…)               markSessionEnded(…)
releaseForSession(…)              releaseForSession(…)
landProjectSession(ctx, session)  landProjectSession(ctx, session)
```

Its own doc claims it "mirrors the manual `endSession` path … minus the PTY
kill" (`reconcile.ts:22-24`) — it also omits the landing. Mitigated, not fixed:
`services/git.ts:413-416` (`ensureProjectWorktree`) merges leftover
`runcastle/project` commits at the *next* project-session launch. So the work is
not lost, but it lands silently, with no `project.landed` event, at an
unpredictable later time, and only if the human opens another project session.
Key: `inconsistent:session-teardown` · **violation** · confidence **high** · effort S · risk low.

**D-6 — shutdown exits the process synchronously after `killAll()`, so no exit handler, no landing and no in-flight landing ever completes.**

```ts
// index.ts:126-131
const shutdown = (): void => {
  ptyRegistry().killAll()
  server.stop()
  process.exit(0)
}
```

`killAll()` (`pty/registry.ts:127-132`) only *requests* kills — under the sidecar
backend it writes a frame to a child's stdin and schedules a 500 ms timer. The
very next statement calls `process.exit(0)`, so: the frame may not flush, the
backstop never runs, `pty.onExit` never fires, `handlePtyExit` never runs, and
`awaitProjectLandings` (`sessions.ts:664`, the export written for exactly this)
is never awaited. `landProjectSession`'s doc says the in-flight git children
"outlive the teardown path that started them" and "On Windows an open handle
fails a directory removal with EPERM outright" (`sessions.ts:650-657`) — that
hazard is real and currently unguarded at the one place it matters. Combined with
D-3, quitting runcastle on Windows can leave `claude` (and its sidecar `node`)
running with no owner.
Key: `race:shutdown-teardown` · **violation** · confidence **high** · effort S · risk medium.

**D-7 — three event emitters used for the same lifecycle events inside one module.**
`launcher.ts` emits with `emit(ctx, feature.id, …)` (`:316`, `:449`, `:456`,
`:464`, `:471`, `:507`, `:916`), `emitProject(ctx, project.id, …)` (`:568`,
`:583`, `:614`, `:679`, `:686`, `:716`) and `emitForSession(ctx, session, …)`
(`:969`, `:980`, `:1030`, `:1046`). `emitForSession` already dispatches on the
session's scope — it is the one that works for both — so the two scope-specific
calls are the odd ones out, and the same event type (`session.launched`) is
emitted through two different functions depending on which launch function you
came from (`:507` vs `:716` vs `:1030`). Any change to launch-event payloads has
to be made in all three shapes.
Key: `inconsistent:event-emission` · **judgement call** · confidence **high** · effort S · risk low.

**D-8 — repeated switches on `SessionKind`, in seven places across four files, with no single table.**

| where | switch |
|---|---|
| `launcher.ts:412` | `if (input.kind === 'revisit')` |
| `launcher.ts:437` | `input.kind !== 'waypoint' && input.kind !== 'revisit'` |
| `launcher.ts:295` | `session.kind !== 'waypoint'` |
| `sessions.ts:203-226` | `KICKOFF_LINES: Record<SessionKind, string>` |
| `sessions.ts:687` | `session.kind !== 'project'` (landing) |
| `artifacts.ts:103-105` | `kind === 'waypoint' / 'converge' / 'revisit'` → prompt renderer |
| `artifacts.ts:668-670` | `kind === 'project'` → bash rules |
| `edit-guard.ts:36-38` | `kind !== 'project'` → edit guard |
| `hooks.ts:219-228, 231-235, 247-263` | `prepare` / `project` / default nouns + contexts |

Nine kinds (`ideation`/`spec`/`tickets` steps, `qa`, `waypoint`, `revisit`,
`converge`, `prepare`, `project`) × nine decision points. `KICKOFF_LINES` is the
one exhaustive `Record<SessionKind, …>` — every other site is an ad-hoc
comparison that a new kind will silently fall through. Adding a tenth kind today
is a nine-file-region edit with no compiler help. Suggested module: one
`SESSION_KIND_TRAITS: Record<SessionKind, {scope, promptRenderer, kickoff,
guardsEdits, bashRules, lands, resumes}>` in `@runcastle/core` (kinds are already
declared there), consumed by launcher/artifacts/edit-guard/hooks.
Key: `repeated-switch:session-kind` · **judgement call** · confidence **high** · effort M · risk medium.

**D-9 — `sessions.ts` is edited for three unrelated reasons (divergent change).**
One 885-line module owns (a) session-row persistence — `:31-98`, `:739-885`;
(b) an entire kickoff-delivery state machine with three module-level maps, five
timing constants, retry budgets and TUI-echo matching — `:156-637`; (c) project
git landing with its own dedup set and in-flight promise set — `:639-736`. Its
own header only claims (a):

```ts
// sessions.ts:12-18
/** Session-row persistence for the launcher + hook receiver + MCP server. …
 *  They perform no event emission — callers (launcher.ts, hooks.ts) emit the
 *  lifecycle events … */
```

which (b) and (c) both violate — both emit (`:465`, `:504`, `:611`, `:706`).
Key: `divergent-change:sessions-module` · **judgement call** · confidence **high** · effort M · risk low.

**D-10 — artifact drift vs `docs/SPEC.md` §5.**

- SPEC §5.2 names three hooks ("SessionStart + UserPromptSubmit + SessionEnd");
  `renderSettings` (`artifacts.ts:723-734`) registers **five** — adds `Stop` and
  `PreToolUse`. Both additions are deliberate and documented in code
  (`:704-712`), so this is spec-side drift. *(Flagged in the brief; not re-derived.)*
- SPEC §5.2 says "timeout 10" for all hooks; code uses 10 for `session-start`/
  `session-end` and 5 for the rest (`artifacts.ts:719`).
- **SPEC §5.5 specifies a different hook-client wire shape than the code sends.**
  SPEC: `POSTs { event, env: { sessionId: RUNCASTLE_SESSION_ID }, payload }`.
  Code (`hook-client.ts:52`): `body: JSON.stringify({ event, sessionId, payload })`
  — flat, no `env` wrapper. The receiver reads the flat form
  (`routes/hooks.ts:47,54` — `sessionId?: string` / `body.sessionId`), so client
  and server agree; only the spec is stale. Worth correcting because SPEC §5.5 is
  the contract a reimplementation of the hook client would be written against.
- SPEC §5.3's command line omits `--resume`, which `buildClaudeArgs` prepends
  (`launcher.ts:167-169`) ahead of `--settings`.
- `artifacts.ts:418-421` — the hardcoded POSIX `createdb "$DB_NAME"` / `dropdb`
  example inside `renderPreparePrompt`. Known as E2E finding **F10**
  (`E2E-FINDINGS.md:122`); code-side aspect only: it is a *literal string
  constant inside a prompt renderer*, so there is no platform branch to fix and
  no test could catch it — the fix has to be either a platform-conditional
  example or moving the recipe out of the source string entirely.
Key: `drift:spec-section-5` · **violation** · confidence **high** · effort S · risk low.

**D-11 — `edit-guard.ts` design assessment (F18 is the symptom; the module's shape is the cause).**
Not re-deriving F18 (`E2E-FINDINGS.md:345`). The module's problem is that its
whole policy is one negation of one kind:

```ts
// edit-guard.ts:36-38
export function guardsEdits(kind: SessionKind): boolean {
  return kind !== 'project'
}
```

Everything else in the module is well-built — `evaluateEditGuard` (`:63-90`)
fails open on anything unreadable, uses `resolve`/`relative` correctly for
Windows (`:78-81`), and returns *prose telling the agent what to do instead*
rather than a bare deny. But the policy input is a `SessionKind` and nothing
else, so a guard decision cannot depend on *what the session was opened to do* —
and the launcher's whole per-purpose-briefing mechanism (`kickoffLine`,
`launcher.ts:91-96`) exists precisely because one kind serves several purposes.
A revisit told to resolve a merge conflict is a `revisit`, so it gets the
docs-only guard.

The module already has the right seam — `EditGuardInput` (`:40-50`) is a
per-call struct, not a kind — so the fix is to widen the *policy* input
(`writeScope: 'docs' | 'repo' | 'none'`, decided at launch and stored on the
session row) rather than to reshape the module. `guardsEdits` is then a lookup on
that field and the second caller (`artifacts.ts:731`) keeps working unchanged.
Key: `primitive-obsession:edit-guard-policy` · **judgement call** · confidence **high** · effort M · risk medium.

**D-12 — `writeSessionArtifacts` is `async` but does no async work.**
`artifacts.ts:767-800`: body is `mkdirSync` + three `writeFileSync`. Every caller
`await`s it (`launcher.ts:479`, `:591`, `:692`), which yields to the microtask
queue and *creates* a scheduling window in three functions whose comments are
otherwise anxious about exactly such windows (`launcher.ts:391-398` — "no `await`
between the two"). A sync function with a sync signature removes the window and
the false promise.
Key: `fake-async:write-artifacts` · **judgement call** · confidence **high** · effort S · risk low.

---

## E. Wrong-tool & weak-typing findings

**E-1 — KNOWN HAZARD, CONFIRMED: `spawnEmbeddedPty` scrubs the Claude Code nesting vars but not the `RUNCASTLE_*` asset vars the server writes into its own `process.env`.**

```ts
// launcher.ts:1016-1021
const env: Record<string, string | undefined> = {
  ...process.env,
  RUNCASTLE_SESSION_ID: session.id,
  RUNCASTLE_SERVER_URL: serverUrl,
}
for (const key of CC_NESTING_ENV) delete env[key]
```

```ts
// asset-paths.ts:73-77
export function applyInstalledAssetEnv(pkgRoot: string): void {
  for (const [envVar, path] of Object.entries(vendoredAssetPaths(pkgRoot))) {
    if (process.env[envVar] === undefined && existsSync(path)) process.env[envVar] = path
  }
}
```

**Confirmed, with the blast radius narrowed.** `applyInstalledAssetEnv` is called
once, at `src/bin/runcastle.ts:54`, with `pkgRoot = <dir of bin>/..`. In a
*contributor checkout* that resolves to `packages/server/src`, where none of the
six vendored assets exist, so nothing is written and there is no leak from this
path. In a **published install** all six exist, so the server's own
`process.env` gains `RUNCASTLE_MIGRATIONS_DIR`, `RUNCASTLE_SKILLS_DIR`,
`RUNCASTLE_WEB_DIST`, `RUNCASTLE_HOOK_CLIENT`, `RUNCASTLE_PTY_HOST`,
`RUNCASTLE_SANDCASTLE_TEMPLATE` — all pointing at runcastle's *own* vendored
copies — and `{...process.env}` hands every one of them to every spawned session.

Real consequence, in order of certainty:

1. **Dogfooding / any project that is itself runcastle-shaped** — a `prepare` or
   `project` session runs in the developer's real checkout (`launcher.ts:562`,
   `:670`) and is explicitly told to run the project's setup, migrations and dev
   server (`artifacts.ts:396-402`, `:475-483`). With `RUNCASTLE_MIGRATIONS_DIR`
   inherited, that project's migration runner reads the *installed runcastle's*
   migrations instead of its own. This is the failure the operator has already
   hit and written down ("Tests in talk sessions read stale migrations — unset
   the inherited `RUNCASTLE_*` asset env vars or get hundreds of phantom
   failures").
2. **Nested runcastle** — a session that runs `runcastle` (or `bun run dev`)
   inherits `RUNCASTLE_DEV`, `RUNCASTLE_PTY_BACKEND`, `RUNCASTLE_CLAUDE_BIN`,
   `RUNCASTLE_NODE_BIN` too, silently pinning the child to the parent's data dir
   and binaries.
3. **Every other project** — the vars are inert but the hygiene argument that
   justified `CC_NESTING_ENV` applies verbatim: these are *the server's own
   runtime configuration*, and the child is a different program in a different
   repo.

The asymmetry is the tell: the module already knows that leaking the parent's
own env into the child breaks it (`launcher.ts:987-994` — "Scrubbed so embedded
sessions are first-class no matter how the server was launched"), and applies
that reasoning to exactly one vendor's variables. `ASSET_ENV`
(`asset-paths.ts:20-33`) is already the exhaustive list; scrubbing
`Object.values(ASSET_ENV)` is a one-line fix, and `pty/dev-pane.ts:104`
(`env: env ?? process.env`) needs the same treatment.
Key: `unscrubbed:child-process-env` · **violation** · confidence **high** · effort S · risk low.

**E-2 — the "exactly one of three briefs" invariant is enforced by a nested ternary with a throwing IIFE instead of a discriminated union.**

```ts
// artifacts.ts:781-789
const systemPrompt = feature
  ? renderSystemPrompt(feature, session.kind, waypoint, lap)
  : prepare
    ? renderPreparePrompt(prepare)
    : projectBrief
      ? renderProjectPrompt(projectBrief)
      : (() => { throw new Error(`session ${session.id} has no feature and no project-session brief`) })()
```

`WriteArtifactsInput` (`artifacts.ts:29-51`) declares `feature?`, `prepare?` and
`projectBrief?` as three independent optionals, so "exactly one is present" is a
runtime assertion the type system is not asked to hold — even though
`CreateSessionInput` two files away (`sessions.ts:25-28`) demonstrates the exact
union the codebase already knows how to write:

```ts
} & ({ featureId: string; projectId?: never } | { projectId: string; featureId?: never })
```

Key: `weak-typing:artifact-brief-union` · **violation** · confidence **high** · effort S · risk low.

**E-3 — untyped hook-response boundaries (`unknown` as a return type).**
`edit-guard.ts:93` `export function editDenyResponse(denial: EditDenial): unknown`
returns a fully-known literal shape (`hookSpecificOutput.hookEventName:
'PreToolUse'`, `permissionDecision: 'deny'`, `permissionDecisionReason`). The
comment calls it "the verified `PreToolUse` deny shape" — verified enough to be
an interface. `routes/hooks.ts` then propagates `unknown` through six handlers
(`:121`, `:159`, `:188`, `:203`, `:272`, `:308`). Since these shapes are the
whole contract with Claude Code, they are exactly what should be typed (or
zod-modelled) rather than the one thing that is not.
Key: `weak-typing:hook-response` · **violation** · confidence **high** · effort S · risk low.

**E-4 — stringly-typed env-var keys in `asset-paths.ts`.**
`resolveAsset(envVar: string, fallback: string)` (`:40`) and
`vendoredAssetPaths(pkgRoot): Record<string, string>` (`:55`) both widen away the
`ASSET_ENV` union that is declared `as const` right above them (`:20-33`). A typo
in an env-var name at a call site compiles. `Record<(typeof ASSET_ENV)[keyof
typeof ASSET_ENV], string>` and `envVar: AssetEnvVar` cost nothing and make the
"one pattern, both layouts" promise in the module doc checkable.
Key: `weak-typing:asset-env-keys` · **judgement call** · confidence **high** · effort S · risk low.

**E-5 — `sql\`rowid\`` — raw SQL in the drizzle layer, six times.**
`sessions.ts:779`, `:805`, `:862`, `:879` (plus the doc references at `:762`,
`:806`, `:874`). Each is `.orderBy(desc(sql\`rowid\`))`, with the comments
admitting the cause: "`sessions` has no timestamp". The house rule is drizzle as
the query layer; ordering by a SQLite implementation detail is both a wrong-tool
finding and a correctness hazard (rowid is reusable after deletes, and would be
meaningless if `sessions` ever became `WITHOUT ROWID`). The real fix is a
`createdAt` column.
Key: `wrong-tool:rowid-ordering` · **violation** · confidence **high** · effort M (migration) · risk low.

**E-6 — `hook-client.ts` parses arbitrary JSON with no schema and swallows the failure into a differently-shaped payload.**

```ts
// hook-client.ts:43-47
try { payload = raw.trim().length > 0 ? JSON.parse(raw) : {} }
catch { payload = { raw } }
```

and the receiver then hand-validates every field it wants:
`routes/hooks.ts:127-130`, `:164-167`, `:193`, `:278`, `:313-320` — five
copies of `typeof payload?.x === 'string' ? payload.x : undefined`. Zod is the
house schema lib and the hook payload shapes are pinned in
`docs/research/CC-INTEGRATION-NOTES.md`; one `HookPayload` schema would replace
all of it and make the `{ raw }` fallback an explicit, typed case.
Key: `wrong-tool:hook-payload-validation` · **judgement call** · confidence **high** · effort S · risk low.

**E-7 — quoting of the generated hook command line.**

```ts
// artifacts.ts:716-720
const cmd = (event: string): CommandHook => ({
  type: 'command',
  command: `bun run "${hookClient}" ${event}`,
  timeout: …,
})
```

The path *is* quoted (good, and the house rule is honoured), and `JSON.stringify`
escapes the Windows backslashes correctly on the way into `settings.json`. Two
residual notes rather than a defect: the string is assembled by hand rather than
as an argv array, so a path containing a `"`, a `` ` `` or a `$` (all legal in a
Windows profile name) would break or interpolate depending on which shell Claude
Code hands it to; and this is the only shell string the launcher emits that *is*
quoted, while `C-3`'s three sibling renderings are not — the inconsistency is
the more actionable half.
Key: `fragile:hook-command-string` · **judgement call** · confidence **medium** · effort S · risk low.

**Clean on the main hazard:** every filesystem path in scope is built with
`node:path` — `launcher.ts:2,215,224` (`join`/`resolve`/`dirname`),
`artifacts.ts:3,774-776`, `asset-paths.ts:2,57-62`, `skills-root.ts:2,18,31,40`,
`edit-guard.ts:1,78-80`. I found **no** hand-concatenated path in this scope. The
only string-built targets are URLs (`artifacts.ts:65`, `:758`,
`hook-client.ts:49`), which is correct.

No `any`, no `as any`, no `@ts-ignore`, no non-null `!` assertions anywhere in
scope (checked by reading; the only casts are the narrowing
`(EDIT_TOOLS as readonly string[])` at `edit-guard.ts:65` and
`globalThis as GlobalWithRegistry` in the sibling registry).

---

## F. Shallow modules / deletion-test candidates

**F-1 — `resolveClaudeExecutable` and `claudeSpawnTarget`: two one-line wrappers, one caller each.**

```ts
// launcher.ts:191-193
function resolveClaudeExecutable(): string { return resolveTool('claude') }
// launcher.ts:201-203
function claudeSpawnTarget(claudeArgs: string[]): SpawnTarget {
  return spawnTargetFor(resolveClaudeExecutable(), claudeArgs)
}
```

`util/resolve-executable.ts:156-158` already exports the composition:

```ts
export function resolveSpawnTarget(name: string, args: string[]): SpawnTarget {
  return spawnTargetFor(resolveTool(name), args)
}
```

Deletion test: replace `claudeSpawnTarget(claudeArgs)` at `launcher.ts:1015` with
`resolveSpawnTarget('claude', claudeArgs)` and both wrappers vanish with no
complexity reappearing anywhere. Their doc comments (which explain PATHEXT and
the `.cmd`/`.ps1` interpreter rules) duplicate the docs already on the functions
they call.
Key: `shallow:claude-spawn-wrappers` · **judgement call** · confidence **high** · effort S · risk low.

**F-2 — `markAgentWorking` / `markAwaitingInput` over `setAwaitingInput`.**
`sessions.ts:87-98`: two exported one-liners and a private one-liner, three
functions to write one boolean column. Borderline — the names carry the domain
meaning the boolean does not, and the shared doc block at `:73-86` is genuinely
worth having, so this passes the deletion test *as a pair* (deleting them would
push `setAwaitingInput(ctx, id, false)` into `routes/hooks.ts:65-67` where the
polarity is easy to get backwards). Recorded as *not* a finding, so a sibling
agent does not double-report it.

**F-3 — `guardsEdits` (`edit-guard.ts:36-38`) has two callers and is the seam the
policy should live behind — keep.** See D-11 for the real issue (its input type,
not its existence).

**F-4 — `hasCompletedProjectSession` (`sessions.ts:816-835`) is a one-predicate
existence query with a single caller (`services/prep.ts:49`).** Single caller =
hypothetical seam only; it earns its keep as the named domain concept ("has the
human done preparation") rather than as reuse. Not proposing removal — flagging
that it belongs in the `C-5` query consolidation if that happens.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G-1 — `sessionEnv(session, serverUrl)`: one module that assembles a child
process's environment.** *(two real callers today)*
Today `launcher.ts:1016-1021` (sessions) and `pty/dev-pane.ts:104` (drive pane)
each decide independently what a spawned child inherits, and only one of them
scrubs anything. Concentrating "what does a runcastle-spawned child inherit" in
one place makes E-1 a one-line change forever after, and gives the burner /
research spawn paths (sibling scope) somewhere correct to call. Locality: the
scrub list lives beside `ASSET_ENV`, which is the thing that creates the hazard.
Leverage: callers stop having to know that the server's own env is polluted.
Effort **S**, blast radius **small** (two call sites + a test).

**G-2 — `SESSION_KIND_TRAITS`: one table replacing nine kind-switches.** *(four real callers)*
D-8's table. Put it in `@runcastle/core` next to the `SessionKind` declaration:
`{ scope: 'feature'|'project', promptRenderer, kickoff, writeScope, bashRules,
lands, resumes }`. Consumed by `artifacts.ts:103-105/668/731`,
`edit-guard.ts:36`, `sessions.ts:203/687`, `routes/hooks.ts:219-263`,
`launcher.ts:295/412/437`. Locality: adding a kind becomes one row.
Leverage: exhaustiveness checking replaces nine chances to forget. This also
subsumes D-11 (the `writeScope` field is the edit-guard fix).
Effort **M**, blast radius **medium** (core + 4 server files + their tests).

**G-3 — split `sessions.ts` into `sessions/rows.ts` + `sessions/kickoff.ts` + `sessions/landing.ts`.** *(D-9)*
The kickoff state machine (≈480 lines, three module-level maps, its own timing
constants and retry semantics) is a genuinely deep module hiding real
complexity — it deserves its own file and its own header, and the row-persistence
module deserves back the "no event emission" invariant it currently states and
breaks. Landing is a third, git-shaped concern that only shares the file because
`handlePtyExit` needed both. Pure move; no behaviour change.
Effort **M**, blast radius **medium** (import updates across launcher, hooks,
end-session, mcp, trpc, ~10 test files).

**G-4 — `finishLaunch(...)`: collapse the three launch functions' shared tail.** *(C-2, three real callers)*
`launchSession` / `launchPrepareSession` / `launchProjectSession` differ in their
*preamble* (worktree, guards, resume choice, brief) and are identical in their
*tail* (build input → spawn:false branch → spawn). Extracting the tail also fixes
C-3 in one place and gives D-1's missing guard an obvious home.
Effort **M**, blast radius **medium** (one file + `project-session.test.ts`,
`launch-artifacts.test.ts`).

**G-5 — one asset/root resolver.** *(C-1; four real call shapes)*
`resolveAsset` (env-or-fallback), `resolveSkillsRoot` (env-or-ascend),
`resolvePluginDir` (env-or-ascend, duplicate) and `routes/web.ts:70` (env-or-
fallback) are two patterns implemented four times. Merge the two ascenders
(C-1) first — that is the pure win; folding `routes/web.ts` into `resolveAsset`
is the optional second step.
Effort **S**, blast radius **small**.

**G-6 — a typed hook-protocol module (`hooks/protocol.ts`).** *(E-3 + E-6, speculative-ish)*
Zod schemas for the four inbound payload shapes and typed constructors for the
three outbound `hookSpecificOutput` shapes, shared by `hook-client.ts`,
`routes/hooks.ts` and `edit-guard.ts`. Two callers exist (client + receiver), so
the seam is real, but the payoff is type safety rather than deleted code.
Effort **S/M**, blast radius **small**.

**G-7 — `createdAt` on `sessions`, retiring `sql\`rowid\``.** *(E-5, four call sites)*
A drizzle migration plus four `orderBy` changes. Also unlocks C-5 (a single
`findLatestSession`) and makes the M1 "singleton live session" limitation
(`sessions.ts:868-875`) fixable later.
Effort **M** (migration), blast radius **medium**.

---

## H. Cross-cutting candidates to pass UP

1. **`unscrubbed:child-process-env`** — every place runcastle spawns a child
   process decides its `env` independently and none of them scrub the server's
   own `RUNCASTLE_*` runtime config. Confirmed at `launcher.ts:1016-1021`
   (scrubs Claude Code vars only) and `pty/dev-pane.ts:104` (`env: env ??
   process.env` — scrubs nothing, so the drive's dev command also inherits the
   parent's `CLAUDE_CODE_*` markers). **Sibling agents owning `workflows/`
   (ticket-burner, research) and `services/` (drive setup/stop commands, doctor
   probes at `doctor/cli.ts:24`) should check the same thing.** Suspected shared
   module: **`sessionEnv` / `spawnEnv`** (G-1). Highest-value single fix in my
   scope.

2. **`leaked:windows-process-tree`** — the repo has exactly one tree-kill
   (`pty/dev-pane.ts:162`, `taskkill /pid … /T /F`) and every other kill path is
   a single-process kill: `pty/pty.ts:206-213` (native `proc.kill()`),
   `pty/pty-sidecar.ts:231-243` (frame + `child.kill()` on the *host*, not the
   grandchild), `pty/registry.ts:114-119`, `:127-132`. Sessions spawn `claude`,
   which spawns `bun` hook clients, MCP children and subagents — and may sit
   behind a `cmd.exe /c` shim. **Whoever owns `pty/` and `workflows/` should
   confirm whether the burner/sandcastle teardown has the same gap.** Suspected
   shared module: **`killProcessTree(pid)`**.

3. **`race:shutdown-teardown`** — `index.ts:126-131` kills and `process.exit(0)`s
   in the same synchronous tick, so no `onExit` handler, no project landing and
   no in-flight git child ever finishes; `awaitProjectLandings`
   (`sessions.ts:664`) was written for this and is called only by tests. Anyone
   auditing `index.ts`, `workflows/` (in-flight runs) or `services/drive` should
   check for the same "fire teardown, exit immediately" shape. Suspected shared
   module: **an async `shutdown()` that awaits every registered drain hook.**

4. **`repeated-switch:session-kind`** — nine `SessionKind` decision points across
   `launcher.ts`, `sessions.ts`, `artifacts.ts`, `edit-guard.ts`,
   `routes/hooks.ts` (D-8). **Web and MCP agents almost certainly have more**
   (`mcp/server.ts` gates tools on session kind; the UI renders per-kind labels
   and CTAs). If ≥2 agents report it, this is a repo-wide finding. Suspected
   shared module: **`SESSION_KIND_TRAITS` in `@runcastle/core`** (G-2).

5. **`inconsistent:event-emission`** — three emitters (`emit`, `emitProject`,
   `emitForSession`) used for the same event types within one module (D-7).
   `emitForSession` already dispatches on scope, so the other two are redundant
   at most call sites. **Sibling agents on `services/` and `trpc/` should report
   which emitter their scope reaches for** — the house rule ("every service
   function that mutates emits an event") makes this a repo-wide surface.

6. **`redundant:asset-root-resolution`** — "env override wins, validated, else
   fall back / ascend" implemented four times: `asset-paths.ts:40`,
   `skills-root.ts:27`, `launcher.ts:212`, `routes/web.ts:70` (and referenced by
   `db/migrate.ts:21`, `services/setup.ts:236`, `workflows/ticket-burner.ts:1470`,
   `workflows/research.ts:219`). **Whoever owns `routes/` and `workflows/` will
   see the consumer half.** Suspected shared module: **one `assets` module**
   (G-5).

7. **`inconsistent:session-teardown`** — the same teardown recipe (mark ended /
   release waypoint / land project branch / emit) is written three times with
   three different subsets: `launcher.ts:958-984`, `pty/end-session.ts:24-48`,
   `reconcile.ts:41-51` (missing the landing), plus a fourth partial in
   `routes/hooks.ts:203-211`. Suspected shared module: **`finishSession(ctx,
   session, reason)`** owning the whole recipe, with the reason choosing the
   event.

8. **`drift:spec-section-5`** — `docs/SPEC.md` §5 is stale in four specific ways
   (D-10), one of which (§5.5's `{ event, env: { sessionId }, payload }` wire
   shape) is a *contract* that no longer matches `hook-client.ts:52`. **Any agent
   auditing docs should collect these rather than each of us patching prose.**

9. **`redundant:err-message`** — `e instanceof Error ? e.message : String(e)` is
   inlined 4× in my scope alone despite a local `errMsg` helper
   (`launcher.ts:873`). **Expect this in every scope**; suspected shared module:
   **`errMsg` in `util/`**.

10. **`wrong-tool:hook-payload-validation` / `weak-typing:hook-response`** — the
    Claude Code hook protocol is hand-validated with five copies of
    `typeof payload?.x === 'string'` and returned as `unknown`, in a repo where
    zod is the house schema lib (E-3, E-6). **The MCP agent should check whether
    `mcp/server.ts`'s session-identity header parsing has the same shape.**

