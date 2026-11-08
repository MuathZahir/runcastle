# Runcastle

An opinionated programming system layered on coding-agent CLIs (Claude Code, Codex) — the IDE to their text editor. It makes feature work concrete: every feature has a lead agent that holds its whole context, the work it hands out runs as **workers** the human can step into at any time, and the human makes every decision about what they get.

**The core loop:** you and a feature's lead settle what it should be → the lead hands the work to workers, some you iterate with, some running on their own → a Review worker drives the app and checks it → you test-drive and merge. The human decides; agents build. Many features run this loop in parallel, and the orchestrator runs the project's features as far as the human asks.

## Lineage

- **Matt Pocock's skills** (`~/.claude/skills`) — the methodology source: grilling, to-spec, implement, tdd, code-review, wayfinder, handoff. We fork and adapt, not depend.

## Locked decisions

1. **Audience: dogfood-first, product bones.** Dogfooded on real daily work. Core abstractions (thread store, workers, skill packs) are designed so a public product can grow out of it. No auth/onboarding until it survives real use.

2. **Form factor: local web app.** A Bun server on the user's machine owns the agent threads, workers and their sandboxes, and the project's records; the browser UI at localhost is the IDE surface, on a phone too. Tauri-wrappable later.

3. **Agent conversations are runcastle's own.** Every conversation — the orchestrator, a feature's lead, a worker — is an ACP session the server owns, running the human's installed CLI through its official adapter, and runcastle renders it (ADR-0015). Processes are lazy: they start on a prompt and stop when idle. Terminals remain only for program output (dev servers, the design server, settings flows).

4. **Context injection toolkit**, passed through the adapter's session options:
   - `--settings` → per-session hooks and guards without touching user config. The PreToolUse guards and the UserPromptSubmit status line remain; liveness and turn state come from ACP, not hooks.
   - A thread's opening briefing is its first prompt; everything runcastle says to an agent is a prompt (ADR-0015).
   - `--append-system-prompt-file` → the generated session briefing.
   - `--plugin-dir` → vendored skill packs.
   - `--mcp-config` → the app's MCP server, its tools filtered per session kind. Attached *alongside* the human's own MCP servers, not instead of them: `--strict-mcp-config` is opt-in via `sessionMcp: 'runcastleOnly'`. A session carries the human's own skills and setup; keeping them lean is the user's job.

5. **Session store: hybrid.** Knowledge (brief, decisions, spec, ADRs, notes) lives **in the target repo** at `docs/features/<slug>/` — versioned, agent-readable. Machinery (threads and their event logs, workers, holders, events) lives in the **app's SQLite**. The tickets, rounds and runs of features built before workers are kept as read-only history (ADR-0020).

6. **Git topology: a worktree for each feature's talk, a sandbox for each worker, the main checkout for the human.**
   - Each feature = a branch (`feature/<slug>`).
   - A feature's lead works in the feature's worktree, which stays docs-only by guard except in design mode, where it renders screens with fake data.
   - Each worker works in its own sandbox on its own copy of the feature branch; its commits come back to the host at handback and land through the feature's landing queue (ADR-0019, ADR-0020).
   - The main checkout is reserved for the human: the guarded test drive (one drive slot per project, ADR-0014) and final merges. The drive's two chats — Fix drive and the scenario chat — are the one kind of worker that runs there, in the human's checkout, because they need the drive's database and dev server (ADR-0019 §7b).

7. **Retired: phases.** A feature has no stored phase; its state is derived from facts (`tickets-and-review-are-tools-not-phases`). Big intent is cut into several features by the orchestrator after a shape grill (ADR-0012).

8. **Retired: gates.** Nothing blocks a feature behind a gate. Review runs by default as a worker, and the human's own yes is what moves work forward.

9. **The human makes every decision.** The human settles what a feature should be — in a grill in its chat, in a grill held by the orchestrator for a small one, or by confirming the decisions a self-planned feature marks as theirs — and says yes to its plan. After that the lead hands the work to workers, a Review worker checks it, and the human test-drives and merges. Autonomy covers the building, never the human's decisions. The orchestrator runs a cut on a working agreement the human chooses: autonomous, checkpoints they name, or a check-in after each feature.

10. **Retired: built-in workflows.** The ticket-burner, review and research-sweep workflows and their registry are gone; delegated work is workers (ADR-0019, ADR-0020).

11. **Skills: vendored, adapted forks.** Matt's skills are forked into app-owned skill packs (provenance credited) and adapted to runcastle's contracts — `/grilling` writes to `docs/features/<slug>/`, the lead's skill hands work to workers, and so on. Injected per-session via `--plugin-dir`. Upstream changes can't break us; we diverge freely; users need nothing preinstalled.

12. **Retired: the M1 tracer bullet** — the build-era plan of one feature through the whole pipeline before parallelism. Parallelism is how runcastle works now.

13. **Stack:** Bun + Hono + tRPC (live updates over SSE, `GET /api/stream`) + Vite/React + Drizzle + local SQLite. Agents run over ACP adapters; workers run in Docker or Podman sandboxes built from a runcastle-managed image (ADR-0018). Program-output terminals run on Bun's own PTY, so Node is not a prerequisite (ADR-0017). Cross-platform: Windows, macOS, Linux.

14. **Name: runcastle.** Takes the runcastle.dev domain and brand.

15. **Retired: laps.** A feature loops until the human is happy without a lap counter or mode: build, drive, tell the agent, it fixes (`tickets-and-review-are-tools-not-phases`).

16. **Two levels: the orchestrator delegates to features, features delegate to workers** (ADR-0019). A worker is a thread with a label, an assignment, its own sandbox and branch, a status and a handback; the human can open any worker and talk to it. Workers replaced burn tickets, review tickets, conflict resolvers, drive chats and side chats. An agent's own in-reply subagents are not workers.

17. **Agents talk by tool call, never by mechanical pings** (ADR-0019 §6). A child tells its parent by calling a tool when it judges the parent needs to know. Events with no agent behind them — a restart, a usage limit, a container dying, a merge conflict — go only to the agent that owns the work.

18. **Orchestrator threads hold features** (ADR-0016). One holder per feature; news about it goes only to that thread, a non-holder is refused, and taking a feature is explicit. Holding binds threads, never the human.

## Design principles

- **Flexible guidance over brittle machinery.** When in doubt, less mechanism. Guidance lives in skills and briefs; machinery only where an agent cannot be trusted to remember. (Standing user directive.)
- **Git abstracted behind product verbs** ("test this feature", "merge") — vibe-coder friendly as a principle, not a persona.
- **Parallelization is a first-class goal** — the architecture never assumes one live feature or one worker.
- **Individual developers first.** Design for one developer whose work all goes through runcastle. Teams come later, and only teams that all use runcastle; teammates working outside it are out of scope.
- **Language-agnostic by construction.** Runcastle's own code only handles paths, git, text and commands it runs. Anything that needs to understand code is an agent's job; there are no per-language parsers.
- **Minimal docs; agents read code on demand.** Never ask a human or an agent to keep a description of the code current. What lasts is records (decisions, ADRs, dated previews) and executable things that break loudly (tests, scenarios).
- **Starting the app is the expensive step.** A project's app may take minutes to come up, with Docker services and a loaded machine. Runcastle starts it as rarely as possible and gets everything out of each start. It never starts the app just to look at it: to see a screen while designing, the agent renders it with fake data on the project's own frontend dev server (design mode); the drive is for end-to-end checks, and the Review worker shows the screenshots its drive took.

## Deferred / open threads

- Fork-a-feature mechanics (new feature seeded from a parent's knowledge; CC `--fork-session` where applicable).
- Multi-project — the full parallel multi-project UI ([GH #12](https://github.com/MuathZahir/runcastle/issues/12)).
- Side-by-side dev servers for several drives at once, if one drive slot per project proves too tight.
- Registry integration (runcastle marketplace inside the app).
