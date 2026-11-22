## Purpose

Autopilot is a switch on an epic. It locks the feature chats, sends every question and "ready" through the orchestrator, and follows a run plan. In a 36-hour autopilot run that relay was a large cost: the orchestrator's conversation grew past its cap, a stale hook locked the human out of it, and leads sat waiting on answers the orchestrator had to make up anyway.

Once each feature has its own involvement level (the feature this waits on), autopilot has no job left. The human: "Do we really need something called 'Autopilot' in this case?" This feature removes it. It is decisions 7, 9 and 14 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`.

What the human gets:

- No autopilot switch, no run plan, and no locked feature chats. They can always type in any feature's chat.
- Leads decide by their feature's level and do not send questions or the plan's yes to the orchestrator.
- At the last level ("Nothing", a working name), runcastle itself merges a feature when its lead says ready and the review is clean. A feature that was waiting on it then starts by itself.
- The orchestrator is still woken on every merge of its features, with a short message from runcastle that carries the review's summary, so it can adjust what comes next. It is also woken for trouble that crosses features.
- An epic that is on autopilot at the moment of upgrade keeps working: its features get the level that matches.

Where: runcastle's server (autopilot's tools and locks, the merge step), the web app (the switch, the plan view, the locked composer) and the orchestrator's and lead's rules. Who: every runcastle user.

## Must not swallow

- The setting and its screens: the feature this waits on.
- Stacked branches or building on an unmerged dependency. Dependencies stay strict.
- A new kind of supervisor or watchdog in autopilot's place.

## Decided with the human

- One per-feature setting replaces autopilot and the planning mode: "Alright, but this setting will be for every feature."
- The orchestrator first proposed dropping its wake on each merge. The human objected: "Would it not be needed after a feature merges? I feel like there are some usecases where it could be needed." Settled: the orchestrator is woken on every merge of its features.
- Strict dependencies, where a waiting feature starts by itself after its dependency merges: "Yes".
- The cut: "Alright, you can start". Planning mode was the orchestrator's pick (plan automatically).

## Understood

- Hard limits stop at every level: money, accounts, anything outside git that cannot be undone. Removing autopilot must not remove those stops.
- A merge with no human needs a clean review and green checks, and a conflict stops and asks. The orchestrator's reading is that a merge conflict goes to the feature's lead first, and to the human only if the lead cannot settle it.
- Remove the machinery; do not leave it dormant behind a flag.

## Open

- What "the review is clean" means exactly for a merge with nobody watching: no open findings at all, or none above low severity.
- How the human undoes a merge made without them. Today that is a git revert; say whether that is enough.

## Ordering

Waits on "How involved am I". Nothing waits on it.

Planning mode: automatic

## Added by the orchestrator, 2026-11-21

The human, 2026-11-21: "I also want you to tell all features to prioritize implementing on their own. Maybe use subagents. But prefer not to use workers since we keep running out of memory and disk... We need to finish these fixes as fast as possible". So the lead builds this itself in the feature's folder, with its own subagents for parallel parts, and starts no workers, not even a Review worker. It reviews with its own subagents, fixes what they find, runs typecheck and the affected tests, then declares ready.
