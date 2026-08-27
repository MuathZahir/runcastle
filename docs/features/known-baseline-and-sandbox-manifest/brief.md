## Why this exists

Source: the 2026-08-27 runcastle audit (14 burns + 4 reviews against project-helix, Windows host). Item C1, ranked #1 saving (~35–70 min per feature).

Every burn independently rediscovered the same five facts: (1) the sandbox has no Python, so bare `pnpm typecheck` / `turbo run test` abort on one package and the run is repeated; (2) one backend spec is red at branch base — re-diagnosed in all 14 burns, twice via scratch worktrees with symlinked node_modules built solely to prove non-authorship; (3) two frontend typecheck errors are pre-existing; (4) a known set of frontend files flake under load and pass in isolation — re-triaged with full-suite + isolation runs in 6 burns; (5) no Postgres/Docker, so integration specs typecheck but never execute — probed with `docker ps`/`pg_isready` per burn, and one review ran the tier with `timeout 420` anyway after its own probe came back empty.

The operator's yardstick is a raw interactive Claude Code session: it remembers these facts across turns; a burn does not. This feature is the memory a raw session has.

## What is already settled

- ADR-0008 decision 4: `verifyCommands` + `knownFailures` exist as operator-typed project settings, injected as `{{VERIFY_NOTES}}` (ticket-burner.ts ~1189–1233). The prompt already says "treat that as your baseline, do NOT spend a run establishing it." That is prose the operator has to keep current by hand, and it says nothing about sandbox capabilities. This feature automates the baseline and adds the manifest; it does not replace the settings (they remain the operator override).
- ADR-0005: burns run in an isolated clone at /home/agent/repo; the baseline must be captured in that environment, not on the host, because "what is red in the sandbox" is the question.

## Shape to work out in ideation

- When the baseline runs: once per feature at burn start (the audit says "feature start"), and whether it is re-captured per lap or when the feature branch's base moves.
- What is recorded: failing test ids / typecheck error signatures per package; a capability manifest (interpreters, services, docker) discovered by probing, not typed; the exact per-package commands that actually work in the sandbox.
- Where it lives (machinery side of the hybrid store — SQLite, not docs) and how it is injected into both burn and review prompts, with the audit's instruction verbatim: "Diff your failures against this baseline in one command. Do not investigate, do not prove non-authorship, do not build a worktree."
- Rewrite generated VERIFY blocks to sandbox-safe per-package commands derived from the manifest.

## What this must NOT swallow

- Ticket preflight (C2, separate draft `ticket-preflight`): that checks a ticket's premises against the code; this checks the environment's state. Different input, different moment.
- Persistent warm caches (B0, draft `persistent-burn-cache-volume`): that makes verification cheaper; this makes it unnecessary to repeat. Independent.
- Any agent-behaviour limits or budget commentary — the operator has ruled those out (audit B2 decision).
