## Why

The human, 2026-11-13: "things should be leading to each other. For example, if the orchestrator wants to tell the user to go work on a specific feature, then he should be able to link the user to that feature and the user just clicks on that directly in the chat. So always think of these ways of making the user's life easier." It is now a charter principle ("A simple path for the human").

**What exists today.** Feature links appear only inside the orchestrator's action cards, through a links context in the web app (`FeatureLinksContext` in `apps/web/src/components/chat/thread/FeatureCardItems.tsx`, provided by `ProjectShell.tsx`). An agent's own words name a feature as plain text. The human then has to find it in the sidebar.

## What the human wants

Any agent (an orchestrator, a lead, a worker) can link the things it names in its reply. The main ones are a feature and a worker's chat; add others if they are cheap, such as a design or a shown file. One click opens the thing. On a phone it works the same.

## Direction (for the lead to settle)

- Pick the simplest syntax an agent writes naturally. One option is a markdown link with a runcastle target such as `[Faster reviews](feature:faster-cheaper-reviews)`. A known slug or title could also become a link by itself. Either way, a link to something that doesn't exist must render as plain text, not as a broken link.
- Add one line to each skill: when you point the human at something, link it.
- Keep it small. This is rendering, plus one rule per skill.

## What it must not swallow

- The status and "needs you" changes, which belong to "Needs you is the agent's call".
- The skill rewrite, which belongs to "Skills become short rules". Add only the one linking line here.

Planning mode: plans itself
