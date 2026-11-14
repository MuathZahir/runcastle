## Why

The human, 2026-11-14: "having the workers in a separate page on the sidebar is no longer needed. We can probably just nest all the workers under the feature that uses them."

Today a feature row has a "›" arrow (`WorkersArrow` in `SidebarParts.tsx`) that swaps the whole left sidebar to the feature's own page (`workers/FeatureSidebarPage.tsx`, from interactive-workers). That page has a header with back and "+ New worker", a Lead card, then the feature's workers in Needs you / Working / Done lanes. The human picked that drill-in placement back then and has now changed their mind. The page costs a navigation step, and a worker that needs the human sits one level down instead of where they are looking. The project's design rule "a simple path for the human" says whatever needs the human is one click away.

## Direction (orchestrator's recommendations, to settle in the grill)

- **Workers become indented rows under their feature's row**, in the same sidebar. The drill-in page, its header, its Lead card and the "›" arrow go. Clicking a feature already opens its lead, so the Lead card is redundant.
- **Which workers show.** Recommended: live workers (needs you, working, idle with work open) always show under their feature with no toggle, so a worker that needs the human is visible in place. Finished and dropped workers fold into one "N done" line under the feature. They don't vanish, and the list stays short when a feature has had many workers.
- **New worker.** "+ New worker" moves onto the feature row (on hover or in its actions menu).
- **Status words.** A nested worker row uses the four status words from "Needs you is the agent's call": Needs you · <line>, Working, Idle, Merged/Done. Its feature's row still shows the newest need among its lead and workers.
- **Locked features.** On autopilot, nested worker rows show locked the same way their feature does (from epics-on-autopilot).
- **Phone.** Check what the phone layout uses today for a feature's workers and keep it consistent.

## Must not swallow

- What workers are or how they run: this is sidebar placement only.
- The worker chat itself (`WorkerChat.tsx`) is unchanged; clicking a nested row opens it as today.

Planning mode: grill with you
