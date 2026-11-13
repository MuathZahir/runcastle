# Decisions — Each feature's own scenarios

Planned without the human, in a headless run on 2026-11-12. Decisions 1–4 are the
human's own, copied from the brief; the rest are assumed and marked so.

All assumed decisions confirmed by the human on 2026-11-13.

## 1. A per-feature scenario is just a scenario the feature's agent writes
**Decision:** No snapshot mechanism. When an agent reaches a state that is slow to reach (the bug it is fixing, a screen behind many steps), it writes a scenario for it, and every later drive of this feature starts there: the agent's own re-drives, the review's drive and the human's test drive. How the scenario builds the state is the agent's choice: seed code, a copy of data from the drive's database, a call to the app's API.
**Why:** Flexible guidance over brittle machinery, and runcastle never reads a scenario's contents (language-agnostic).

## 2. The file name is the description
**Decision:** The agent names the scenario after the state you land in. No new description field.
**Why:** Runcastle already shows a scenario by its file name.

## 3. They leave with the feature
**Decision:** The agent lists its scenarios when it presents the work, and before merge deletes them, except any the human says to keep. A kept scenario must be seed code, never a data copy. Guidance, not merge-time machinery: if agents forget, the human deletes the leftover by hand, and code is added only if that actually happens.
**Why:** One-time scenarios pile up in the permanent list and break as the app changes; only code survives later changes.

## 4. Data copies stay out of git, in a per-feature folder
**Decision:** A copy of database data lives in a per-feature folder in runcastle's data directory, handed to scenario scripts through an environment variable, and deleted when the feature merges. This folder is the only code in the feature.
**Why:** A copy can hold real users' data, passwords or keys, and once committed it stays in git history forever. It must sit outside the agent's worktree because the human's test drive runs in the human's own checkout.

## 5. Who writes a feature's scenarios
**Decision:** The lead, its workers, and the ＋ New scenario chat docked beside this feature's test drive all write them. Workers write seed code only: their sandbox cannot reach a drive's database or the data folder. Data copies come from the lead or the scenario chat, which run on this machine. The Review worker still never writes or edits a scenario; when no scenario reaches a state it reports that, as today.
**Why:** These are the agents that already write scenarios today; the review stays a judge of the work, not a contributor to it.
**Assumed.** Alternative: let the Review worker write a scenario for a slow state it reached, so the fix drive starts there.
**The human (2026-11-13):** "Alright" — stands as planned.

## 6. Every scenario the feature added leaves with it, whoever wrote it
**Decision:** "The feature's scenarios" means every scenario file its branch added, including one the human asked for in the ＋ New scenario chat during this feature's test drive. A permanent scenario the branch only changed (fixed after an app change, say) is not one of them and stays. Runcastle's "own" mark covers added and changed files alike, so the lead checks which were added against the base branch. The lead lists them all and deletes all but the ones the human keeps. The scenario chat tells the human, when it writes one on a feature's drive, that it leaves with the feature unless they keep it.
**Why:** One rule the lead can check from the branch alone, with no record of who wrote what. A scenario the human wanted for good is kept with one word.
**The human (2026-11-13):** "This feature doesnt matter. I have many scenarios from other features too. Will clean them up at once when this is merged." The rule stands as planned; the human clears the existing pile by hand after merge. Alternative not taken: a scenario the human asked for in the scenario chat is permanent by default.

## 7. When the lead deletes them
**Decision:** The lead deletes a scenario as soon as a fix makes it pointless, so the set stays small. The lead's ready message lists the feature's scenarios and says they leave with the feature unless the human keeps one. When the human says the work is good after a drive, the lead's reply asks once which to keep, and deletes the rest in its next commit (rewriting a kept data copy as seed code first). When an orchestrator chat owns the feature, it asks the lead to clear them before it merges.
**Why:** The human's test drive needs the scenarios until the human is done, so they cannot go at ready time; "this is good" is the last moment the lead usually hears before Merge. The human can press Merge without ever saying it, and then the leftovers merge and the human deletes them by hand (decision 3).
**Assumed.** Alternative: the lead deletes them as soon as it declares ready and the drive keeps working from the branch's last commit that had them; rejected because re-drives after a fix would lose them.
**The human (2026-11-13):** "Alright" — stands as planned.

## 8. Workers' shipped scenarios stop being permanent by default
**Decision:** The feature skill's "Ship a scenario" guidance changes: a scenario a worker ships for a hard-to-reach state is the feature's, and leaves with it. It also asks the lead to write one itself whenever it reaches a slow state while fixing, named after where you land.
**Why:** Today's guidance is the main source of the one-time scenarios that pile up in the project's list.
**Assumed.** Alternative: leave worker-shipped scenarios permanent and apply the leave-with-the-feature rule to the lead's own only.

## 9. The data folder's life
**Decision:** Each feature gets `~/.runcastle/scenario-data/<featureId>/`, created when a drive of that feature first hands it out. Every child process of that feature's drives (setup, each scenario, teardown) gets its path in `RUNCASTLE_SCENARIO_DATA`; a project drive gets no such variable. The lead finds the path in `get_feature_context`. The folder is deleted when the feature merges and when it is deleted; archiving keeps it, since archiving keeps all of a feature's data and can be undone.
**Why:** The drive's identity variables already reach every drive process, so the folder rides the same path. A project drive has no feature, which is also why a kept scenario must be seed code.
**Assumed.** Alternative: delete it on archive too.
**The human (2026-11-13):** "Alright" — stands as planned.

## 10. Which scenario the Test drive button starts stays as it is
**Decision:** No change: the button starts the feature's first own scenario, and the rest are under its caret. When the feature has several, the lead's ready message says which one to pick for what.
**Why:** The brief keeps the data folder as the only code; the picker already puts this feature's scenarios first under "This feature".
**Assumed.** Alternative: `declare_ready` names a scenario file, and the Test drive button starts that one.
**Challenged:** With several scenarios the button starts whichever sorts first by path, which may be a worker's minor one; a line in the ready message is easy to miss, so the lead should name its main scenario to sort first. My answer stands: decision 2 makes the name the description, so names are not bent for sort order; keeping the set small (decision 7) does the same job, and the alternative is the fix if it still bites.
**The human (2026-11-13):** "Alright" — stands as planned.

## 11. A data copy comes only from a drive's own database
**Decision:** The scenario-data folder holds only data copied from this feature's drives (the drive's isolated database, or files the app wrote during them), trimmed to what the state needs. An agent never copies from a staging or production database, or any other source, unless the human hands it one for this purpose.
**Why:** Decision 4 keeps copies out of git because they can hold real users' data; the safest folder is one that never receives it in the first place.
**Assumed.** Alternative: allow copies from any database the human's environment can reach, staging included.
**The human (2026-11-13):** "Alright" — stands as planned.
