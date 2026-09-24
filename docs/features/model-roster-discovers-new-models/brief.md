## Why this exists

When Anthropic or OpenAI ship a new model, runcastle does not offer it. The roster the UI shows is `modelRoster(config)` in `packages/core/src/config.ts`: a hard-coded `CURATED_MODELS` list (around lines 105–115: claude-opus-5, sonnet-5, their [1m] variants, opus-4-8, gpt-5.6-sol/terra/luna) with the operator's own `models` roster merged over it by id. So a new model reaches the chooser only through a runcastle release or the human typing an entry into Settings → Models (`ModelsPage.tsx`/`RosterTable.tsx`). The human wants this to happen automatically, possibly from a provider's models endpoint.

## The open question (research first)

Can the logins runcastle actually uses list models? Runcastle runs on subscription auth, not API keys: `CLAUDE_CODE_OAUTH_TOKEN` for Claude, and a borrowed ChatGPT `~/.codex/auth.json` for Codex (see the shipped `codex-burns-on-the-chatgpt-subscription`).
- Anthropic has `GET /v1/models`, but it expects an API key. Whether an OAuth token works there is unverified.
- The Codex CLI keeps a models cache fed by the ChatGPT backend. It may be readable, or there may be a CLI command that lists models.
- Fallbacks: ask each installed CLI what it supports; offer the CLIs' own aliases (for example `opus`/`sonnet`, which resolve to the latest) as roster entries; or a remotely published curated list.

Leave the choice to this feature's ideation. Use Context7 or live docs; do not trust memory for any of these API shapes.

## Things to settle in ideation, not here

- How discovered models merge with curated entries and the operator's entries (who wins, and whether the operator's use-case notes survive).
- How a discovered model gets its runtime (`claude-code` vs `codex`) and its flagship/smoke roles.
- Refresh cadence, offline behaviour, and whether discovered-but-unused models clutter the chooser.
- How this affects the MCP `annotatedModels` the tickets agent sees (`tickets-agent-sees-empty-annotatedmodels-despite-a-saved-roster` was a past bug here).

## Must NOT swallow

- **Keeping sandbox CLIs current.** That is `sandbox-agent-clis-track-the-host-version`, which should land first. A newly discovered model is exactly what triggers "Claude Code X does not support this model; version Y or newer is required", so this feature relies on that one's preflight and version-drift check rather than solving CLI freshness itself.
- Per-step or per-project model resolution order (`project-model-overrides-global-step-models` territory).
