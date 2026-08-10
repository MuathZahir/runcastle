## Why this exists

The human keeps having feature-shaped ideas at the wrong moment — usually while working on something the new idea depends on, or when they simply don't want to start it yet — and then forgetting them. Runcastle's only home for a parked idea today is one line in the charter's `## Deferred / open threads`, which is deliberately hostile to backlogs: stored lists decay into graveyards, and regenerable findings shouldn't be stored at all. But this case is exactly what that stance handles worst: an idea that is *already feature-shaped*, with worked-out reasoning behind it that a one-liner throws away. The brief is the non-regenerable part — that's why this deserves a draft status rather than a charter line.

## What it is

A feature can be created in a **`draft` status**: title, one-liner, and brief — **and nothing else**. No branch, no worktree, no docs dir. The brief lives in the app's SQLite until activation.

- Drafts appear in the rail, visually parked (clearly distinct from in-flight features).
- A **Start** action activates a draft: it runs the normal create-time machinery *at that moment* — cutting the feature branch from the then-current base, writing `brief.md`, entering ideation as usual. This is a deliberate design decision (settled during intake): branch-at-Start **dissolves the staleness problem entirely**. There is no dormant branch to rebase because the branch doesn't exist until work begins. Do not build create-branch-then-refresh-later machinery — that's mechanism serving nothing (charter principle: flexible guidance over brittle machinery).
- Two creation surfaces: the New Feature form gains a "save as draft" affordance, and the agent-facing `create_feature` MCP tool gains a `draft?` flag — so the project session and a grilling session mid-flight ("this is really a second feature — parking it") can park an idea with its reasoning attached.
- Drafts presumably need a delete/discard affordance too, so the rail doesn't itself become the graveyard the charter stance guards against.

## What it must NOT swallow (settled during intake)

- **Dependency modeling.** "Depends on feature X" stays *prose in the brief* ("start after X merges") — never a modeled edge with blocking semantics, ordering, or auto-activation when X ships. The moment drafts know about each other you've built a scheduler; that is a different, much bigger feature.
- **Prioritization / reordering** of drafts. Out.
- **A backlog board UI.** Drafts are parked cards in the existing rail, not a new surface.

## Charter interaction

This amends the charter's "no backlog; parked ideas are one-line deferred threads" stance. The feature should land a small ADR recording the amended position: draft features are the home for *feature-shaped* parked ideas (non-regenerable brief attached); `## Deferred / open threads` remains the home for sub-feature-sized threads. The project-session and grilling skill guidance that says "there is no draft feature status" needs updating to match.
