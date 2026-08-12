# Server runtime — consolidated audit report

**Scope:** `packages/server/src/{launcher,pty,routes,mcp,workflows,dev,doctor,bin,assets}/**`,
`packages/server/scripts/**`, `packages/server/drizzle/*.sql`.
Services / tRPC / db / util are a sibling orchestrator's; boundaries are marked `→ sibling` below.

**Leaf reports consolidated here** (full evidence lives in each):
- `server-runtime-launcher.md` — launcher/** (984 lines)
- `server-runtime-pty-routes.md` — pty/** + routes/** (816 lines)
- `server-runtime-workflows.md` — workflows/** (959 lines)
- `server-runtime-mcp-tooling.md` — mcp/** + dev/** + doctor/** + bin/** + assets/** + scripts/** + drizzle/*.sql (1029 lines)

**Orchestrator verification.** I independently re-derived, against source, the claims with the
largest blast radius before accepting them: the missing spawn guard (D-1), the constant-`true`
`sessionFinished` predicate (D-2), the dead PTY barrel, the registry reap gap, the zero-index
migration set, the `0004` backfill corruption, `awaitProjectLandings` being test-only, and the
triplicated OAuth-token reader. Each is marked **[verified by orchestrator]**. Where a leaf's
framing was incomplete, I corrected it rather than reporting both (noted inline).

---

## A. Flow map

### Flow 1 — Session launch (talk session)

```
apps/web  ──trpc──▶ trpc/routers/feature.ts:59-67  launchSession (any SessionKind, no guard ⚠ D-1)
                          │
                          ▼
   launcher/launcher.ts:352  launchSession
     :360  ensureWorktree ─────────────────────────────▶ → sibling services/git.ts (worktree add)
     :361  createSessionRow ──────────────────────────▶ launcher/sessions.ts:25
     :372  planKickoff (explicit brief ⇒ fresh, no --resume)
     :399  assertSpawnable   ← ONLY on the waypointId branch
     :414  assertSpawnable   ← ONLY on the revisit branch
           (ideation / qa / converge reach neither ⚠ D-1)
     :437  resume: mostRecentResumableSession(kind).ccSessionId
                          │
                          ▼
   launcher/artifacts.ts:589-735  writeSessionArtifacts  → sessionDir(sessionId)/
     ├─ system-prompt.md   :781-789 (three-optional brief union, nested ternary ⚠ E-2)
     ├─ settings.json      :723-733  5 hooks: SessionStart(×N sources) / UserPromptSubmit /
     │                                Stop / SessionEnd / PreToolUse(edit guard)
     │                                SPEC §5.2 names only 3 ⚠ drift
     └─ mcp.json           allowlist RUNCASTLE_MCP_ALLOW_RULES :612-630 (14 tools)
                          │
                          ▼
   launcher/launcher.ts:1006  spawnEmbeddedPty
     :1016  env = { ...process.env, RUNCASTLE_SESSION_ID, RUNCASTLE_SERVER_URL }
     :1021  delete CC_NESTING_ENV[]   ← scrubs CLAUDE_* only, never RUNCASTLE_* ⚠ H1
     :1023  ptyRegistry().create(...) ──────────────────▶ pty/registry.ts:60
                          │
                          ▼
   pty/pty.ts:106  selectBackend  'native' | 'sidecar'  (win32 ⇒ sidecar)
     ├─ native:  pty.ts:144 node-pty in-process
     └─ sidecar: pty-sidecar.ts → spawns system `node` pty/pty-host.cjs (newline-JSON frames)
                          │
                          ▼
   pty/registry.ts:60  entry { pty, ring: RingBuffer, sinks }  ← never reaped on natural exit ⚠ D2
   pty/ws.ts:62  attach() ──ws──▶ apps/web xterm  (/ws/terminal/:sessionId)
                          │
   ┌──────────────────────┴─ inside the session ─────────────────────────┐
   │ claude ──hook──▶ launcher/hook-client.ts:38 (bun, standalone)        │
   │   reads RUNCASTLE_SERVER_URL/:SESSION_ID, POSTs flat                 │
   │   { event, sessionId, payload }  ← SPEC §5.5 says { env:{sessionId} } ⚠ drift
   └──────────────────────┬──────────────────────────────────────────────┘
                          ▼
   routes/hooks.ts:50  POST /api/hooks/:event   (5 events; docstring :21-22 lists 4 ⚠ D8)
     :79-105  switch(event) → session-start | user-prompt | stop | session-end | pre-tool
              hand-rolled typeof guards, no zod ⚠ E1 / H3
     session-start ─▶ markSessionLive ─▶ store ccSessionId + transcriptPath
                   ─▶ schedule kickoff  ─▶ emitForSession
     pre-tool      ─▶ launcher/edit-guard.ts:36 guardsEdits(kind) → allow/deny JSON
                          │
                          ▼ (exit)
   launcher/launcher.ts:953  handlePtyExit (`feature` param never read ⚠ B-2)
     :966  landProjectSession  → sibling services/git.ts
   pty/end-session.ts:26-27  kill() then remove() — no tree kill ⚠ D1, fire-and-forget ⚠ D3
   launcher/reconcile.ts:41  boot reconciliation — omits landProjectSession ⚠ D-5
```

### Flow 2 — Burn (AFK ticket implementation)

```
apps/web ──trpc──▶ trpc/routers/feature.ts:162
      ▼
 → sibling services/features.ts:425  burn()  (G3 gate, sweeps orphaned `burning`, failed→pending)
      ▼
 workflows/runner.ts:84  startRun — run row, AbortController, detachWorktree (BRANCH_CLAIMING), wire ctx
      ▼
 workflows/registry.ts:17  getWorkflow(id)   Map<string, WorkflowDef> — 2 entries
      ▼
 workflows/ticket-burner.ts:1410  burnRun
   :1424 auth precheck (sandbox !== 'noSandbox')     :1432 detectCycle(blockedBy)
      ▼
 :1265 burnTickets — worker pool, concurrency default 3 (SPEC §8 still says 1 ⚠ drift)
      ▼
 :1631 realExecuteTicketRun  ← 568 lines, the giant
   :1655-1677 prompt ← packages/skills/burner/implement-ticket.md (typed key check)
   :1687 toolchain + cache mounts      :1704 burn-guard install
   :1711-1736 three stream consumers   :1717 beginTranscript ┐
   :1741 activeTicketAborts.set        ┐                     │ cleanup `finally` only
   :1966 try {                          ┘ ← gap: throws here leak both ⚠ #2
   :1995-2152 attempt loop, 7-branch catch ladder → :2059 sandcastle run()
        env = { CLAUDE_CODE_OAUTH_TOKEN } only  ← clean, no RUNCASTLE_* leak ✅
        cwd = .sandcastle/worktrees/… INSIDE project.repoPath ⚠ #3 (E2E F19)
   :2162-2171 result parse + BLOCKED.md read (shared repo root ⚠ #6)
      ▼
 :1926 landChain → :1196 landWithResolve — serial merge queue :2213
   conflict ⇒ resolver agent :1800 on resolve-conflict.md (untyped renderTemplate ⚠ #10)
   bounded by burnConflictAttempts; success verified against git, not the agent :1887 ✅
      ▼
 workflows/runner.ts:182  executeRun finalizer — sweepOrphanedBurning, run.finished,
   G4 auto-advance, reattach worktree (AFTER the row goes terminal ⚠ race)
      ▼ (server restart)
 workflows/reconcile-runs.ts:35  reconcileStaleRuns — sweeps merged branches only,
   never removes orphaned .sandcastle worktrees ⚠ #3
```

`workflows/research.ts` is the sibling workflow on the same spine (`registry.ts` → `runner.ts` →
`researchRun`), but reimplements six helpers and omits eleven capabilities — see D.2.

### Flow 3 — Dev / doctor / bin tooling

```
bin/runcastle.ts:36  hand-rolled arg switch (unknown ⇒ help ⇒ exit 0 ⚠ #10)
  :54  applyInstalledAssetEnv(pkgRoot) ── MUTATES global process.env ⚠ root of H1
  ▼
doctor/cli.ts:22-29  merge CLAUDE_CODE_OAUTH_TOKEN from data-dir .env over process.env
  :5  imports parseEnvFile from ../workflows/ticket-burner ⚠ layering
  ▼
doctor/doctor.ts:284-293  8 probes, ~11 spawns, strictly sequential
  :56-66  DoctorEnv.env OPTIONAL + :281 `env.env ?? process.env`  ← root cause of E2E F1
  :227-242 sandcastleImageProbe never tries podman (return inside loop) ⚠
  ▼
doctor/system-exec.ts:38-40  resolve({ ok: true, code: code ?? 0 }) — signal-kill reads as exit 0 ⚠
```

---

## B. Dead code (verified by importer search)

| Item | `file:line` | Why dead | Verification | Conf |
|---|---|---|---|---|
| `pty/index.ts` — the whole barrel | `pty/index.ts:1-40` | Zero importers; the only two hits are the barrel and `registry.ts` importing the sibling *file* `./pty` | **[verified by orchestrator]** repo-wide grep over `packages/ apps/` | high |
| `HooksSettings` type alias | `launcher/artifacts.ts:601` | `export type HooksSettings = SessionSettings`; only the declaration matches | leaf grep over `.ts/.tsx/.md` in `packages/ apps/ scripts/ docs/ site/` | high |
| `handlePtyExit`'s `feature` param | `launcher/launcher.ts:953` | Never read; threaded from 3 call sites. `tsconfig` has `strict` but not `noUnusedParameters` | leaf read | high |
| `awaitProjectLandings` | `launcher/sessions.ts:664` | Only importer is `test/project-session.test.ts` — written for the EPERM teardown case, never wired into production shutdown | **[verified by orchestrator]** | high |
| `RingBuffer.clear()` | `pty/ring-buffer.ts` | No caller anywhere | leaf grep | high |
| `assertPtyInstalled` | `pty/install-check.ts` | Exported for production gates never built | leaf grep | high |
| `HookBody.event` | `routes/hooks.ts` | Declared on the wire, never read (the path param is used) | leaf read | high |
| `export` on `readTokenFromEnvFile` | `workflows/ticket-burner.ts:2229` | Zero importers — `research.ts` copy-pasted the body instead | **[verified by orchestrator]** | high |
| Unused `Feature` type import | `workflows/research.ts:4` | `noUnusedLocals` set only for design-system | leaf read | high |
| Unearned `export` (code live, export dead) | `doctor/doctor.ts:171,224,257`, `doctor/cli.ts:38`, `dev/state.ts:212`, `mcp/server.ts:683` | Internal-only; no external importer | leaf grep | high |

**Not dead** (leaf claims I checked and rejected): `workflows/registry.ts` passes the deletion test —
it holds two entries plus the id→def indirection `runner.ts` needs; `Dockerfile`/`Containerfile` are
both live (`services/setup.ts:272` copies the dir; docker and podman each want their own filename).

---

## C. Redundancy & repeated logic

**C1. `errorMessage(e)` — six copies of two variants. [3 leaves]**
`e instanceof Error ? e.message : String(e)` as private `errMsg`/`describe`/`errorHeadline`:
`launcher/launcher.ts:873`, `workflows/ticket-burner.ts:1247`, `workflows/research.ts:137`,
`dev/state.ts:199-201` (named `describe` — un-importable in tests, collides with vitest),
`mcp/server.ts:346`, `bin/runcastle.ts:84`, `scripts/build-package.ts:103`, plus
→ sibling `services/features.ts:607`, `services/fsbrowse.ts:241`, `services/git.ts:160`.
**Module:** `errorMessage` in the existing `packages/server/src/errors.ts`.

**C2. AFK-token read — three implementations. [verified by orchestrator]**
`workflows/ticket-burner.ts:2229` (exported, zero importers) and `workflows/research.ts:356` are
**verbatim identical** — and `research.ts:26` already imports `parseEnvFile` from ticket-burner, so
it shared the parser and copy-pasted the wrapper. `doctor/cli.ts:22-29` is a third shape (merges into
an env map rather than returning a token). The generic `parseEnvFile` itself lives at
`ticket-burner.ts:286`, inside a 2245-line workflow file, imported by the pre-boot doctor gate.
**Module:** `services/auth-token.ts`. Three callers = real seam.

**C3. `ticket-burner.ts` ↔ `research.ts` — five more verbatim copy-pastes.**
`errorHeadline` (1247/137), `readDocsDigestFromDisk` (1474/223), `AUTH_MISSING_*` (77/51),
`renderResearchPrompt:170` reimplementing `renderTemplate:185`, skills-asset path (1468/217).

**C4. Asset-root resolution — "env override wins, validated, else fallback/ascend" ×4.**
`launcher/asset-paths.ts:40`, `launcher/skills-root.ts:27`, `launcher/launcher.ts:212`,
`routes/web.ts:70`. `resolvePluginDir` (`launcher.ts:212-240`) is a line-for-line
re-implementation of `resolveSkillsRoot` — it *is* `join(resolveSkillsRoot(here), SKILLS_MARKER)`.

**C5. Hook handler pairs — feature-scoped vs project-scoped written three times.**
`routes/hooks.ts` C1: ~60 lines across three pairs whose only genuine variation is the injected
context string and the event noun, as `hooks.ts:156-157` itself admits.

**C6. Newline-JSON frame reader implemented twice byte-for-byte** (`pty-sidecar.ts` / `pty-host.cjs`);
**`env values must be strings` filter ×3** (`pty.ts`, `pty-sidecar.ts`, `pty-host.cjs` — the last
deliberately isolated); **`git worktree prune` ×4 in two mechanisms**
(`services/git.ts:380,695,1233` via `g.raw` vs `dev/state.ts:212-218` via `execFileSync`, which
imports the git service anyway).

**C7. MCP handler preamble ×14** — `mcp/server.ts:703-957`, identical
`resolveCtxSession`/`noSession`/`ok` blocks.

---

## D. Inconsistencies & structural smells

### D.1 Latent bugs (call these out first — they produce wrong behaviour at runtime)

| # | Bug | `file:line` | Key | Conf |
|---|---|---|---|---|
| 1 | **No spawn guard for ideation/qa/converge.** `launchSession` reaches `assertSpawnable` only on the `waypointId` (:399) and `revisit` (:414) branches; `sweepActiveSessions` is called only at `:795` inside `workWaypoint`. `trpc/routers/feature.ts:67` passes any kind straight through. Two "Start grill" clicks ⇒ two `claude` processes in one worktree writing the same `decisions.md`. The doc at `:260-268` claims git forbids it — git forbids two *worktrees* on a branch, not two processes in one. **[verified by orchestrator]** | `launcher/launcher.ts:352,399,414,795` | `missing-guard:spawn-ideation` | high |
| 2 | **`sessionFinished` is constant-`true` for every non-waypoint kind.** `:295 if (session.kind !== 'waypoint') return feature.mapped`; its only path is `sweepActiveSessions:795`, reached only after `workWaypoint:772` throws unless `feature.mapped`. So a live qa/revisit/ideation/converge conversation is swept without the `endLive` confirmation, and the timeline says "ended the **finished** revisit session" (`:319`). **[verified by orchestrator]** | `launcher/launcher.ts:294-296` | `wrong-predicate:session-finished` | high |
| 3 | **Session PTYs are killed without a tree kill.** `killProcessTree` exists once, private, in `dev-pane.ts:159-170`, with a docstring (`:150-158`) explaining that ConPTY reaches only the direct child. The session path hits the identical shape — `resolve-executable.ts:44` `WIN_EXTS` includes `.cmd`, so an npm-global `claude` resolves to `claude.cmd` and the real node process is a **grandchild** — and gets `entry.pty.kill()` only. Orphaned `claude` holds worktree file handles ⇒ the recorded Windows `EPERM`-on-worktree-teardown pain. | `pty/end-session.ts:26`, `pty/registry.ts:117`, `pty/dev-pane.ts:159` | `leak:process-tree-kill` | high |
| 4 | **Shutdown races teardown.** `index.ts:128-132` `killAll(); server.stop(); process.exit(0)` synchronously. On the win32 sidecar backend `kill()` only writes a `{t:'kill'}` frame + a 500 ms backstop (`pty-sidecar.ts:231-243`), so no `onExit` fires, `handlePtyExit` never runs, no project landing, and `awaitProjectLandings` — written for exactly this — is never awaited. | `index.ts:128-132`, `launcher/sessions.ts:664` | `race:shutdown-teardown` | high |
| 5 | **Registry entries never reaped on natural exit.** `remove()` is called only from `dev-pane.ts:182` and `end-session.ts:27`, both user-initiated. A session that exits on its own leaves entry + RingBuffer forever. **[verified by orchestrator]** | `pty/registry.ts` | `leak:registry-entries` | high |
| 6 | **`research` silently downgrades a `podman` sandbox to no sandbox** — runs the AFK agent on the host. `research.ts:270` hand-rolls `docker \| noSandbox` instead of calling `selectSandbox` (`ticket-burner.ts:1567`, which has `case 'podman'`), though `config.sandbox` is `z.enum(['docker','podman','noSandbox'])`. Doubled in the auth precheck: `research.ts:100` `=== 'docker'` vs burner `:1424` `!== 'noSandbox'`. **Two-line fix.** | `workflows/research.ts:270,100` | `inconsistent:sandbox-selection` | high |
| 7 | **Abort-controller / transcript leak.** `activeTicketAborts.set` at `:1741` and `beginTranscript` at `:1717`, but the `try` owning the cleanup `finally` starts at `:1966`. Any throw between (e.g. `readFileSync(burnerTemplatePath())` `:1670`, `mkdirSync` `:1694`, `await branchCommitsAhead` `:1765`) skips `:2183-2198` ⇒ controller stays in the module map forever, so a later `stopTicketRun` returns `true` while aborting a dead controller. | `workflows/ticket-burner.ts:1717,1741,1966,2183` | `latent:ticket-cleanup-scope` | high |
| 8 | **Orphaned `.sandcastle/worktrees/` inside the user's repo** (confirms E2E F19). Created under `project.repoPath`; **zero** gitignore writes anywhere in `packages/server/src`; `reconcile-runs.ts:92-98` sweeps merged branches only and `git.ts:1159-1204` merely *detaches* worktrees. runcastle's own `.gitignore` lists it — invisible when dogfooding, visible on every other project. | `workflows/reconcile-runs.ts:92`, `services/git.ts:651` | `latent:orphaned-burn-worktrees` | high |
| 9 | **Migration `0004` writes feature ids into `project_id`** for orphaned events: `COALESCE((SELECT project_id FROM features WHERE …), \`feature_id\`)` — and the very next line correctly NULLs `feature_id` for that same row, so the orphan ends up with a feature id sitting in its project column. Shipped data corruption. **[verified by orchestrator]** | `drizzle/0004_events_project_id.sql` | `latent-bug:events-backfill` | high |
| 10 | **The database has zero indexes**, while `events` is polled at 1.5 s. No `CREATE INDEX` in any of the 19 migrations; `core/src/db-schema.ts:1` imports only `integer, primaryKey, sqliteTable, text`. Hot filters: `events.ts:158` (`feature_id = ? AND id > ?`), `:217` (`project_id = ? AND id > ?`), `:176-178` (`feature_id = ? AND type = ?` + `ORDER BY ts DESC`, called per-feature from `mcp/server.ts:632`). **[verified by orchestrator]** | all `drizzle/*.sql`, `packages/core/src/db-schema.ts:1` | `perf:missing-event-indexes` | high |
| 11 | **`system-exec` reports a signal-killed child as exit 0** — `resolve({ ok: true, code: code ?? 0 })` while every probe tests `code === 0`. | `doctor/system-exec.ts:38-40` | `latent-bug:exec-outcome-code` | high |
| 12 | **`sandcastleImageProbe` never tries podman** when docker exists — `return` inside the loop. | `doctor/doctor.ts:227-242` | `latent-bug:sandcastle-image-probe` | high |
| 13 | **`DoctorEnv.env` is optional with a `?? process.env` fallback** — the design flaw behind E2E F1. The miscaller `trpc/routers/setup.ts:29-33` also omits `cwd`, so the AFK card's git-identity probe resolves identity in the server's cwd rather than the repo — a *second* divergence between card and CLI on the same host. | `doctor/doctor.ts:56-66,281` | `weak-typing:doctor-env-optional` | high |
| 14 | **`isMergeConflictError` matches the bare word "conflict"** and runs *before* `classifyTicketRunError` (`:2102` vs `:2121`) — an npm `ERESOLVE … peer dependency conflict` from the install hook is misrouted to `merge.conflict.needs-human`, skipping transient retry. | `workflows/ticket-burner.ts:991-996` | `latent:conflict-detection-heuristic` | medium |
| 15 | **`BLOCKED.md` read from the shared repo root** under `burnConcurrency` default 3; nothing ever deletes it ⇒ one agent's BLOCKED text is attributed to every later zero-commit ticket. | `workflows/ticket-burner.ts:1487,2162` | `latent:blocked-file-crosstalk` | medium |
| 16 | **`runcastle <typo>` exits 0** — the sibling CLI in the same package exits 1 (`dev/args.ts:142,:33`). | `bin/runcastle.ts:36-37,61-63` | `latent-bug:cli-exit-code` | high |
| 17 | **`devtool` db-guard blocks `onboarding git clear`** (E2E F8) and the saved identity lives inside the tree `reset` wipes. | `scripts/devtool.ts:97-101,291` | `latent-bug:devtool-db-guard` | high |
| 18 | **Sidecar `kill()` backstop can orphan the tree and can double-fire**; sidecar exit reports the wrong `signal` value. | `pty/pty-sidecar.ts:231-243`, D12 | `latent:sidecar-kill` | medium |
| 19 | **Unknown/invalid hook input answered `200 {}` with zero observability**; **turn-state mutation emits nothing** (`setAwaitingInput` writes the DB silently, so the UI badge waits for a poll). | `routes/hooks.ts` D6, `launcher/sessions.ts:96-98` | `silent:hook-rejection`, `inconsistent:event-emission` | high |
| 20 | **Teardown inconsistency:** `reconcile.ts:41-42` omits `landProjectSession`, which both other teardown paths call (`launcher.ts:966`, `end-session.ts:37`), while its comment claims to "mirror the manual `endSession` path". Silently mitigated by `services/git.ts:413-416` at the next project launch. | `launcher/reconcile.ts:41` | `inconsistent:session-teardown` | high |

### D.1b Process-kill / teardown path inventory — the question only this scope can answer

Asked by a sibling orchestrator. **Eight independent kill paths, exactly one of which is correct.**

| # | Path | `file:line` | Semantics | Correct? |
|---|---|---|---|---|
| 1 | `killProcessTree` — the canonical one | `pty/dev-pane.ts:159-170` | win32 `taskkill /pid <p> /T /F`; POSIX `process.kill(-pid, 'SIGTERM')` (process **group**) | ✅ **the only correct one** |
| 2 | Drive-pane stop | `pty/dev-pane.ts:180-181` | calls #1, then `reg.kill(paneId)` | ✅ (only consumer of #1) |
| 3 | Session teardown | `pty/end-session.ts:26` → `pty/registry.ts:117` `entry.pty.kill()` | direct child only | ❌ orphans the `claude` grandchild (D.1 #3) |
| 4 | Shutdown sweep | `pty/registry.ts:127-129` `killAll()` ← `index.ts:129` | direct child only, then `process.exit(0)` 2 lines later | ❌ orphans **and** races (D.1 #4) |
| 5 | Native PTY backend | `pty/pty.ts:209` `proc.kill()` | node-pty direct child | ❌ |
| 6 | Sidecar supervisor backstop | `pty/pty-sidecar.ts:238` `child.kill()` (500 ms after the frame) | kills the **node supervisor**, not the tree below it | ❌ can orphan the whole tree |
| 7 | Sidecar host | `pty/pty-host.cjs:143` (on `{t:'kill'}`) and `:179` (on stdin `end`) | direct child only | ❌ |
| 8 | Drive-hook timeout | `services/drive-hooks.ts:163` `child.kill()` | direct child + a `KILL_GRACE_MS` window; **its own comment concedes defeat**: *"a grandchild that survived the kill … can hold [stdio] open forever"* | ❌ known-broken, worked around |
| 9 | Repo dev launcher | `scripts/dev.ts:56` `for (const c of children) c.kill(signal)` | direct children only | ❌ (dev-only) |

**Workflows spawn no processes directly** — `ticket-burner.ts` / `research.ts` cancel via `AbortController`
(`activeTicketAborts`) and delegate process lifetime to `@ai-hero/sandcastle`, so they are *not* additional
kill paths (they are, separately, a container-teardown path — see D.1 #8).

**Verdict for the parent: `killProcessTree(pid)` is the highest-confidence shared-module extraction in the
repo.** One correct implementation exists, it is `private` in a leaf file, and **seven** other sites hand-roll
a strictly weaker version — including one (`drive-hooks.ts:163`) whose comment documents the exact failure
the correct implementation prevents, and then adds a grace timer instead of fixing it. That is eight
adapters, not two.

### D.1c Additional latent bugs confirmed at a sibling's request

**21. `buildBurnAgent` passes a *replacement* env, not a merge — and this is the mechanism behind the
stray committed `~` directory.** `ticket-burner.ts:1529-1532`:
```ts
const opts: ClaudeCodeOptions = {
  ...(token ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
```
The child therefore runs with **no `HOME` and no `USERPROFILE`**, so `~` never expands and any tool writing
to `~/.claude/...` creates a literal directory named `~` relative to its cwd. The repo contains exactly
that artifact, committed:
`packages/server/~/.claude/projects/C-Users-user-Projects-exam-forge/7e2f128f-….jsonl`
**[verified by orchestrator — `git ls-files`]**. This *corrects* the framing in my first pass and in the
workflows leaf: the replacement env is genuinely clean w.r.t. `RUNCASTLE_*` leakage (H1 still does not apply
to sandboxes), but it is **not** therefore correct — it strips variables the child legitimately needs.
Key `latent:replacement-env-home`, violation, high.

**22. `noCodeRule` is injected into 2 of 6 prompt renderers while the edit guard denies 8 of 9 session
kinds.** `noCodeRule` (`artifacts.ts:82`) is called only at `:147` (inside `renderSystemPrompt:97`) and
`:357` (inside `renderRevisitPrompt:277`). The other four renderers omit it: `renderWaypointPrompt:162`,
`renderConvergePrompt:217`, `renderPreparePrompt:384`, `renderProjectPrompt:524`. Only the last is
*correct* — `edit-guard.ts:36 guardsEdits(kind) { return kind !== 'project' }` exempts `project` alone.
So **waypoint, converge and prepare sessions are hook-denied code edits that their prompt never warns them
about**, which is the same "ordered to edit, then forbidden" shape as E2E F18, one layer earlier.
Key `inconsistent:no-code-rule`, violation, high. **[verified by orchestrator]**

**23. `renderTemplate` fails open on unresolved placeholders — deliberately, which is the problem.**
`ticket-burner.ts:184-190` documents it: *"Keys absent from `values` are left alone — a template is free to
carry placeholders one caller fills and another does not."* Reasonable in isolation, but it means the
resolver path (`:1808`, 9 untyped keys) ships `{{OTHER_SIDE}}` verbatim to the agent on a renamed
placeholder, while the implementer path is protected by `renderTicketPrompt`'s typed key set (`:193`).
Sharpens D-list item #10: the fix is to give the resolver a typed key set, not to change `renderTemplate`.

### D.2 `research` vs `ticket-burner` — parallel workflows, eleven unexplained capability gaps

`research.ts` lacks, with no stated reason: transient retry / attempt chaining, the conflict-resolver
agent, the burn guard, deps install, `maxIterations`, live transcript, tool timing, per-unit stop,
isolated workspace, cache mounts, `burnCpus`. Combined with C3's five copy-pastes and bug #6, the two
workflows are a fork rather than two instances of one engine.

### D.3 Repeated switches, data clumps, primitive obsession

- **`SessionKind` switches — nine decision points in launcher alone** (`launcher.ts`, `sessions.ts`,
  `artifacts.ts`, `edit-guard.ts`) plus two more in `routes/hooks.ts:219-228,231-235`, and `mcp/server.ts`
  gates `dry_run_drive` on kind. Adding a kind is shotgun surgery. **Module:** `SESSION_KIND_TRAITS` in core.
- **Hook event name is a bare string in four places** with no shared union (`artifacts.ts` producer,
  `hooks.ts` consumer, `hook-client.ts`, docs).
- **`BRANCH_CLAIMING = new Set(['ticket-burner'])`** — stringly-typed workflow ids across 6 sites; its own
  comment admits the flag belongs on `WorkflowDef`.
- **`edit-guard.ts` policy input is `SessionKind` alone**, so a guard cannot depend on *purpose* — which is
  exactly what the launcher's `kickoffLine` mechanism varies. This is the structural reason E2E **F18**
  (revisit told to resolve conflicts, then denied the write) cannot be fixed inside the guard. The module
  is otherwise well-built (fails open, uses `resolve`/`relative`, prose denials); the fix is widening the
  input (a `writeScope` on the session row), not reshaping the module.

### D.4 Doc / contract drift — the single strongest cross-leaf signal (all four leaves)

| Drift | Code side | Doc side | Conf |
|---|---|---|---|
| **SPEC documents 7 of 14 MCP tools** — arithmetic terminates at 7 (§6 "4 tools" → §13.3 "7 total" → §15.3 "no new tools"); file ends at :470 with no §16. `update_ticket`, `cancel_ticket`, `create_feature`, `get_project_context`, `get_work_record` have **no contract in SPEC at all**; `dry_run_drive` appears nowhere in `docs/`. | `mcp/server.ts:683-961` (14), allowlist `artifacts.ts:612-630` (14 — they agree) | `docs/SPEC.md:151,254`; `CLAUDE.md` "4 MCP tools"; `packages/skills/packs/README.md:46` still names the original four | high |
| **Hook wire shape** — SPEC §5.5 specifies `{ event, env: { sessionId }, payload }` | `hook-client.ts:52` sends flat `{ event, sessionId, payload }`; receiver agrees | SPEC is stale | high |
| **Hook count** — SPEC §5.2 names 3 hooks | code registers 5 (adds Stop + PreToolUse) | SPEC stale | high |
| **Hook docstring** lists 4 of the 5 events it handles | `routes/hooks.ts:79-105` handles 5 | `routes/hooks.ts:21-22` | high |
| **SPEC §8** says tickets work *on* `feature/<slug>` (contradicting §8's own next bullet + ADR-0007) and `concurrency = 1` | actual default 3; podman unmentioned | `docs/SPEC.md:178-179` | high |
| **`tickets/SKILL.md` re-creates the duplicate event the code deleted.** `mcp/server.ts:199-201`: *"This tool used to emit an additional 'tickets.emitted' note, which double-logged…"* | `packs/runcastle/skills/tickets/SKILL.md:68` restores it by hand, with a hand-counted `<n>` that can disagree with `stored` | high |
| **`emit_waypoints` arg drift** — `originWaypointId` accepted (`core/schemas.ts:177`) but omitted from the tool description (`mcp/server.ts:898`); `waypoint/SKILL.md:26` requires it, `ideate/SKILL.md:57` + SPEC §13.3 omit it ⇒ lineage silently lost from ideation sessions | | high |
| **`complete_phase`'s `phase` arg is a label, not a target** — code branches on `nextGate(feature)?.id === 'G3'` (`:308-317`), never on `input.phase` (used only in the event message `:299-300`) | description `:946` promises otherwise | medium |
| **`qa/SKILL.md` prohibitions are honour-system** — forbids `complete_phase`/`emit_tickets`, but a qa session has a `featureId` so `requireFeatureId` passes and both execute. `dry_run_drive:453-460` already shows the `session.kind` guard qa lacks | | medium |
| **`UI-SPEC §5`** describes a runtime probe the code deliberately replaced with a deterministic switch, and 3 of 8 protocol frames | `pty/pty.ts:106` | high |
| **`patches/node-pty@1.1.0.patch` hunk 1** (ConPTY `AttachConsole` guard) is load-bearing for Windows kill latency, referenced by **no** source file or doc, and would be deleted by following `prebuild-bridge.ts:33-36`'s retirement checklist verbatim | | high |

**The pattern all four leaves independently named:** the spec is *append-only by amendment section*
(§13.3, §15.3), and features added after §15 stopped amending it at all. The fix is structural
(generate the tool/hook/route inventory from code), not prose.

---

## E. Wrong-tool & weak typing

- **Hand-rolled validation at process boundaries in a zod repo** [3 leaves]: `routes/hooks.ts` (8 `typeof`
  guards + 2 casts on a cross-process contract, E1); `pty/ws.ts:77` control frames; `pty-sidecar.ts:59-66`
  host frames; `mcp/server.ts:790` declares both `get_work_record` args optional then throws at `:620-622`
  (rule stated in prose only, and `featureSlug: ""` passes zod then trips the throw);
  `scripts/build-package.ts:40` `JSON.parse(...) as T` on the **release** path — a malformed manifest
  silently ships a wrong tarball; `scripts/devtool.ts:401` same shape.
- **`dev/args.ts:36,110-113` hand-mirrors `FeatureStatus` + casts**, while the adjacent branch at `:99`
  correctly uses `Phase.safeParse`; `core/src/schemas.ts:98` exports the zod enum.
- **Untyped template render for the resolver prompt** — `renderTemplate` with 9 keys
  (`ticket-burner.ts:1808`) while the implementer gets `renderTicketPrompt`'s typed key check, so a
  renamed placeholder in `resolve-conflict.md` ships `{{OTHER_SIDE}}` verbatim to the agent.
- **MCP error shape is inconsistent**: only `noSession` returns a structured tool error
  (`mcp/server.ts:664-674`); all seven domain refusals are *thrown* uncaught
  (`:121,:214,:255,:281,:363,:455,:621`), with no try/catch in `buildMcpServer`.
- **Three-optional brief union enforced by nested ternary + throwing IIFE** (`artifacts.ts:781-789`)
  where `CreateSessionInput` (`sessions.ts:25-28`) already expresses the union.
- **`write()` stringly-typed while `onData()` is byte-transparent** — asymmetric PTY interface.
- **`sql\`rowid\`` ×4**; **`selectSandbox` exported with no return type**; **`writeSessionArtifacts` is
  `async` with a fully sync body**, creating microtask windows in three functions whose comments fear
  exactly that.
- **Clean, worth recording:** zero `any` / `as any` / `@ts-ignore` / `!` across launcher and workflows;
  all Windows paths go through `node:path` or core `paths.ts` — **no hand-concatenated paths anywhere in
  scope**, and no path interpolated into a shell command in workflows.

---

## F. Shallow modules / deletion-test results

**Pass (keep):** `pty/ring-buffer.ts` (deep — bounded retention + late-attach replay);
`pty/registry.ts` (deep, though `has()`/`ids()` are thin); `workflows/registry.ts` (the id→def
indirection is what `runner.ts` needs); `dev-pane.ts` `drivePaneId`/`isDrivePaneId` (thin but earning
it — encodes the non-session-id invariant); `routes/web.ts` `contentType`/`isFile` (trivially thin,
correctly so); `launcher/edit-guard.ts` (deep; its defect is input width, not depth).

**Fail:** `pty/index.ts` (dead barrel — deletion removes nothing); `resolvePluginDir`
(`launcher.ts:212`, a re-implementation of a function it could call).

---

## G. Deepening / extraction opportunities — ranked across all four leaves

Ranked by value × confidence ÷ effort.

> **Re-ranked after the kill-path inventory (D.1b).** #1 and #2 were swapped: `killProcessTree` has
> **eight** adapters with one correct implementation already written, which beats `childEnv`'s three on
> confidence and effort alike.

1. **`pty/kill-tree.ts` — shared process teardown.** *(high value · **highest conf** · M · medium blast)*
   `dev-pane.ts:159-170` already holds the correct Windows/POSIX tree-kill *and* the reasoning; it is
   private with one consumer while **seven** other sites hand-roll a weaker kill (full inventory, D.1b).
   Call it from `registry.kill()` so session, drive pane and `killAll()` all get tree semantics; fix
   `drive-hooks.ts:163` and `scripts/dev.ts:56` on the same pass. Pair with giving `PtySession.kill()` a
   completion signal (D.1 #4), which is what would finally let `endSession` *await* teardown. This is the
   mechanism behind the recurring Windows `EPERM`-on-worktree-teardown pain, and every prior repair fixed
   one call site rather than the interface — which is precisely why a module is the right fix.
2. **`childEnv()` — one child-process environment policy.** *(high value · high conf · M · medium blast)*
   Three spawn paths, one policy, zero shared code: `launcher.ts:1016-1021` (spreads, scrubs 8 `CLAUDE_*`),
   `services/drive-env.ts:143-148` (spreads, scrubs nothing), `dev-pane.ts:104` (raw fallback). Extract
   `childEnv({ base, overrides, scrub })` carrying `CC_NESTING_ENV` **plus** a new `RUNCASTLE_ASSET_ENV`
   list, and apply it inside `registry.create()` so no future spawn path can forget. Phase 2: make
   `applyInstalledAssetEnv` return a resolved-asset record instead of mutating global `process.env`,
   which is what makes the leak structural. **Kills a documented, recurring failure class outright.**
   Note the policy must cover *stripping* **and** *preserving*: the burner's replacement env
   (`ticket-burner.ts:1529-1532`) drops `HOME`/`USERPROFILE` and produced the committed `~` directory
   (D.1c #21), so `childEnv` needs an explicit keep-list as well as a scrub-list.
3. **`services/auth-token.ts`.** *(high · high · S · low)* Three callers today
   (`ticket-burner:2229`, `research:356`, `doctor/cli.ts:22`), one of which reaches into a 2245-line
   workflow file for a generic `.env` parser. Fixes E2E F1's root cause on the way past.
4. **`errorMessage(e)` in `packages/server/src/errors.ts`.** *(medium · high · S · low)* Six copies, three
   leaves, file already exists.
5. **`HookEvent` union + per-event zod payloads in `@runcastle/core`.** *(high · high · M · medium)*
   Collapses four findings into one change: the 4-way string duplication, the 8 hand-rolled `typeof`
   guards, the dead `body.event`, and the docstring drift. Producer (`artifacts.ts:715-735`) and consumer
   (`hooks.ts:78-105`) become two ends of one typed contract; a typo stops compiling instead of 200-ing.
6. **`workflows/sandbox.ts`** (`ticket-burner:454-550,1523-1547,1567-1594`, ~190 L). *(high · high · S–M)*
   Real seam — `research` already imports `buildBurnAgent` and hand-rolls the rest. **Extracting it *is*
   the fix for the podman-downgrade bug.**
7. **Three `CREATE INDEX` lines in one migration.** *(high · high · S · low)* Smallest high-certainty win
   in the whole report; the UI's entire polling story sits on it.
8. **`registerSessionTool()` wrapper for MCP.** *(high · high · M · low)* Folds 14 identical preambles +
   error shaping + the docs checkpoint into one declarative table — which then also feeds a
   registry-drift test and a generated SPEC §16, fixing the largest doc-drift finding structurally.
9. **`idleTimeout` on `Bun.serve`.** *(medium · medium · S · low)* One option at `index.ts:105` fixes E2E
   F11 and F14 together, and the terminal WebSocket at the same time.
10. **`workflows/run-errors.ts`** (~130 L) — real seam; kills the `errorHeadline` copy and gives the
    conflict-detection heuristic one place to be fixed.
11. **`workflows/burn-prompt.ts`** (~300 L) — real seam; kills three copy-pastes and lets the typed-key
    check cover the resolver template.
12. **Bound registry retention of exited entries** (TTL eviction, reusing the already-written
    `RingBuffer.clear()`). *(medium · high · S · low)*
13. **`workflows/agent-telemetry.ts`** (`:673-926`, ~250 L = 11 % of the file, zero burn vocabulary).
14. **Split `realExecuteTicketRun`** (568 L) — seams already visible as closures; a `TicketRunContext`
    built once would fix the abort-controller leak structurally. *(M–L)*
15. **Collapse the three hook handler pairs** — land after #5 so dispatch is already typed.
16. *Speculative (single caller):* `repo-toolchain.ts`, `ticket-scheduler.ts`, `landing.ts`,
    `ticket-abort-registry.ts`, `resolvePackageRoot()`.

---

## H. Cross-cutting candidates to pass UP

Ordered by cross-leaf corroboration then blast radius. **[N leaves]** = independently named by N of my four.

**H1. `leak:child-env-inheritance` — no single policy for what a spawned child inherits. [2 leaves + orchestrator]**
`launcher.ts:1016` spreads `process.env` and scrubs only `CLAUDE_*`; `services/drive-env.ts:147` spreads and
scrubs nothing; `dev-pane.ts:104` falls back to raw `process.env`. Made *structural* by
`launcher/asset-paths.ts:73-77`, which **mutates the server's global `process.env`** at bin boot
(`bin/runcastle.ts:54`) so that in a published install every child inherits `RUNCASTLE_MIGRATIONS_DIR`,
`SKILLS_DIR`, `WEB_DIST`, `HOOK_CLIENT`, `PTY_HOST`, `SANDCASTLE_TEMPLATE`, plus `RUNCASTLE_DEV`,
`RUNCASTLE_PTY_BACKEND`, `RUNCASTLE_CLAUDE_BIN`, the data-dir/port overrides (`core/paths.ts:34,44`,
`core/config-load.ts:30`) and the whole `RUNCASTLE_BURN_*`/`MODEL` block. `prepare`/`project` sessions run
in the developer's **real checkout** and are explicitly told to run migrations, so a runcastle-shaped
project reads the installed runcastle's migrations. This is the user's own recorded operating hazard.
**Scope note:** the burn sandbox is **clean** (`ticket-burner.ts:1530` passes only the OAuth token) — the
leak is PTY-only. **→ sibling agents:** confirm `services/drive-hooks.ts` (its `:63` comment says it
"mirrors `devSpawnTarget`", suggesting a fourth copy) and `doctor/system-exec.ts`.
**Module:** `childEnv`/`spawnEnv`.

**H2. `leak:process-tree-kill` + `race:teardown-fire-and-forget` — EIGHT independent kill paths, one correct. [2 leaves + sibling orchestrator + orchestrator inventory]**
**Full inventory with `file:line` in D.1b — this is the answer to the sibling's question, and it settles
the ranking.** One correct implementation (`dev-pane.ts:159-170`, win32 `taskkill /T /F` + POSIX
process-group signal) is `private` in a leaf file with exactly one consumer. Seven other sites hand-roll a
strictly weaker direct-child-only kill: `end-session.ts:26`→`registry.ts:117`, `registry.ts:129` (`killAll`),
`pty.ts:209`, `pty-sidecar.ts:238` (kills the *supervisor*, not the tree), `pty-host.cjs:143,179`,
`services/drive-hooks.ts:163`, `scripts/dev.ts:56`. `drive-hooks.ts:163` is the sharpest evidence: its own
comment concedes *"a grandchild that survived the kill … can hold [stdio] open forever"* and adds a grace
timer rather than fixing the kill. Compounding it, `PtySession.kill(): void` returns no completion signal,
so nothing downstream *can* await teardown, and `index.ts:128-132` exits synchronously after merely queuing
a kill frame. This is the repo's most-repaired area by commit history (`tree-kill the dev pane on Windows
(taskkill /T)`, `let teardown await the landing instead of racing it`) and **every repair fixed one call
site, never the interface** — which is why the same bug keeps returning.
**Module:** `killProcessTree(pid)` + an awaitable `kill()`. **Eight adapters, not two — I rank this the
repo's highest-confidence shared-module extraction.**

**H3. `wrong-tool:json-boundary-validation` — hand-rolled `typeof` guards where the house rule says zod. [3 leaves]**
`routes/hooks.ts` (cross-process hook contract, 8 guards + 2 casts), `pty/ws.ts:77`,
`pty-sidecar.ts:59-66`, `mcp/server.ts:790` vs `:620-622`, `scripts/build-package.ts:40` (release path),
`scripts/devtool.ts:401`. **→ sibling agents:** every `JSON.parse` meeting an external producer — config
load, transcripts, tRPC input edges. **Module:** wire-payload schemas in core.

**H4. `drift:spec-vs-code` — the spec is append-only by amendment and stopped being amended. [4 leaves]**
SPEC documents 7 of 14 MCP tools (and 5 tools have *no* contract anywhere in `docs/`); §5 is stale in four
ways including a **live wire contract** (§5.5 vs `hook-client.ts:52`); §8 contradicts itself on branch
targeting and states a concurrency of 1 against an actual default of 3; `CLAUDE.md` and
`packages/skills/packs/README.md:46` still say "4 MCP tools"; two skill-pack prompts contradict the server
(`tickets/SKILL.md:68` restores an event the code deliberately deleted; `qa/SKILL.md:20-21` states
prohibitions the server does not enforce). **→ parent:** this is one repo-wide finding with a structural
fix (generate the inventory from code), not eleven prose patches. Ask the `docs/` and `packages/skills`
leaves whether §4 (tRPC map) and §10 (web) show the same append-only decay.

**H5. `redundant:error-message-extraction` — six copies of two variants. [3 leaves]**
Listed in C1. Home: `packages/server/src/errors.ts`, which already exists. Expect double digits repo-wide.

**H6. `repeated-switch:session-kind` — nine decision points in launcher, two in routes, one in MCP. [2 leaves]**
Adding a `SessionKind` is shotgun surgery across `launcher.ts`, `sessions.ts`, `artifacts.ts`,
`edit-guard.ts`, `routes/hooks.ts:219-235`, `mcp/server.ts`. **→ sibling agents:** the web leaves render
per-kind CTAs and the MCP surface gates tools on kind — expect more. The same shape almost certainly
recurs for **phase**, **gate id** and **event type** (`primitive-obsession:workflow-id` is the third
instance already: `BRANCH_CLAIMING = new Set(['ticket-burner'])`).
**Module:** `SESSION_KIND_TRAITS` in `@runcastle/core`.

**H7. `inconsistent:event-emission` — mutations that skip the house convention. [2 leaves]**
`setAwaitingInput` (`sessions.ts:96-98`) writes the DB and emits nothing, so the UI's turn-state badge
waits for a poll; `emit_waypoints` is the one mutating MCP tool with no docs checkpoint;
`routes/hooks.ts` uses `emit` and `emitForSession` interchangeably for the same event type, and launcher
uses three emitters (`emit`/`emitProject`/`emitForSession`) for the same event types in one module.
**→ sibling agents:** which mutating service functions skip `emit`, and does `LiveSignal` need a third
kind for high-frequency state that must not spam the timeline?

**H8. `perf:missing-event-indexes` — the database has no indexes at all. [1 leaf, orchestrator-verified]**
Zero `CREATE INDEX` in 19 migrations; `core/src/db-schema.ts:1` imports no `index`. This is a
`packages/core` schema decision that the whole services layer and the entire 1.5 s-polling UI story sit
on. **→ parent:** pair with whatever the web leaves report about polling cadence — the fix is three lines.

**H9. `redundant:asset-root-resolution` — "env override wins, validated, else ascend" ×4. [2 leaves]**
`asset-paths.ts:40`, `skills-root.ts:27`, `launcher.ts:212`, `routes/web.ts:70`, with consumers in
`db/migrate.ts:21`, `services/setup.ts:236`, `ticket-burner.ts:1470`, `research.ts:219`. One `assets` module.

**H10. `dead-export:*` — the `export` keyword is unearned across the scope. [4 leaves]**
Ten items in section B. None are dead *code* in most cases — the *export* is what's dead. Sharp end: the
two doctor probes with the subtlest logic are exported **and** have no direct test, and
`buildMcpServer` — the layer that drifts — is exported but never exercised (`test/mcp-tools.test.ts`
imports only the `tool*` functions, so nothing tests that the 14 registrations match the 14 allowlist
entries). **→ parent:** `tsconfig` sets `strict` but not `noUnusedParameters`/`noUnusedLocals` outside
design-system, so tsc cannot see any of this.

**H11. `drift:patched-dependency` — vendored patch behaviour with no code-side pointer. [1 leaf]**
`patches/node-pty@1.1.0.patch` hunk 1 is load-bearing for Windows kill latency and stderr cleanliness, is
referenced by no source file or doc, and would be deleted by following `prebuild-bridge.ts:33-36`'s
retirement checklist verbatim. **Generalises to:** does every patch / vendored fork have a code-side
pointer and a retirement precondition? `packages/skills` vendors forked packs — worth confirming those
carry provenance headers (SPEC §9 requires them).

**H12. `config:bun-idle-timeout` — one `Bun.serve` call, no timeout knobs, two long-lived transports. [1 leaf + E2E]**
`index.ts:105-112` sets `port`/`fetch`/`websocket` only; `stream.ts:31`'s 25 s heartbeat is tuned against
an unset 10 s default and `ws.ts` has no keepalive at all. Already diagnosed as E2E **F11/F14**; recorded
here because **the terminal WebSocket is a third victim nobody has attributed to it yet**, and the fix is
one option on one line. → owned by whoever audits `src/index.ts`.

**H13. `redundant:sandcastle-container-template` — `Dockerfile` and `Containerfile` are byte-identical, hand-synced. [1 leaf]**
Neither is dead (docker and podman each want their own filename), but nothing keeps them equal and
`test/sandcastle-scaffold.test.ts:30-31` asserts the UID/GID invariant against the **Containerfile only**.
Same file: two unpinned installers piped to bash on a floating `FROM node:22-bookworm`, so two builds of
"the same" burner image differ, and `doctor.ts:224-251` probes presence only, never freshness. **Burner
image reproducibility is a whole-product property** — passing up rather than filing locally.

**H14. `ambiguous:findings-citation` — code comments cite finding numbers under THREE incompatible schemes. [orchestrator]**
Raised by a sibling and confirmed to be worse than reported. Code comments use:
1. `(findings F<N>)` → `docs/features/identify-random-issues-throughout-the-system/findings.md`
   (proved by `F22`/`F23`/`F24` at `services/git.ts:101,734`, `gates.ts:210` — the root
   `E2E-FINDINGS.md` stops at F19). In my scope this form appears once: `launcher/launcher.ts:855`.
2. `E2E finding <N>` — a *severity*-ordered scheme matching neither file:
   `launcher.ts:398` ("E2E finding 8"), `:878` ("E2E finding 3"), `sessions.ts:59` ("E2E findings 5+8"),
   `waypoints.ts:172` / `reconcile.ts:12` ("E2E finding, severity 4" / "severity 1").
3. `E2E finding:` with prose and no number (`artifacts.ts:635`, `launcher.ts:132`).
A reader cannot resolve any of these without guessing which document is meant, and scheme 2's numbers
collide with scheme 1's. **→ parent:** worth one repo-wide normalization (cite `<file>#F<N>`), and worth
warning every other leaf that inline `F<N>` in *their* reports may mean a different document than they
assumed. **My report's own `E2E F<N>` references are all sourced from root `E2E-FINDINGS.md`, which I read
directly — they do not use the code-comment numbering.** violation (doc) · high · S.

**H15. `inconsistent:cli-conventions` — two hand-rolled CLIs in one package, opposite conventions. [1 leaf]**
`bin/runcastle.ts` (unknown ⇒ help ⇒ **exit 0**) vs `dev/args.ts:142` (unknown ⇒ `UsageError` ⇒ exit 1).
Fine at this size, but **→ parent:** if the `scripts/` leaf found a third arg-parsing style, that is a
repo-wide "pick one". The exit-0-on-typo bug is worth surfacing regardless.

---

## Verified non-findings (so no one re-chases them)

- ~~Burn **sandbox** env is clean — only `CLAUDE_CODE_OAUTH_TOKEN`.~~ **RETRACTED** — see D.1c #21.
  It is clean w.r.t. `RUNCASTLE_*` leakage (H1 still does not reach sandboxes) but it is a *replacement*
  env that strips `HOME`/`USERPROFILE`, which is what produced the committed `~` directory.
- No hand-concatenated paths anywhere in scope; `node:path`/core `paths.ts` throughout.
- No `any` / `as any` / `@ts-ignore` / `!` in launcher or workflows.
- All 7 silent `catch {}` in workflows are documented and correct (they are a *policy with no shared
  expression* — see H-adjacent note, not a bug).
- The single `JSON.parse` in workflows (`:651`) is properly `unknown` + `typeof`-guarded.
- `services/tickets.updateTicket` **does** emit, so the `preserveChain`/`conflictFiles` writes are not
  missed emissions.
- `pty-host.cjs` / `pty-sidecar.ts` are a legitimate two-process pair, not duplication; the third copy of
  the env-string filter inside `pty-host.cjs` is deliberate isolation.
- `Dockerfile` and `Containerfile` are both referenced and live.
- Landing success is verified **against git, not against the agent's claim** (`ticket-burner.ts:1887`) —
  a genuinely good design decision worth preserving through any refactor.
