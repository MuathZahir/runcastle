# Preparation proves its findings

## Why this feature exists

Preparation today **asserts** values but never **proves** them. The prep prompt tells the agent "run what you propose; do not guess" (`packages/server/src/launcher/artifacts.ts:398`), but nothing enforces it — `record_finding` accepts any value whether or not the agent ever executed it. The first time `driveSetupCommand`, `devCommand`, `driveEnv`, or `driveStopCommand` are exercised **together, end-to-end** is when a real test drive depends on them — which is exactly where a wrong value produces weird failures for a user: a drive that won't start, a URL sniff that never fires, or a `dropdb` aimed at the wrong database.

Evidence this is a real failure mode, not a hypothetical: a prep session on the helix project confidently mis-derived the per-branch-database story (see `docs/features/prep-prompt-explain-the-host-key-semantics/brief.md`), and the human had to manually remind a later prep session about the per-branch DB pattern. Part of that specific incident was release lag (the prompt fix at HEAD, `artifacts.ts:404-425`, is not in the published 1.1.1 build) — but the structural gap remains: an agent's claim about what works on this machine is never checked against the machine.

## What it is

1. **A dry-run drive as the closing move of a preparation session.** Once the drive-loop keys are recorded, the prep flow actually walks the real drive lifecycle in order: render `driveEnv` (the same `{{slug}}`/`{{branch}}`/`{{id}}` rendering a real drive uses — `packages/server/src/services/drive-env.ts`, `driveEnvFor` in `packages/server/src/services/git.ts`), run `driveSetupCommand`, spawn `devCommand`, confirm the localhost URL sniff resolves, then run `driveStopCommand`. The same machinery a real drive uses, so passing the dry run means a real drive will work — not a parallel reimplementation that can drift.
2. **Findings carry verification state.** A finding whose command was watched to succeed is stamped verified (with what ran and what it printed as evidence); one that was only asserted stays unverified. Changing a value clears the stamp.
3. **The drive UI warns before depending on unverified keys.** Starting a test drive with unverified drive-loop keys gets a visible caution (not a block — gates guide, they never imprison; charter design principle #1).

## The agent must understand the flow, not just the keys (explicit human requirement)

The human's one addition when approving this cut: the prep agent must know **how the whole flow works and what each command is for** — what consumes it, when it runs, what happens if it's wrong. The per-key semantics block at HEAD (`artifacts.ts:404-425`, shipped by `prep-prompt-explain-the-host-key-semantics`) is the foundation — build on it, don't duplicate it. The dry run itself is the strongest teaching tool: an agent that must walk setup → dev pane → URL sniff → stop cannot hold a wrong model of the lifecycle. The prompt should frame the dry run as the narrative of a real test drive ("this is exactly what happens when the human clicks Drive"), so the agent's mental model and the machine's behavior are the same story.

## Open questions for the grilling session

- **`dbResetCommand` verification.** It is NOT part of the drive loop — its only consumer is the post-drive migration-drift banner (`detectDbDrift`, `packages/server/src/services/git.ts` ~1561). It is inherently destructive, so it cannot be silently dry-run. Decide: ask-and-run with explicit human consent, or leave it permanently assertable-only (and let the UI say so).
- **Where verification state lives** — on the finding row vs a separate stamp; what exactly clears it (any edit? only value changes?).
- **Partial verification** — what happens when setup passes but the URL sniff times out; is that one failed finding or a failed dry run?
- **Re-verification triggers** — should an old verified stamp decay, or only clear on value change?

## What this must NOT swallow

- **No redesign of the prep conversation** — the interview flow, `record_finding` semantics (`userSupplied` etc.), and the agenda mechanism stay as they are.
- **No settings-UI redesign** — `improve-preparation` already handled prep discoverability; this feature adds at most a verified/unverified indicator.
- **No new drive machinery** — the dry run reuses the existing drive lifecycle code paths; if it needs a hook, extract, don't duplicate.

## Already settled (do not re-litigate)

- The five host keys and their semantics: `artifacts.ts:404-425`.
- `driveEnv` is the single home for branch→dbname derivation (`DB_NAME=myapp_{{id}}` shape); rendered once per drive, shared by setup/dev/stop.
- Preparation is always interactive (AFK prep removed by `improve-preparation`).
- Gates guide, never imprison — the unverified warning is a caution, not a block.
