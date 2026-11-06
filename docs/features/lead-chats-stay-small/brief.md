## Purpose

Quick-win cut from the token analysis (2026-11-06), and the safety net under the worker model: even once leads hand work to workers, their own window still accumulates. Feature chats were 1.3B of ~1.85B chat tokens in two weeks, 99% of it the agent working alone; 58% of it spent above 300k context.

## Findings (evidence)

- **Nothing compacts.** No feature chat compacted except one early Windows session (comment in `launcher/sessions.ts` ~565 confirms runcastle has no compaction). 22 sessions peaked above 400k, max 719k. A replay of the real calls: compacting at 200k down to ~70k saves ~600M; at 300k ~400M. 28 of 35 chats start with a self-planning run that ends at ~230k (up to 354k) in the same window that later builds.
- **Cold resumes rebuild everything.** 76 resumes after ≥1h idle rewrote the whole context (18.3M cache-write tokens, ≈37M input-equivalent; 42% of all cache-write spend). Median gap 4.4h. Example: 192b474a rebuilt 620k in one call; f750479c wrote 490k for a 6-call merge.
- **The lead does hands-on work itself at huge context**: reading code ~1,831 calls (~430M incl. carry), editing ~1,556 (~350M), browser + screenshots 859 (~220M; 514 image reads, 55 re-reads of the same file), tests/typecheck 317 (73M). Only 48 subagent spawns, almost all "challenge the plan" or review. `feature/SKILL.md` "Build it the cheapest good way" says build it yourself, "a whole small feature included". Self-planning reads ~58k of source into the lead (987 cat/sed/head + 601 Reads in total), carried for ~77 later calls (~290M).
- **Editing through scratch scripts**: 157 Writes of Python patch scripts to /tmp (780k chars), 43 failed heredocs ("unexpected EOF"). Likely because the lead reads with `sed -n`, so Edit's read-first rule never applies.
- 58 of 113 subagents ran on Opus because no model was set; read-only mapping tasks belong on a cheaper model.

## Direction (lead decides the details)

- Compact (or start a fresh lead thread seeded from the docs — "the docs are the artifact") at the natural breaks: self-plan done (`threads/lifecycle.ts` ~76), round back, ready declared; and before a turn when the last call was >55 minutes ago and context is >150k. `agentHost.compact` / `host.compact` exist. Consider an `autoCompactWindow` (~200k) in the per-session settings.
- Feature skill: the lead prefers delegating. The codebase survey in self-planning runs in an Explore-type subagent that returns a short map; screenshot critique loops run in a subagent that returns a verdict and the final picture path; mapping subagents name a cheaper model; edits use the Edit tool.
- The human said (2026-11-06) the lead **may still write code itself** when handing it off isn't worth it — the skill should prefer delegating, not forbid doing.

## Must not swallow

- Workers (`workers-prototype…`, `interactive-workers`): this uses the agent's own subagents, not runcastle workers.
- Burns' compaction → `cheaper-burns`. Orchestrator chat size → `agents-are-woken-only-when-it-matters`.
- Tool-result slimming and skill trimming → `tools-and-skills-say-less` (coordinate on `feature/SKILL.md`: both edit it).

## Working agreement (cut 2, agreed 2026-11-06): autonomous

The orchestrator carries this to merged on its own judgement, after the lead's review round.
