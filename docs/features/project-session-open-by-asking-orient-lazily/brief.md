# Project session: open by asking, orient lazily

Make the project session's first visible move a question to the human, not an exploration pass.

**The complaint (verbatim intent from the human):** the project-level agent is slow to start — it explores the whole project before engaging. They want it to immediately ask what they want.

**Why it happens:** `packages/skills/packs/runcastle/skills/project/SKILL.md` §0 ("Orient") instructs: "1. Call `get_project_context`. … 3. Listen to what the human brings" — orientation is step 1, listening is step 3. And `get_project_context` returns the charter AND every live ADR IN FULL plus the feature index (observed ~72k chars on runcastle itself), which doesn't fit a context window comfortably and pushes the agent into subagent-digest detours before it says hello. The injected system prompt for project sessions (`renderProjectPrompt` in `packages/server/src/launcher/artifacts.ts`) ends with "Invoke the `/runcastle:project` skill and drive the project session" with no instruction to engage first.

**The fix (two prompt-content edits, no machinery):**
1. Rewrite §0 of the project SKILL.md: the opening move is to greet and ask what the human wants (one line, e.g. "What are we cutting into features today?" — match the skill's voice). Orientation becomes lazy: call `get_project_context` / read feature docs only when intake, routing, or a portfolio question actually needs the answer — and note that the payload can be very large, so prefer targeted reads (the feature index + specific docs on disk) over swallowing it whole when only part is needed. Keep the rest of the skill's contract intact (grilling style, five destinations, charter rules, closing move).
2. In `renderPreparePrompt`'s sibling `renderProjectPrompt` (`artifacts.ts`), adjust the "Your task" line to say: invoke the skill, then open by asking the human what they brought — do not explore first.

**What this must NOT swallow:** do not slim down or restructure the `get_project_context` payload itself (that is a separate design question about the MCP tool's shape — out of scope here); do not change any other skill in the pack.

**Verify:** `bun run typecheck` and `bun run test` (skill content has no tests; the artifacts prompt render may — extend if `renderProjectPrompt` is pinned by an existing test).
