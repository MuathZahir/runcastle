# CLAUDE.md — runcastle

**Read `docs/SPEC.md` before implementing anything.** It pins every contract
(schemas, tRPC map, gates, file ownership). Names in the spec are law. Read
`CONTEXT.md` for vision + locked decisions, and `docs/research/*` for exact
version pins and wiring patterns (`STACK-NOTES.md`), Claude Code integration
(`CC-INTEGRATION-NOTES.md`), and sandcastle (`SANDCASTLE-NOTES.md`). If a research
note contradicts a *format detail* in the spec, the research note wins — record
the correction in `docs/research/CORRECTIONS.md`.

## Conventions (SPEC §12)

- **Bun everywhere** (`bun add`, `bunx`); never npm/yarn/pnpm.
- **TypeScript strict; ESM only.** No `any` unless quarantined with a comment.
  Server runs TS directly with Bun (no build step); web is Vite.
- **Never touch files outside your assigned dirs** (see ownership table below).
  `NotImplementedError` stubs are wave-B sockets — replace, don't redesign.
- **Windows paths: always `node:path`** (`join`, `resolve`); never
  hand-concatenate; quote paths in shell commands.
- **Every service function that mutates emits an event** — events are the UI's
  lifeblood (`events.list` is polled at 1.5s).
- **Commit your own work when done**: conventional message `feat(scope): ...`.
- **For library/API shapes, use `npx ctx7@latest library|docs`** (≤3 calls per
  question) — don't trust training data for API shapes.
- Ports: server **4512**, web **4513**. Data dir: `~/.runcastle/`.

## Package map

| Package             | Name                 | Role |
|---------------------|----------------------|------|
| `packages/core`     | `@runcastle/core`    | IO-free contracts: schemas, drizzle schema, pipeline/gates, paths, workflow types, config. |
| `packages/server`   | `@runcastle/server`  | Hono + tRPC + services + launcher + MCP + workflows. |
| `packages/skills`   | `@runcastle/skills`  | Vendored/forked skill packs + burner prompt template (content only). |
| `apps/web`          | `@runcastle/web`     | Vite + React + tRPC client + TanStack Query. |

`@runcastle/core` is the only package with no IO (except `paths.ts` pure path
computation and `config.ts` lazy file read inside `loadConfig`). Everything else
depends on it for wire types.

## Server file ownership (SPEC §3 — waves edit disjoint dirs)

A1 creates B-owned files as typed stubs (`throw new NotImplementedError('B1')`)
so typecheck + the UI work end-to-end before wave B lands.

| File                              | Owner | Role |
|-----------------------------------|-------|------|
| `src/index.ts`                    | A1 | boot: Hono app; mount /api/trpc, /api/hooks, /mcp; listen; db migrate |
| `src/config.ts`                   | A1 | load RuncastleConfig |
| `src/db/client.ts`                | A1 | drizzle-orm/bun-sqlite client (schema from core) |
| `src/services/projects.ts`        | A1 | initProject, getProject |
| `src/services/features.ts`        | A1 | createFeature, getFeatureFull, phase transitions |
| `src/services/gates.ts`           | A1 | checkGate(gateId, feature), overrideGate |
| `src/services/tickets.ts`         | A1 | storeTickets (seq + blockedBy resolve), listByFeature, updateTicket |
| `src/services/events.ts`          | A1 | emit, listAfter |
| `src/services/knowledge.ts`       | A1 | scaffoldDocs, listDocs, readDoc |
| `src/services/git.ts`             | B2 | simple-git: branch, worktree, test-drive guard, merge (§7) |
| `src/trpc/*`                      | A1 | context, router, routers (§4); B-owned behavior throws NotImplementedError |
| `src/launcher/launcher.ts`        | B1 | spawn injected Claude Code terminal (§5) |
| `src/launcher/artifacts.ts`       | B1 | write settings.json / mcp.json / system-prompt.md |
| `src/launcher/hook-client.ts`     | B1 | standalone bun hook script (runs inside sessions) |
| `src/routes/hooks.ts`             | B1 | POST /api/hooks/:event |
| `src/mcp/server.ts`               | B1 | 4 MCP tools, zod-validated (§6) |
| `src/workflows/registry.ts`       | A1 | Map<string, WorkflowDef>; stub ticket-burner entry |
| `src/workflows/ticket-burner.ts`  | B3 | @ai-hero/sandcastle burner (§8) |
| `src/workflows/runner.ts`         | A1 | startRun: create run row, wire ctx, catch, finalize |

Other dir owners: `packages/skills` = A2 (§9); `apps/web` = A3 (§10).

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
