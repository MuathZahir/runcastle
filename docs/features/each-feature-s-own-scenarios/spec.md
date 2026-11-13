# Each feature's own scenarios

## Problem

Drives are slow and their scenarios pile up. Agents write one-time scenarios that
land in the project's permanent list and break as the app changes. And an agent that
drives, finds a problem, fixes it and drives again walks back to the problem through
the app on every drive; on another project such a loop took over an hour.

## Approach

**For the human.** A feature's scenarios belong to the feature. Whenever an agent
reaches a state that is slow to reach, it writes a scenario named after where you
land, and every later drive of this feature (the review's, the human's, the lead's
own once "Agents test like owners" gives it drives) starts there through the
picker's existing "This feature" group. The lead's ready message lists them and says
they leave with the feature. When the human says the work is good, the lead asks
once which to keep and deletes the rest; a kept one is rewritten as seed code if it
was a data copy. A scenario may build its state from a copy of the drive's own data,
kept in a per-feature folder outside git that is deleted at merge.

**The shape.** Almost all of it is guidance; the only code is the data folder.

- *Guidance in the feature skill pack.* The SKILL.md "Ready for the human" and
  "After a drive" sections, and `workers.md`'s "Ship a scenario", say: write a
  scenario whenever you reach a slow state (named after the landing state, decision
  2); a worker writes seed code only, the lead may use a data copy; delete a scenario
  as soon as a fix makes it pointless; list the feature's scenarios in the ready
  message, noting which to pick when there are several (decision 10); on the
  human's "this is good", ask which to keep and delete the rest, rewriting a kept
  data copy as seed code (decisions 3, 7). "The feature's scenarios" are the files
  the branch **added** against its base (`git diff --diff-filter=A`), not the "own"
  mark, which also covers permanent scenarios the branch only changed (decision 6).
  Data copies come only from this feature's drives, trimmed to what the state needs
  (decision 11).
- *Guidance in the project skill.* An orchestrator chat that owns a feature asks
  its lead to clear the feature's scenarios before it merges (decision 7).
- *Guidance in the scenario chat's brief* (the ＋ New scenario / Fix it chat docked
  beside a drive, `renderScenarioPrompt`). On a feature's drive it says the scenario
  leaves with the feature unless the human keeps it, and that it may build state from
  a data copy in `RUNCASTLE_SCENARIO_DATA`. On a project drive it says scenarios are
  permanent, so seed code only.
- *The Review worker's drive brief is unchanged*: it already prefers the feature's
  own scenarios and never writes one (decision 5).
- *The scenario-data folder* (decisions 4, 9). A pure path helper in core gives
  `<dataDir>/scenario-data/<featureId>/`. A drive of a feature hands its path to
  every child process (setup, each scenario run, teardown) as
  `RUNCASTLE_SCENARIO_DATA`, creating the folder on first hand-out; the drive
  identity grows an optional feature id for this, and a project drive or the
  preparation dry run passes none, so the variable is absent there.
  `get_feature_context`'s `scenarios` block gains `dataDir`, the absolute path, so
  the lead can write a copy into it. The merge flow removes the folder on success,
  best-effort, beside its other post-merge cleanup; deleting a feature removes it in
  its ordered cleanup; archiving keeps it.

Runcastle still never reads a scenario's contents and still lists scenarios from git
only. Nothing at merge checks for leftover scenarios.

## Seams

- **The drive identity env** (existing: `driveIdentityEnv`). Given a feature
  identity it returns `RUNCASTLE_SCENARIO_DATA` pointing at that feature's folder;
  given none, the variable is absent. Observable in a unit test and in
  `runScenario`'s child env.
- **The scenario-data path helper** (new, core). Pure: feature id in, path out.
- **`get_feature_context`'s `scenarios` block** (existing, extended with
  `dataDir`). Observable through the MCP tool's response.
- **The merge flow and feature delete** (existing). After a successful merge or a
  delete, the folder is gone; after a failed merge or an archive, it remains.
  Observable with a temp data dir.
- **The scenario chat's rendered brief** (existing: `renderScenarioPrompt`). Its
  text on a feature drive versus a project drive.
- **The skill pack text** (existing). Read, not tested.

Testing a drive end to end needs a hand-started drive: drives of runcastle start
from the installed version, so this branch's server must be started by hand to see a
scenario receive `RUNCASTLE_SCENARIO_DATA`.

## Out of scope

- The Haiku helper for a lead's repeated drives and the rule for when a stuck agent
  stops ("Agents test like owners", built in parallel). This feature only makes the
  scenarios those drives start from.
- Review speed and the review model ("Faster, cheaper reviews").
- Any snapshot or database-dump machinery, and anything that reads a scenario's
  contents.
- A merge-time check or automatic deletion of leftover scenarios (decision 3: added
  only if leftovers actually happen).
- Letting `declare_ready` pick which scenario the Test drive button starts (decision
  10's alternative).

## Open questions

- None. The human confirmed every assumed decision on 2026-11-13.
