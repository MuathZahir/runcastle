# Why this feature exists

Runcastle is currently hard-wired to Claude Code. Supporting Codex (OpenAI's CLI agent, GPT models) opens runcastle to a much larger user base. The human's bar is explicit: **no runcastle feature may be missing or work differently on Codex** — hooks, MCP, prompts, skills-equivalents, guards, transcripts all have to produce the same experience. Where Codex cannot express a mechanism the same way, the mechanism gets redesigned at a level both runtimes can honour — parity of *experience*, not necessarily parity of implementation.

This is deliberately ONE feature, not three. The reasoning: an AgentRuntime interface extracted with only one implementation is almost always wrong; designing the seam against the real second implementation, in one context, produces a better interface. The cost accepted in exchange is a big spec and a big merge on a long-lived branch — mitigated by there being nothing else in flight, and by strict lapping (below).

# What is already known (coupling inventory, with addresses)

Where the Claude Code coupling actually lives today:

1. **Launcher** — `packages/server/src/launcher/` (launcher.ts, artifacts.ts, sessions.ts, runtime.ts, skills-root.ts): spawns `claude` with injected settings.json (hooks), mcp.json, system prompt, and skill packs.
2. **Hooks — the nervous system** — `launcher/hook-client.ts`, `routes/hooks.ts`, `launcher/edit-guard.ts`. Briefing delivery is confirmed via hooks (ADR-0009); "talk sessions don't write code" is a PreToolUse guard; session lifecycle in the DB rides SessionStart/Stop. This is the load-bearing surface, NOT MCP.
3. **Burner** — `packages/server/src/workflows/ticket-burner.ts`: built on @ai-hero/sandcastle's `claudeCode` agent (`claude --print`, `CLAUDE_CODE_OAUTH_TOKEN` from ~/.runcastle/.env). Burn semantics are pinned by ADR-0002/0006/0008.
4. **Periphery** — `services/transcripts.ts` parses Claude Code session transcripts; `doctor/` and `services/setup.ts` check the claude binary and token; `util/resolve-executable.ts`; skill packs in `packages/skills/` are Claude Code skills.

MCP itself is a shared protocol — Codex supports MCP servers — so the 14-tool MCP surface should port cleanly. The open question is everything else.

# The make-or-break research question (settle in ideation, FIRST)

Codex's lifecycle-hook surface is historically far thinner than Claude Code's — no known direct PreToolUse-guard equivalent, a different config model (config.toml + AGENTS.md + custom prompts instead of settings.json + skills), different session storage. **Do not trust training data for any of this.** Ideation must have agents read the CURRENT Codex/OpenAI docs via context7 (`npx ctx7@latest library/docs`) and produce a parity matrix: every runcastle mechanism (each hook event we depend on, edit-guard, briefing confirm, MCP config injection, system-prompt injection, skills, headless exec, transcript format, auth) mapped to its Codex equivalent — or to an explicit redesign that both runtimes can honour. Anything with no equivalent is a design decision made in ideation, not a surprise discovered mid-burn. The runtime-abstraction decision should land as an ADR.

# Lap structure (agreed with the human)

- **Lap 1 — the seam.** Extract everything Claude-specific behind one AgentRuntime interface; Claude Code becomes its first implementation; ZERO behavior change. Proven by everything staying green.
- **Lap 2 — Codex interactive sessions.** Launcher spawn, config.toml/AGENTS.md/MCP wiring, briefing delivery and guards (or their redesigned substitutes), transcripts.
- **Lap 3 — Codex ticket-burner.** Headless `codex exec` inside the sandbox, auth story, retry/robustness semantics mapped onto ADR-0006/0008.

Runtime choice is **per project** for this feature.

# What this feature must NOT swallow

- Generalizing to N runtimes (Gemini etc.) beyond what two real implementations force on the interface.
- Per-ticket / per-session model routing ("cheap model burns boring tickets") — future feature; per-project choice is the boundary here.
- Multi-runtime UI beyond a project-level setting (no picker polish, no comparison UX).
- Rewriting the skill packs as a general cross-runtime content system — port what sessions need, nothing more.

# Consequences elsewhere (not this feature's to do, but to know)

The project charter's first sentence defines runcastle as "layered on Claude Code." When this ships, the charter gets rewritten at project level — the project session owns that; this feature just needs to produce the ADR that justifies it.
