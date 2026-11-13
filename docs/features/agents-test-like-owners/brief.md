## Why this exists

On another project the human watched a feature agent change code, drive the app, find issues, fix, drive again, for over an hour. Nothing tells an agent when to stop that loop, so the human assumed all was well while it went round. In the human's words: "agents sometimes tend to get stuck solving a particular issue instead of zooming out and looking at the bigger picture. Sometimes the answer is just pivoting or changing the whole approach if it seems like its not working. I want the agent to be proactive and work on the projects as if theyre his."

The loop is also expensive. It runs in the lead's own chat, on its strongest model, with a context that grows every round.

The human's idea for the drive itself: a Haiku agent does the test drive, takes screenshots at every major step, and reports its observations; the main model reads the report and the screenshots. The orchestrator measured that this would barely speed up a Review worker (clicking is a small slice of a review), so it was moved here, to the lead's repeated drives, where it fits. The same pattern exists already: designing alone hands screenshot loops to a subagent (packs/runcastle/skills/feature/references/planning-alone.md, "Look at your own screens").

## Decided with the human

1. **Repeated drives go to a Haiku helper.** When the lead drives to check its own work, a helper agent on Haiku does the driving: open the scenario or page, do the steps the lead gives, screenshot each major step, and report what it saw. The lead reads the report and the screenshots that matter, then fixes. Human: "Alright".
2. **Step back after the second failed round.** Before a third fix, the agent asks whether the problem is this bug or the approach: what the failures have in common, and whether a different design makes the problem go away instead of patching it.
3. **Stop after three.** After 3 rounds of fix and re-drive on the same problem without fixing it, the agent stops, tells the human what was tried, what each drive showed and what it thinks is wrong, and waits. Human: "Alright" to the 3-round rule.
4. **Free to change how, asks before changing what.** Rewriting how something works under the hood, switching a library, or throwing away its own code is the agent's call, as an owner would make it; it tells the human in one line what it changed and why. Anything that changes what the human gets (a different screen or behaviour, a dropped requirement, going against something they decided) is brought to them with the problem and a recommended new direction, and they decide. The line is the same one as "never guess what, where or who". Human: "Yes".
5. **Owner outside the task too.** When the agent notices something broken or badly built nearby, it says so and offers to add it to the backlog as a new feature. It neither ignores it nor quietly fixes it inside this feature.

## What it must not swallow

- The scenarios the helper starts from belong to "Each feature's own scenarios", built in parallel; this guidance should work with or without a feature scenario (fall back to the page or route).
- Review speed belongs to "Faster, cheaper reviews". A Review worker stays one agent.
- Workers already have a runaway guard; extend the same spirit to workers where it fits, without new machinery. This is guidance in skills, not code.
- The skill text has size caps tested in the repo; make room by tightening, not by raising caps without saying so.

Planning mode: plans itself
