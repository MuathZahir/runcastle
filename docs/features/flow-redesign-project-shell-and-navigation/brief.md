## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui` (lands first). This is flow 2 of 7: the chrome every other flow sits inside. **Order matters:** land this before the ideation→tickets flow and before build→review→ship, because all three touch `Workspace.tsx` and the next-step bar.

## The flow, as it exists

- `apps/web/src/components/ProjectShell.tsx` — assembles Titlebar / Sidebar / workspace / Inspector / StatusBar; owns the global ⌘K keydown and the single active test drive.
- `components/Titlebar.tsx` — brand mark → portfolio, project switcher, ⌘K launcher, cross-project runs pill, server-health dot, inspector toggle.
- `components/Sidebar.tsx` — "Quick" and "New chat" doors in the head, pinned project-conversation row, preparation nudge row, features grouped by triage lane (Needs you / Agent working / In progress / Drafts / Shipped / Archived), show-archived toggle, per-row kebab (`FeatureActionsMenu.tsx`).
- `components/Inspector.tsx` — Details (current gate + knowledge docs → DocPeek) and Activity (raw event feed).
- `components/StatusBar.tsx`, `components/CommandPalette.tsx`, `components/UpdateBanner.tsx`, `components/DocPeek.tsx`.
- Navigation is a single-screen state machine with **no router**: `Shell.tsx` → `lib/use-project-nav.ts` → `lib/workspace.ts` → `lib/project-workspace.ts` (`workspaceView` = create | prepare | project | feature | empty). Whether to introduce real routes (URL per project/feature/phase, so refresh and back work) is **this flow's question to settle**.

## Known issues going in

- The human reports the rail-head **New** button opens the most recent project chat instead of a new one. `ux-issues` ticket 3 (`docs/features/ux-issues/outcome.md`) made New call `talk.start()` with `fresh: true` — so this is a regression somewhere between the button and `talkToProject`; diagnose, don't assume.
- Prior audit (`docs/features/identify-random-issues-throughout-the-system/findings.md`): F7 update banner overlaying everything, F14 health chip hard-coded port, F10.4 entering a project auto-selects an arbitrary feature, F10.5/F18 activity feed leaks raw agent internals and event slugs, F10.8 palette shows "current" instead of the phase, F16 undefined jargon ("grill", "burn", "G1", "lap"). `ui-state-management` fixed the SSE/staleness class — do not reopen it, but verify the shell honours it.
- The Inspector's Details tab shows "Gates are the human approval points…" explainer text on every feature, every time (screenshot from the human) — an example of the "useless text" they want gone.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser first: every entry point, branch, button, menu, dead end — including keyboard paths (⌘K), refresh, browser back, and multi-project switching.
2. Present the complete flow map to the human and get it confirmed before designing. The human will add issues the walk missed.
3. Redesign: simplify, spacious/modern/aesthetic on the foundation's tokens and primitives; cut explanatory copy that repeats itself.
4. Code quality is in scope for this flow's files (dead/duplicated code, oversized components, deep-module seams, component tests).
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules.

## What it must NOT swallow

- The contents of any phase body, the project chat body, preparation, or settings — those are their own flows. Own the frame, the rails, the palette, and navigation between things; not the things.
- The creation doors' *forms* (QuickForm) — the project-chat-and-creation flow owns those; this flow owns where the doors sit.

## Already settled

Charter decision 13 (Bun + Vite/React, xterm terminals). `next-step-bar-affordance-audit` already removed duplicate next-step buttons — read its decisions before re-litigating the bar.
