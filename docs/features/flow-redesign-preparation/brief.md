## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui`. This is flow 4 of 7. It is small and was nearly folded into the project-chat flow; it stays separate because its user story is distinct ("make this repo drivable and burnable") and it has been reworked twice already with the human still unhappy with discoverability.

## The flow, as it exists

- `apps/web/src/components/PreparationWorkspace.tsx` — full-body preparation conversation on the human's own machine (verify commands, test baseline, install/dev/db commands); auto-lands here for an unprepared, feature-less project.
- The rail-foot nudge in `Sidebar.tsx`, the ⌘K "Preparation" action, and the findings shown in Settings → This project.
- Server: `packages/server/src/services/prep.ts`, `launchPrepareSession`, the `prepared`/findings model; the dry-run drive from `preparation-proves-its-findings`.

## What is already decided about it (read before re-litigating)

- `docs/features/improve-preparation/` — preparation is always interactive (AFK prep removed); the featureless whole-page CTA; the rail-foot reminder.
- `docs/features/preparation-proves-its-findings/` — findings are verified/unverified by a dry-run drive; the drive UI warns on unverified keys.
- `docs/features/preparation-supports-multi-service-projects/`, `prep-prompt-explain-the-host-key-semantics/`, `make-test-drive-clear/`.
- Prior audit F1 (`docs/features/identify-random-issues-throughout-the-system/findings.md`): "prepared" was a monotonic flag that hid both surfaces the moment prep finished; re-prepare undiscoverable; re-run resumed the old conversation; unexplained "8" badge (F17.5); copy never says it opens a terminal session (F17.1). Check which of those the fix tickets actually closed.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser on an unprepared project, a prepared one, and a stale one: entry points (auto-land, rail foot, palette, settings), the session, the findings, re-prepare. Every branch and dead end.
2. Present the complete flow map to the human and get it confirmed before designing.
3. Redesign on the foundation's tokens and primitives; this page is copy-heavy — cut it to what the user must know.
4. Code quality is in scope for this flow's files.
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules.

## What it must NOT swallow

- The test-drive experience itself (build→review→ship flow) — preparation *feeds* the drive; it does not render it.
- Settings (own flow) — if findings should stop living in Settings, say where they go and hand the removal to the settings flow via a decision, don't edit the overlay here.
- The preparation agent's briefing content (launcher/skills) beyond bugs in this path.
