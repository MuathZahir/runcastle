## Why this feature exists

Part of the 2026-08-28 decision to make the runcastle web app production-ready by redesigning it **one flow at a time** (see `docs/features/web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui/` — the foundation that lands first). This is flow 1 of 7: everything a user sees before they are inside a project.

## The flow, as it exists

- `apps/web/src/components/FirstRunWizard.tsx` — intro → git identity → pick a coding agent → optional AFK card → open first project.
- `components/PortfolioHome.tsx` — one card per open project (pipeline health, active runs, needs-you), rename, close (refuses while runs in flight), "Open a project" card.
- `components/OpenProject.tsx` — paste/browse a repo path; server validates git repo + default branch.
- `components/DirectoryPicker.tsx` — browses the *server's* filesystem to pick the repo.
- `components/ProjectSwitcher.tsx` — titlebar dropdown across open projects.
- Nav state: `lib/use-project-nav.ts` (`home` | `project` | `open`, persisted in localStorage).

## What the prior audits already found here (do not rediscover; verify and build on)

`docs/features/identify-random-issues-throughout-the-system/findings.md`: F13 (wizard never explains the product, opened on step 2), F17.2–F17.4 (raw error toasts for non-git dirs, no `git init` hint; picker ignores the typed path, 8+ clicks to deep dirs, no path input, junction noise, no git-repo marking; ⌘K hint on Windows), F17.8 ("Close" on a project card is ambiguous), F10.2 (no "while you were away" signal on cards), F10.3 (card stuck in rename state), F20 (long project name breaks layout). Some were fixed by that feature's tickets — check the code, not the list.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. **Walk the whole flow first, with agent-browser**, from a fresh instance AND a returning-user instance. Enumerate every entry point, every branch, every button and menu, every dead end and error path — from start to end.
2. **Present the full flow map to the human and get it confirmed** before proposing any design. The human will add issues the walk did not find. Issues are not the only deliverable — the *flow itself* is what the human wants to confirm.
3. Then redesign: simplify, make spacious/modern/aesthetic on the foundation's tokens and primitives, fix the flow so it is easy to navigate and understand.
4. **Code quality is in scope for this flow's files**: dead and duplicated code, oversized components, seams that should be deep modules, and component tests where there are none — scoped to the files this flow touches.
5. **Migration rule**: move this surface's rules out of `apps/web/src/styles.css` into Tailwind classes as you redesign it, and delete the old rules.

## What it must NOT swallow

- The in-project chrome (titlebar, sidebar, palette, status bar) — that is the project-shell flow, even though `ProjectSwitcher` lives in the titlebar; own the switcher's contents, not the titlebar.
- Preparation (its own flow) even though an unprepared, feature-less project lands there.
- Server-side project open/validation logic beyond bugs found in this path.

## Already settled

Charter: dogfood-first, no auth/onboarding beyond what survives real use — the wizard should stay short. Base branch handling on open is decided in `docs/features/base-branch-control/`.
