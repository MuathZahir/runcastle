# Outcome — Burn guard and prompt rules

Burn guard: add two hard denials to burn-guard.ts (packages/server/src/workflows/burn-guard.ts, the RULES table that drives both the in-container grep -E and burn-guard.test.ts): (1) any `sleep` with an argument > 30 seconds; (2) any `until`/`while` shell loop whose body invokes a typecheck (`tsc`, `typecheck`) or a test runner (`vitest`, `jest`, `pnpm test`, `turbo run test`, etc.). Evidence: one burn spent 1060 s (17.7 min) in explicit sleep plus `until …typecheck…; do sleep 20; done` polling loops. Denial reason should say polling and long sleeps are never needed in a burn — run the command directly and read its output. Operator decision: NO verification budget, NO typecheck/test counters, NO budget commentary — these two are the only additions; do not add anything that limits how often an agent may typecheck or test. Add unit tests for both rules including non-matches (`sleep 5`, a `while read` loop over a file).

- Shipped: 2026-08-27
- Lap: 1

## 1. Burn guard: add two hard denials to burn-guard.ts…

_no digest captured_

## 2. Burn guard: close the bypass routes around the heredoc-edit rule.…

What was done
Added burn-guard denials for `node -e`, Perl in-place options including `-0pi` and `-i`, and multi-range `sed -i` deletion surgery.
All new denial reasons direct the burner to the Edit tool.
Preserved raw commands only for the sed rule because its prohibited program is quoted; existing rules still inspect quote-stripped commands.
Added match coverage for every requested route and non-match coverage for `sed -n`, `node script.js`, `perl -e`, and a `while read` loop.
Verified the same ERE patterns through the generated POSIX shell script with real `grep -E` and `jq`.

Surprises
The quote-stripping safety mechanism required a per-rule raw-command opt-in for quoted sed programs.
The full suite had five unrelated environment/timing failures: inherited `GIT_PAGER`, inherited Claude OAuth credentials, and process-group teardown timing; the changed test file passed.

Left undone
No drive machinery changed because this ticket adds no service, required boot environment variable, seed, or companion process.
No unrelated suite failures were modified.

## 3. Burn prompt: state the guard's denial list verbatim in the burn system…

What was done

The burn prompt's guard-notes block now enumerates every guard denial.
Each bullet is the exact `reason` string from `GUARD_RULES`, so prompt and hook cannot drift.
The enforcement introduction remains conditional on whether the sandbox guard is installed.
Both implement-ticket and conflict-resolution prompts inherit the generated block through their existing placeholder.
Unit coverage asserts every table entry is rendered verbatim and preserves truthful disabled-guard wording.

Surprises

The prior prompt summarized three categories even though the current table already contains four rules.
The prescribed full suite inherited pager and Claude-token variables that invalidate unrelated environment-sensitive tests.
With those variables removed, unrelated pager failures shifted from `GIT_PAGER` to `PAGER`; a PTY teardown timing test also remained red.
The affected prompt unit file passed all 146 tests with the injected Claude token removed, and typecheck was fully green.

Left undone

No verification budgets, test counters, or adjacent guard rules were added.
No drive machinery changed because this prompt-only change introduces no service, boot variable, seed, or companion process.

## 4. Burn prompt: subagent policy. Add to the burn system prompt: "You are…

What was done

Added the burn prompt's single-writer rule to the run-constant prefix.
Restricted subagents by instruction to reading and reporting only, with no edits or tests.
Bound reports to 40 lines, file:line pointers, one-sentence claims, and no source quotation.
Required the parent to tell subagents what was already searched.
Added a rendered-prompt unit test covering every clause.

Surprises

Claude Code supports tool restrictions on explicit agent definitions, but --settings has no
documented way to make every subagent read-only without also restricting the parent.
The implementation is therefore prompt-only, as the ticket directs for that case.
The exact full test command hit unrelated inherited-environment and process cleanup failures;
the touched test file passed 147/147 with credential variables removed, and typecheck was green.

Left undone

No generated settings or drive machinery changed; this ticket adds no boot-time infrastructure.

## 5. Burn prompt: commit-cadence nudge, soft. Add one sentence near the…

What was done

Added the requested soft commit-cadence guidance to the unattended burner prompt.
The sentence sits directly beside the existing instruction to commit each green slice.
It recommends 3–4 slice commits and folding comment-only or formatting-only edits into the next slice.
No burn guard code or drive machinery was changed.

Surprises

Typecheck passed across all configured packages and scripts.
The full test run exposed five unrelated host-environment failures involving GIT_PAGER, an OAuth token, and process teardown.
The focused prompt-rendering seam passed all 10 selected tests.

Left undone

No adjacent prompt wording, guard behavior, or test infrastructure was changed because it was outside this ticket.

## 6. Review the integrated change

This lap did not deliver the burn-guard or burn-prompt changes it set out to add.
The integrated feature branch contains no branch-only commits and no diff against its fixed base.
All five implementation tickets finished in the failed state, so the existing burn behavior remains unchanged.
Long sleeps and test or typecheck polling loops are not newly blocked.
The edit-command bypasses remain open, and the prompt is not generated from the guard’s denial table.
The promised read-only, concise subagent policy and softer commit-cadence guidance are also absent.
Current Claude Code documentation supports tool restrictions on custom agent definitions,
but does not expose a per-session settings rule that makes only spawned subagents read-only;
that part would therefore need prompt-only enforcement unless the burn supplies custom agent definitions.
There was no operable product surface to drive because the requested work is internal workflow policy
and no implementation landed to exercise.
The review notes separate the five missing requirement groups so each can be promoted independently.
