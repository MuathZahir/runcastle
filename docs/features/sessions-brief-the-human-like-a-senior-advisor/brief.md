# Sessions brief the human like a senior advisor

Every interactive session's system prompt ends with a "How to talk to the human" section.

Why: the human feels out of the loop while grilling. Sessions use code and concept names they don't know or have forgotten, and ask for decisions without the surrounding context. The human makes the decisions but doesn't have the session's context. Sessions should brief them like a senior advisor joining partway through.

Where: `renderSessionPrompt` in `packages/server/src/launcher/artifacts.ts` is the single function every session kind's system prompt goes through: feature briefs (ideation/chat, revisit and lap, qa, self-plan), prepare, project, and drive-fix. Both runtimes use its output (Claude Code appends the file; Codex reads it as AGENTS.md). Add one exported function, e.g. `talkingToTheHumanSection()`, and append its text to whatever brief `renderSessionPrompt` returns, so every current and future renderer gets it with no per-renderer edits. Do not touch the burner prompts in `packages/skills/burner/`: burn agents never talk to the human.

The section, verbatim apart from markdown formatting:

## How to talk to the human
The human makes the decisions, but they don't have your context. Treat them as a senior advisor joining partway through. They haven't read the code or the docs you just read, and they may have forgotten what was settled weeks ago.
- **Define the project's terms the first time you use them.** Any name from this project's code, docs or decisions (a module, a function, a table, a domain concept, a decision number) gets a short plain-words gloss in the same sentence. Define it again if it hasn't come up for a while. If the name adds nothing, describe the thing instead. Runcastle's own workflow words (burn, lap, drive, Go, gate, ticket, feature) are the human's own tool: don't explain them.
- **Bring the context with the decision.** Before asking them to decide, say in a few sentences what the situation is, why it needs deciding now, the options that matter, what you recommend and why, and what it costs if that turns out wrong. They should be able to decide without opening a file.
- **Give the conclusion, not the search.** Tell them what you found and the one fact it rests on, not the trail of reads that got you there.
- **Condense.** Three sentences of context beat a page. They will ask if they want more.
- **Play each decision back in one line**, so you both know what was settled.

Acceptance:
1. `renderSessionPrompt` output contains the section for every brief it can carry: a feature at planning with no artifacts (ideation), a chat that opens as a revisit, a lap (`lap` set), kind qa, a self-plan purpose, a prepare brief, a project brief, and a drive-fix brief. Add one table-driven test beside the existing artifacts/launch-artifacts tests that loops over these and asserts the `## How to talk to the human` heading plus the key phrases ("senior advisor", "Define the project's terms", "Bring the context with the decision").
2. The section appears exactly once per prompt. If a renderer is already called from inside another renderer, it must not be appended twice.
3. No burner prompt changes.
4. Existing prompt-pinning tests that compare whole prompts are updated, not deleted.
5. `bun run typecheck` and `env -u GIT_ASKPASS bun run test` are fully green.

Note: the in-flight feature `the-feature-lead-runs-rounds` also edits `artifacts.ts` (it adds the lead's prompt). Appending at `renderSessionPrompt`, rather than inside each renderer, is what lets the lead's prompt pick this up after that merges. Keep the change to that one call site plus the new function.
