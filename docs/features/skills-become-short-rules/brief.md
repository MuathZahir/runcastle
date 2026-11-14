## Why

The human, 2026-11-13: "we might be overcomplicating things... micromanaging the agents with so many details and processes... I don't want to give agents a guide on every single scenario and circumstance possible. I want it to have a set of rules and act intelligently based on them."

The prompt audit from the same day:

- **Load.** An orchestrator starts with about 12–16K tokens of instructions and a lead with about 8K. Workers (about 1K) and reviews (about 3K) are lean.
- **Make-up.** About half of it is step-by-step procedure for specific situations, and about 15% is patches written after one incident.
- **Duplication.** "Never guess what, where or who" appears word for word in 5 places, and a test (never-guess.test.ts) keeps the copies identical. The one-place-to-answer rule and the orchestrator's prohibitions are repeated too.
- **Contradictions.**
  - The lead's briefing (`launcher/artifacts.ts`) says "one round at a time", while its skill says there are no rounds.
  - The orchestrator skill says "nothing here is a procedure" and then gives procedures.
  - Its "Do NOT" list restates rules given above it.
- **Sizes.** project/SKILL.md is 26.7K, pinned at a tested cap. intake.md is 18K, preparation.md 23K, feature/SKILL.md 15.7K, planning-alone.md 12.5K.

The transcript audit agrees on the cost. Process leaked into onboarding (preparation) and planning. Plans grew huge: "Agents test like owners" came back with 20 decisions for five sentences of intent. Meanwhile the few rules that matter most stayed weak: when to ask versus decide, plain words, and stepping back when stuck. What worked was one question at a time with a recommendation, honest ownership of mistakes, and fully handed-off runs.

## What the human wants

Each main skill is a short set of rules the agent applies with judgement, plus the tool contracts (which belong in the tool descriptions where possible). There are no per-situation procedures.

## Direction (to grill, not settled)

- Lead and orchestrator skills: about 10 rules each. Fold intake, preparation and planning-alone into the rules, or cut them to a page each.
- One copy of each rule. Drop the test that pins duplicates and pin behaviour instead.
- Fix the "one round at a time" line in the lead's briefing.
- Keep the rules the human cares about most:
  - the human decides what they get;
  - ask one question at a time with a recommendation;
  - write in plain words;
  - change how something is built freely, and ask before changing what they get;
  - step back after two failed tries and stop after three;
  - offer nearby problems as backlog.
- Planning records only the decisions the human actually made or must make, not every edge case.
- Add a charter principle: when something goes wrong, sharpen an existing rule rather than add a paragraph or a mechanism.
- Measure before and after: tokens at the start of a session, and one real feature run start to finish.

## What it must not swallow

- Machinery changes belong to "Needs you is the agent's call" and "Ownership is a label".
- The skills here should describe those simplified worlds. If they merge first, this follows them; otherwise keep the wording neutral.

Planning mode: grill with you
