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

To fill in before ready: the "Agents test like owners" brief planned by the new lead skill, beside
its original 20 decisions.
