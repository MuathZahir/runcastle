# CLAUDE.md — runcastle

> **Build-time document.** Agent instructions for building runcastle itself,
> kept as part of the dogfooding record — some references describe build-era
> states the code has since moved past.

**Read `docs/SPEC.md` before implementing anything.** It pins every contract
(schemas, tRPC map, gates, file ownership). Names in the spec are law. Read
`CONTEXT.md` for vision + locked decisions, and `docs/research/*` for exact
version pins and wiring patterns (`STACK-NOTES.md`), Claude Code integration
(`CC-INTEGRATION-NOTES.md`), and sandcastle (`SANDCASTLE-NOTES.md`, history: the dependency is gone, ADR-0020). If a research
note contradicts a *format detail* in the spec, the research note wins — record
the correction in `docs/research/CORRECTIONS.md`.

## Conventions (SPEC §12)

- **Bun everywhere** (`bun add`, `bunx`); never npm/yarn/pnpm.
- **TypeScript strict; ESM only.** No `any` unless quarantined with a comment.
  Server runs TS directly with Bun (no build step); web is Vite.
- **Never touch files outside your assigned dirs** (see ownership table below).
- **Windows paths: always `node:path`** (`join`, `resolve`); never
  hand-concatenate; quote paths in shell commands.
- **Every service function that mutates emits an event** — events are the UI's
  lifeblood: each one is pushed over the SSE stream (`GET /api/stream`) and
  invalidates the affected queries at once. Polling is only the fallback for a
  stream that is down (1.5s), backed off to 30s while it is live — so a missed
  emit costs the UI half a minute of staleness, not a tick.
- **Styling `apps/web`: read `apps/web/STYLE.md` first** — the theme tokens and
  scale, the primitives, the two component-test tiers, and the rule that retires
  `styles.css` one flow at a time.
- **Commit your own work when done**: conventional message `feat(scope): ...`.
  Two subject forms are owned by the machinery: `ticket(<seq>): <summary>`,
  which the retired burn engine's agents committed (SPEC §8; it stays in the
  history of features built before workers, and never gets reworded), and the
  orchestrator's own docs commits, `runcastle: <what>` (scaffold, outcome, MCP
  checkpoints — see `services/features.ts`, `services/outcome.ts`). Both are
  correct where they appear; they are published to the integration branch, so
  never reword them. A worker commits with the conventional form above.
- **For library/API shapes, use `npx ctx7@latest library|docs`** (≤3 calls per
  question) — don't trust training data for API shapes.
- Ports: server **4512**, web **4513**. Data dir: `~/.runcastle/`.

## Package map

| Package             | Name                 | Role |
|---------------------|----------------------|------|
| `packages/core`     | `@runcastle/core`    | IO-free contracts: schemas, drizzle schema, pipeline/gates, paths, workflow types, config. |
| `packages/server`   | `@runcastle/server`  | Hono + tRPC + services + launcher + MCP + workers. |
| `packages/skills`   | `@runcastle/skills`  | Vendored/forked skill packs + the Review worker's assignments (content only). |
| `apps/web`          | `@runcastle/web`     | Vite + React + tRPC client + TanStack Query. |

Those four are the whole map. `packages/design-system` and the `.design-sync/` Claude
Design round-trip were retired with the Tailwind adoption — `apps/web/src/theme.css` is
the single token source now.

`@runcastle/core` is the only package with no IO (except `paths.ts` pure path
computation and `config.ts` lazy file read inside `loadConfig`). Everything else
depends on it for wire types.

## Server file ownership (SPEC §3 — waves edit disjoint dirs)

In the build era A1 created B-owned files as typed stubs
so typecheck + the UI work end-to-end before wave B lands.

| File                              | Owner | Role |
|-----------------------------------|-------|------|
| `src/index.ts`                    | A1 | boot: Hono app; mount /api/trpc, /api/hooks, /mcp; listen; db migrate |
| `src/config.ts`                   | A1 | load RuncastleConfig |
| `src/db/client.ts`                | A1 | drizzle-orm/bun-sqlite client (schema from core) |
| `src/services/projects.ts`        | A1 | initProject, getProject |
| `src/services/features.ts`        | A1 | createFeature, getFeatureFull, phase transitions |
| `src/services/gates.ts`           | A1 | checkGate(gateId, feature), overrideGate |
| `src/services/tickets.ts`         | A1 | frozen ticket history: listByFeature, getTicket (read only since ADR-0020) |
| `src/services/events.ts`          | A1 | emit, listAfter |
| `src/services/knowledge.ts`       | A1 | scaffoldDocs, listDocs, readDoc |
| `src/services/git.ts`             | B2 | simple-git: branch, worktree, test-drive guard, merge (§7) |
| `src/trpc/*`                      | A1 | context, router, routers (§4); B-owned behavior |
| `src/launcher/launcher.ts`        | B1 | spawn injected Claude Code terminal (§5) |
| `src/launcher/artifacts.ts`       | B1 | write settings.json / mcp.json / system-prompt.md |
| `src/launcher/hook-client.ts`     | B1 | standalone bun hook script (runs inside sessions) |
| `src/routes/hooks.ts`             | B1 | POST /api/hooks/:event |
| `src/mcp/server.ts`               | B1 | 4 MCP tools, zod-validated (§6) — build-era count; the server registers **26** today, filtered per session kind so no session sees all of them |
| `src/mcp/sent-memory.ts`          | — | per-session memory of what a conversation was already sent (stubs, chat read position); in-process, reset on SessionStart |
| `src/services/runs.ts`            | A1 | frozen run and round history reads; `freezeStaleRuns` closes a run the old server left running |
| `src/workers/*`                   | —  | the worker service, sandbox engine, review worker, burn-cache/image/guard (ADR-0019, ADR-0020) — where the retired `src/workflows/` burn engine's duties now live |

Other dir owners: `packages/skills` = A2 (§9); `apps/web` = A3 (§10).

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
