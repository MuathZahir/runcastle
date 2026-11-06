## Purpose
The docs at `site/docs/` (runcastle.dev/docs) were written long ago and only re-skinned since. They describe runcastle as a Claude Code UI ("the IDE to Claude Code's text editor", "requires Claude Code") though Codex is equally supported, and they describe machinery that was removed: the old pipeline (ideation → spec → tickets → implementation → review), gates, the preparation session. The human (2026-11-05): "The docs should be simplified too and some screenshots from the app should be added", and the whole site has "way too much text".

## Understood
- Pages today: `docs/index.html` (1.4k words), `pipeline/` (1.5k), `gates/` (1.2k), `preparation/` (1.6k), `project/` (1.3k), `vps/` (0.8k).
- `gates/` and `preparation/` describe removed things: delete them. `pipeline/` gets rewritten as how a feature actually goes today (Planning, Build, Review, Shipped: talk it through with the feature's agent, it plans and writes tickets, rounds of sandboxed workers build, review with a walkthrough, test drive, merge). Check the current flow against the code and the shipped features' docs (`docs/features/*/decisions.md`, e.g. `tickets-and-review-are-tools-not-phases`, `one-orchestrator-no-mode`, `the-feature-lead-runs-rounds`, `design-mode`, `drive-scenarios`, `the-orchestrator-prepares-the-project`) rather than the old charter text, which is stale.
- Claude Code **or** Codex everywhere.
- Much less text: short pages, a screenshot doing the work a paragraph used to. Fewer pages is fine.
- **Screenshots must be real captures of the app**, not mockups. The README's ones (`site/assets/screens/`) were made this way: copy the real `~/.runcastle/runcastle.db` with `VACUUM INTO` into a scratch data dir, delete every project but `runcastle-demo`, clone its repo to a short path, boot the server from the checkout with `RUNCASTLE_DATA_DIR=<scratch>` and `DO_NOT_TRACK=1`, stage live burns/reviews by DB inserts *after* boot (boot reconcile sweeps running runs). Playwright: wait on `load` plus a settle time, never `networkidle` (the SSE stream never idles); a running drive adds a notice to the review page, so capture that last. Never touch the human's real data dir. Put new captures under a docs-specific assets folder.
- Update `site/sitemap.xml` and any nav for removed/renamed pages. Old URLs that disappear (`/docs/gates/`, `/docs/preparation/`, `/docs/pipeline/` if renamed) should redirect via a Cloudflare Pages `site/_redirects` file to their nearest replacement, since they are indexed.

## The pitch (shared, settled by the human in the project session)
runcastle is **the software development engine** (the new landing headline): it runs the software process for you — cut the idea, plan, design in your real app, build in sandboxes, review, test drive, merge — where other tools hand you an agent and leave the process to you. The moat is streamlining the process and making the developer's life easier, not code safety. The docs intro opens on this claim.

## Must not swallow
- The compare pages (`site/compare/`) belong to the sibling "Compare posts that sell runcastle"; do not edit them. That feature will link only to this feature's new docs URLs; record your final URL list in decisions.md early so the orchestrator can pass it over.
- The landing page (`site/index.html`, generated) belongs to "The software development engine".
- `content.css` is owned by the compare feature (it is restyling it as a blog reading surface). Keep any change of yours to `content.css` small and additive (e.g. a screenshot figure style), or put docs-only styles elsewhere, to avoid a conflict.

## Open
- The exact page set and order: the agent's call.
- Whether the VPS guide still holds as written: check it against the shipped `move-runcastle-to-another-machine` feature.

## Ordering
No dependencies; runs in parallel with the landing and compare features. The orchestrator deploys runcastle.dev after all three merge.

## Working agreement (cut of 2026-11-05)
Autonomous: the orchestrator carries this to merged, merging when the feature's own review is clean, and the human comes back at the end. The human chose this.
