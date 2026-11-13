## Why this exists

The human finds drives misused and slow. Agents write one-time scenarios that pile up in the project's permanent list, and those scenarios break as the app changes. Meanwhile a feature agent that drives, finds a problem, fixes it and drives again walks back to the problem through the app on every drive. On another project, a loop like that took over an hour.

The human's idea: an agent captures the state its work needs, "for this feature ONLY so the user can start from that state and other drives too". It should not be a mechanical thing: "it can just be through code or the agent can copy the data from the db, etc..."

What exists today (packages/server/src/services/scenarios.ts): a scenario is a file under `.runcastle/scenarios/` that runs through the project's one runner command and prints `ENTRY_URL=<url>`. Runcastle lists scenarios from git, never reads their contents (that keeps it language-agnostic), names each from its file name ("expired-coupon" shows as "Expired coupon"), and already marks a feature's own scenarios (the ones its branch added). Nothing is per-feature beyond that mark, and nothing removes them.

## Decided with the human

1. **A per-feature scenario is just a scenario the feature's agent writes; no snapshot mechanism.** When the agent reaches a state that is slow to reach (the bug it is fixing, a screen behind many steps), it writes a scenario for it. Every later drive of this feature starts there: the agent's own re-drives, the review's drive and the human's test drive. How the scenario builds the state is the agent's choice: seed code, a copy of data from the drive's database, a call to the app's API.
2. **The file name is the description.** The agent names the scenario after the state you land in. No new description field.
3. **They leave with the feature.** The agent lists its scenarios when it presents the work, and before merge deletes them, except any the human says to keep. A kept scenario must be seed code, never a data copy, because only code survives later changes. Guidance, not merge-time machinery: if agents forget, the human deletes the leftover by hand, and code gets added only if that actually happens.
4. **Data copies stay out of git.** A copy of database data can hold real users' data, passwords or keys, and once committed it stays in git history forever. It lives in a per-feature folder in runcastle's data directory, handed to scenario scripts through an environment variable, and deleted when the feature merges. It must be outside the agent's worktree because the human's test drive runs in the human's own checkout. This folder is the only code in the feature.

The human said "Yes" to this playback: per-feature scenarios come from guidance to the agents, data copies stay out of git in a per-feature folder, and the only code is that folder.

## What it must not swallow

- The Haiku helper that does a lead's repeated drives, and the rule for when a stuck agent stops, belong to "Agents test like owners", built in parallel. This feature makes the scenarios they start from.
- Review speed and the review model belong to "Faster, cheaper reviews".
- No snapshot or database-dump machinery in runcastle, and nothing that reads a scenario's contents (charter: language-agnostic by construction; flexible guidance over brittle machinery).

## Context for the planner

- Drive code: packages/server/src/workers/drive.ts, services/drive-env.ts (the environment a drive's hooks and scenarios get), services/drive-hooks.ts. Scenario guidance for the scenario chat lives in the launcher's scenario prompt (renderScenarioPrompt).
- **Testing this needs a hand-started drive.** Drives of runcastle start from the installed version, so a change to drive machinery is tested by hand-starting this branch's server, not by the Test drive button.

Planning mode: plans itself
