# Features set up scenarios themselves

## Problem

Reviews are fast only when they start from a scenario (a project command under
`.runcastle/scenarios/` that seeds the drive's database and prints `ENTRY_URL=`,
landing the browser at a ready-made state, signed in). Today only the human's
first ＋ New scenario chat beside a test drive sets a project's scenarios up. On a
project run on autopilot the human never opens a drive, so scenarios never exist,
and every review (full and verify) redoes signup and onboarding by hand: 20–30
minutes and $0.20–0.50 a run, against runcastle's own 4–4.5 minutes.

## Approach

**From the user's side.** When a feature needs a state someone would otherwise
build by hand (decision 4) and the project is not set up for scenarios, the
feature's lead sets scenarios up itself while building, proves each one on a real
drive of its branch, and only then starts the review (decisions 3, 5). The review
replays them as it already does. If the full review still had to reach a state by
hand, the lead writes that scenario before the verify review (decision 7). The
setup and one signed-in, onboarded base scenario stay with the project; the
feature's other scenarios leave with it as today (decision 6). A project whose
drive cannot carry scenarios is flagged once and the review goes on by hand
(decision 8). Fixtures are built as a ladder of steps each calling its parent, so
scenarios stay thin and an app change is fixed in one step (decision 9). Nothing
changes on any screen; the Blank app nudge and the human's
＋ New scenario chat stay as they are.

**The lead's drive (new tool).** The feature lead gets a drive tool shaped like
the Review worker's `review_drive`: actions `start`, `status`, `stop` and
`scenario` (`{ file }`), acting only on its own feature. It reuses the review
drive machinery: the server's real test-drive path on the human's checkout, the
project's one drive slot, the drive's `drive.env` overlay, and the same runner the
human's picker uses (`runScenarioOnDrive`). `start` boots the feature branch as
committed (the lead commits first). The drive carries the lead as its named
holder, the way a review drive names its Review worker, so the UI's drive slot
shows who holds it and the human's Stop still ends it. It is refused, retriably,
while another drive holds the slot. `scenario` returns the entry URL (and `TOKEN`)
or the scenario's failure (exit code, "printed no ENTRY_URL", or timeout, with
the output tail), exactly as the review gets it. The lead hands the entry URL to a
subagent with `agent-browser` to confirm the landing; runcastle never inspects
the page. The gate is the feature's own lead chat (the session `get_feature_context`
answers for); orchestrators, workers and other features' leads are refused. Whether
this is a new drive purpose or the review's purpose with a different holder is a
build choice; the review's own checks (`reviewDriveFor`) must not start treating a
lead's drive as a review's, nor the reverse.

**Recording the runner.** `set_scenario_runner({ command })` (today the ＋ New
scenario chat's only) is also given to the feature lead, unchanged: the command
must contain `{file}`.

**When a project counts as set up.** `scenarios.setUp` (in `get_feature_context`
and `read_feature`) becomes: a runner is recorded, and the base branch tracks at
least one file under `.runcastle/scenarios/`, `_fixtures/` included. Today it
needs a listed scenario on the base, so a project whose scenarios all left with
their features would read as not set up and a later lead would redo setup.

**The lead's guidance (skill pack).** The feature skill's Scenarios section is
rewritten: with `setUp` true it is as today; with `setUp` false and a slow state
in the feature, the lead sets up. A new reference page carries the setup steps,
taken from the ＋ New scenario chat's setup brief so both say the same thing: the
drive-only login route if the app has sign-in, typecheck coverage of
`.runcastle/scenarios/`, base fixtures, the runner, then the permanent base
scenario (a freshly signed-up, onboarded user on the app's first real screen),
then the feature's own. The fixtures form a ladder (decision 9): each step is a
function that calls its parent (`signedUpUser` → `onboardedUser` → …), and a
scenario calls the deepest step it needs, adds only its own bit and prints where
to land. A new state that later scenarios will share becomes a new step on the
ladder, not code copied between scenarios; a data-copy scenario stays off it. It adds: prove each on the lead's drive before the
review; after a review's "No scenario reaches <state>", write and prove that one
before the verify review; if the drive will not start or `drive.env` does not
carry the database, say so once (`wait_for_you`, or `hand_back` on autopilot),
recommend the orchestrator's preparation, and go on; never edit the drive setup.
The ready message names the base scenario as permanent and lists the rest as
leaving with the feature. The Plan's "who builds what" names scenario setup as the
lead's part when the feature will do it.

**The ＋ New scenario chat's setup brief** gains the same ladder rule, so a chat
and a lead set a project up the same way. Outside setup mode its brief says to
reuse the ladder's steps and add a step rather than copy one.

**The review's prompt.** The scenario block's fallback ("none — …, so set up each
criterion's state by hand") also asks for the "No scenario reaches <state>"
observation, so a feature with no scenarios at all still tells its lead which
states to cover. "Never write or edit a scenario" stays. The verify review gets
the same block, as it does today through its mode.

Unchanged: when the ＋ New scenario chat runs in setup mode, the Blank app nudge, the
orchestrator's preparation ("do not set up scenarios while preparing" stays), the
scenario-data folder, and which scenario Test drive starts.

## Seams

- **The lead's drive tool** (new), at the MCP tool function: a lead caller starts
  a drive of its feature, runs a scenario and gets the landing or the failure; a
  worker, an orchestrator or another feature's lead is refused; a busy slot is a
  retriable refusal; the review's own drive checks do not see the lead's drive.
- **`set_scenario_runner` audience** (existing tool): a lead can record a runner;
  a command without `{file}` is still refused.
- **`featureScenarios`'s `setUp`** (existing): true with a runner and only
  `_fixtures/` on the base; false without a runner.
- **The review assignment render** (existing, `renderReviewAssignment`): the
  no-scenarios fallback carries the observation line.
- **The scenario chat's brief** (existing, `renderScenarioPrompt`): setup mode
  and the plain brief both carry the ladder rule.
- The skill text has no test; the review reads it against this spec.

## Out of scope

- Dropping or merging the two reviews.
- The project's own drive setup and drive instructions; the orchestrator's
  preparation stays the place for them.
- Per-language tooling: setup is agent work, runcastle's code stays
  language-agnostic.
- The Review worker writing scenarios.
- Any screen change.
- Runcastle chaining scenarios at run time (running one on top of another); the
  ladder lives in the project's own code (decision 9).
- Parked: the ready declaration hands the epic a scenario title where its drive
  tool expects a file (backlog draft "Ready's scenario reaches the epic as a file").

## Open questions

- Two features on one unset project may both set up at once; the second to merge
  conflicts on the login route and fixtures and is resolved by the usual merge
  path. The lead checks the base for setup right before it starts, which narrows
  the window but does not close it.
- Runcastle's own app has no sign-in, so the signed-in landing through a
  lead-written login route is proven only on the human's own project after
  merge, as drive-scenarios decision 9 did for the scenario chat.
- Live sessions run the globally installed runcastle, so the new behaviour reaches
  the autopilot project only after a publish and reinstall.
