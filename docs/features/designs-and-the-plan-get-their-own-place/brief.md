## Purpose
The human (2026-11-02): "the distinction between previews and designs could be a little confusing, especially since to open designs, the user should go through the html previews and look for the design buttons. We have 'Review Packages' that appear in chats which I liked … something similar with designs could be useful. Maybe the preview itself could also show as a card too … Maybe the design page should have all the designs created so the user doesn't go through the preview … currently it's not even easy to tell there's a preview and designs waiting for you."

## What exists today (audit, addresses are starting points)
- **Plan preview**: one hand-drawn docs/features/<slug>/preview.html, shown in the panel's Plan tab (PreviewPanel.tsx) when the agent calls `show_panel({view:'plan'})`.
- **Design**: a real component + preview page served by the project's own dev server, shown live in the Design tab (references/design.md §1-5, §8 in the feature skill). Unapproved designs stay uncommitted; approved ones commit as `design: <what>`.
- **show_file**: any file copied into the thread's store, rendered as an inline image or a card (threads/shown.ts, ShownFiles.tsx).
- **Review Package**: a chat card (ReviewPackageCard.tsx) opening its own page — the one that works well.

Friction: the Design tab only exists while the design server runs (panel.ts ~80, Workspace.tsx ~289), and a planning run stops the server when it ends (planning-alone.md ~86), so next day the tab is gone; the only way back is an "Open in design" button inside the agent-written plan HTML (preview.md ~97-104), which lists a design only if the agent remembered to. No list of "all designs" exists. `show_panel` leaves nothing in the transcript. "Preview" names two different things (mcp/server.ts ~3752; the retired `preview → plan` alias in panel.ts ~28). The yes to round 1 commits every uncommitted design even if the human never opened them (design.md §8).

## What the human agreed (2026-11-02)
- Plan and designs each appear as **cards in the chat**, in the same family as Review Package and file cards.
- The **Design tab is always present** and is a **list of every design for this feature**; opening one starts the design server on demand. The list comes from runcastle's own record (e.g. an event the agent records per design), not from agent-written HTML.
- A **badge** on the panel toggle (or equivalent) when there is a plan or design the human hasn't looked at.
- Stop calling designs "previews": it is "the Plan" and "Designs".
Prefer removing machinery: the `data-open-design` bridge in the plan HTML, the postMessage plumbing in preview-frame.ts, the tab that appears and vanishes with the server, and the "designs to look at" prose convention should go if the new shape makes them redundant.

## Understood / open
Understood: the shape above. Open for this feature's own grill: what a design card shows (thumbnail? title + width?), whether approval becomes explicit per design, and how "a design is waiting" plugs into the typed waiting states the "You always know what's waiting" feature builds.

## Must not swallow
The general waiting-state words, header buttons and pings (built by "You always know what's waiting" — reuse them). Review Package internals. App-wide vocabulary renames ("Ready to publish").

## Ordering
Waits on "You always know what's waiting" (up next: starts itself when that merges). "Ready to publish" waits on this.

## Working agreement (made 2026-11-02)
Autonomous: the orchestrator carries this to merged, merge included — except designs: any design waits for the human's own yes (they planned to look on 2026-11-03). This feature is design-heavy, so expect to stop there; gather what's ready into one look. End with a review round as usual.
