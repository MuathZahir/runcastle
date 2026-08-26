# Codex burns on the ChatGPT subscription

## Why this exists

`codex-runtime-support` (shipped 2026-08-20) split Codex auth by surface in its decision #5 (`docs/features/codex-runtime-support/decisions.md#5`): talk sessions borrow `~/.codex/auth.json` (ChatGPT login), but AFK ticket burns require `CODEX_API_KEY` — a pay-per-token OpenAI key. That was never the intent. Codex should run on the user's subscription everywhere, the way Claude burns run on the subscription via `CLAUDE_CODE_OAUTH_TOKEN`.

Decision #5 was a **deliberate** choice, not an oversight. Its stated reason: "API-key env is the documented headless mechanism; copying OAuth files into sandboxes is fragile and over-scoped. Consequence, documented not fought: interactive Codex bills the ChatGPT plan, AFK burns bill the API key." This feature overturns that decision, so ideation must revisit it with evidence rather than treat it as a bug — the two fragilities it was dodging are exactly the two things to verify below.

## What to build

Change burns to borrow `auth.json` into the sandbox's `CODEX_HOME`. The mechanism already exists on the interactive side: `packages/server/src/launcher/runtimes/codex.ts:426-431` copies the human's `auth.json` into the synthetic per-session home. The burn side to change:

- `buildAgentEnv` and the container mount in `packages/server/src/workflows/ticket-burner.ts` (~:2342)
- the fail-early auth precheck (~:1554) — "logged in" instead of "key set"
- `readTokenFromEnvFile('codex')` (~:3326)
- the doctor's `codex-api-key` probe and `afkFix` copy in `packages/server/src/doctor/doctor.ts:236-251` (the `RUNTIME_SPECS` table drives onboarding, doctor, setup service and the AFK card from one place — change it there)
- the wizard's Codex AFK card

Keep `CODEX_API_KEY` as an **optional override** when set.

### Also in scope — two open review findings from the shipped feature's `test-notes.md`

1. **`talkReady` (test-notes.md:48-68).** `apps/web/src/lib/first-run.ts:115` currently accepts `installed && (authed || afkReady)`, but the launcher's `checkReady()` hard-refuses a talk launch with no `auth.json`. A Codex-only user who pastes only an API key passes onboarding, gets GPT defaults seeded, and then every talk session refuses to open. Fix `talkReady` to mean interactive login only. Once burns run on the login, Codex's talk readiness and AFK readiness collapse to the same truth ("logged in"), so this is the same semantic fix, not a rider.
2. **Per-ticket cross-runtime precheck (test-notes.md:69+).** The fail-early auth precheck covers only the run's model; a ticket assigned to a Codex model inside an otherwise-Claude burn (decision #4 per-ticket models) reaches the container with no credentials and fails there instead of up front. The precheck is being rewritten anyway — cover the per-ticket runtime case in the same pass.

## Verify in ideation before committing to the mechanism

1. **OpenAI's terms allow headless `codex exec` on a ChatGPT plan.** If they do not, this feature collapses to just the `talkReady` fix plus doctor copy, and decision #5 stands.
2. **The OAuth refresh in `auth.json` survives being copied into a sandbox that rotates it.** If the sandbox refreshes and rotates the token, the host copy goes stale (and possibly the reverse). If so: write it back after the burn, or refresh per burn before copying. ADR-0002 (per-ticket temp branches, concurrent burns) means several sandboxes may hold copies at once — check whether concurrent refreshes invalidate each other.

## What is already known

- Ticket 4's digest: the `CODEX_API_KEY` burn path was **never verified against the live CLI** — pinned only by rendered-command assertions and upstream schema. Whoever burns this will be running the first real Codex burn. Budget for that.
- The burn guard for Codex is installed under `$HOME/.codex/hooks/` in the container with `--dangerously-bypass-hook-trust`; the review path uses `-c` dotted overrides for MCP because codex's config struct is `deny_unknown_fields`. Whatever lands in `CODEX_HOME` for auth must coexist with that.
- Per-ticket model resolution re-reads the token when a ticket's assignment crosses runtimes (ticket 5 digest) — the closure in `resolveBurnDeps` is where the borrowed-auth path must plug in too.

## What this must NOT swallow

- **The `approval_policy` divergence for Codex project sessions** (test-notes.md ~40-47): a Codex project session gets `approval_policy = "never"` across the whole repo where Claude gets `default`. Safety-shaped and unrelated to auth — a separate quick change.
- **Any general "which credential wins" refactor across runtimes.** Claude's burn path (`CLAUDE_CODE_OAUTH_TOKEN` from `~/.runcastle/.env`) stays byte-identical.
- **Plan-limit handling.** Burning on the subscription means Codex burns now hit ChatGPT usage windows. The parked draft `auto-continue-burns-after-provider-limit-reset` is where that belongs; note it, don't build it.

## Record the outcome

Whatever ideation decides, it supersedes decision #5 of `codex-runtime-support` — say so explicitly in this feature's `decisions.md` so the portfolio has one current answer.
