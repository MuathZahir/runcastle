# Burn guard and prompt rules

## Ticket 1

Burn guard: add two hard denials to burn-guard.ts (packages/server/src/workflows/burn-guard.ts, the RULES table that drives both the in-container grep -E and burn-guard.test.ts): (1) any `sleep` with an argument > 30 seconds; (2) any `until`/`while` shell loop whose body invokes a typecheck (`tsc`, `typecheck`) or a test runner (`vitest`, `jest`, `pnpm test`, `turbo run test`, etc.). Evidence: one burn spent 1060 s (17.7 min) in explicit sleep plus `until …typecheck…; do sleep 20; done` polling loops. Denial reason should say polling and long sleeps are never needed in a burn — run the command directly and read its output. Operator decision: NO verification budget, NO typecheck/test counters, NO budget commentary — these two are the only additions; do not add anything that limits how often an agent may typecheck or test. Add unit tests for both rules including non-matches (`sleep 5`, a `while read` loop over a file).

## Ticket 2

Burn guard: close the bypass routes around the heredoc-edit rule. Extend the deny table so `node -e`, `perl -0pi` / `perl -i`, and multi-range `sed -i 'A,Bd;C,Dd'` file surgery are denied with a reason pointing at the Edit tool. Evidence: agents routed around `python3 - <<EOF` with node -e line-splicing and perl -0pi (one silent no-op sed shipped; one `@@BLOCK@@` placeholder dance). Keep the ERE-subset discipline (the pattern must work in both `grep -E` and `new RegExp`) and keep false-deny risk low: a plain `sed -n` read, `node script.js`, and `perl -e 'print'` without -i must still pass. Tests for every match and non-match.

## Ticket 3

Burn prompt: state the guard's denial list verbatim in the burn system prompt (the template rendered in packages/server/src/workflows/ticket-burner.ts, near the existing tool-usage rules from ADR-0008 decision 5), generated from the same RULES table so it cannot drift. Evidence: six burns each wasted a probe call empirically testing whether the heredoc rule exists. The list is informational ("these commands are denied by a hook; use Edit/Read/Grep instead"); it must not add budget or verification-count language.

## Ticket 4

Burn prompt: subagent policy. Add to the burn system prompt: "You are the only writer in this tree. Subagents may READ and REPORT only — they never edit, never run tests. Reports are ≤40 lines: file:line pointers plus one-sentence claims, zero source quotation. Tell subagents what you already searched so they do not repeat it." Evidence: one burn spawned 8 subagents editing one tree concurrently (three documented edit collisions, one wasted 25-file test batch, and the 17.7 min of sleep-polling existed solely to re-serialize the fan-out); exploration subagents pasted 77.5 KB of prose (~20k tokens, 54 % of that log) into the parent. If Claude Code's settings allow restricting subagent tools per session (check with ctx7 / the Claude Code docs for agent tool policy in --settings), also enforce read-only subagents in the generated settings; if not, prompt only, and say so in the ticket digest.

## Ticket 5

Burn prompt: commit-cadence nudge, soft. Add one sentence near the existing "commit every green slice" rule: "Aim for 3–4 slice commits per ticket; never commit a comment-only or formatting-only change on its own — fold it into the next slice." Evidence: ~20 % of commits were comment/formatting self-review commits that each paid the full post-commit sync cost. This is guidance, not a guard rule; do not touch burn-guard.ts for it.
