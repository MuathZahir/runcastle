# Runcastle M1 — Implementation Spec

> **Build-time document.** Written to coordinate runcastle's own construction
> and kept as part of the dogfooding record — it may describe states the code
> has since moved past. The code and README are authoritative for current
> behavior.

Read `CONTEXT.md` first for vision + locked decisions. This spec pins the contracts every implementation agent builds against. **Names in this file are law**; if a research note (docs/research/) contradicts a *format detail* here (e.g. a hook JSON field), the research note wins — record the correction in docs/research/CORRECTIONS.md.

M1 tracer bullet: one repo, one feature at a time: create feature → grilling terminal opens (context injected) → spec/tickets land in store → click Burn → sandcastle runs one AFK agent per ticket on the feature branch → test-drive → merge.

## 0. Monorepo

Bun workspaces, TypeScript strict everywhere, ESM only. Server runs TS directly with bun (no build step). Web is Vite.

```
runcastle/
├── package.json              # workspaces: packages/*, apps/*; scripts: dev, typecheck, test
├── tsconfig.base.json        # strict, moduleResolution bundler, types: ["bun-types"] where needed
├── packages/
│   ├── core/                 # contracts: zod schemas, drizzle schema, pipeline, paths, workflow types
│   ├── server/               # Hono + tRPC + services + launcher + MCP + workflows
│   └── skills/               # upstream/ (snapshots, done) + packs/ (our forks) + burner/ (prompt templates)
└── apps/
    └── web/                  # Vite + React + tRPC client + TanStack Query
```

- Package names: `@runcastle/core`, `@runcastle/server`, `@runcastle/skills`, `@runcastle/web`.
- Root scripts: `bun run dev` (server + web concurrently), `bun run typecheck` (tsc -b or per-package `tsc --noEmit`), `bun run test` (vitest), `bun run dev:tool` (dev-only test-state surgery — `scripts/devtool.ts` over `packages/server/src/dev/`, unreachable from the published bundle).
- Ports: server **4512**, web dev **4513** (vite `server.port`). Server URL: `http://localhost:4512`.
- Data dir: `~/.runcastle/` → `runcastle.db`, `config.json`, `.env` (CLAUDE_CODE_OAUTH_TOKEN for sandboxed Claude Code agents; Codex ones borrow the host's `codex login` instead, though a hand-set CODEX_API_KEY here still overrides it), `sessions/<sessionId>/` (launch artifacts), `worktrees/<projectId>/<slug>/` (talk worktrees), `logs/`.
- Dev/prod split: `dataDir()` honours `RUNCASTLE_DATA_DIR`, and `scripts/dev.ts` points `bun run dev` at `~/.runcastle-dev/`. Everything else in `paths.ts` derives from `dataDir()`, so the two trees are fully independent; the published bin never sets the var. `GET /health` reports `{ ok, dataDir }` so a live server's tree is identifiable.

## 1. packages/core (file → exports)

- `src/ids.ts` — `newId(prefix: string): string` (prefix + nanoid(12), e.g. `feat_x1y2...`).
- `src/schemas.ts` — zod schemas + inferred types (these are the wire types for tRPC and MCP):
  - `Phase = z.enum(['ideation','spec','tickets','implementation','review','shipped'])`
  - `FeatureSize = z.enum(['full','collapsed'])` (collapsed = small feature, skips `spec` phase)
  - `TicketStatus = z.enum(['pending','burning','done','failed'])`
  - `SessionKind = z.enum(['ideation','qa'])` (qa = "come back and ask questions" — same injection, no phase writes)
  - `RunStatus = z.enum(['running','succeeded','failed','cancelled'])`
  - `TicketInput` (what the ideation session emits via MCP): `{ title: string, goal: string, context: string, acceptanceCriteria: string[], seams: string[], blockedBy: number[] /* seq numbers of other tickets in the same batch */ }`
  - `Ticket` = TicketInput + `{ id, featureId, seq: number, status: TicketStatus, commits: string[], error?: string }`
  - `Project { id, name, repoPath, mainBranch, devCommand?: string }`
  - `Feature { id, projectId, slug, title, oneLiner, size, phase, branch, baseBranch?, status: 'active'|'shipped', createdAt }` — `baseBranch` is the branch `branch` was forked off at creation (choosable; defaults to `mainBranch`). Unset on features predating the column.
  - `SessionRow { id, featureId, kind, ccSessionId?, transcriptPath?, status: 'launching'|'live'|'ended', worktreePath }`
  - `Run { id, featureId, workflow: string, status: RunStatus, startedAt, endedAt?, summary? }`
  - `EventRow { id: number, featureId, runId?, ticketId?, ts, type: string, message: string, data?: unknown }`
- `src/pipeline.ts` — phases as data:
  - `PIPELINE: PhaseDef[]` where `PhaseDef { phase, gateToEnter?: GateDef }`.
  - `GateDef { id: 'G1'|'G2'|'G3'|'G4'|'G5', description, check: GateCheckId }` — checks are *identifiers*; the server implements them (core stays IO-free):
    - G1 enter `spec` (or `tickets` when collapsed): `decisions-file-exists`
    - G2 enter `tickets`: `spec-file-exists` (auto-satisfied for collapsed)
    - G3 enter `implementation`: `tickets-approved` (human Burn click)
    - G4 enter `review`: `all-tickets-terminal`
    - G5 enter `shipped`: `human-merge` (the Merge click IS the gate)
  - `nextPhase(feature: {phase, size}): Phase | null` respecting collapsed skipping `spec`.
- `src/db-schema.ts` — drizzle sqlite tables mirroring the schemas: `projects, features, sessions, tickets, runs, events, gate_overrides`. `events.id` integer autoincrement (used as polling cursor `afterId`). JSON columns via `text(..., { mode: 'json' })`.
- `src/paths.ts` — `dataDir()`, `dbPath()`, `sessionDir(id)`, `worktreeDir(projectId, slug)`, `featureDocsRel(slug) = 'docs/features/' + slug` (relative to target repo), `envPath()`.
- `src/workflow.ts` — the workflow contract (Decision #10):
  ```ts
  interface WorkflowCtx {
    project: Project; feature: Feature; tickets: Ticket[];
    emitEvent(e: { type: string; message: string; ticketId?: string; data?: unknown }): void;
    updateTicket(id: string, patch: Partial<Pick<Ticket,'status'|'commits'|'error'>>): void;
    signal: AbortSignal;
  }
  interface WorkflowDef {
    id: string;                              // 'ticket-burner'
    run(ctx: WorkflowCtx): Promise<{ status: 'succeeded'|'failed'; summary: string }>;
  }
  ```
- `src/config.ts` — `RuncastleConfig` zod (defaults): `{ serverPort: 4512, model: 'claude-opus-5', stepModels: { smoke: 'claude-haiku-4-5' } (sparse per-step overrides, issue #48; keyed by `ModelStep`), sandbox: 'docker'|'noSandbox' (default 'docker'), mainBranch: 'main' }`, loader merging `~/.runcastle/config.json` + env. Legacy `smokeModel` folds into `stepModels.smoke` (read-compat). `resolveModel(step, config, project?, runOverride?)` picks a step's model as `runOverride ?? project.model ?? stepModels[step] ?? model` — the global values are the machine-wide setup, so a project's own `model` overrides them (there is no per-project per-step matrix).

## 2. Database (drizzle + bun:sqlite)

- Client in `packages/server/src/db/client.ts` using `drizzle-orm/bun-sqlite`; schema imported from core.
- Migrations: use `drizzle-kit push`-style auto-sync on boot if that's what STACK-NOTES recommends for a local app that owns its DB; otherwise bundled migrations run at boot. WAL mode on.

## 3. packages/server — file ownership (waves edit disjoint dirs)

```
src/
  index.ts             A1  boot: Hono app; mounts /api/trpc, /api/hooks, /mcp; starts listener; runs db migrate
  config.ts            A1  load RuncastleConfig
  db/client.ts         A1
  services/
    projects.ts        A1  initProject(repoPath) [detects mainBranch], getProject()
    features.ts        A1  createFeature (calls git.createFeatureBranch + scaffoldDocs + db row), getFeatureFull, phase transitions
    gates.ts           A1  checkGate(gateId, feature) implementing GateCheckIds; overrideGate(featureId, gate, reason)
    tickets.ts         A1  storeTickets(featureId, TicketInput[]) [assign seq, resolve blockedBy seq→id], listByFeature, updateTicket
    events.ts          A1  emit(featureId, {...}), listAfter(featureId, afterId)
    knowledge.ts       A1  scaffoldDocs(feature) [brief.md from title+oneLiner], listDocs(feature) [reads docs/features/<slug> from repo via worktree or main checkout], readDoc(path)
    git.ts             B2  see §7
  trpc/
    context.ts router.ts routers/*.ts   A1  procedure map in §4; stubs for B-owned behavior throw NotImplementedError
  launcher/
    launcher.ts        B1  see §5
    artifacts.ts       B1  writes settings.json / mcp.json / system-prompt.md per session
    hook-client.ts     B1  standalone bun script (also used INSIDE sessions)
  routes/hooks.ts      B1  POST /api/hooks/:event
  mcp/server.ts        B1  see §6
  workflows/
    registry.ts        A1  Map<string, WorkflowDef>; stub ticket-burner entry
    ticket-burner.ts   B3  see §8
    runner.ts          A1  startRun(featureId, workflowId): creates run row, invokes WorkflowDef.run with ctx wired to services, catches errors, finalizes run row. In-memory AbortController per run.
```

A1 creates B-owned files as typed stubs (`throw new NotImplementedError('B1')`) so typecheck and the UI work end-to-end before wave B lands.

## 4. tRPC procedure map (pin — apps/web builds against exactly this)

Router `appRouter` in `trpc/router.ts`, context = `{ db, config }`. All inputs/outputs zod from core.

- `project.get(): Project | null`
- `project.init({ repoPath: string }): Project` — validates it's a git repo; stores mainBranch. Per-project overrides (devCommand, model, sandbox) are set later via `settings.update({ projectId, key, value })` — `project.update` is retired (issue #46).
- `project.branches({ projectId }): { current, mainBranch, branches: string[], remoteBranches: string[] }` — branches for the create-feature base picker (`feature/*` excluded); `current` is the main checkout's branch; `remoteBranches` are `origin/*` refs with no local twin (picking one materializes a local base — see §7 `resolveBaseBranch`).
- `project.prep({ projectId }): { pendingKeys: PreparedKey[], findings: ProjectFinding[], prepared: boolean }` — the preparation surface the UI polls (§14); `prepared` is what decides whether the call-to-action shows
- `feature.create({ title, oneLiner, size, baseBranch? }): Feature` — slugify title; resolve `baseBranch` (default `mainBranch`) to a local branch (a remote pick materializes a local tracking branch); git branch `feature/<slug>` forked off it; scaffold docs; phase=`ideation`. Stores the resolved local base; the feature merges back into it at ship (not unconditionally main).
- `feature.list(): FeatureListItem[]` — Feature + ticket counts + activeRun boolean
- `feature.get({ id }): { feature, tickets, sessions, runs, docs: {relPath, title}[], gate: { next: GateDef|null, satisfied: boolean, reason?: string } }`
- `feature.launchSession({ featureId, kind, kickoffLine? }): { sessionId }` (B1 behavior; `kickoffLine` replaces the per-kind opening briefing for one session)
- `feature.resendKickoff({ sessionId }): { line: string }` — re-type that session's briefing into its terminal (ADR-0009; backs the session strip's **Send briefing** when delivery was never confirmed)
- `feature.advance({ featureId }): Feature` — attempt gate → next phase (server-side check; error with reason if unsatisfied). Refuses G3 (tickets→implementation): that human "Burn" gate is crossed only by `feature.burn` or `overrideGate` (see C3).
- `feature.overrideGate({ featureId, gate, reason }): Feature` — records override + advances (may cross any gate, incl. G3)
- `feature.burn({ featureId }): { runId }` — G3, the ONLY plain-crossing of it: requires phase `tickets` + ≥1 ticket; sets phase `implementation`; `runner.startRun(...,'ticket-burner')`. Also accepts phase `implementation` with no active run (cancelled/crashed run) and restarts the burn without re-crossing a gate.
- `feature.testDrive({ featureId, action: 'start'|'stop' }): { ok: boolean, deniedReason?: string, branch?: string }` (B2)
- `feature.merge({ featureId }): { ok: boolean, conflict?: boolean }` (B2; sets phase `shipped` on success)
- `run.get({ runId }): Run`
- `events.list({ featureId, afterId?: number }): EventRow[]` — UI polls this at 1.5s
- `docs.read({ featureId, relPath }): { content: string }`
- `settings.get({ projectId? }): SettingsView` — the scope-resolved settings surface (issue #46). Without `projectId` returns the globals; with one, each field resolved `project ?? global` with `source: env|project|file|default`, `editable` (env-locked → false), `restartRequired` (serverPort), and the `scope` a write targets. Globals live in `~/.runcastle/config.json`; per-project overrides (model, sandbox, devCommand) on project rows.
- `settings.update({ projectId?, key, value }): SettingField` — write a global default (omit `projectId`) or a per-project override (with `projectId`, project-overridable fields only; `value: null` clears it). Env-locked fields are rejected. A global write is write-through: it persists to the config file AND refreshes the in-memory `config` in place, so the next launch/run picks it up with no restart while in-flight work keeps its starting config. Emits `settings.updated`.

## 5. Launcher (B1) — spawning an injected Claude Code terminal

1. Create session row `sess_<id>`, kind per request; ensure talk worktree exists (git service): `worktrees/<projectId>/<slug>` checked out to `feature/<slug>`.
2. Write artifacts to `sessionDir(sessionId)`:
   - `system-prompt.md` — feature brief: title, oneLiner, phase, pipeline explanation, paths (`docs/features/<slug>/`), instruction to begin with the pack's entry skill (`/runcastle:ideate` for kind=ideation; for qa: answer questions, never advance phases), and the MCP tool cheat-sheet.
   - `settings.json` — hooks config (exact JSON shape per docs/research/CC-INTEGRATION-NOTES.md): SessionStart + UserPromptSubmit + SessionEnd, each `type: "command"`, command = `bun run <abs path to hook-client.ts> <event>`, timeout 10.
   - `mcp.json` — `{ "mcpServers": { "runcastle": { "type": "http", "url": "http://localhost:4512/mcp" } } }` (verify exact field names in research notes; if http-type needs headers for session identity, add `X-Runcastle-Session: <sessionId>`).
3. Command (verify flags against research notes; `--append-system-prompt-file` fallback = inline `--append-system-prompt`):
   `claude --settings "<dir>/settings.json" --mcp-config "<dir>/mcp.json" --plugin-dir "<packs>/runcastle" --append-system-prompt-file "<dir>/system-prompt.md" --permission-mode acceptEdits --model <resolved>`
   `--strict-mcp-config` is appended only when `sessionMcp: 'runcastleOnly'` (default `inherit`). The flag means "ignore **all** other MCP configurations", which drops the human's own connections and their plugins' servers along with everything else — so the default keeps runcastle's server merged into the human's existing MCP set rather than replacing it.
4. **Spawn:** the session runs in a server-owned embedded PTY (UI-SPEC §5, cross-platform — no `wt.exe`). `claude` is spawned with `cwd` = talk worktree and `RUNCASTLE_SESSION_ID` / `RUNCASTLE_SERVER_URL` inherited directly onto the process env; the PTY is registered by session id and streamed to the in-app xterm view over `/ws/terminal/:sessionId`. (The legacy `window` launch mode + its `wt.exe -w 0 nt … cmd /k` command line is removed — see CONTEXT.md decision 13.)
5. `hook-client.ts` (runs inside session): reads stdin JSON, POSTs `{ event, env: { sessionId: RUNCASTLE_SESSION_ID }, payload }` to `RUNCASTLE_SERVER_URL/api/hooks/<event>`, prints the server's JSON response verbatim to stdout, exit 0. 3s fetch timeout; on any error print `{}` and exit 0 (never break the user's session).
6. `/api/hooks/session-start`: mark session live, store `ccSessionId` + `transcriptPath` from payload; respond with the context-injection JSON (exact shape per research notes) carrying: feature brief digest + current phase + "call get_feature_context for detail".
   `/api/hooks/user-prompt`: respond injecting one compact line: `[runcastle] feature=<slug> phase=<phase> tickets=<n>`. `/api/hooks/session-end`: mark ended.

## 6. MCP server (B1) — 4 tools, zod-validated

Mounted at `POST /mcp` (Streamable HTTP; use @hono/mcp if STACK-NOTES confirms, else raw SDK transport). Session identity: prefer header from mcp.json; fallback: singleton "most recent live session" (M1 has one live ideation session at a time — acceptable, note it).

1. `get_feature_context() → { feature, phase, docs: {relPath, content}[], tickets: Ticket[] }`
2. `emit_tickets({ tickets: TicketInput[] }) → { stored: number, ids: string[] }` — validates + stores via `storeTickets`, which emits the single event `tickets.stored` (one mutation → one event; see C3)
3. `record_event({ type, message }) → { ok }` — timeline note from the session (decisions recorded, spec saved, etc.)
4. `complete_phase({ phase }) → { ok, nextPhase, waitingOn? } | { ok: false, reason }` — runs gate check server-side and advances (same code path as `feature.advance`), EXCEPT it never crosses G3: completing the `tickets` phase records the work done and returns `{ ok: true, nextPhase: 'implementation', waitingOn: 'human burn' }` without advancing (the human Burn click is the crossing). See C3.

## 7. Git service (B2) — `services/git.ts`, use `simple-git`

- `assertRepo(repoPath)`, `detectMainBranch(repoPath)`
- `createFeatureBranch(project, slug, base?)` → branch `feature/<slug>` from `base` (default `project.mainBranch`; must be an existing local branch) (no checkout of main working dir)
- `listBranches(project)` → `{ current, mainBranch, branches, remoteBranches }` — local branches + remote-only `origin/*` refs (`feature/*` excluded) for the `project.branches` base picker
- `resolveBaseBranch(project, base)` → local branch name — passes a local branch through; materializes a local tracking branch for a remote-tracking pick (`origin/<name>` → local `<name>`, reusing an existing local one); throws if neither exists. Keeps the stored base a real merge target.
- `ensureTalkWorktree(project, feature) → worktreePath` — `git worktree add <dataDir path> feature/<slug>`; reuse if exists; prune stale on failure and retry once
- `commitDocs(worktreePath, message)` — stage `docs/features/<slug>` only, commit if changes (used by MCP complete_phase to checkpoint knowledge)
- Test drive (in-memory module state: `{ active?: { featureId, previousBranch } }`):
  - `start`: deny (with reason) if: main checkout dirty (`status --porcelain` non-empty) | another test drive active | feature has an active run. Else record current branch, `checkout feature/<slug>`, return ok. If `project.devCommand` set, spawn it in a drive-owned embedded PTY pane (registry id `drive:<featureId>` — a NON-session id, so session guards / resume never touch it) via a generalized shell/cmd shim; sniff the first localhost URL from its output for the "Open app" link (sticky per drive). Best-effort — a spawn failure never fails the drive.
  - `stop`: checkout `previousBranch`, clear state, and kill the dev pane's whole process tree (POSIX process-group signal / Windows ConPTY teardown) so its port is freed with no orphan; the sniffed URL is cleared. Two reports, because a stop is not symmetric with a start: `carriedChanges` names the uncommitted files git carries across the switch (`start` denies a dirty tree; `stop` cannot without stranding the user), and `dbDrift` fires when migration-looking paths differ between the two branches — the drive applied schema the dev database still holds, so the next `migrate` on `previousBranch` reports drift with nothing tying it back. Carries `project.dbResetCommand` when set; it is offered, NEVER run automatically (a dev database can hold hand-built state).
  - `activeDriveInfo()` → `{ featureId, branch, devPaneId?, devUrl? } | null` for the review-phase dev pane + Open app link (polled via `feature.driveInfo`).
- `mergeFeature(project, feature)`: target = `feature.baseBranch ?? mainBranch` (a feature lands back on the branch it forked from). Deny if test drive active, checkout dirty, or target branch gone. Record the pre-merge branch → `checkout target` → `merge --no-ff feature/<slug>` → on conflict `merge --abort`, return `{ ok: false, conflict: true, target }` + event; on success return `{ ok: true, target }` (caller sets phase shipped, emits event). Restore the pre-merge branch after (best-effort; detached HEAD left as-is) so the shared checkout isn't silently parked on the base.

## 8. Ticket burner (B3) — `workflows/ticket-burner.ts` + `@ai-hero/sandcastle`

Consult docs/research/SANDCASTLE-NOTES.md for exact `run()` API (branch targeting, merge-back, cwd, streaming). Requirements:

- Topo-order tickets by `blockedBy`; detect cycles → fail run with event. Process queue with `concurrency = 1` (M1) but code shaped as a worker pool so M2 raises the constant.
- Per ticket: status `burning` + event → render prompt from `packages/skills/burner/implement-ticket.md` template (placeholders: ticket JSON, feature brief, docs digest, commit convention `ticket(<seq>): <summary>`) → `sandcastle.run()` with: claudeCode(config.model), sandbox from config (`docker()` | `noSandbox()`), repo = project.repoPath, work on branch `feature/<slug>` (per sandcastle's branch strategy; commits must land on the feature branch) → on success: collect `result.commits`, status `done` + event; on failure/zero-commits: status `failed`, event with error, **continue** with other non-blocked tickets.
- Landing (ADR-0007): each ticket lands through the run's serial merge queue. A landing conflict is NOT a ticket outcome — the burner runs a resolver agent (`packages/skills/burner/resolve-conflict.md`, same ticket + feature-docs context, plus the conflicting paths and the sibling commits) on the ticket's branch, which merges the feature branch IN and resolves there so the next merge fast-forwards; bounded by `config.burnConflictAttempts`. Only when that budget is spent does the ticket fail, carrying `attemptBranch` + `conflictFiles` — the state that makes the next burn of it resolve rather than re-implement.
- Auth, per runtime: a Claude Code burn loads `~/.runcastle/.env` (CLAUDE_CODE_OAUTH_TOKEN) into the sandbox env per sandcastle's mechanism; a Codex burn borrows the operator's own login instead, bind-mounting the host Codex home read-only and copying `auth.json` into the container's Codex home on sandbox-ready (a `CODEX_API_KEY` left in `~/.runcastle/.env` by hand is still passed through and wins). If the runtime's credential is missing and sandbox=docker → fail fast with actionable event, per run and per ticket.
- Run summary: `X/Y tickets done`. Succeeded iff all done. After run: server auto-advances to `review` if G4 satisfied.
- The burner prompt embeds our forked implement+tdd+code-review discipline (single agent run per ticket does implement→self-review→fix→commit; M1 has no separate review run).

## 9. packages/skills — packs/runcastle (A2)

Plugin dir consumed via `--plugin-dir` (exact manifest format per CC-INTEGRATION-NOTES). Skills are FORKS of `upstream/` (keep provenance header comment in each). All are `disable-model-invocation: false` so the system prompt can direct invocation, and all speak our MCP tools:

- `ideate` (entry): orchestrates the unbroken ideation session: relentless grilling (fork of grilling/grill-with-docs) writing `docs/features/<slug>/decisions.md` incrementally → size branch: full → `/runcastle:spec` then `/runcastle:tickets`; collapsed → `/runcastle:tickets` directly. Calls `record_event` at milestones, `complete_phase` at each boundary, and ends after emit_tickets telling the user to review tickets in the runcastle UI and click Burn.
- `spec` (fork of to-spec): writes `docs/features/<slug>/spec.md`, calls `complete_phase({phase:'spec'})`.
- `tickets` (fork of to-tickets): vertical slices, each sized to **earn** one fresh agent session and land inside it (the per-ticket container + install + re-orientation is fixed overhead — ADR-0008 — and a ticket that overruns pays it again, so fine granularity lives in `acceptanceCriteria`, not in the ticket count), blockedBy edges by seq; calls `emit_tickets` (NOT files), then `complete_phase({phase:'tickets'})`.
- `qa`: read-only helper for kind=qa sessions (answer questions from docs + code; may `record_event`; never advances phases).
- `burner/implement-ticket.md`: NOT a skill — prompt template (see §8) embedding forked implement+tdd+code-review rules: pre-agreed seams from ticket, red-green per criterion, typecheck+tests before commit, conventional message.

## 10. apps/web (A3) — minimal but honest UI

Vite + React + @trpc/react-query + TanStack Query v5, plain CSS (one stylesheet, dark). Poll `events.list` + `feature.get` with `refetchInterval: 1500`. Pages (react-router or simple state routing — keep trivial):

- **Home**: project init form (repoPath input) if none; else feature list (title, phase badge, ticket counts, active-run pulse) + "New feature" dialog (title, oneLiner, size toggle) → navigates to feature page.
- **Feature page**: phase stepper with gate state (+ Advance / Override-with-reason controls); Sessions card ("Open ideation terminal" / "Open Q&A terminal" buttons → `feature.launchSession`; show live/ended); Knowledge card (docs list, click to read in modal via `docs.read`); Tickets table (seq, title, status chip, blockedBy, commits count, error tooltip); **Burn** button (enabled when gate G3 satisfiable: phase=tickets & tickets>0); Run panel (status + streaming event log, newest last, auto-scroll); **Test drive** start/stop with denial reasons surfaced; **Merge** button (review phase) with conflict error surfacing; Timeline (all events).

## 11. Testing + definition of done

- Vitest: core (pipeline nextPhase/gate data, ticket seq/blockedBy resolution, topo-sort incl. cycle), server services against in-memory sqlite (`:memory:`), git service against a temp fixture repo (init, branch, worktree, test-drive guard, merge + conflict case). No UI tests in M1.
- `bun run typecheck` green across workspace; `bun run test` green.
- Scripted smoke (`scripts/smoke.ts`, integration agent writes/runs): temp target repo (git init + tiny bun app + initial commit) → project.init → feature.create → simulate hooks POST session-start → call MCP emit_tickets with 2 trivial tickets → feature.burn with `{sandbox:'noSandbox', model: smokeModel}` → expect commits on feature branch + tickets done → testDrive start/stop → merge → phase shipped. (noSandbox runs claude on host — trivial tickets like "add HEALTH.md with the word ok" keep it cheap/safe.)
- Demo (docker sandbox) follows as task #7.

## 12. Conventions for all agents

- Bun everywhere (`bun add`, `bunx`); never npm/yarn/pnpm. TS strict; no `any` unless quarantined with a comment.
- Never touch files outside your assigned dirs (§3 ownership). NotImplementedError stubs are wave-B sockets — replace, don't redesign.
- Windows paths: always `node:path` (`join`, `resolve`); never hand-concatenate; quote paths in shell commands.
- Every service function that mutates emits an event (events are the UI's lifeblood).
- Commit your own work when done: conventional message `feat(scope): ...` — repo is `runcastle/` itself.
- When docs are needed, use `npx ctx7@latest library/docs` (≤3 calls per question) — do not trust training data for API shapes.

## 13. Mapped ideation (post-M1 — ADR-0001)

Multi-session ideation for features too big for one context window. **Built
after the ship-path fixes and the workspace redesign land** (ADR-0001
sequencing); specified here so names are law when it does. Self-contained:
each item below states its amendment to the M1 sections explicitly.

### 13.1 Core amendments (§1)

- `src/schemas.ts` additions:
  - `WaypointType = z.enum(['grilling','research','prototype','task'])`
  - `WaypointStatus = z.enum(['open','claimed','resolved','dropped'])`
  - `WaypointInput { title: string, type: WaypointType, question: string, blockedBy: number[] /* seq refs within batch */ | string[] /* existing waypoint ids */, originWaypointId?: string }`
  - `Waypoint` = WaypointInput + `{ id, featureId, seq: number, status: WaypointStatus, claimedBy?: string /* sessionId | runId */, lastSessionId?: string, summary?: string }`
  - `Feature` gains `mapped: boolean` (default false; set by creation toggle or `escalate_to_map`; independent of `size`).
  - `SessionKind` gains `'waypoint' | 'converge'`.
- `src/pipeline.ts`: G1's check becomes conditional on `feature.mapped`:
  `decisions-file-exists` (unmapped, unchanged) | `all-waypoints-terminal`
  (mapped: every waypoint `resolved` or `dropped`). Fog is NOT gate-checked.
  `nextPhase()` unchanged.
- `src/db-schema.ts`: new `waypoints` table mirroring the schema; `blockedBy`
  + lineage as JSON columns like tickets.
- `src/workflow.ts`: `WorkflowCtx` gains `input?: unknown` (per-run payload —
  the research waypoint) and `resolveWaypoint(id: string, disposition: 'resolved'|'dropped', summary: string): void`.

### 13.2 Server amendments (§3, §4)

- New `services/waypoints.ts` (owner: the mapped-ideation feature): `storeWaypoints` (seq assign + blockedBy resolve + cycle rejection — same algorithm as `storeTickets`), `listByFeature`, `claim(id, claimedBy)` (transactional; fails if not open/frontier), `release(id)` (back to open, keeps `lastSessionId`), `resolve(id, disposition, summary)`, `frontier(featureId)` (derived: open ∧ unclaimed ∧ all blockers terminal — never stored). `resolve` emits `waypoint.resolved` plus one `waypoint.unblocked` event per newly-freed waypoint.
- Session-end hook + run finalizer: auto-release any waypoint still claimed by the ending session/run.
- New `workflows/research.ts`: `research` WorkflowDef registered alongside `ticket-burner`. Sandcastle run (same auth/sandbox config as §8) with prompt from `packages/skills/burner/research-waypoint.md`; the sandbox agent reads the waypoint question, researches (web + repo), writes `docs/features/<slug>/research/<waypoint-slug>.md`, commits to the feature branch; the workflow then calls `ctx.resolveWaypoint`.
- tRPC additions (§4):
  - `feature.create` input gains `mapped?: boolean`.
  - `feature.get` response gains `waypoints: Waypoint[]` + `frontierIds: string[]` when mapped.
  - `feature.workWaypoint({ featureId, waypointId }): { sessionId } | { runId }` — claims first (error if not on frontier), then spawns terminal (grilling/prototype/task → kind=`waypoint`) or starts the `research` run.
  - `feature.converge({ featureId }): { sessionId }` — requires G1 satisfiable (or override); spawns kind=`converge` terminal.

### 13.3 MCP amendments (§6) — 3 new tools (7 total)

5. `escalate_to_map({ destination, notes }) → { ok }` — sets `mapped`, scaffolds `map.md` (Destination/Notes from args; empty Not-yet-specified / Out-of-scope), emits event. Idempotent warning if already mapped.
6. `emit_waypoints({ waypoints: WaypointInput[] }) → { stored: number, ids: string[] }` — via `storeWaypoints`; available to every session once mapped (recursion: any session may branch the map).
7. `resolve_waypoint({ id, disposition: 'resolved'|'dropped', summary }) → { ok }` — prose answer goes to `decisions.md` (dropped: gist to `map.md` Out-of-scope) by direct file write in the session; this tool flips machinery only.

`get_feature_context` response gains `waypoints` + `frontier` when mapped.
Claiming is NEVER agent-callable — it is a spawn-time server side effect.

### 13.4 Knowledge amendments

`docs/features/<slug>/map.md` scaffolded by `escalate_to_map` (or at create
when the toggle is set): `## Destination`, `## Notes`, `## Not yet specified`,
`## Out of scope`. Prose sections are edited by sessions via direct file
writes (serial HITL makes this race-free); resolutions accumulate in the
existing `decisions.md`. `research/` subdirectory holds research waypoint
summaries.

### 13.5 Skills amendments (§9)

- `ideate` gains the escalation branch: when the feature outgrows the window
  (rabbit holes, decisions hanging on unread material), call
  `escalate_to_map`, `emit_waypoints` for the first batch, tell the user the
  map is charted, and END the session (charting is one session's work).
- New `waypoint` (entry for kind=waypoint): read map + assigned question from
  injected context; mode by type (grill / prototype fork / task checklist);
  write `decisions.md` + `map.md` directly; may `emit_waypoints`; ends with
  `resolve_waypoint`.
- New `converge` (entry for kind=converge): read `map.md` + `decisions.md`
  ONLY (not transcripts), then run `/runcastle:spec` → `/runcastle:tickets`
  unbroken (decision 9 relocated here).
- New `burner/research-waypoint.md` prompt template (see §13.2).

### 13.6 UI amendments (§10)

`GrillBody` mapped variant: destination line; waypoint groups — frontier
(Work button each), blocked (greyed, blocker *names*), claimed (live pulse;
Resume when `lastSessionId`), resolved/dropped (collapsed count); fog rendered
from `map.md`; Converge button when G1 satisfiable, remaining fog shown as a
soft warning beside it. `NewFeatureForm`: start-mapped toggle. Lineage shown
as one line per waypoint ("surfaced by <name>"); tree view deferred. No new
routes, no new polling.

### 13.7 Tests

Vitest: waypoint seq/blockedBy resolve + cycle rejection (shared with ticket
tests), frontier derivation (blocked→freed on resolve AND on drop), claim
transactionality (double-claim fails), auto-release on session end, G1
conditional check both modes. Smoke extension: escalate → emit 2 waypoints
(one blocking the other) → resolve both → converge gate satisfiable.

## 14. Project preparation — `services/prep.ts` + the `prepare` session

**Why.** `verifyCommands`, `knownFailures` and `setupCommand` sit empty on
almost every install, and not because the form is unfriendly: they are
*findings*, not preferences. Answering "which tests are already red on main"
means running the suite; answering "how do I verify a change here" means knowing
the workspace filter names. That is agent work, and today every burn agent pays
it per ticket and throws it away (ADR-0008: two whole monorepo suite runs lost
to guessing one filter name). Preparation pays it once, with evidence.

**Prepared keys** (`PREPARED_KEYS`, core): `setupCommand`, `verifyCommands`,
`knownFailures`, `devCommand`, `dbResetCommand`. Each is a column on `projects`;
the first three also have a global config twin resolved `project ?? global` via
`resolvePreparedSettings` (they describe a REPO, so a machine-wide value is
wrong as soon as a second project is open). `dbResetCommand` is project-only.

**Storage.** Values live in the project columns, so every existing reader —
settings resolution, the burner, the launcher — is unchanged. `project_findings`
(PK `project_id,key`) carries provenance only: `source` (`session|human`),
`evidence`, `established_at`, `established_sha`.

**Rules.**
- **Always interactive.** Preparation is a `prepare` SESSION on the human's own
  machine (`project.talkToPrep`), and only that. It had a headless twin that
  measured the repo in a sandbox with nobody watching; that is gone. The run was
  minutes behind a spinner with nothing to look at, and the keys it could never
  settle alone — the dev server, the local database, credentials — are the ones
  a single direct question resolves. Asking beats guessing, and asking needs
  someone there.
- **Measured, not inferred.** The brief requires the agent to RUN what it
  proposes. Reading `package.json` would automate the same guess, earlier. On
  the host it can run every key, including the five that describe this machine.
- **A human value is never overwritten.** No override flag exists. Clearing a
  field drops its provenance and hands it back to preparation — the only way.
  `record_finding({ userSupplied: true })` is what marks a value as theirs.
- **Staleness is measured.** Findings pin to the main-branch sha they were taken
  at; the UI shows `rev-list <sha>..<main>` distance and flags past a threshold.
  An uncomputable distance (rebased-away sha) reports *unknown*, never *fresh* —
  a rotted baseline is worse than none, since agents trust it.

**Lifecycle.** Nothing fires on open. `isPrepared` decides whether the UI asks:
true once `pendingKeys` is empty OR a `prepare` session has run to an end. The
second clause is what stops the prompt becoming wallpaper — some keys are
honestly empty forever ("this repo has no database"), and a permanent nudge is
the noise this surface exists to remove.

**Where it shows (§10).** An unprepared project with no features gets the WHOLE
workspace as the call-to-action — not a card under the new-feature buttons,
which is where it was invisible. Once features exist it demotes to a row pinned
at the bottom of the features rail. It is not in the settings overlay at all.

## 15. Laps (ADR-0010)

Iterative delivery: the pipeline loops until the human merges. One trip is a
**lap**. From review, three verbs: **Fix** (promoted-note tickets burned via
the existing review→implementation loop-back, same lap), **Rethink** (new lap,
back to ideation), **Merge** (unchanged G5). No mode flag exists — a feature
merged on lap 1 is the old linear flow verbatim. Self-contained amendments,
same style as §13.

### 15.1 Core amendments (§1)

- `src/schemas.ts`:
  - `Feature` gains `lap: number` (default 1).
  - `Ticket` gains `lap: number` (stamped from `feature.lap` at store time;
    `TicketInput` unchanged — sessions never choose the lap).
  - `SessionKind` unchanged: the lap session is kind `revisit` (ADR-0010 §5).
- `src/pipeline.ts`: second typed backward transition
  `RETHINK_LOOP_BACK = { from: 'review', to: 'ideation' }` and
  `rethinkPhase(feature): Phase | null` (mirror of `loopBackPhase`).
  `nextPhase`/`nextGate` unchanged. Gate checks: `tickets-approved` (G3) is
  satisfied by ≥1 `pending` ticket **in the current lap**; `all-tickets-
  terminal` (G4) stays cumulative — earlier laps' tickets are terminal by
  construction. G1/G2 untouched (trivially satisfied on laps ≥2; the lap
  starts with its grilling by construction — seatbelt, not cage).
- `src/db-schema.ts`: `lap` integer columns on `features` (default 1),
  `tickets`, `sessions`, `events` — the latter three stamped from the
  feature's lap at row creation. The UI's lap trail is derived by grouping on
  them; there is NO `laps` table (ADR-0010 §8).

### 15.2 Server amendments (§3, §4)

- `services/features.ts` gains `rethink(featureId)`: guards phase=`review` ∧
  no active run; increments `lap`, sets phase `ideation` via
  `RETHINK_LOOP_BACK`, emits `lap.started`.
- Test notes live in `docs/features/<slug>/test-notes.md` (decision-5 seam:
  prose in the repo): one `## Lap N` heading per lap, one `- ` bullet per
  note. Promotion rewrites the bullet in place, appending ` → tkt_<id>`.
- tRPC additions (§4):
  - `feature.rethink({ featureId }): { sessionId }` — calls the service, then
    launches a `revisit` session with the lap kickoff (below). One click, one
    terminal.
  - `feature.testNote({ featureId, text }): { ok }` — appends a bullet under
    the current lap's heading (creates heading/file lazily); emits
    `testnote.added`. Callable any time, not only mid-drive.
  - `feature.promoteNote({ featureId, lap, index }): { ticketId }` — promotes
    the index-th bullet of that lap's section: stores one ticket (title =
    note text, editable client-side before the call via `text?: string`
    override; `lap` = current feature lap) and rewrites the bullet with the
    ticket ref. Emits `testnote.promoted` (the single event for this
    mutation; no separate `tickets.stored`). Rejects already-promoted notes.
  - `feature.burn` G3 wording updated: requires ≥1 pending ticket **in the
    current lap** (both the `tickets`-phase crossing and the review-phase
    Fix restart).
- Kickoff registry: `revisit` gains the `lap` purpose —
  `LAP <n> REVIEW ITERATION`: read `test-notes.md` (previous lap's section)
  + spec `## Later laps`; promoted notes are ALREADY tickets (ids injected —
  never re-emit them); interview the human, update `decisions.md` + spec,
  `emit_tickets` for this lap, `complete_phase` through ideation/spec/tickets
  in this one session. Session-start context injection for a lap revisit
  carries the same: previous lap's notes + promoted-ticket ids + `## Later
  laps` content.

### 15.3 MCP amendments (§6) — no new tools

`get_feature_context` response gains `lap: number`; its `tickets` are the
full history (the `lap` field on each row distinguishes). `complete_phase`
already auto-advances ideation→spec→tickets and still refuses to cross G3 —
the human Burn click stays the crossing, which is exactly the two-click lap.

### 15.4 Knowledge amendments

`test-notes.md` as in §15.2 (created lazily on first note — not scaffolded).
The spec template gains an optional `## Later laps` section: scope
consciously deferred at slicing time; each lap's session reads it alongside
the notes and prunes/promotes entries with the human. `decisions.md`
accumulates as before (a `## Lap N` heading per rethink is convention, not
machinery).

### 15.5 Skills amendments (§9)

- `ideate` gains lap-awareness (the slicing question): ask *how sure is the
  human this is what they want?* Sure/small → spec the whole thing, one lap.
  Unsure/large → recommend a thin lap 1 (walking skeleton of the uncertain
  part, or a sub-feature slice), park the rest in `## Later laps`, and say
  so out loud — the human decides. Orthogonal to the map escalation branch
  (§13.5): mapping is for ideation too big to *think*; laps are for features
  too uncertain to *spec whole*.
- `revisit` gains the lap mode (triggered by the lap kickoff): digest notes →
  amend `decisions.md` + spec (including pruning `## Later laps`) →
  `emit_tickets` → `complete_phase` through tickets → tell the human to Burn.
  Never re-emit promoted tickets.

### 15.6 UI amendments (§10)

- Notes live on the review body's open-work section — the review agent's
  defects and the human's notes as one list, one row anatomy, written with a
  multi-line composer that takes a pasted image (`notes.add`, then the
  screenshot upload route keyed by note id).
- Review bar: two forward decisions — **Merge & ship** and **Iterate**
  (decision 21). Iterate opens the triage step over every open note and defect
  (one Quick fix checkbox per row, unchecked); everything ticked mints tickets
  through `notes.triage`, and anything left is carried into lap N+1's
  conversation (`feature.rethink`). With nothing open the step is skipped and
  the lap starts empty-handed. "Fix" survives as a capability — a triage that
  ticks everything burns without a conversation — but is no longer a bar verb.
- Burn labels say whose tickets they burn when laps mix (decision 28a).
- Lap trail: phase stepper gains a "Lap N" chip when `lap > 1`; the review
  page's status strip carries the lap chip and its story (decision 27a — the
  standing lap banner is gone); the timeline groups by lap (derived — no new
  endpoints, no new polling).

### 15.7 Tests

Vitest: `rethinkPhase` transition; `rethink` service (lap increment, guard
against active run / wrong phase); G3 lap-scoping (lap-1 done tickets do not
satisfy lap 2); ticket lap-stamping; `testNote` append + lazy heading;
`promoteNote` (ticket stored with current lap, bullet rewritten, double-
promotion rejected). Smoke extension: burn lap 1 → testNote → promoteNote →
Fix burn → rethink (lap=2, phase=ideation) → lap session emits 1 ticket →
burn → merge.
