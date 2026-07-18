# Runcastle M1 — Implementation Spec

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
- Root scripts: `bun run dev` (server + web concurrently), `bun run typecheck` (tsc -b or per-package `tsc --noEmit`), `bun run test` (vitest).
- Ports: server **4512**, web dev **4513** (vite `server.port`). Server URL: `http://localhost:4512`.
- Data dir: `~/.runcastle/` → `runcastle.db`, `config.json`, `.env` (CLAUDE_CODE_OAUTH_TOKEN for sandboxed agents), `sessions/<sessionId>/` (launch artifacts), `worktrees/<projectId>/<slug>/` (talk worktrees), `logs/`.

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
  - `Feature { id, projectId, slug, title, oneLiner, size, phase, branch, status: 'active'|'shipped', createdAt }`
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
- `src/config.ts` — `RuncastleConfig` zod (defaults): `{ serverPort: 4512, model: 'claude-opus-4-8', smokeModel: 'claude-haiku-4-5-20251001', sandbox: 'docker'|'noSandbox' (default 'docker'), mainBranch: 'main' }`, loader merging `~/.runcastle/config.json` + env.

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
- `project.init({ repoPath: string }): Project` — validates it's a git repo; stores mainBranch, optional devCommand later via `project.update({ devCommand? })`
- `feature.create({ title, oneLiner, size }): Feature` — slugify title; git branch `feature/<slug>`; scaffold docs; phase=`ideation`
- `feature.list(): FeatureListItem[]` — Feature + ticket counts + activeRun boolean
- `feature.get({ id }): { feature, tickets, sessions, runs, docs: {relPath, title}[], gate: { next: GateDef|null, satisfied: boolean, reason?: string } }`
- `feature.launchSession({ featureId, kind }): { sessionId }` (B1 behavior)
- `feature.advance({ featureId }): Feature` — attempt gate → next phase (server-side check; error with reason if unsatisfied). Refuses G3 (tickets→implementation): that human "Burn" gate is crossed only by `feature.burn` or `overrideGate` (see C3).
- `feature.overrideGate({ featureId, gate, reason }): Feature` — records override + advances (may cross any gate, incl. G3)
- `feature.burn({ featureId }): { runId }` — G3, the ONLY plain-crossing of it: requires phase `tickets` + ≥1 ticket; sets phase `implementation`; `runner.startRun(...,'ticket-burner')`. Also accepts phase `implementation` with no active run (cancelled/crashed run) and restarts the burn without re-crossing a gate.
- `feature.testDrive({ featureId, action: 'start'|'stop' }): { ok: boolean, deniedReason?: string, branch?: string }` (B2)
- `feature.merge({ featureId }): { ok: boolean, conflict?: boolean }` (B2; sets phase `shipped` on success)
- `run.get({ runId }): Run`
- `events.list({ featureId, afterId?: number }): EventRow[]` — UI polls this at 1.5s
- `docs.read({ featureId, relPath }): { content: string }`

## 5. Launcher (B1) — spawning an injected Claude Code terminal

1. Create session row `sess_<id>`, kind per request; ensure talk worktree exists (git service): `worktrees/<projectId>/<slug>` checked out to `feature/<slug>`.
2. Write artifacts to `sessionDir(sessionId)`:
   - `system-prompt.md` — feature brief: title, oneLiner, phase, pipeline explanation, paths (`docs/features/<slug>/`), instruction to begin with the pack's entry skill (`/runcastle:ideate` for kind=ideation; for qa: answer questions, never advance phases), and the MCP tool cheat-sheet.
   - `settings.json` — hooks config (exact JSON shape per docs/research/CC-INTEGRATION-NOTES.md): SessionStart + UserPromptSubmit + SessionEnd, each `type: "command"`, command = `bun run <abs path to hook-client.ts> <event>`, timeout 10.
   - `mcp.json` — `{ "mcpServers": { "runcastle": { "type": "http", "url": "http://localhost:4512/mcp" } } }` (verify exact field names in research notes; if http-type needs headers for session identity, add `X-Runcastle-Session: <sessionId>`).
3. Command (verify flags against research notes; `--append-system-prompt-file` fallback = inline `--append-system-prompt`):
   `claude --settings "<dir>/settings.json" --mcp-config "<dir>/mcp.json" --strict-mcp-config --plugin-dir "<packs>/runcastle" --append-system-prompt-file "<dir>/system-prompt.md" --permission-mode acceptEdits`
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
- `createFeatureBranch(project, slug)` → branch `feature/<slug>` from mainBranch (no checkout of main working dir)
- `ensureTalkWorktree(project, feature) → worktreePath` — `git worktree add <dataDir path> feature/<slug>`; reuse if exists; prune stale on failure and retry once
- `commitDocs(worktreePath, message)` — stage `docs/features/<slug>` only, commit if changes (used by MCP complete_phase to checkpoint knowledge)
- Test drive (in-memory module state: `{ active?: { featureId, previousBranch } }`):
  - `start`: deny (with reason) if: main checkout dirty (`status --porcelain` non-empty) | another test drive active | feature has an active run. Else record current branch, `checkout feature/<slug>`, return ok. If `project.devCommand` set, spawn it in a drive-owned embedded PTY pane (registry id `drive:<featureId>` — a NON-session id, so session guards / resume never touch it) via a generalized shell/cmd shim; sniff the first localhost URL from its output for the "Open app" link (sticky per drive). Best-effort — a spawn failure never fails the drive.
  - `stop`: checkout `previousBranch`, clear state, and kill the dev pane's whole process tree (POSIX process-group signal / Windows ConPTY teardown) so its port is freed with no orphan; the sniffed URL is cleared.
  - `activeDriveInfo()` → `{ featureId, branch, devPaneId?, devUrl? } | null` for the review-phase dev pane + Open app link (polled via `feature.driveInfo`).
- `mergeFeature(project, feature)`: deny if test drive active or checkout dirty. `checkout mainBranch` → `merge --no-ff feature/<slug>` → on conflict `merge --abort`, return `{ ok: false, conflict: true }` + event; on success return ok (caller sets phase shipped, emits event). Stay on mainBranch after.

## 8. Ticket burner (B3) — `workflows/ticket-burner.ts` + `@ai-hero/sandcastle`

Consult docs/research/SANDCASTLE-NOTES.md for exact `run()` API (branch targeting, merge-back, cwd, streaming). Requirements:

- Topo-order tickets by `blockedBy`; detect cycles → fail run with event. Process queue with `concurrency = 1` (M1) but code shaped as a worker pool so M2 raises the constant.
- Per ticket: status `burning` + event → render prompt from `packages/skills/burner/implement-ticket.md` template (placeholders: ticket JSON, feature brief, docs digest, commit convention `ticket(<seq>): <summary>`) → `sandcastle.run()` with: claudeCode(config.model), sandbox from config (`docker()` | `noSandbox()`), repo = project.repoPath, work on branch `feature/<slug>` (per sandcastle's branch strategy; commits must land on the feature branch) → on success: collect `result.commits`, status `done` + event; on failure/zero-commits: status `failed`, event with error, **continue** with other non-blocked tickets.
- Auth: load `~/.runcastle/.env` (CLAUDE_CODE_OAUTH_TOKEN) into the sandbox env per sandcastle's mechanism. If missing and sandbox=docker → fail fast with actionable event.
- Run summary: `X/Y tickets done`. Succeeded iff all done. After run: server auto-advances to `review` if G4 satisfied.
- The burner prompt embeds our forked implement+tdd+code-review discipline (single agent run per ticket does implement→self-review→fix→commit; M1 has no separate review run).

## 9. packages/skills — packs/runcastle (A2)

Plugin dir consumed via `--plugin-dir` (exact manifest format per CC-INTEGRATION-NOTES). Skills are FORKS of `upstream/` (keep provenance header comment in each). All are `disable-model-invocation: false` so the system prompt can direct invocation, and all speak our MCP tools:

- `ideate` (entry): orchestrates the unbroken ideation session: relentless grilling (fork of grilling/grill-with-docs) writing `docs/features/<slug>/decisions.md` incrementally → size branch: full → `/runcastle:spec` then `/runcastle:tickets`; collapsed → `/runcastle:tickets` directly. Calls `record_event` at milestones, `complete_phase` at each boundary, and ends after emit_tickets telling the user to review tickets in the runcastle UI and click Burn.
- `spec` (fork of to-spec): writes `docs/features/<slug>/spec.md`, calls `complete_phase({phase:'spec'})`.
- `tickets` (fork of to-tickets): tracer-bullet vertical slices, each sized to one fresh agent session, blockedBy edges by seq; calls `emit_tickets` (NOT files), then `complete_phase({phase:'tickets'})`.
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
