# Runcastle

An opinionated programming system layered on coding-agent CLIs (Claude Code, Codex) — the IDE to their text editor. It makes feature work concrete: every feature gets a persistent **feature session** that moves through phases, every agent spawned inside it inherits the feature's full context, and the stretch between human ideation and human testing runs AFK through sandboxed agent workflows.

**The core loop:** you get grilled on a feature → spec + tickets fall out → AFK agents burn the tickets in sandboxes → you test-drive and merge. Human-in-the-loop only at the two ends. Many features run this loop in parallel.

## Lineage

- **Matt Pocock's skills** (`~/.claude/skills`) — the methodology source: grilling, to-spec, to-tickets, implement, tdd, code-review, wayfinder, handoff. We fork and adapt, not depend.
- **Sandcastle** (`@ai-hero/sandcastle`) — the AFK engine: sandboxed agent runs (Docker/Podman/Vercel), branch strategy, merge-back.

## Locked decisions

1. **Audience: dogfood-first, product bones.** v1 is dogfooded on real daily work. Core abstractions (session store, workflow contract, skill packs) are designed so a public product can grow out of it. No auth/onboarding until it survives real use.

2. **Form factor: local web app.** Bun server on the user's machine owns sessions, workflows, sandcastle, transcript indexing; browser UI at localhost is the IDE surface. Tauri-wrappable later.

3. **Agent-CLI driving: hybrid.** Interactive work happens in **real agent terminals** (Claude Code or Codex) launched by the app with context pre-injected. AFK work runs headless via sandcastle. The app never rebuilds the chat UX — it is the orchestration + memory + observation layer.

4. **Context injection toolkit** (all interactive-mode capable, per official docs):
   - `--settings '<inline JSON>'` → per-session hooks without touching user config (keystone).
   - **SessionStart hook** → phones home to the app server with `session_id` + `transcript_path` (launcher passes `FEATURE_ID` via env), binding every terminal to its feature session; injects the feature brief via `additionalContext`.
   - **UserPromptSubmit hook** → injects per-turn phase state/rules.
   - `--append-system-prompt-file` → generated feature brief.
   - `--plugin-dir` → vendored phase-scoped skill packs.
   - `--mcp-config` → app's MCP server (record decision, advance phase, query feature memory, emit tickets). Attached *alongside* the human's own MCP servers, not instead of them: `--strict-mcp-config` suppresses every other MCP source (user, project, and plugin-contributed), so it is opt-in via `sessionMcp: 'runcastleOnly'` rather than always-on. A session is the human's terminal; hermeticity belongs to the burn sandbox.
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

15. **Laps: iteration without a mode.** A feature may loop until the human is happy — "agile" vs "waterfall" are not modes, just descriptions of how a feature went. From review, three verbs: **Fix** (test-drive notes promoted to tickets one click each, burned via the existing review→implementation loop-back; same lap), **Rethink** (new **lap**: back to ideation), **Merge** (happy — the loop closes on the feature branch; one merge, at the end). Laps 2+ default to one unbroken session — digest test notes → update decisions/spec → emit the lap's tickets, auto-advancing phases via MCP — so lap cost scales with rethink size; full ceremony and the map stay available as opt-in escalation. The test-drive panel quick-captures notes (appended per lap to `test-notes.md`, injected into the next lap's session, which is told which notes are already tickets so it never re-emits them). Slicing is the grilling skill's judgment driven by user certainty — unsure → thin lap 1, deferred scope parked in the spec's `## Later laps` section; sure → spec it whole, likely merge on lap 1. Machinery: `feature.lap` counter (Rethink increments, Fix doesn't), `lap` column on tickets (G3/burn scoped to current lap), lap tags on sessions/events, no laps table; G1/G2 stay dumb on later laps (the lap starts with its grilling by construction).

## Design principles

- **Flexible guidance over brittle machinery.** When in doubt, less mechanism. Gates guide; they never imprison. (Standing user directive.)
- **Git abstracted behind product verbs** ("test this feature", "merge") — vibe-coder friendly as a principle, not a v1 persona.
- **Parallelization is a first-class goal** — the architecture must never assume one live feature, even where M1's UI does.

## Deferred / open threads

- Ticket schema design (first build task — the burner and `/to-tickets` fork both consume it).
- Sandcastle auth for AFK agents, per runtime — setup prerequisite. Claude Code burns run on a long-lived token (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` in `~/.runcastle/.env`); Codex burns borrow the operator's own `codex login`, bind-mounting the host Codex home read-only and copying `auth.json` into the container, so their only setup step is the login itself. A `CODEX_API_KEY` set by hand in `~/.runcastle/.env` is still honoured as an override for deliberate API billing, but nothing asks for one.
- Automated testing workflow (browser agents) to shrink human click #2.
- Per-burn overhead (sandbox spin-up, burner orientation) — attack independently so laps never feel slower than "I could've done it in one Claude session" (warm/reused sandboxes per feature, tighter burner context).
- Fork-a-feature mechanics (new session seeded from parent knowledge; CC `--fork-session` where applicable).
- Multi-project — in flight via the publish wayfinder map ([GH #12](https://github.com/MuathZahir/runcastle/issues/12)): full parallel multi-project UI.
- Full-fat worktrees for side-by-side dev servers (only if the guarded switch proves annoying).
- Registry integration (runcastle marketplace inside the app).
- Live observation depth for AFK runs in M1: status + final diff + logs minimum; richer streaming later.
