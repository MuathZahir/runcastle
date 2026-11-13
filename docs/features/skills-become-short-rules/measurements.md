# Measurements — what a session starts with

From `bun packages/server/scripts/session-start-size.ts` (decision 11): the briefing, the entry
skill (plus the planning page for a headless planning run), and the tools offered to that session
kind (name, description, input schema). Tokens are estimated as bytes ÷ 4.

## Before (main at 679a7661, 2026-11-13)

| Session | Briefing | Skill | Tools (count) | Total bytes | ~Tokens |
|---|---:|---:|---:|---:|---:|
| Feature lead | 3,319 | 16,744 | 12,878 (22) | 32,941 | 8,235 |
| Feature lead, planning alone | 4,423 | 29,003 | 12,878 (22) | 46,304 | 11,576 |
| Orchestrator | 4,820 | 28,327 | 16,784 (30) | 49,931 | 12,483 |

## After

To fill in before ready.

## Replay

A subagent planned the "Agents test like owners" brief headless, by the new lead skill only
(SKILL.md, planning-alone.md, decisions-and-spec.md), against the code at that brief's scaffold
(444db055), without seeing the original plan.

| Plan | Decisions | Assumed | Check first | decisions.md | spec.md |
|---|---:|---:|---:|---:|---:|
| Original (old skill) | 20 | n/a | n/a | 14,616 | 6,299 |
| Replay (new skill) | 10 | 5 | 3 | 4,311 | 3,228 |

Five of the ten are the brief's own "Decided with the human" lines, copied unmarked; the other
five are the replay's assumptions. One pull it reported: the brief put "workers too" under "What it
must not swallow", which the skill does not count as settling what, where or who, so it recorded
that as an assumption to check first rather than asking.
