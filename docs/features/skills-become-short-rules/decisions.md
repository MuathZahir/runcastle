# Decisions — Skills become short rules

Planned without the human (a headless planning run, 2026-11-13). Every decision marked
**Assumed.** waits for the human's word. The challenge pass was a separate agent given only
the brief and these decisions.

Check first: 3, 6, 9, 10, 12

## 1. The skills describe today's main
**Decision:** Both machinery features the brief names have merged ("Needs you is the agent's call", and "Epics on autopilot", which replaced per-feature ownership and is what "Ownership is a label" became). The rewritten skills describe that world: one `wait_for_you({ why })`, autopilot instead of owners, no rounds and no tickets. Every leftover line about rounds, tickets, owners or waiting kinds goes, including "one round at a time" in the lead's briefing.
**Why:** The brief says to follow those features if they merge first; they have.

## 2. What the rewrite covers
**Decision:** The lead's skill and the orchestrator's skill, their reference pages, the briefings that wrap those two sessions, and the descriptions of their tools. The worker, review, Q&A and code-review prompts stay as they are; they are already lean.
**Why:** The audit found the load in those two sessions (about 8K and 12–16K tokens at start); workers start near 1K and reviews near 3K.
**Assumed.** Alternative: tidy every session kind in the same pass, so workers get the "stop after three" and plain-words rules too.
**For the human.** Workers and reviews keep today's instructions word for word.

## 3. The briefing holds facts; the rules live once, in the skill
**Decision:** A session's briefing says only what is true of this session: which feature or project, branch, docs folder, whether a human is present, and which skill to open first. Every rule lives in exactly one place, the skill. The briefing's "How to talk to the human" section and its copied rules go.
**Why:** Today the same rule sits in the briefing and the skill, and the two drift apart (the briefing still says "one round at a time"; the skill says there are no rounds). Claude Code keeps an opened skill through compaction, and the briefing already makes opening it the first move.
**Assumed.** Alternative: put the rules in the briefing (always in view) and drop the skill body.
**Challenged:** A skill has to be opened; if an agent skips it, it has no rules at all. Keep a very short core of rules in the briefing.
**For the human.** Where an agent's rules come from changes; if agents start ignoring them, this is the first thing to revisit.

## 4. Tool contracts go into the tool descriptions
**Decision:** What a tool does, refuses and returns is written in that tool's own description, not in a skill. A skill names a tool only inside a rule. Stale tool text goes too (the context tool's description still mentions rounds and ticket rows; the skills name ticket tools that no longer exist).
**Why:** The description is in view exactly when the tool is called, and only for sessions that have that tool.
**Assumed.** Alternative: a short "Tools" section at the end of each skill.

## 5. The charter principle is already there
**Decision:** Nothing is added to the charter (`CONTEXT.md`, the project's vision and locked decisions). Its "Rules, not procedures" principle, dated 2026-11-13, already says to sharpen an existing rule rather than add a paragraph or a mechanism; checked on this branch. The orchestrator has already rewritten locked decisions 9 and 18 to match autopilot (ADR-0022); 18 now reads "A feature is the human's, unless its epic is on autopilot", and the skills are written against that.
**Why:** The brief's ask is met on main already, and the lead may not write the charter.

## 6. The lead gets 11 rules, the orchestrator 12, plus short format pages
**Decision:** The lead's skill becomes 11 rules and the orchestrator's 12, each one or two sentences, drafted in the Plan. What stays in reference pages is format only, read when needed: for the lead, the Plan page, design mode, and the shapes of `decisions.md` and `spec.md`; for the orchestrator, project preparation (the drive scripts and setup facts an agent cannot work out) and the charter's format. Intake, routing, health sweeps and triage fold into the rules or into tool descriptions. Target sizes: lead skill about 5K bytes, orchestrator about 6K, each reference page under 6K.
**Why:** Ten rules carry the judgement, but preparation holds facts that silently break drives when wrong, so it keeps one page. The orchestrator has more distinct jobs (cutting features, preparation, triage, charter, autopilot, merging), hence 12.
**Assumed.** Alternative: exactly ten rules each, with preparation cut to a few lines too.
**Challenged:** Counts and byte targets fixed before drafting are arbitrary; size the rules by what they need.
**For the human.** This is what both agents will run on: the rule lists in the Plan are the product.

## 7. Step back after two failed tries, stop after three
**Decision:** One rule, in both skills, for any problem, the agent's own tries or a worker's: after two failed tries at the same problem, step back and change the approach; after a third, stop and bring the human what was tried and what you recommend, with `wait_for_you` (or the autopilot hand-back when the orchestrator runs the feature). It replaces today's worker-only "runaway guard" and the long stuck section.
**Why:** The brief lists it among the rules the human cares about most; today only the worker case is covered.
**Assumed.** Alternative: keep the worker-only guard and add nothing for the agent's own loops.
**Challenged:** A worker's stop and the lead's own stop may need different actions; confirm they are the same.
**For the human.** Agents stop and come to them after a third failed try at anything, not only a worker's.

## 8. A plan records only the decisions the human made or must make
**Decision:** In any planning, grilled or alone, `decisions.md` holds only what changes what the human gets or what they might overturn. How it is built goes to the spec. A plan with many decisions for a small intent is a sign to offer a split.
**Why:** "Agents test like owners" came back with 20 decisions for five sentences of intent; the human reads every one before their yes.
**Assumed.** Alternative: keep the depth rule as written and let size follow.
**Challenged:** A fixed count ("more than about ten") is a crude trigger; judge by decisions against the size of the intent. (Taken: the count is gone.)
**For the human.** Plans get shorter; edge cases move to the spec, which they need not read.

## 9. Planning alone shrinks to one page
**Decision:** The headless planning page keeps only what differs from a planning chat: plan in one turn, decide as you would recommend and mark it assumed, pick at most five to check first, never start work, design screens only where the feature reshapes them, leave designs uncommitted, end on the plan card and one question. Question rounds, the depth rule, the separate "challenger" agent and the "For the human" mark go; every recorded decision is now one the human must see (decision 8).
**Why:** The page is 12K of procedure for a run whose output the human reviews anyway; the challenger adds an agent run and more decisions, the opposite of decision 8.
**Assumed.** Alternative: keep the challenger as the one guard against a planner's blind spot.
**For the human.** Self-planned features stop carrying a second agent's objections.

## 10. Size budgets replace tests that pin wording
**Decision:** The tests that pin exact sentences go: the one that keeps the four "never guess" copies identical, and the phrase checks on both skills. Each entry skill and reference page gets a size budget test at the sizes in decision 6, so growing a skill means sharpening a rule, not adding one. Tests of what a briefing must carry for its session (facts, the skill to open) stay.
**Why:** Phrase pins made every rewrite a test rewrite and froze duplicates in place; a budget enforces the charter's "sharpen, don't add" without freezing words. One such cap already exists on the orchestrator's skill (28.5K).
**Assumed.** Alternative: no size budgets, only the before-and-after measurement.
**Challenged:** A budget test is new machinery; it will force cramming or fail a good fix. Rely on measurement instead.
**For the human.** Future incident fixes must fit the budget, or raise it on purpose.

## 11. Measured before and after
**Decision:** A small script prints what each session kind starts with (briefing, entry skill, its tools' descriptions), in bytes and estimated tokens. It runs on main before the work and on the branch after; both numbers go in the feature's outcome. Before ready, one behaviour check: a subagent plans a past brief ("Agents test like owners") by the new lead skill, and its decision count and plan size are set beside the original's. The "one real feature run" happens after the human publishes and reinstalls, on their next real feature; it does not hold the merge.
**Why:** Live sessions run the installed version, so a real run can only show the change after publish; the replay gives behaviour evidence before merge at the cost of one subagent.
**Assumed.** Alternative: run a full benchmark feature on both versions before merge.
**For the human.** Their next real feature after publish is the real test.

## 12. The human approves the rule lists in the Plan; workers write on their own
**Decision:** The Plan carries the drafted rules for both skills; the human's yes or edits there settle the rule lists. Each skill is then written by an "on its own" worker from the agreed list, and the human reads the final text at review.
**Why:** The rules are the product, so the human's yes on their text is required; but sitting through two wording sessions is the detail-managing the human asked to stop.
**Assumed.** Alternative: two "with you" workers, so the human polishes each skill's wording before it hands back.
**Changed by the orchestrator:** it judged two "with you" sessions too much of the human's time, given they want to stop managing details.
**For the human.** They see the final wording only at review, not while it is written.
