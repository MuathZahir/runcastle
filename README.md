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

**Dev commands** (Bun only — never npm/pnpm/yarn):

- `bun install` — install the workspace.
- `bun run dev` — server (port 4512) + web (port 4513) concurrently.
- `bun run typecheck` — `tsc --noEmit` across the typed packages.
- `bun run test` — Vitest suite (currently `@runcastle/core` contracts).

**Package map** (Bun workspaces, TypeScript strict, ESM only):

- `packages/core` — `@runcastle/core`: IO-free contracts (zod schemas, drizzle
  schema, pipeline/gates, paths, workflow types, config). The names here are law.
- `packages/server` — `@runcastle/server`: Hono + tRPC + services + launcher +
  MCP + workflows. Runs TS directly with Bun, no build step. *(shell)*
- `packages/skills` — `@runcastle/skills`: vendored/forked Claude Code skill
  packs + the ticket-burner prompt template. Content only, no TS. *(shell)*
- `apps/web` — `@runcastle/web`: Vite + React + tRPC client + TanStack Query.
  *(placeholder — scaffolded by the web agent)*
