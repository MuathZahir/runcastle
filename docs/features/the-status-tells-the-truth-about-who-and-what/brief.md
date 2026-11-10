## Purpose

The human keeps seeing features under **Working** that are actually waiting on them, and features that are working shown as waiting. Both come from runcastle *guessing* a status from proxies where it could read a fact. This feature makes three such guesses read facts instead. It is a narrow fix, not a redesign of the need rules.

## What the human saw (2026-11-09)

1. **"A better way to move between projects" sat under Working, reading "With the orchestrator · Needs your answer · Which directions to…"**, while its lead had asked the *human* which design directions to mock (via `wait_for_you`). Cause: `you-always-know-what-s-waiting` decision 18 — when an orchestrator thread holds a feature, its holdable waits (`HOLDABLE` in `packages/core/src/feature-need.ts`: answer, plan, stopped, conflict, test, merge) are marked `held`, sit in the working lane, don't ping and don't count for an hour. But since `agents-are-woken-only-when-it-matters` (decisions 19–23), the orchestrator hears nothing about a feature except a lead's `hand_back` and a few machine events (`services/orchestrator-notify.ts`) — a `feature.needs_you` is not among them. So a question the lead put to the human is hidden from the human for an hour while no orchestrator knows it exists.

2. **The same feature dropped out of Working while its lead's background subagent ("Build switcher direction mocks") was still running at 15 minutes.** Cause: `threads-open-fast-and-show-the-truth` decision 2 — `BACKGROUND_WINDOW_MS` (10 min, `packages/core/src/thread.ts`, `threadActivity`) caps how long background work after a turn ends counts as working, because "nothing Claude Code reports separates a test run from a dev server left up". That is no longer true for subagents: the `tasks` event already carries `agents` separately from `tasks`.

3. **In the chat, the running subagent was inside the collapsed "Worked for 50s" fold**, so nothing on screen said work was still going except the composer's "Working 15m 4s". Cause: `every-word-the-agent-writes-stays-in-view` decision 2 — a run of work folds the moment words follow it (`WorkBlock` in `apps/web/src/components/chat/thread/Work.tsx`), regardless of whether a step in it is still running.

## Decided with the human

1. **Who a wait is for follows the tool the agent used.** A lead's `wait_for_you` (and every other wait addressed to the human) always reads as needing the human: Needs you, counts, pings — held or not. "With the orchestrator · …" shows only after the lead hands back to the orchestrator (`hand_back`), until the orchestrator replies (e.g. `send_to_feature`). The `HOLDABLE` guess by need kind goes.
2. **Keep the hour as a safety net** on a handed-back wait: unanswered by the orchestrator for an hour, it moves to Needs you with its plain words, counts and pings, as decision 18's orchestrator change already said.
3. **A running subagent keeps the feature (and its thread) working for as long as it runs.** The 10-minute window applies only to background shell commands (a dev server can run forever). A question still beats running work, as `threads-open-fast` decision 3 says (asks, `wait_for_you`, declared ready, a reply ending in "?").
4. **The fold stays closed while something in it runs, but its line tells the truth**: a spinner and what is running, e.g. "Subagent running · Build switcher direction mocks". It becomes "Worked for …" only once everything in it has finished. It does not open itself — words already shown never move (`every-word…` decision 2 stands).

## Must not swallow

- A wider simplification of the need rules (nine need kinds, "quiet" answers that never ping, the overall precedence). The human chose the narrow fix now; that clean-up is a separate design question for later.
- Any model reading a chat to judge its status. Status comes from facts the agent and the runtime already report.
- Changing what the orchestrator is woken for beyond what decision 1 needs.

## Open (for the plan)

- How "the orchestrator replied" is detected to end a handed-back wait, and what a handback leaves on the feature so the need reads "With the orchestrator" (today a handback sets no need at all).
- Plan yes on a held, self-planned feature: the orchestrator gives that yes. If the lead waits for it with `wait_for_you` kind `plan`, decision 1 would now put it under Needs you. The lead skill probably needs one line: when an orchestrator holds the feature and the wait is the orchestrator's to answer, hand back instead of (or as well as) `wait_for_you`. Settle it in the plan; mark it **For the human** if it changes what the human sees.
- Whether `agents` in the `tasks` event is reliable for Claude Code background subagents (and what Codex reports), and where the same "still running" fact should reach the fold.
- Update the shipped features' decisions this changes only through this feature's own decisions.md (it supersedes `you-always-know-what-s-waiting` 18 in part, `threads-open-fast-and-show-the-truth` 2 in part, and refines `every-word-the-agent-writes-stays-in-view` 2).

## Ordering

A cut of one. Nothing waits on it.

## How it runs

Working agreement: **check-in before merge** — the orchestrator carries it through planning, building and review, then shows it to the human and merges only on their word. Decisions that change what the human gets stay theirs.

Planning mode: **plans itself** — what changes for the human was settled in the orchestrator's chat; only how it is built is left. Any plan decision that changes what the human sees is marked **For the human** and comes to them first.
