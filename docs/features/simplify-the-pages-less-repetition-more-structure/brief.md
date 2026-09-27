## Why this exists

From notes triage on 2026-09-25. The human's note: "I want to simplify some of the pages. I feel like there's some redundant information already found in other pages and in the same page too. Also, some pages need more structure, they feel a little overwhelming to look at." Screenshot (read it): C:\Users\user\.runcastle\project-notes\pnote_saPi96RosuRQ.png. It shows a shipped feature's page ("Settings shows step models through the legacy migration").

Two separate complaints, both real:

1. **Redundancy.** The same fact is stated more than once. On the screenshot's shipped feature page alone:
   - The ticket tally appears three ways, and they don't even agree: the summary says "Tickets 1 of 1 landed", Check details says "Tickets 2/2 done", and Run says "succeeded · 2/2 tickets done". One of those counts the review ticket and the other doesn't.
   - The review outcome appears twice: "Review — Reviewed this build" in the summary, and "Reviewed 1d ago · Verified gates mode" on the Lap 1 line, repeated again as ticket "#2 · Review — gates mode, verified".
   - "Checks 2 of 3 passed" in the summary sits above an expanded "Check details" block that restates it.
   The human also said information repeats *across* pages, so the ideation session should find which facts the feature page, the rail/sidebar row, the review page and the burn page each repeat, and decide which page owns each fact.

2. **Structure.** Some pages are a long flat column of equal-weight rows and sections (summary rows, lap trail, "Questions asked", then three collapsibles), with nothing saying what matters most in the current state. The ask is a clear hierarchy: what the human needs first, and what can recede.

## Scope we agreed on

- **First lap = the feature page, across its phases** (planning, building, review, shipped). It's the page the human lives on and the one in the screenshot. Other pages (settings, burn page, home) come in later laps, once the approach is proven here. Park them in the spec's `## Later laps`.
- This is an information-architecture and layout pass on existing surfaces. It is **not** a restyle: the design system (apps/web/DESIGN.md, apps/web/STYLE.md, theme.css tokens, and the recent "add color" / "consistency pass" commits ebc6eaab and 56480286) is settled and stays.

## What it must not swallow

- **Loading states / skeletons.** Handled by the triage batch "Triage batch — loading states, icons, and the sidebar and note-box polish" (skeleton for the feature page) and the parked quick change "Skeletons for every loading state".
- **Tickets not visible during planning.** A bug with its own quick change, "Planning shows the tickets it already has". Don't fold it in here, but its ticket list will be on the feature page this redesigns, so design around it.
- **New information or features.** Simplifying means removing and reordering, not adding surfaces.

## Sequencing

Parked as a draft on purpose: the triage batch and the planning-tickets fix both edit the feature page (Workspace.tsx and its bodies). Start this after they merge, so it redesigns the page as it actually is.

## Portfolio notes

Neighbours worth reading before grilling: `review-as-a-lap-trail`, `review-arrival-is-legible`, `four-states-and-two-hard-rules`, `flow-redesign-build-review-and-ship` (all shipped, docs under docs/features/<slug>/). They produced much of what now reads as redundant, so their decisions.md say why each element was added. Removing something should respect the reason it exists, or state that the reason no longer holds.
