# Brief

## Why this feature exists

The human, 2026-10-24, describing a whole-app redesign run through the orchestrator: the orchestrator creates a feature per area (sidebar, settings, …) and stops once each is designed. "When they're done, I would go through all the features one by one looking at the design (maybe the preview in the design server, not the html one, can be created when I'm not there and opened when I want to see it and approve). I can approve the design or iterate with each feature's agent until things look good."

This is runcastle's edge: the human approves the look, with sample data, before anything is wired. That is the cheapest point at which to catch the most expensive rework.

## What exists

- **Design mode** (docs/features/design-mode/decisions.md) runs only in a chat the human is attending. The agent builds preview pages served by the project's own frontend dev server and shows them in the panel beside the chat. When the human approves a design, the chat commits it as `design: <what>`; unapproved work stays uncommitted (#6). The panel can open a screen's preview page and start the dev server if needed.
- **Self-planning runs** (`features-plan-themselves`, `whole-cuts-plan-themselves`) plan a feature headless, with nobody watching. Today they do not design anything.

## Settled with the human

- The previews are the **design server's** preview pages, not the plan's HTML preview (`preview.html`).
- **No dev server runs while the human is away.** It starts when the human opens the design to look. Dependency installs per feature are the machine cost, not dev servers.
- The human approves or iterates per feature in that feature's chat. A larger change across features goes through the orchestrator (sibling feature).

## Open — the uncertain piece of the cut

- **Are designs made with nobody watching good enough to be worth reviewing?** This is what the human wants to test first. Suggested first lap: one feature designs its screens on its own, then a test drive judges the result.
- **The agent designing blind.** With no dev server while away, the agent never sees its own screens. It could start one briefly to check its work (screenshots), then stop it. Weigh that against the charter's "starting the app is the expensive step". Note the frontend dev server alone is much lighter than a full drive.
- **Where unapproved designs live** while they wait: uncommitted in the worktree (today's rule), or committed as a proposal.
- **How "design ready" shows up** for the human. It likely sits under Needs you, using the status model from *Tickets and review are tools, not phases*. Opening the feature then opens the design pane on its preview.

## Must not swallow

- The orchestrator's part: creating the cut, batching "N designs ready", and cross-cutting changes. That is *One orchestrator, no mode*.
- Removing Go, and tickets and review as tools: *Tickets and review are tools, not phases*.
- Wiring designs to real data. That stays in tickets or the agent's own build work after approval (design-mode decision on tickets that wire a designed screen).

## Ordering

Third of the 2026-10-24 cut. Waits on *Tickets and review are tools, not phases*, whose status model "design ready, waiting on you" should fit into. It is independent of *One orchestrator, no mode*, but pays off most with it.
