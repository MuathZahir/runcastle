# runcastle

Runcastle is an opinionated programming system layered on Claude Code — the IDE
to Claude Code's text editor. Every feature gets a persistent session that moves
through phases (ideation → spec → tickets → implementation → review → shipped);
agents spawned inside a feature inherit its full context, and the stretch between
human ideation and human testing runs AFK through sandboxed agent workflows. The
core loop: you get grilled on a feature → spec + tickets fall out → AFK agents
burn the tickets in sandboxes → you test-drive and merge. It is a local web app
(Bun server + browser UI) that dogfoods first; see `CONTEXT.md` for the vision
and locked decisions, and `docs/SPEC.md` for the M1 contracts.

**Status: M1 — smoke-passing.** All waves landed and integrated; `bun run
typecheck` + `bun run test` (109 tests) are green, and `bun run scripts/smoke.ts`
drives the full pipeline end-to-end in-process against a throwaway repo and a real
host `claude` (project.init, feature.create, ideation session, hooks, MCP
emit_tickets/complete_phase, a real noSandbox burn, test-drive, merge). Remaining
before the demo: a live run with a real Claude Code terminal and the docker
sandbox (`docs/SPEC.md` §11, task #7).

**Dev commands** (Bun only — never npm/pnpm/yarn):

- `bun install` — install the workspace.
- `bun run dev` — server (port 4512) + web (port 4513) concurrently.
- `bun run typecheck` — `tsc --noEmit` across the typed packages.
- `bun run test` — Vitest suite (core contracts + server services/git/hooks/mcp/burner).
- `bun run scripts/smoke.ts` — scripted end-to-end smoke (real host `claude` burn).

**Package map** (Bun workspaces, TypeScript strict, ESM only):

- `packages/core` — `@runcastle/core`: IO-free contracts (zod schemas, drizzle
  schema, pipeline/gates, paths, workflow types, config). The names here are law.
- `packages/server` — `@runcastle/server`: Hono + tRPC + services + launcher +
  MCP + workflows. Runs TS directly with Bun, no build step. *(shell)*
- `packages/skills` — `@runcastle/skills`: vendored/forked Claude Code skill
  packs + the ticket-burner prompt template. Content only, no TS. *(shell)*
- `apps/web` — `@runcastle/web`: Vite + React + tRPC client + TanStack Query.
  *(placeholder — scaffolded by the web agent)*
