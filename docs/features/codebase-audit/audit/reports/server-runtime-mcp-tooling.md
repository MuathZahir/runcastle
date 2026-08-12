# Audit report — server runtime & MCP tooling (leaf)

Scope: `packages/server/src/mcp/server.ts`, `src/dev/{args,state}.ts`,
`src/doctor/{cli,doctor,report,system-exec}.ts`, `src/bin/runcastle.ts`,
`src/assets/sandcastle/{Dockerfile,Containerfile}`,
`scripts/{build-package,publish-manifest}.ts`, `drizzle/*.sql`.
Cross-referenced (not audited): `packages/skills/**`, `docs/SPEC.md`,
`src/launcher/artifacts.ts`, `src/services/*`, `packages/core/src/*`.

---

## A. Flow map

### A1. MCP tool call (the main flow in this scope)

```
Claude Code session (talk terminal)
  └─ mcp.json  (launcher/artifacts.ts renderMcpConfig — sets X-Runcastle-Session header)
      └─ HTTP POST http://localhost:4512/mcp
          └─ src/index.ts  (mounts /mcp)
              └─ mcp/server.ts:965-982   Hono sub-app
                  ├─ mcp.use('*')        forces `charset=utf-8` on JSON responses (:969-974)
                  └─ mcp.all('*')        builds a FRESH McpServer + StreamableHTTPTransport PER REQUEST (:976-982)
                      └─ buildMcpServer()  mcp/server.ts:683-961 — 14 registerTool calls
                          └─ per-tool handler
                              ├─ resolveCtxSession(extra)         :676-680
                              │    ├─ getRuntimeCtx()             launcher/runtime.ts
                              │    ├─ headerSessionId(extra)      :83-89  (x-runcastle-session)
                              │    └─ resolveSession()            :92-98  → getSessionRow | mostRecentLiveSession
                              ├─ noSession() → isError text        :664-674  (if no session)
                              ├─ tool<Name>(ctx, session, args)   pure-ish impl, :148-656
                              │    ├─ requireFeatureId(session)   :114-126  (GateError refusal)  ── feature half
                              │    └─ requireProject(ctx,session) :362-372  (GateError refusal)  ── project half
                              │         └─ services/{features,tickets,waypoints,findings,events,git,knowledge,repo}
                              │              └─ drizzle → bun:sqlite (~/.runcastle/runcastle.db)
                              ├─ commitDocsCheckpoint()           :334-350  (7 of 14 tools) → services/git.commitDocs
                              └─ ok(result) → JSON.stringify      :660-662
```

Note the *error* leg: any `GateError` / `InvalidInputError` / `NotFound` thrown by a
`tool*` function is **not** caught in `buildMcpServer` — it propagates into the MCP
SDK, which turns it into a protocol-level error. Only `noSession()` produces a
structured `isError` payload. See D3.

### A2. `runcastle doctor` (CLI + pre-boot gate)

```
bin/runcastle.ts:76 main(process.argv.slice(2))
  ├─ applyInstalledAssetEnv(resolve(dirname(fileURLToPath(import.meta.url)), '..'))  :54
  ├─ parseCommand(argv)                      :27-38  (hand-rolled, 4 commands)
  └─ 'doctor' → import('../doctor/cli')      :64-67
       └─ doctor/cli.ts runCli()             :56-64
            ├─ parseMode(argv)               :18-20  (--gate | --boot)
            ├─ resolveDoctorEnv()            :38-53
            │    ├─ createSystemExec({cwd})  doctor/system-exec.ts:17-42 → node:child_process.spawn
            │    ├─ envWithToken()           :23-35  merges ~/.runcastle/.env over process.env
            │    │     └─ parseEnvFile       IMPORTED FROM ../workflows/ticket-burner  ← layering smell (D1)
            │    └─ resolveSandboxImage(loadConfig())
            ├─ runDoctor(env)                doctor/doctor.ts:279-300 — 8 probes, SEQUENTIAL
            ├─ formatReport(report, mode)    doctor/report.ts:32-51
            └─ exitCodeFor(report, mode)     doctor/doctor.ts:309-312
```

Second caller of `runDoctor`, on a different path: `trpc/routers/setup.ts:29` — it
does **not** build a `DoctorEnv` via `resolveDoctorEnv()`, which is E2E finding F1.

### A3. `bun run dev:tool` (dev state surgery)

```
scripts/devtool.ts
  ├─ parseArgs(argv)              src/dev/args.ts:65-143  → DevCommand union
  ├─ needsConfirmation(cmd)       src/dev/args.ts:150-161
  ├─ cmd.kind === 'reset' → resetDataDir()     (before db open)
  ├─ existsSync(dbPath()) guard   devtool.ts:97-101  ← blocks db-free commands (F8)
  ├─ createDb + runMigrations + loadConfig → AppCtx
  └─ run(ctx, cmd)                devtool.ts:112-137 switch
       └─ src/dev/state.ts  removeFeature / removeProject / resetPrep / counts
            ├─ services/git.{removeTalkWorktree,deleteFeatureBranches}
            ├─ raw execFileSync('git', ['worktree','prune'])   state.ts:212-218  ← bypasses the git service (C1)
            └─ drizzle deletes across 7 tables, NO transaction (state.ts:122-128)
```

---

## B. MCP tool drift (the headline)

### B0. The registered set — ground truth from code

All 14 come from `buildMcpServer()` (`packages/server/src/mcp/server.ts:683-961`).
The launcher's permission allowlist `RUNCASTLE_MCP_ALLOW_RULES`
(`packages/server/src/launcher/artifacts.ts:612-630`) lists **exactly these 14** —
allowlist and registry agree; the drift is entirely doc-side.

| # | Tool (`registerTool` line) | zod `inputSchema` | Scope guard | What it does | Emits event? | Docs checkpoint? |
|---|---|---|---|---|---|---|
| 1 | `record_finding` :687 | `{ key: PreparedKey, value: string, evidence?: string, userSupplied?: boolean }` :696-701 | `requireProject` | writes `project_findings` + prepared column; `userSupplied` → source `human` (locks the key) | yes — `prep.finding_recorded` :424 | no |
| 2 | `dry_run_drive` :711 | `{ action: z.enum(['start','status','stop']) }` :724 | `requireProject` **+ `session.kind !== 'prepare'` refusal** :453-460 | runs the real test-drive machinery under synthetic slug `prep-dry-run` | delegated to `git.dryRunDrive` | no |
| 3 | `create_feature` :763 | `{ title: string.min(1), oneLiner: string, baseBranch?, brief?, ticket?: { prose: string.min(1) } }` :746-752 | `requireProject` | `createFeature` or (with `ticket`) `quickChange` | delegated to service | no |
| 4 | `get_project_context` :761 | `{}` :770 | `requireProject` | project row + `CONTEXT.md` + live ADRs + feature index | no (read) | no |
| 5 | `get_work_record` :779 | `{ featureSlug?: string, seam?: string }` :790 | `requireProject` | facts-only ticket/run history; **manual** "at least one required" check :620-622 | no (read) | no |
| 6 | `get_feature_context` :799 | `{}` :805 | `requireFeatureId` | feature + phase + lap + docs + tickets (+ waypoints/frontier/assignedWaypoint when mapped) | no (read) | no |
| 7 | `emit_tickets` :814 | `{ tickets: z.array(TicketInput) }` :820 | `requireFeatureId` | `storeTickets` | yes — `tickets.stored` (in service) | yes :826 |
| 8 | `update_ticket` :831 | `{ id, title?, goal?, context?, acceptanceCriteria?: string[], seams?: string[] }` :837-844 | `requireOwnTicket` | `editTicket` | delegated | yes :850 |
| 9 | `cancel_ticket` :855 | `{ id: string, reason?: string }` :861 | `requireOwnTicket` | `cancelTicket` | delegated | yes :867 |
| 10 | `escalate_to_map` :872 | `{ destination: string, notes?: string }` :878 | `requireFeatureId` | flips `mapped`, scaffolds `map.md` | delegated | yes :887 (skipped on warning) |
| 11 | `emit_waypoints` :893 | `{ waypoints: z.array(WaypointInput) }` :899 | `requireFeatureId` + `feature.mapped` :254-256 | `storeWaypoints` | delegated | **no** ← inconsistent, see D2 |
| 12 | `resolve_waypoint` :908 | `{ id: string, disposition: WaypointDisposition, summary: string }` :914 | `requireFeatureId` | `resolveWaypoint` | delegated | yes :920 |
| 13 | `record_event` :925 | `{ type: string, message: string }` :932 | neither (feature **or** project) | `emitForSession` | yes (that is the tool) | no |
| 14 | `complete_phase` :941 | `{ phase: Phase }` :947 | `requireFeatureId` | gate check + `advance`, parks at G3 | yes — `phase.complete_requested`, `tickets.awaiting_burn` :297,:311 | yes :954 (only when `ok`) |

### B1. `docs/SPEC.md` documents 7 of 14 tools — **7 are entirely undocumented**

- **Violation.** `doc-drift:mcp-tool-surface`. **Confidence: high.**

`docs/SPEC.md:151` — `## 6. MCP server (B1) — 4 tools, zod-validated` — then
`docs/SPEC.md:155-158` numbers exactly 4. `docs/SPEC.md:254` — `### 13.3 MCP
amendments (§6) — 3 new tools (7 total)` — `:256-258` add `escalate_to_map`,
`emit_waypoints`, `resolve_waypoint`. `docs/SPEC.md:418` — `### 15.3 MCP
amendments (§6) — no new tools`. **There is no §16; the file ends at line 470
(`### 15.7 Tests`).** So the spec's arithmetic terminates at **7 total**, while
the server registers **14** — a 100 % overshoot.

The 7 tools with **zero contract in SPEC.md** (verified with a per-name grep over
all repo markdown outside `docs/features/`):

| Tool | SPEC.md mentions | Where it is actually specified |
|---|---|---|
| `update_ticket` | **none** | nowhere — only the skill prompt (`packages/skills/packs/runcastle/skills/revisit/SKILL.md:22`) |
| `cancel_ticket` | **none** | nowhere — only `revisit/SKILL.md:23` |
| `create_feature` | **none** | only `project/SKILL.md:22` + a "decision 19" reference in the code comment (`mcp/server.ts:482`) |
| `get_project_context` | **none** | only `project/SKILL.md:20` |
| `get_work_record` | **none** | only `project/SKILL.md:21` |
| `record_finding` | one **prose** mention, `docs/SPEC.md:339` (`record_finding({ userSupplied: true }) is what marks a value as theirs`) — no signature, no return shape, not in the numbered tool list | `launcher/artifacts.ts:445` (prompt string) |
| `dry_run_drive` | **none** anywhere in `docs/` (only `E2E-FINDINGS.md:176`) | `launcher/artifacts.ts:473` (prompt string) |

CLAUDE.md compounds it: `CLAUDE.md` — `| src/mcp/server.ts | B1 | 4 MCP tools,
zod-validated (§6) |`. Since "names in the spec are law" (CLAUDE.md), a spec that
omits half the surface cannot function as law. **Fix: one §16 "MCP tool surface"
table in SPEC.md, generated from / checked against `buildMcpServer`.** A cheap
guard: a vitest that asserts `buildMcpServer()`'s registered names equal
`RUNCASTLE_MCP_ALLOW_RULES` *and* equal a list parsed out of SPEC — the second
half is what is missing today (the first half already effectively holds).

### B2. `tickets/SKILL.md` re-creates the exact duplicate event the code deleted

- **Violation.** `doc-drift:tickets-emitted-event`. **Confidence: high.**

`packages/server/src/mcp/server.ts:199-201`:
```ts
  // `storeTickets` is the mutation and emits the single `tickets.stored` event
  // (one mutation → one event). This tool used to emit an additional
  // `tickets.emitted` note, which double-logged the same action on the timeline.
```
`packages/skills/packs/runcastle/skills/tickets/SKILL.md:67-68`:
```md
- `mcp__runcastle__emit_tickets({ tickets: [...] })` — **emit the array; do NOT write ticket files.** It returns `{ stored, ids }`.
- `mcp__runcastle__record_event({ type: "tickets.emitted", message: "<n> tickets" })`.
```
The server removed the automatic `tickets.emitted` note *because* it double-logged;
the prompt then instructs the agent to emit it by hand, restoring the double log
(now with a hand-written `<n>` that can disagree with `stored`). Same pattern is
echoed in `docs/SPEC.md:189` ("ends after emit_tickets…"). Either the code comment's
reasoning or the prompt is wrong — they cannot both be right.

### B3. `emit_waypoints` — `originWaypointId` is accepted but undocumented in the tool description, and only one of two callers knows about it

- **Violation.** `doc-drift:emit-waypoints-args`. **Confidence: high.**

Schema accepts it: `packages/core/src/schemas.ts:171-179` includes
`originWaypointId: z.string().optional()` (:177).

The tool's own description, which is what an agent that hasn't read the skill sees
(`packages/server/src/mcp/server.ts:898`):
```
'Each waypoint: title, type (grilling|research|prototype|task), question, blockedBy[] (1-based positions within THIS batch, and/or ids of already-stored waypoints).'
```
— `originWaypointId` is **omitted**.

`packages/skills/packs/runcastle/skills/waypoint/SKILL.md:26` **does** require it:
```md
`mcp__runcastle__emit_waypoints({ waypoints: [...] })` — each with `title`, `type`, `question`, `blockedBy` … and `originWaypointId: "<your waypoint id>"` so the lineage ("surfaced by …") is recorded.
```
`packages/skills/packs/runcastle/skills/ideate/SKILL.md:57` (the other caller) omits
it entirely, as does `docs/SPEC.md:257`. Net effect: lineage is recorded from
waypoint sessions and silently lost from ideation sessions, and the tool
description actively teaches the omission.

### B4. Two tools have **no prompt caller anywhere in `packages/skills/`**

- **Judgement call** (deliberate, but a real structural inconsistency).
  `inconsistent:prepare-session-prompt`. **Confidence: high** on the fact,
  **medium** on it being wrong.

A repo-wide grep of `packages/skills/**` for all 14 names returns **zero** hits for
`record_finding` and `dry_run_drive`. `packages/skills/packs/runcastle/skills/`
contains exactly: `converge, ideate, project, qa, revisit, spec, tickets, waypoint`
— there is **no `prepare` skill**. The `prepare` session's entire instruction set
is a hard-coded TypeScript string array in
`packages/server/src/launcher/artifacts.ts:445-485`:
```ts
    '- `record_finding({ key, value, evidence, userSupplied })` — one call per key.',
    …
    'On a yes, `dry_run_drive({ action })` runs it in two halves and you inspect between them:',
```
plus a fragment in `packages/server/src/routes/hooks.ts:261` and another in
`packages/server/src/launcher/edit-guard.ts:72`. So one of nine session kinds keeps
its prompt in TS source rather than in the package that exists to own prompts
(`packages/skills` = "Vendored/forked skill packs … (content only)", CLAUDE.md).
Consequence: prompt edits for `prepare` are code changes needing a rebuild, they are
invisible to anyone reading `packages/skills`, and the `record_finding` guidance now
lives in **three** files that must be kept in sync (`artifacts.ts:445`,
`hooks.ts:261`, `edit-guard.ts:72`).

### B5. `README.md` in the skills pack pins the old 4-tool worldview

- **Violation.** `doc-drift:mcp-tool-surface`. **Confidence: high.** (Same key as B1.)

`packages/skills/packs/README.md:46`:
```md
3. If you are forking an upstream skill, keep the provenance header and rewire its steps to runcastle's MCP tools (`get_feature_context`, `emit_tickets`, `record_event`, `complete_phase`).
```
Verbatim the SPEC §6 four. Anyone forking a skill today is pointed at 4 of 14.

### B6. `get_work_record`'s "at least one argument" rule is a runtime throw, not a schema

- **Violation.** `wrong-tool:zod-validation`. **Confidence: high.**

`packages/server/src/mcp/server.ts:790` declares
`inputSchema: { featureSlug: z.string().optional(), seam: z.string().optional() }`
— i.e. `{}` validates. The real constraint is enforced by hand at `:620-622`:
```ts
  if (!slug && !seam) {
    throw new InvalidInputError('get_work_record needs a featureSlug or a seam to look up')
  }
```
The tool *description* carries the rule in prose (`:789`: "At least one argument is
required."). Zod expresses this natively (`.refine`, or a union of two objects), and
doing so would put the constraint in the schema the MCP client sees instead of only
in an error the agent discovers by failing. Note also the mismatch in behaviour: an
empty-string `featureSlug: ""` passes zod, is `.trim()`-ed to falsy at `:618`, and
lands in the same throw — an argument the client believes it supplied.

### B7. Behaviour drift: `complete_phase` description vs. the G3 branch

- **Judgement call.** `doc-drift:complete-phase-gate`. **Confidence: medium.**

Description (`mcp/server.ts:946`) says completing the tickets phase returns
`{ ok: true, nextPhase: "implementation", waitingOn: "human burn" }`. The code
(`:308-317`) branches on **`nextGate(feature)?.id === 'G3'`**, not on
`input.phase === 'tickets'`, and computes `nextPhase(feature) ?? 'implementation'`.
So the returned `nextPhase` is whatever the pipeline says next is, and the branch
fires whenever the feature's *current* gate is G3 regardless of the `phase`
argument. Worse: **`input.phase` is otherwise never used for anything but the event
message** (`:299-300`) — an agent calling `complete_phase({ phase: 'spec' })` while
the feature actually sits at `tickets` gets the G3 park, and an agent calling
`complete_phase({ phase: 'ideation' })` on a feature at `spec` advances the *spec*
phase. The parameter reads like a target but behaves like a label. Either validate
`input.phase === feature.phase` (returning `{ ok: false, reason }` otherwise) or
drop the parameter.

### B8. `qa/SKILL.md` forbids tools the server would refuse anyway — and one it would not

- **Judgement call.** `doc-drift:qa-tool-guard`. **Confidence: medium.**

`packages/skills/packs/runcastle/skills/qa/SKILL.md:20-21`:
```md
- **Never advance a phase.** No `complete_phase`. This session has no gates to cross.
- **Never emit tickets.** No `emit_tickets`.
```
Both are prompt-only prohibitions: a `qa` session has a `featureId`, so
`requireFeatureId` (`mcp/server.ts:114-126`) passes and both tools would execute.
Every other refusal in this file is enforced server-side (`requireProject`,
`requireFeatureId`, `requireOwnTicket`, the `prepare`-only check at `:453-460`);
`qa` is the one kind whose restriction is honour-system. Given `dry_run_drive`
already demonstrates the `session.kind` guard pattern (`:453`), a read-only kind
should be enforced the same way.

---

## C. Redundancy & repeated logic

### C1. `git worktree prune` is implemented four times, two different ways

- **Violation.** `redundant:worktree-prune`. **Confidence: high.** Effort S.

Via `simple-git` inside the git service:
- `packages/server/src/services/git.ts:380` — `await g.raw(['worktree', 'prune'])`
- `packages/server/src/services/git.ts:695` — `await g.raw(['worktree', 'prune'])`
- `packages/server/src/services/git.ts:1233` — `await g.raw(['worktree', 'prune'])`

Via raw `node:child_process` in the dev tool, in a module that already
`import * as git from '../services/git'` (`state.ts:18`):
- `packages/server/src/dev/state.ts:212-218`
```ts
export function pruneWorktrees(repoPath: string): void {
  try {
    execFileSync('git', ['-C', repoPath, 'worktree', 'prune'], { stdio: 'ignore' })
  } catch { … }
}
```
Two callers already exist for a `git.pruneWorktrees(repoPath)` export (three, if the
service's own three sites are folded in), so this is a **real seam**, not a
hypothetical one. It is also the only place in `src/dev/` that shells out to git
directly rather than through the service, which is exactly the inconsistency a
reader would not predict from the file's own doc comment.

### C2. Container-runtime detection is done twice per doctor run

- **Judgement call.** `redundant:container-runtime-detect`. **Confidence: high.**
  Effort S, risk low.

`packages/server/src/doctor/doctor.ts:174` and `:190` probe `docker --version` /
`podman --version` inside `containerRuntimeProbe`; `sandcastleImageProbe` then does
it **again** at `:227-229`:
```ts
  for (const runtime of ['docker', 'podman'] as const) {
    const present = await exec(runtime, ['--version'])
    if (!(present.ok && present.code === 0)) continue
```
On a machine with neither runtime that is 4 spawns to learn one fact; on a
docker machine, 2. Extract `detectRuntime(exec): Promise<'docker'|'podman'|null>`
and pass the answer to the image probe — two callers, real seam, and it also fixes
the latent bug in D5.

### C3. `commitDocsCheckpoint` is called from 7 tool handlers with a bespoke message each

- **Judgement call.** `redundant:mcp-docs-checkpoint`. **Confidence: medium.**
  Effort S.

`mcp/server.ts:826, 850, 867, 887, 920, 954` each repeat
`await commitDocsCheckpoint(rs.ctx, rs.session, '…')`, and the *decision* about
which tools checkpoint is scattered across the 14 registrations rather than stated
once. See D2 for the inconsistency this scattering has already produced.

---

## D. Inconsistencies & structural smells

### D1. `doctor/cli.ts` imports a generic env parser from the 2 245-line burner workflow

- **Violation.** `layering:parse-env-file`. **Confidence: high.** Effort S, risk low.

`packages/server/src/doctor/cli.ts:5`:
```ts
import { parseEnvFile } from '../workflows/ticket-burner'
```
`ticket-burner.ts` is the AFK burn workflow (SPEC §8, owner B3). Importing it pulls
that whole module graph into the *pre-boot prerequisite gate* — the one code path
that must run when the machine is least healthy, and the one that runs before
anything else does. `parseEnvFile` is a pure string→map function with no burner
semantics; it belongs in `packages/core` (which already owns `config.ts`/`paths.ts`)
or a `src/util/env-file.ts`. Two callers exist (the burner and the doctor), so the
seam is real.

### D2. `emit_waypoints` is the one mutating docs-touching tool with no docs checkpoint

- **Judgement call.** `inconsistent:mcp-docs-checkpoint`. **Confidence: medium.**

Compare `mcp/server.ts:893-906` with its immediate neighbours:
```ts
      return ok(toolEmitWaypoints(rs.ctx, rs.session, args))     // :904 — no checkpoint
```
vs. `escalate_to_map` (`:887`), `resolve_waypoint` (`:920`), `emit_tickets` (`:826`),
`update_ticket` (`:850`), `cancel_ticket` (`:867`), `complete_phase` (`:954`) — all
call `commitDocsCheckpoint`. `emit_tickets` and `emit_waypoints` are the same shape
of operation (batch-store rows on the current feature) and are treated differently
with no comment explaining why. Either it is a deliberate asymmetry that wants one
line of prose, or it is an omission.

### D3. Only `noSession` returns a structured tool error; every domain refusal escapes as a thrown exception

- **Judgement call.** `inconsistent:mcp-error-shape`. **Confidence: high.**
  Effort M, risk medium (changes what agents see).

`mcp/server.ts:664-674` builds the one well-shaped error:
```ts
function noSession(): CallToolResult {
  return { content: [{ type: 'text', text: 'No active runcastle session…' }], isError: true }
}
```
Every other refusal — `GateError` from `requireFeatureId` (:121), `requireProject`
(:363), `requireOwnTicket` (:214), the unmapped-feature guard (:255), the
`prepare`-only guard (:455) and `InvalidInputError` (:621) — is **thrown** out of
the handler with no try/catch anywhere in `buildMcpServer`. The MCP SDK converts
those to protocol errors whose text is whatever `Error.message` happens to be. The
careful, agent-directed refusal prose written at `:118-123` ("Your tools are
create_feature, get_project_context…") is therefore delivered through a *different*
channel and a different shape than `noSession`'s. One `withToolErrors(fn)` wrapper
that catches `GateError | InvalidInputError` and returns `{ isError: true, content:
[…] }` would make all 14 tools speak one dialect — and would also stop a genuine
internal exception (a drizzle error, a missing file) from being indistinguishable
from a deliberate refusal.

### D4. Repeated `resolveCtxSession` + `noSession` preamble in all 14 registrations

- **Judgement call.** `redundant:mcp-handler-preamble`. **Confidence: high.**
  Effort S, risk low.

Every handler is the same 3 lines (`:703-707, :725-730, :754-758, :772-776,
:792-796, :807-811, :822-828, :846-852, :863-869, :880-890, :900-905, :917-922,
:934-938, :950-957`):
```ts
    async (args, extra) => {
      const rs = await resolveCtxSession(extra)
      if (!rs) return noSession()
      return ok(<impl>(rs.ctx, rs.session, args))
    },
```
A single `registerSessionTool(server, name, meta, impl)` helper would concentrate
session resolution, the no-session refusal, error shaping (D3) and the docs
checkpoint (C3/D2) in one place, and would make "does this tool checkpoint docs?" a
declared field rather than a fact you learn by reading 14 handlers. This is the
strongest deepening opportunity in the scope (see G1).

### D5. `sandcastleImageProbe` gives up on podman whenever docker exists

- **Violation** (latent bug). `latent-bug:sandcastle-image-probe`. **Confidence: high.**
  Effort S.

`packages/server/src/doctor/doctor.ts:227-242`:
```ts
  for (const runtime of ['docker', 'podman'] as const) {
    const present = await exec(runtime, ['--version'])
    if (!(present.ok && present.code === 0)) continue
    const inspect = await exec(runtime, ['image', 'inspect', imageName])
    if (inspect.ok && inspect.code === 0) { …ok… }
    return { …status: 'missing'… }        // ← returns, never tries podman
  }
```
The `return` inside the loop means the loop body can only iterate once past the
`continue`. On a host with docker installed but its daemon down (or docker installed
and podman actually holding the image), `docker image inspect` fails and the probe
reports the image **missing** without ever asking podman. The fix line then tells
the user to build an image they already have. `continue`-on-inspect-failure, or the
shared `detectRuntime` from C2, resolves it.

### D6. `system-exec` reports a signal-killed child as a clean exit 0

- **Violation** (latent bug). `latent-bug:exec-outcome-code`. **Confidence: high.**
  Effort S.

`packages/server/src/doctor/system-exec.ts:38-40`:
```ts
      child.on('close', (code) => {
        resolve({ ok: true, code: code ?? 0, stdout, stderr })
      })
```
`code` is `null` exactly when the child was terminated by a **signal**. `code ?? 0`
turns "killed" into "succeeded", and every probe's success test is
`out.ok && out.code === 0` (`doctor.ts:89, 144, 175, 191, 229`). A `docker info`
killed by the OS therefore reports the daemon healthy. The `close` handler receives
`(code, signal)` — the signal should map to a non-zero/`null` code, not to 0.

### D7. `bin/runcastle.ts` exits 0 on an unrecognised command

- **Violation.** `latent-bug:cli-exit-code`. **Confidence: high.** Effort S.

`packages/server/src/bin/runcastle.ts:36-37`:
```ts
  // Unknown token: show help rather than silently booting on a typo.
  return { command: 'help', args: argv }
```
`main` then hits `case 'help': console.log(USAGE); return 0` (`:61-63`), so
`runcastle docter` prints usage and exits **0**. A script doing
`runcastle "$CMD" || fallback` never sees the failure. Contrast the sibling CLI:
`src/dev/args.ts:142` throws `UsageError` on an unknown command and the tool exits 1
(`args.ts:33` — "the tool exits 1"). Two CLIs in the same package, opposite
conventions. (Also: `parseCommand` only inspects `argv[0]`, so `runcastle serve
--version` silently ignores the flag — minor, and arguably fine.)

### D8. `dev/state.ts` deletes across seven tables with no transaction

- **Judgement call.** `latent-bug:dev-delete-atomicity`. **Confidence: medium.**
  Effort S, risk low (dev-only).

`packages/server/src/dev/state.ts:122-128` — seven sequential `.run()` calls. An
error on any of them (a locked db while the dev server holds it) leaves e.g. tickets
gone and the feature row present. `bun:sqlite`/drizzle offer `db.transaction`;
`removeProject` (`:138-155`) has the same shape one level up. Dev-only, so low
stakes — but "hard-delete a feature" is precisely the operation whose half-completion
produces the confusing state the tool exists to clear.

### D9. `doctor` runs 8 probes (up to ~11 spawns) strictly sequentially on the boot path

- **Judgement call.** `perf:doctor-sequential-probes`. **Confidence: high.**
  Effort S, risk low.

`packages/server/src/doctor/doctor.ts:284-293` — an array literal of `await`s:
```ts
  const results: ProbeResult[] = [
    await bunProbe(exec), await nodeProbe(exec), await gitProbe(exec), await claudeProbe(exec),
    await gitIdentityProbe(exec, env.cwd), await containerRuntimeProbe(exec),
    await sandcastleImageProbe(exec, imageName), afkTokenProbe(processEnv),
  ]
```
The probes are independent and the `ExecFn` seam is already injected, so
`Promise.all` is a two-line change. `docker info` on a cold Docker Desktop is
multi-second, and this is the `--gate` path that gates boot. The one ordering
subtlety (C2's duplicate detection) disappears if `detectRuntime` is extracted.

### D10. `DoctorEnv.env` is optional with a `process.env` fallback — the shape that produced F1

- **Violation** (design flaw enabling a confirmed runtime bug).
  `weak-typing:doctor-env-optional`. **Confidence: high.** Effort S, risk low.

`packages/server/src/doctor/doctor.ts:56-66`:
```ts
export interface DoctorEnv {
  exec: ExecFn
  /** Environment map to read tokens from; defaults to `process.env`. */
  env?: Record<string, string | undefined>
  …
```
and `:281`: `const processEnv = env.env ?? process.env`, consumed by
`afkTokenProbe(processEnv)` (`:257-272`, reads `env.CLAUDE_CODE_OAUTH_TOKEN`).

The only correct production value for `env` is the merged one from
`doctor/cli.ts:23-35` (`envWithToken()`, which layers `~/.runcastle/.env` over
`process.env`). Because the field is optional and silently falls back, a caller that
forgets it gets a *plausible but wrong* environment rather than a type error — which
is exactly E2E finding **F1**: `packages/server/src/trpc/routers/setup.ts:29` calls
`runDoctor` without an `env`, so the AFK-token probe reads the server's boot-time
`process.env` and never sees a token written to `~/.runcastle/.env` after boot.

The design lesson is the optionality, not the missed call site. Three cheap fixes,
in increasing strength: (a) make `env` **required** on `DoctorEnv` — every real
caller has one and the compiler finds the rest; (b) delete the `?? process.env`
fallback so the omission is a crash in tests rather than a wrong answer in
production; (c) best — make `resolveDoctorEnv()` (`cli.ts:38-53`) the **only**
constructor of a `DoctorEnv`, i.e. have `runDoctor` take `Partial<DoctorEnv>`
overrides merged over `resolveDoctorEnv()`, so "the merged env" is the default and
tests opt out explicitly. Today the honest default (`process.env`) is the wrong one
for every caller, and the doc comment ("defaults to `process.env`") reads as a
feature rather than a trap.

### D11. `devtool`'s db-existence guard blocks the two commands that need no db (E2E F8)

- **Violation.** `latent-bug:devtool-db-guard`. **Confidence: high.** Effort S.

`scripts/devtool.ts:97-101`:
```ts
  if (!existsSync(dbPath())) {
    log(`no dev database yet at ${dbPath()}`)
    log('start it once with `bun run dev` (it creates the tree at boot).')
    return cmd.kind === 'status' ? 0 : 1
  }
```
The guard sits **before** `run(ctx, cmd)` dispatch (`:107`), but
`onboarding-git` dispatches to `gitIdentityClear()` / `gitIdentityRestore()`
(`devtool.ts:133`) which take **no `ctx`** and touch only `git config --global` and
a JSON file. So the command documented as the way to make the wizard's git step
reachable (`src/dev/args.ts:185-186`) refuses to run in exactly the fresh-machine
state it exists for. `reset` is already special-cased above the guard (`:95`);
`onboarding-git` needs the same treatment.

The second half of F8 compounds it: `savedIdentityPath()` is
`join(dataDir(), 'dev-saved-git-identity.json')` (`devtool.ts:291`), i.e. **inside**
the tree that `reset` (`:95` → `resetDataDir()`) deletes. A `clear` → `reset` →
`restore` sequence loses the user's real global git identity irrecoverably, and
`gitIdentityRestore` (`:393-400`) can only print "set it by hand". The saved
identity is host state, not dev-tree state, and should live outside the wiped tree
(or `reset` should preserve it).

### D12. `dev/args.ts` mirrors `FeatureStatus` by hand

- **Judgement call.** `wrong-tool:feature-status-mirror`. **Confidence: medium.**
  Effort S.

`packages/server/src/dev/args.ts:35-36`:
```ts
/** Feature statuses the tool accepts (mirrors core's `FeatureStatus`). */
export const FEATURE_STATUSES = ['active', 'shipped', 'archived'] as const
```
followed by a hand-rolled membership test and a cast at `:110-113`:
```ts
      if (!(FEATURE_STATUSES as readonly string[]).includes(status)) { … }
      return { kind: 'feature-status', feature, status: status as FeatureStatus }
```
The same file's `phase` handling (`:99-103`) does it correctly with the core zod
enum — `Phase.safeParse(phase)` and `Phase.options` — and needs no cast. Core
exports a `FeatureStatus` type at the same seam; if the zod enum is exported too,
this becomes `FeatureStatus.safeParse(status)` and the `as` disappears. The comment
"mirrors core's" is an acknowledged duplication that drifts the moment a status is
added.

---

## D-bis. Migrations (`packages/server/drizzle/*.sql`)

19 files, 175 lines total. Reporting only real problems, per brief.

### D13. **Zero indexes exist anywhere in the schema — and `events` is polled at 1.5 s**

- **Violation** (performance / latent scaling bug). `perf:missing-event-indexes`.
  **Confidence: high.** Effort S, risk low. **This is the biggest migration finding.**

`grep -c 'CREATE INDEX' packages/server/drizzle/*.sql` → **0 across all 19 files**.
`packages/core/src/db-schema.ts:1` confirms it is not a drizzle-side declaration
either — the import line is
```ts
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
```
with no `index` / `uniqueIndex`. The only indexes SQLite has here are the implicit
rowid/PK ones.

What that costs, given the house convention "`events.list` is polled at 1.5s"
(CLAUDE.md / briefing) and "every service function that mutates emits an event":

| Query | Site | Predicate | Index available |
|---|---|---|---|
| feature timeline poll | `services/events.ts:158` `where(and(eq(events.featureId, featureId), gt(events.id, afterId)))` | `feature_id = ? AND id > ?` | none on `feature_id` — full scan |
| project timeline poll | `services/events.ts:217` `and(eq(events.projectId, …), gt(events.id, …))` | `project_id = ? AND id > ?` | none |
| `latestEventTs` | `services/events.ts:176-178` `where(and(eq(events.featureId,…), eq(events.type, type))).orderBy(desc(events.ts)).limit(1)` | `feature_id = ? AND type = ?` + sort | none — full scan **plus a sort**, and `toolGetWorkRecord` calls it **once per feature** (`mcp/server.ts:632`) |

`events` is the fastest-growing table in the system by construction (one row per
mutation, plus every burner step), it is the only one on a 1.5 s timer, and it is
the one with no index on either of its two filter columns. The whole-table scan is
invisible at 200 rows and is a per-1.5s full scan of a six-figure table after a few
weeks of burns. Minimum fix, one migration:
`CREATE INDEX events_feature_id_idx ON events(feature_id, id)`,
`CREATE INDEX events_project_id_idx ON events(project_id, id)`,
`CREATE INDEX events_feature_type_ts_idx ON events(feature_id, type, ts)`.
Every other table has the same gap on its foreign key (`tickets.feature_id`,
`waypoints.feature_id`, `sessions.feature_id`, `runs.feature_id`,
`test_notes.feature_id`, `features.project_id`) — all queried by exactly that
column — but those are not on a poll loop, so they are second priority.

### D14. `0004`'s backfill writes a **feature id into the `project_id` column** for orphaned events

- **Violation** (data-integrity bug, already shipped). `latent-bug:events-backfill`.
  **Confidence: high.**

`packages/server/drizzle/0004_events_project_id.sql`:
```sql
	COALESCE((SELECT `project_id` FROM `features` WHERE `features`.`id` = `events`.`feature_id`), `feature_id`),
	CASE WHEN `feature_id` IN (SELECT `id` FROM `features`) THEN `feature_id` ELSE NULL END,
```
When an event's `feature_id` no longer resolves (the feature row was deleted — which
`dev/state.ts:125` does routinely, and `deleteFeature` does in the product), the
`COALESCE` fallback stuffs the **feature id** into the NOT-NULL `project_id` column,
while the next expression correctly NULLs `feature_id`. The row is then permanently
attributed to a "project" whose id is `feat_…` and which cannot exist. Those rows are
invisible to both timeline queries (`services/events.ts:158` and `:217` both miss
them) and un-deletable by `removeProject` (`dev/state.ts:149` keys on the real
project id). The correct fallback was to drop such rows, or to require a real
project. It has shipped, so a repair migration — not an edit — is the fix.

### D15. The two table-rebuild migrations disagree about `PRAGMA foreign_keys`

- **Judgement call.** `inconsistent:migration-rebuild`. **Confidence: high.** Effort S.

`0013_sudden_naoko.sql` wraps its rebuild:
```sql
PRAGMA foreign_keys=OFF;--> statement-breakpoint
… DROP TABLE `sessions`; … PRAGMA foreign_keys=ON;
```
`0004_events_project_id.sql` performs the identical `__new_x` → `DROP TABLE` →
`RENAME` dance with **no pragma at all**. Only one of them can be right about
whether the guard is needed. (In practice no FKs are declared, so both work today —
which is exactly why the divergence will survive until FKs are added and then bite.)

### D16. `project_preps` — created in `0010`, dropped in `0015`, five migrations later

- **Judgement call** (churn, no action needed beyond awareness). `churn:project-preps`.
  **Confidence: high.**

`0010_misty_ken_ellis.sql` creates a 7-column `project_preps` table; `0015_magenta_angel.sql`
is a single line: `DROP TABLE \`project_preps\`;`. This is the headless-preparation-run
model that SPEC §14 records as removed ("It had a headless twin … that is gone",
`docs/SPEC.md:329-331`). Correctly documented; noted only because a fresh install
still executes both migrations, and because it is the one place migration history
and spec history visibly agree.

### D17. Irreversible column drop in `0008`

- **Judgement call** (accepted risk, worth one line of awareness).
  `destructive:feature-size-drop`. **Confidence: high.**

`0008_panoramic_molecule_man.sql`: `ALTER TABLE \`features\` DROP COLUMN \`size\`;`
— the only truly destructive statement in the set (`0015`'s table drop discards a
table that was never read in a shipped install). `size` was `NOT NULL` in `0000`, so
the data is gone with no down-migration. This is a legitimate product decision
(`test/feature-size-drop.test.ts` exists), and drizzle has no down-migrations, so
there is nothing to fix — but it means the migration set is one-way, which is worth
stating once somewhere near the schema.

No other migration problems found: no added-then-never-used columns (every added
column resolves to a reader — `attempt_branch`, `conflict_files`, `drive_env`,
`awaiting_input`, `verified_at`/`verified_sha`, the four `lap` columns), and the
migrations are consistent with `packages/core/src/db-schema.ts`.

---

## E. Wrong-tool & weak-typing findings

### E1. `FeatureContext.feature` is typed by `ReturnType<typeof getFeatureRow>` at an exported boundary

- **Violation.** `weak-typing:feature-context`. **Confidence: high.** Effort S.

`packages/server/src/mcp/server.ts:130-132`:
```ts
export interface FeatureContext {
  feature: ReturnType<typeof getFeatureRow>
```
This is the return type of the **most-called MCP tool** (`get_feature_context`), i.e.
part of the wire contract every session reads. Deriving it from a repo function's
return type means the tool's payload silently changes shape whenever
`services/repo.ts` changes, with no compile error and no diff in this file. The
domain type is already imported two lines above — `Feature` (`:5`) — and is used
elsewhere in the same file (`featureIndexLine(feature: Feature)`, `:562`). Naming it
`Feature` makes the contract explicit and makes a repo-side change a type error here.

### E2. `dev/args.ts` hand-rolls a `FeatureStatus` check that core exports as a zod enum

- **Violation.** `wrong-tool:feature-status-mirror`. **Confidence: high.** Effort S.
  (Detail in D12; the confirming fact:)

`packages/core/src/schemas.ts:98-99` already exports both:
```ts
export const FeatureStatus = z.enum(['active', 'shipped', 'archived'])
export type FeatureStatus = z.infer<typeof FeatureStatus>
```
`packages/server/src/dev/args.ts:36` re-declares the same three strings and
`:113` casts (`status as FeatureStatus`) — while `:99` in the same function does the
right thing with `Phase.safeParse`. Two adjacent branches, two conventions, and the
cast is the file's only one.

### E3. `JSON.parse(...) as T` with no schema, twice on the release path

- **Violation.** `wrong-tool:json-parse-unvalidated`. **Confidence: high.** Effort S.

`packages/server/scripts/build-package.ts:39-41`:
```ts
function readPkg(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
}
```
and `scripts/devtool.ts:401`:
```ts
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; email?: string }
```
House convention is zod at boundaries. The build-package one matters more than it
looks: `buildPublishedManifest` reads `serverPkg.dependencies`, `.engines`, `.type`
off an unvalidated object, and a malformed `package.json` produces a **silently
wrong published tarball** rather than an error. `PackageJson` (publish-manifest.ts:15-27)
is already an interface; a zod object of the same shape costs one line and turns
the failure into a build-time throw.

### E4. Nine `as …T` type-alias imports in one block, because zod schema and type share a name

- **Judgement call** (repo-wide naming friction, not a bug).
  `naming:zod-type-alias`. **Confidence: high.** Effort L (repo-wide), risk medium.

`packages/server/src/mcp/server.ts:4-18` — `FeatureStatus as FeatureStatusT`,
`FindingSource as FindingSourceT`, `Phase as PhaseT`, `PreparedKey as PreparedKeyT`,
`RunStatus as RunStatusT`, `TicketInput as TicketInputT`, `TicketStatus as
TicketStatusT`, `Waypoint as WaypointT`, `WaypointInput as WaypointInputT` — nine
aliases in one import, because core exports the schema and the inferred type under
the same identifier and this file needs both. It works, but the `T` suffix is an
un-documented local convention that other files may or may not share. Flagged as a
cross-cutting observation for the parent (see H5) rather than a local fix.

### E5. Exports with no external consumer (verified by importer search)

- **Violation** (dead export surface, not dead code). `dead-export:*`.
  **Confidence: high.** Effort S, risk low.

Searched `packages/ apps/ scripts/` for each identifier, excluding the defining file:

| Symbol | `file:line` | External refs |
|---|---|---|
| `containerRuntimeProbe` | `doctor/doctor.ts:171` | **0** (not even a test) |
| `sandcastleImageProbe` | `doctor/doctor.ts:224` | **0** |
| `afkTokenProbe` | `doctor/doctor.ts:257` | **0** |
| `resolveDoctorEnv` | `doctor/cli.ts:38` | **0** — and this is the one that *should* have a second caller (see D10 / F1) |
| `pruneWorktrees` | `dev/state.ts:212` | **0** — called only at `state.ts:153` |
| `buildMcpServer` | `mcp/server.ts:683` | **0** — called only at `mcp/server.ts:977` |

`gitIdentityProbe` is the counter-example: genuinely exported and consumed by
`packages/server/src/services/setup.ts`. None of these are dead *code* (all are
called internally); the `export` keyword is what is unearned, and it makes the
module's interface look wider than it is. Note especially that `containerRuntimeProbe`
and `sandcastleImageProbe` are exported *and untested directly* — the two probes
with the subtlest logic (D5) have the widest advertised surface and the least cover.

### E6. `buildMcpServer`'s registrations — schemas and descriptions — are untested

- **Violation.** `untested:mcp-registrations`. **Confidence: high.** Effort S.

`packages/server/test/mcp-tools.test.ts:10-21` imports the **pure `tool*` functions**
(and the Hono app), never `buildMcpServer`. A repo-wide grep confirms **no test
anywhere calls `buildMcpServer()`**. `RUNCASTLE_MCP_ALLOW_RULES` is asserted only
against the rendered settings file (`test/launch-artifacts.test.ts:80`,
`test/project-session.test.ts:124`) — never against the actual registered names.

So the layer that drifts (tool names, `inputSchema` shapes, descriptions) is exactly
the layer with no test, while the layer that does not drift (the impl functions) is
well covered. The allowlist/registry agreement I verified in B0 holds **today by
hand, not by test**. One test — enumerate `buildMcpServer()`'s tools, assert the set
equals `RUNCASTLE_MCP_ALLOW_RULES` stripped of `mcp__runcastle__` — closes half the
B1 drift permanently and costs ~10 lines.

---

## F. Shallow modules / deletion-test candidates

### F1s. `doctor/report.ts` `statusWord` — a pass-through

- **Judgement call.** `shallow:status-word`. **Confidence: high.** Effort S.

`packages/server/src/doctor/report.ts:19-21`:
```ts
function statusWord(status: ProbeStatus): string {
  return status.toUpperCase()
}
```
One caller (`:25`). Deletion test: inline it and the complexity is `.toUpperCase()`
at the call site — nothing reappears anywhere. It is a named nothing. (Contrast
`GLYPH` at `:9-16`, which is a genuine table and earns its name.) Trivial; listed
because it is the only true pass-through in the scope.

### F2s. `dev/state.ts` `describe` duplicates a repo-wide idiom

- **Judgement call.** `redundant:error-message-extraction`. **Confidence: high.**
  Effort S, but repo-wide — see H4.

`packages/server/src/dev/state.ts:199-201`:
```ts
export function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
```
The same expression is written inline at `mcp/server.ts:346`
(`${e instanceof Error ? e.message : String(e)}`), `bin/runcastle.ts:84`
(`err instanceof Error ? err.message : err`), and
`scripts/build-package.ts:103` (same). Four sites, one of which named it and did not
export it usefully (E5 shows `describe`'s importer count is unreadable because the
name collides with vitest's `describe` — which is itself an argument for renaming
it). This is a one-liner, so the finding is not "extract a module" but "there is one
already and three call sites don't use it" — a naming problem (`describe` is
un-importable in any test file) more than a duplication problem.

### F3s. Not shallow — noted so the parent does not flag them

`resolveSession` (`mcp/server.ts:92-98`), `requireFeatureId` (`:114-126`),
`requireProject` (`:362-372`) and `requireOwnTicket` (`:207-217`) all look like
two-line guards but pass the deletion test decisively: removing them scatters a
null-check plus a carefully-worded agent-facing refusal across 14 handlers, and the
file's own comment at `:105-112` argues the point correctly. Leave them.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G1. `registerSessionTool` — one wrapper for all 14 MCP registrations.**
*Effort M, blast radius: one file (`mcp/server.ts`), plus one new test.*
Today each registration repeats session resolution, the no-session refusal, and
(for 7 of them) a docs checkpoint, while error shaping is repeated **zero** times
because nobody does it (D3). A single helper taking
`{ name, meta, impl, checkpoint?: (result) => string }` would concentrate: the
`resolveCtxSession` + `noSession` preamble (D4, 14 sites), the `GateError` →
`{ isError: true }` conversion that is currently missing (D3), and the checkpoint
decision that is currently an unexplained per-tool accident (D2). **Leverage:** the
tool list becomes a declarative table, which is also the thing a drift test (E6) and
a generated SPEC §16 table (B1) can both read. Two callers exist fourteen times over
— this is the realest seam in the scope.

**G2. `events` indexes.** *Effort S, blast radius: one new migration.*
D13. Highest value-per-effort item in the whole report: three `CREATE INDEX` lines
against the one table on a 1.5 s poll loop. No code change, no API change.

**G3. Make `DoctorEnv` un-mis-constructable.** *Effort S, blast radius: `doctor.ts`,
`doctor/cli.ts`, `trpc/routers/setup.ts`, doctor tests.*
D10 / F1. Make `env` required (or have `runDoctor` accept `Partial<DoctorEnv>`
merged over `resolveDoctorEnv()`), so the compiler finds the one caller that got it
wrong and prevents the next one. **Leverage:** turns a class of silent wrong-answer
bug into a compile error; also fixes F1 as a side effect rather than as a patch.

**G4. `detectRuntime(exec)` extracted from the two container probes.**
*Effort S, blast radius: `doctor/doctor.ts` only.*
C2 + D5 + D9 all resolve together: one detection, half the spawns, the
podman-never-tried bug disappears, and `Promise.all` becomes safe.

**G5. `parseEnvFile` moved out of `workflows/ticket-burner`.**
*Effort S, blast radius: `doctor/cli.ts`, `workflows/ticket-burner.ts`, + any other
importer.* D1. Two callers already; the pre-boot gate should not import the burner.
Natural home: `packages/core` (it is IO-free string parsing) or `src/util/env-file.ts`.

**G6. `git.pruneWorktrees(repoPath)` on the git service.**
*Effort S, blast radius: `services/git.ts`, `dev/state.ts`.* C1. Four call sites, two
mechanisms; the dev tool is the only place in `src/` that shells out to git outside
the service.

**G7. A `prepare` skill pack, moving the prompt out of `artifacts.ts`.**
*Effort M, blast radius: `packages/skills`, `launcher/artifacts.ts`,
`routes/hooks.ts`, `launcher/edit-guard.ts`, their tests.* B4. Speculative in the
sense that it is arguably a deliberate choice — but it is the only session kind
whose prompt is not in the prompt package, and its `record_finding` guidance is
currently triplicated across three TS files.

**G8. SPEC §16 "MCP tool surface" + a registry-drift test.**
*Effort M (mostly writing), blast radius: `docs/SPEC.md`, one test file.* B1/B5/E6.
Documentation, but the highest-leverage documentation in the scope: seven tools
currently have no contract anywhere except a prompt, in a repo whose stated rule is
"names in the spec are law".

**G9. Single-caller / speculative — flagged, not proposed.**
`statusWord` (F1s) and `describe` (F2s) are one-liners; folding them is cleanup, not
a seam. `commitDocsCheckpoint` should be folded into G1 rather than extracted
separately.

---

## H. Cross-cutting candidates to pass UP

These are the ones I expect siblings to have hit too. Canonical keys are chosen so
the parent can match by key.

**H1. `doc-drift:mcp-tool-surface` — SPEC.md documents 7 of 14 MCP tools.**
Evidence: `docs/SPEC.md:151` ("4 tools"), `:254` ("7 total"), file ends at :470 with
no §16; `mcp/server.ts:683-961` registers 14; `launcher/artifacts.ts:612-630` lists
14. Also `packages/skills/packs/README.md:46` still names the original four, and
`CLAUDE.md` says "4 MCP tools". **Why it's cross-cutting:** any sibling auditing
`docs/`, `packages/skills`, or the launcher is looking at the same divergence from a
different side, and the tRPC-router sibling should be asked whether SPEC §4's
procedure map has drifted the same way. Suspected shared root cause: **the spec is
append-only by amendment section (§13.3, §15.3) and features added after §15 stopped
amending it at all.** Recommend the parent check §4 and §10 for the same pattern.

**H2. `redundant:mcp-handler-preamble` / `inconsistent:mcp-error-shape` — no shared
tool-handler wrapper.** Evidence: `mcp/server.ts:703-957` (14 identical preambles),
`:664-674` (the only structured error) vs. six thrown `GateError`s at `:121, :214,
:255, :281, :363, :455` and an `InvalidInputError` at `:621`. **Cross-cutting
because** the tRPC routers are the sibling surface with the same problem shape
(request → resolve context → guard → service → shape errors), and the web sibling
consumes whatever error shape comes out. If tRPC has an error-formatter and MCP does
not, that is one repo-wide finding about "two wire surfaces, one error vocabulary,
implemented once".

**H3. `perf:missing-event-indexes` — the DB has no indexes at all.**
Evidence: 0 `CREATE INDEX` in `drizzle/*.sql`; `packages/core/src/db-schema.ts:1`
imports no `index`; `services/events.ts:158, :176-178, :217` filter/sort on
unindexed columns on a 1.5 s poll. **Cross-cutting because** it is a `packages/core`
schema decision that every service and the whole UI polling story sit on top of —
the core sibling and the services sibling are both standing on it without seeing it.
Pair with whatever the web sibling reports about polling cadence.

**H4. `redundant:error-message-extraction` — `e instanceof Error ? e.message :
String(e)` written inline everywhere.** Evidence in my scope alone:
`dev/state.ts:199-201` (named `describe`, and un-importable because the name collides
with vitest), `mcp/server.ts:346`, `bin/runcastle.ts:84`,
`scripts/build-package.ts:103`. I would expect double-digit occurrences repo-wide.
Trivial individually; worth one `errorMessage(e)` in core precisely because it is the
kind of thing every sibling will report once and nobody will fix.

**H5. `naming:zod-type-alias` — schema and inferred type share an identifier, so
consumers alias.** Evidence: `mcp/server.ts:4-18`, nine `as …T` aliases in one import
block. Not a bug; flagged so the parent can see whether other packages invented a
*different* workaround (e.g. `type FooType`, or importing the schema namespaced).
If three packages invented three conventions, that is a repo-wide finding; if only
this file does it, drop it.

**H6. `wrong-tool:json-parse-unvalidated` — `JSON.parse(...) as T` at boundaries.**
Evidence in scope: `packages/server/scripts/build-package.ts:40` (the *release*
path — a malformed manifest silently ships) and `scripts/devtool.ts:401`. The house
rule is zod; I expect siblings to find more (config files, hook payloads, transcript
parsing). Worth consolidating into one repo-wide item with a list of sites.

**H7. `redundant:sandcastle-container-template` — `Dockerfile` and `Containerfile`
are byte-identical duplicates kept in sync by hand.** Evidence:
`packages/server/src/assets/sandcastle/Dockerfile` and `…/Containerfile` are both
1 692 bytes and `diff` is empty. **Both are genuinely referenced** — `services/setup.ts:272`
copies the whole dir via `scaffoldSandcastleConfig(sandcastleTemplateDir(), …)`, and
docker/podman each look for their own filename (`docs/research/SANDCASTLE-NOTES.md:143`),
so **neither is dead code** — but nothing keeps them equal: `test/sandcastle-scaffold.test.ts:30-31`
asserts the UID/GID invariant against the **Containerfile only**, so a Dockerfile that
drifts is caught by nothing. One file plus a copy (or a `sandcastle-scaffold` test
asserting the two are identical) removes the class. Related, same file: the image
pipes two unpinned installers to bash (`curl -fsSL https://bun.sh/install | bash`,
`curl -fsSL https://claude.ai/install.sh | bash`) on a floating `FROM node:22-bookworm`
— so two builds of "the same" burner image are not the same image, and the doctor only
probes presence (`doctor.ts:224-251`), never freshness. Passing up because
reproducibility of the burner image is a whole-product property, not a file-local one.

**H8. `inconsistent:cli-conventions` — two CLIs in one package, opposite conventions.**
Evidence: `bin/runcastle.ts:36-37` + `:61-63` (unknown command → help → **exit 0**)
vs. `dev/args.ts:142` + `:33` (unknown command → `UsageError` → exit 1); hand-rolled
`parseCommand` (`bin/runcastle.ts:27-38`) vs. a small hand-rolled parser with flag
validation (`dev/args.ts:45-143`). Neither uses a library, which is fine at this size
— but if the parent's other leaves found a third arg-parsing style (in `scripts/`),
that is a repo-wide "pick one" item. Also passing up the concrete bug: **`runcastle
<typo>` exits 0**.

**H9. `dead-export:*` — internal-only functions carrying `export`.**
Evidence in scope: `containerRuntimeProbe`, `sandcastleImageProbe`, `afkTokenProbe`
(`doctor/doctor.ts:171, 224, 257`), `resolveDoctorEnv` (`doctor/cli.ts:38`),
`pruneWorktrees` (`dev/state.ts:212`), `buildMcpServer` (`mcp/server.ts:683`) — all
zero external references by importer search. Passing up because "export everything
by default" is a habit, not a file-local slip, and the parent can only judge whether
it is repo-wide by pooling leaves. Note the sharp end: the two doctor probes with the
subtlest logic are exported *and* have no direct test.

**H10. `latent-bug:*` cluster worth surfacing to the top of the parent's report.**
Four independent runtime bugs found here, each small and each shipped:
- `doctor/system-exec.ts:38-40` — signal-killed child reported as exit 0 (D6).
- `doctor/doctor.ts:227-242` — image probe never tries podman when docker exists (D5).
- `drizzle/0004_events_project_id.sql` — feature ids written into `project_id` (D14).
- `scripts/devtool.ts:97-101` + `:291` — E2E F8, both halves (D11).
Plus the confirmed E2E **F1** root cause at `doctor/doctor.ts:56-66` + `:281`
(optional `env` with a `process.env` fallback), whose miscall is
`trpc/routers/setup.ts:29-33` — note that call also omits `cwd`, so the AFK card's
git-identity probe resolves identity in the *server process's* cwd rather than the
repo, a second divergence between the card's report and the CLI's on the same host.

---

## Boundary notes (not mine to audit)

- `packages/server/src/launcher/artifacts.ts` — owns `RUNCASTLE_MCP_ALLOW_RULES` and
  the `prepare` prompt; I read it only to verify B0/B4. The launcher sibling owns it.
- `packages/skills/**` — read for drift only (B2, B3, B5, B8). Whoever owns skills
  should be handed B2 (`tickets.emitted`) and B3 (`originWaypointId`) directly, since
  the fix is prompt-side in both.
- `packages/server/src/services/events.ts`, `git.ts`, `features.ts` — read to confirm
  index usage (D13) and prune duplication (C1); the services sibling owns them.
- `scripts/devtool.ts` — outside my file list, but cited for E2E F8 (D11) and E3, as
  instructed.
- `packages/core/src/db-schema.ts`, `schemas.ts` — read to verify D13, B3, E2.

