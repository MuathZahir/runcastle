# Brief

## Why this feature exists

The human, 2026-10-24: "I don't want there to be a separate orchestrator mode (I want to remove that). The orchestrator agent should be able to do everything (check on a feature's state, talk to the feature's agent, start ticket rounds, etc.). But the prompt should be done well so that nothing unexpected happens."

Their example: "I want to redesign the whole application." The orchestrator grills them as always. It asks how to run it — do the whole thing and merge, or stop once the components are designed so they can look first. It creates the features. The human reviews each design and iterates with each feature's agent, or comes back to the orchestrator for a larger rework ("I want a different theme") that reaches every affected feature. Then they approve and start building, either one by one or by telling the orchestrator to start them all.

The aim is one front door. The human says what they want in the project chat and is pulled in only for taste (does it look and feel right?) and trust (does it work, should it merge?). Everything between runs without them, and nothing happens that they did not agree to.

## What exists

The mode was built by `whole-cuts-plan-themselves` (docs/features/whole-cuts-plan-themselves/decisions.md). It is an experimental project setting (#3). It holds every click, merge included (#4). It works by judgement, not procedure (#5). No limits beyond the human's buttons, and one move stops it (#6). It may act only on features it created (around line 42). An accent ring on the sidebar glyph and an "Orchestrated" tag on the page mark those (#18, line 93). Notifications reach it only while it is live (around line 51; #20). Before creating anything for a cut, it agrees with the human how the cut is run (around line 87). The skill text is the "Orchestrating" section of the project skill (packages/skills, the project pack's SKILL.md).

## Settled with the human

- **No setting.** The project session always has the acting tools.
- **No ownership and no marker.** Remove the accent ring and the "Orchestrated" tag. The orchestrator may act on any feature. Its instructions keep it to what the human asked, or to a cut whose working agreement the human made. It never competes with a feature the human has a chat open on (the existing "the feature is busy, wait" rule).
- **Instructions stay general.** The human was explicit: no task-specific rules such as "for a large redesign, create a foundation feature". The guidance must be judgement the agent can generalise. For example: when several features would change the same shared thing, the change belongs in one place, because otherwise agents edit the same files and drift apart. The orchestrator then works out what that means for each task.
- **Go is gone** (sibling feature). The orchestrator starts work by messaging the feature's agent (`send_to_feature` exists), not by a Go tool.

## Raised by the project session, for this feature to decide

- **Cross-cutting changes.** "Tell every feature to change the theme" sent to N agents means N edits of the same shared files: conflicts and drift. The general instruction above should cover it. Decide how the orchestrator explains its choice to the human.
- **Judging parts, not the whole.** Each feature branches from main and cannot see its siblings' changes, so the human reviews one screen next to the old others. The general "one place for shared things" judgement plus ordering (`dependsOn`, ADR-0013) mostly answers this. Decide whether more is needed.
- **Batching interruptions.** Six features each needing approval is six pings. The orchestrator should gather them ("4 designs ready for you").
- **Which features' events reach the orchestrator** now that ownership is gone. Likely: the ones it acted on, or that are in a cut it is running.
- **Dependency installs** are the main machine cost when many features work at once. The human noted dev servers start only when they open one, so installs are the load. Decide whether the orchestrator paces them.

## Must not swallow

- Removing Go and making tickets and review into tools: that is *Tickets and review are tools, not phases*, which this waits on.
- Designs made while the human is away: *Designs wait for you*.
- Relaunching the orchestrator headless when it is not live. It was considered and rejected in `whole-cuts-plan-themselves`. Reopen it only if the human asks.

## Ordering

Second of the 2026-10-24 cut. Waits on *Tickets and review are tools, not phases*, because the orchestrator's tools and instructions must speak to the feature agent that feature creates.
