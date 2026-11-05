## Purpose
From a project note triaged on 2026-11-05. The human: "There doesn't seem to be rules on how designs are chosen. For example, the agent created two separate designs that I have to approve for a tweak. One design with the tweak and one without. I think each design should be of one component. We don't do different designs for each tweak... strictly one design per component/page with state controls for the user to test different states."

## Understood (agreed in triage)
- Today the feature skill's design guide (`packages/skills/packs/runcastle/skills/feature/references/design.md`, §2 "One design page per state") makes each state its own design page, so each state is approved separately. The guide also has a **Tweaks** menu for open choices (which of two layouts, a colour), removed before commit. The with/without-tweak pair the human hit broke that existing Tweaks rule.
- **New rule, agreed:** one design per screen or component. Its states (empty, loading, error, full, a dialog open…) are reached through a small state switcher on that one design page. Open choices stay as Tweaks inside the same design. Never a separate design for a variant or a tweak. The human approves one thing per screen.
- A flow across several screens is still one design per screen.
- Why: fewer approvals, and the human can still check every state before approving.

## Must not swallow
No change to how designs are approved, committed or wired into tickets beyond what the rule needs. Not the website work running in parallel.

## Open
- Whether the switcher lives purely in the design page (skill text + a helper in the preview starter / `.runcastle/preview/` fakes) or needs a home in runcastle's design pane. Prefer the in-page route if it serves; only touch apps/web if needed.
- Whether runcastle's own `.runcastle/preview/` helpers should ship a reusable switcher.

## Risk
Small. If wrong, the fallback is today's one-page-per-state paragraph.

## Ordering
Independent of everything else in flight.

## Working agreement (cut of 2026-11-05)
Autonomous: the orchestrator carries this to merged, merging when the feature's own review is clean. The human chose this. Note that the live sessions run the globally installed runcastle, so a skill change reaches sessions only after publish + reinstall.
