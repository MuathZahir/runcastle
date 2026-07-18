# Runcastle

An opinionated programming system layered on Claude Code — the IDE to Claude Code's text editor. It makes feature work concrete: every feature gets a persistent **feature session** that moves through phases, every agent spawned inside it inherits the feature's full context, and the stretch between human ideation and human testing runs AFK through sandboxed agent workflows.

**The core loop:** you get grilled on a feature → spec + tickets fall out → AFK agents burn the tickets in sandboxes → you test-drive and merge. Human-in-the-loop only at the two ends. Many features run this loop in parallel.

## Lineage

- **Matt Pocock's skills** (`~/.claude/skills`) — the methodology source: grilling, to-spec, to-tickets, implement, tdd, code-review, wayfinder, handoff. We fork and adapt, not depend.
- **Sandcastle** (`@ai-hero/sandcastle`) — the AFK engine: sandboxed agent runs (Docker/Podman/Vercel), branch strategy, merge-back.

## Locked decisions

1. **Audience: dogfood-first, product bones.** v1 is dogfooded on real daily work. Core abstractions (session store, workflow contract, skill packs) are designed so a public product can grow out of it. No auth/onboarding until it survives real use.

2. **Form factor: local web app.** Bun server on the user's machine owns sessions, workflows, sandcastle, transcript indexing; browser UI at localhost is the IDE surface. Tauri-wrappable later.

3. **Claude Code driving: hybrid.** Interactive work happens in **real Claude Code terminals** launched by the app with context pre-injected. AFK work runs headless via sandcastle. The app never rebuilds the chat UX — it is the orchestration + memory + observation layer.

4. **Context injection toolkit** (all interactive-mode capable, per official docs):
   - `--settings '<inline JSON>'` → per-session hooks without touching user config (keystone).
   - **SessionStart hook** → phones home to the app server with `session_id` + `transcript_path` (launcher passes `FEATURE_ID` via env), binding every terminal to its feature session; injects the feature brief via `additionalContext`.
   - **UserPromptSubmit hook** → injects per-turn phase state/rules.
   - `--append-system-prompt-file` → generated feature brief.
   - `--plugin-dir` → vendored phase-scoped skill packs.
   - `--mcp-config` + `--strict-mcp-config` → app's MCP server (record decision, advance phase, query feature memory, emit tickets).
   - Transcripts tailed from `~/.claude/projects/<project>/<session-id>.jsonl`; `--resume`/`--fork-session` for the return-later and fork stories.

5. **Session store: hybrid.** Knowledge (spec, decisions/ADRs, research, notes) lives **in the target repo** at `docs/features/<slug>/` — versioned, agent-readable. Machinery (phase state, CC session links, workflow runs, transcript index) lives in the **app's SQLite**.

6. **Git topology: worktrees for talk, sandboxes for work, main checkout for the human.**
   - Each feature = a branch (`feature/<slug>`).
   - Interactive ideation/spec terminals → instant **docs-only worktrees** (no dependency install — they only read code and write docs), enabling parallel grilling.
   - AFK ticket burners → sandcastle sandboxes, commits merge back to the feature branch.
   - Main checkout reserved for the human: **guarded checkout-switch test drive** (auto-stash → checkout → run dev server → restore; blocked with explanation while any live session has uncommitted work) and final merges.
   - Full-fat worktrees (with installs) deferred until actually needed.

7. **Phases: Matt's flow, size-aware.** Ideation → Spec → Tickets → Implementation → Review → Shipped. Small features may collapse Spec+Tickets (explicit choice). Research/Prototype are detour activities available in any phase, not phases. Phases are **data** (pipeline definition) internally so custom pipelines can exist later. Big features get **mapped ideation** (ADR-0001, SPEC §13): the ideation phase becomes a wayfinder-style map of typed waypoints worked across many sessions, converging to the normal spec→tickets flow — the detour activities realized as structure.

8. **Gates: enforced, override with reason.** Gates block by default; every gate has an override requiring a one-line reason, recorded in feature history. Seatbelt, not cage.

9. **Approvals: two clicks.** (1) Grill session emits spec + tickets in one unbroken context window (Matt's context-hygiene rule); human skims ticket review card and clicks "burn". (2) Human test-drives the finished branch and clicks merge. Review findings auto-feed fix cycles inside the burner; only hard blockers surface. "Full-auto" per-feature toggle can remove click #1 later.

10. **Workflows: built-in, contract-shaped.** v1 ships ticket-burner (the main one), review, research-sweep as TS modules calling sandcastle directly — each implementing one stable contract: inputs (feature context, tickets, repo), outputs (commits, artifacts, events streamed to UI). Loading workflows from `.sandcastle/` dirs or the runcastle registry is a later additive change.

11. **Skills: vendored, adapted forks.** Matt's skills are forked into app-owned skill packs (provenance credited) and adapted to our contracts — `/to-tickets` emits tickets in the app's machine-readable schema via MCP, `/grilling` writes to `docs/features/<slug>/`, etc. Injected per-session via `--plugin-dir`. Upstream changes can't break us; we diverge freely; users need nothing preinstalled.

12. **M1 tracer bullet: one feature, full pipeline, minimal UI.** One repo, one feature at a time: create session → grilling terminal opens with injected context + vendored skills → spec/tickets land in app store → click "burn" → sandcastle runs implement+review per ticket on the feature branch → test-drive button → merge. Ugly UI, single project, no forking, no parallel features. M2 multiplies what M1 proves (parallelism).

13. **Stack:** Bun + Hono + tRPC (live updates via subscription/SSE) + Vite/React + Drizzle + local SQLite. Sandcastle called directly as a TS lib. Terminals are server-owned embedded PTYs streamed to the in-app xterm view — cross-platform (Windows/macOS/Linux); the legacy `wt.exe` window mode is removed.

14. **Name: runcastle.** Takes the runcastle.dev domain and brand.

## Design principles

- **Flexible guidance over brittle machinery.** When in doubt, less mechanism. Gates guide; they never imprison. (Standing user directive.)
- **Git abstracted behind product verbs** ("test this feature", "merge") — vibe-coder friendly as a principle, not a v1 persona.
- **Parallelization is a first-class goal** — the architecture must never assume one live feature, even where M1's UI does.

## Deferred / open threads

- Ticket schema design (first build task — the burner and `/to-tickets` fork both consume it).
- Sandcastle auth for AFK agents (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` in `.sandcastle/.env`) — setup prerequisite.
- Automated testing workflow (browser agents) to shrink human click #2.
- Fork-a-feature mechanics (new session seeded from parent knowledge; CC `--fork-session` where applicable).
- Multi-project — in flight via the publish wayfinder map ([GH #12](https://github.com/MuathZahir/runcastle/issues/12)): full parallel multi-project UI.
- Full-fat worktrees for side-by-side dev servers (only if the guarded switch proves annoying).
- Registry integration (runcastle marketplace inside the app).
- Live observation depth for AFK runs in M1: status + final diff + logs minimum; richer streaming later.
