# Codex runtime support

## Problem

runcastle is hardwired to one agent runtime. Every talk session spawns the `claude` CLI, every burn runs through the Claude Code provider, onboarding demands a Claude login, and the UI speaks about "Claude" as if it were the product. But many users arriving at runcastle are Codex-native — they have a ChatGPT plan and the `codex` CLI, not a Claude subscription — and today runcastle is simply unusable for them. Users with both want to pick the right model for each job: a Claude model for design-taste work, a GPT model for mechanical refactors, per ticket. Neither audience can be served by a single hardcoded runtime.

## Approach

From the user's perspective: nothing new to learn. Models from both providers appear in the same settings dropdowns; picking `gpt-5.6-sol` for ideation opens a Codex session where a Claude model opens Claude Code; hooks, guards, MCP tools, skills, and kickoff behave identically. Ticket cards may arrive pre-stamped with a model chosen by the tickets agent from the user's annotated roster, changeable before Burn. Onboarding presents both providers as peers — auth what you have, at least one — and a Codex-only user gets the entire product.

The shape (decisions 1–12):

**Runtime is a property of the model.** The model vocabulary changes from bare strings to entries carrying `{ id, runtime, note? }`, where `runtime` is `claude-code | codex`. The curated list groups by runtime; custom ids get an explicit runtime picker (never inference). `resolveModel`'s chain (run override → project → step → global) is unchanged, but its result now implies a runtime, and every launch site consumes that pair. Per-runtime default pairs (flagship + smoke: `claude-opus-5`/`claude-haiku-4-5`, `gpt-5.6-sol`/`gpt-5.6-luna`) exist so onboarding can seed the global defaults from whichever runtime is authed (Claude's pair wins when both). Any launch whose resolved model belongs to a runtime that is not ready fails early with a doctor pointer — the AFK auth-precheck behavior extended to talk sessions.

**The AgentRuntime seam: symmetric interface, asymmetric mechanism.** One adapter contract per runtime covering both surfaces: resolve the binary, write per-session artifacts, build argv/env (including which env vars to scrub), name the kickoff line format, construct the burn agent, install the burn guard, and classify runtime-specific error text for retry policy. The Claude adapter is a refactor-in-place of today's behavior — flags (`--settings`, `--mcp-config`, `--append-system-prompt-file`, `--plugin-dir`) against the user's real home; deliberately **not** `CLAUDE_CONFIG_DIR` (on Windows it would relocate credentials and fire first-run onboarding every spawn). The Codex adapter generates a synthetic per-session `CODEX_HOME` containing `config.toml` (model; `workspace-write` sandbox with auto-approval as the `acceptEdits` analogue; project trust; the runcastle MCP server as streamable HTTP with the session-identity header), `hooks.json` (the same five lifecycle events invoking the same hook client, `commandWindows` on Windows, launched with hook-trust bypassed since we author them), `AGENTS.md` (the same per-kind system prompt, wording made runtime-neutral), and a copy of the user's real Codex `auth.json`.

**The server stays runtime-neutral.** Codex's hook protocol is Claude-shaped — same stdin JSON, same `hookSpecificOutput.permissionDecision` verdict — so the hook routes and the edit guard are unchanged; only where hooks are *declared* moves into the adapter. The MCP server (streamable HTTP + identity headers) is already neutral. Session lifecycle (launching → live → ended via SessionStart/Stop/SessionEnd) works identically because Codex fires the same events.

**Skills render from one source into two formats.** The runcastle skill pack remains the single content source; the Codex adapter renders it into Codex skill format at launch, and the kickoff protocol types the `$`-prefixed Codex invocation instead of `/runcastle:*`, with delivery still confirmed via the `UserPromptSubmit` hook. Prompt templates (burner and session renderers) drop Claude-specific phrasing ("claude --print", tool-name spellings) in favor of runtime-neutral wording, parameterized where the runtime must be named.

**Burns swap the provider, keep the harness.** The burn chokepoint constructs a sandcastle `codex()` agent when the resolved model's runtime is Codex, `claudeCode()` otherwise. Auth mirrors the Claude pattern: `CODEX_API_KEY` in the runcastle env file, injected into the burn env, with the same fail-early precheck. The sandbox image bakes both CLIs. The burn guard gets a Codex twin installed into the container's Codex home; deny rules and reasons stay shared content. Completion detection (git-first: commits → done, BLOCKED.md → failed) is already runtime-neutral. Retry classification gains OpenAI/Codex error patterns beside the Anthropic ones.

**Per-ticket model assignment.** Model entries accept an optional free-text use-case note. Only annotated entries are passed to the tickets session's context; it may stamp an optional `model` on each emitted ticket, chosen from that set, blank when there is no annotated reason to deviate. Blank falls through to `resolveModel` as today. The ticket card displays the assignment; the human can change it before Burn; the burner treats it as the run override.

**Onboarding, doctor, and copy.** The first-run wizard detects both CLIs, offers both providers as peer auth cards (Claude: login/setup-token flow; Codex: `codex login` for talk + API key for AFK), and gates on at least one runtime ready, then seeds defaults per decision 7. The doctor probes both runtimes but flags a missing one only when some configured model resolves to it. All "Claude" copy in the web app becomes runtime-aware — named when a runtime is in hand, "the agent" when generic. The transcript service gains a best-effort parser for Codex's rollout JSONL rendered through the same conversation view, degrading to "transcript not available" without ever affecting the session.

## Seams

- **`resolveModel` / model-entry schema** *(existing, extended)* — resolving a step now observably yields `{ id, runtime }`; tests pin the chain and the runtime derivation, including custom entries and default seeding.
- **AgentRuntime adapter contract** *(new — the feature's one new seam)* — per-runtime implementation of binary resolution, artifact writing, argv/env building, kickoff line, burn-agent construction, guard install, error classification. Observable as: given a session kind + resolved model, the adapter yields a complete launch spec (artifact file set + argv + env) that can be asserted without spawning anything; the existing smoke path (`spawn:false` rendered command) extends to Codex naturally.
- **Burn-agent chokepoint** *(existing)* — one construction point yielding a sandcastle agent per runtime; observable via the rendered print command and env, as current tests already do for Claude.
- **Hook route + edit guard** *(existing, unchanged)* — parity is asserted here: a Codex session's hook traffic must drive the same session lifecycle and produce the same deny verdicts.
- **MCP server + identity headers** *(existing, unchanged)* — Codex sessions call the same tools with the same headers.
- **Ticket store / `emit_tickets`** *(existing, extended)* — optional `model` per ticket, validated against the annotated roster, surfaced on cards, honored as run override.
- **Doctor probes** *(existing, extended)* — per-runtime readiness (binary, auth, AFK key) with conditional severity.
- **Transcript service** *(existing, extended)* — runtime-dispatched parsing with graceful degrade.

## Out of scope

- Any third runtime (Gemini, local models) — the seam should admit one, but nothing beyond Claude Code and Codex ships or is tested.
- Managing the user's ChatGPT login for interactive Codex (runcastle never performs OAuth; it copies existing auth).
- Cost/billing display or reconciliation between ChatGPT-plan usage and API-key usage.
- Mixed-runtime *single* sessions (a session/burn runs on exactly one runtime, chosen by its model).
- Migrating existing projects' stored model strings beyond treating bare ids as Claude-runtime (the historical default).

## Open questions

- Exact auto-approval configuration for Codex's `acceptEdits` analogue (`approval_policy`/granular table values) — pin during implementation against the live CLI version; the decision (workspace-write, no prompts inside the worktree) is locked.
- Whether Codex skill discovery for the rendered pack works best from the worktree's `.agents/skills` or a home-level location — implementation detail to settle empirically; the invariant is: skills load without polluting the repo's tracked files.
- Codex rollout JSONL specifics — the parser is best-effort by decision; the first implementation pins whatever the current format is.

## Later laps

- Per-model reasoning-effort setting (Codex `model_reasoning_effort`, first-class Claude effort suffix support) hung off the model entry (decision 12).
- Runtime-aware curated-model refresh (keeping flagship/smoke pairs current as providers ship models).
- A third runtime as proof the seam generalizes.
