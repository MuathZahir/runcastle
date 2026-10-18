# Outcome — Sessions brief the human like a senior advisor

Every interactive session's system prompt ends with a "How to talk to the human" section.

- Shipped: 2026-10-18
- Laps run: 1

## What shipped

5 commits · 3 files

### Lap 1
- 3 tickets landed: #1 Every interactive session's system prompt ends with a "How to talk to…; #3 Headless runs are told "No human is present", then end on how to bring decisions to the human; #4 New renderSessionPrompt test block detaches the AgentRuntime-seam doc comment from its describe
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a1068dba2a9de71095d55a0a762a15add9225adb
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 9e8007711f3c06af192c84aba9cd331c6bd964a2
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Headless runs are told "No human is present", then end on how to bring decisions to the human

# ticket(3) digest

**What was done.** In `packages/server/src/launcher/artifacts.ts` I added one shared line, `OUTRANKS_TALKING_TO_THE_HUMAN`. Both `selfPlanRule` and `headlessRunRule` now end with it. It tells a headless run that its "## No human is present" section outranks the closing "How to talk to the human" section. The run should still use that section's writing rules in anything it leaves for the human to read later, but must never end its turn on a decision for them. I also updated `headlessRunRule`'s doc comment, which used to say it only overrode "the brief above". The single append in `renderSessionPrompt` is unchanged, and so is the closing section's wording.

**Tests.** In `packages/server/test/launch-artifacts.test.ts`, inside the existing `renderSessionPrompt` describe, I added:
- a table-driven case for self-plan, relay (headless, lap 2) and a self-started headless lap, asserting the precedence line sits inside the no-human section;
- a case checking that an ordinary ideation prompt does not get that line.

**Repro re-run.** I re-ran the reviewer's repro with its exact inputs. These are the self-plan and relay rows of the new table. Before the fix, the line was missing and all three cases failed. After the fix, the no-human section of both prompts says it outranks the closing section. `bun run typecheck` reported 0 errors. `env -u GIT_ASKPASS bun run test` passed 337 files, with 2 files skipped and 0 failures. That count differs from the 118-file baseline in the prompt, but it matches ticket 2's report.

**Surprises.** None in the code.

**Left undone.** Ticket 2's review found two other problems, and I did not touch either because they are outside this ticket:
- The "qa" row in the closing-section test table actually re-tests ideation, because qa sessions no longer exist.
- The `renderSessionPrompt` test block sits under an earlier test's doc comment, so that comment now describes the wrong block.

**Drive machinery.** I made no infrastructure changes, so I did not edit or check the drive scripts.
