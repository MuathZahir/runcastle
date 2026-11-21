# The feature file, the review, and scenarios

Read this before you write decisions or build notes, start a review, or ship
a scenario.

## The feature file: `docs/features/<slug>/brief.md`

One file grows, top to bottom: the brief (the human's words, written by the
orchestrator; never edit it), `## Decisions` (yours to add), `## Build notes`
(yours) and `## Review summary` (runcastle adds it at merge; never write it).
Add a heading only when it has something under it. A feature whose folder
already has `decisions.md` or `spec.md` keeps writing those to the end.

## `## Decisions`: what the human decided

Only decisions that change what the human gets, or that they might overturn;
what an engineer settles while building goes to the build notes. A decision the
brief records under `## Decided with the human` is already theirs: copy it in
with no mark. Append each the moment it settles, never in a batch at the end:

```markdown
### <n>. <short title>
**Decision:** <the choice, in the project's own words>
**Why:** <the reason, and what it was chosen over>
```

**Marks**, each one line under **Why:**

- `**Assumed.** Alternative: <the main alternative>.` Made without the human
  (a planning run with nobody present, or an orchestrator message that does
  not count as theirs).
- `**Changed by the orchestrator:** <why>` An orchestrator message changed or
  made it. It keeps its `**Assumed.**` line, or gains one.
- `**Decided by autopilot.**` The epic decided it while running this feature on
  autopilot, where its answer counts as the human's.
- `Supersedes: <n>` Replaces an earlier one. Never rewrite the old one: append
  the new one, and amend the build notes where affected.

Only the human's own words remove `**Assumed.**` and `**Changed by the
orchestrator:**`, in the same edit that records their answer.

**Check first.** A plan made with nobody present carries one line under the
heading, `Check first: 2, 5, 7`: at most five decisions to look at first, kept
in step with any plan page. Drop a number once the human confirms it.

## `## Build notes`: how it is built

A few short paragraphs once what the feature does is settled: the approach,
where to test it (the seams: prefer existing ones, as high and as few as
possible), and what is left out, including scope parked as backlog features.
No file lists or code. Each worker's assignment carries the rest, quoting the
human's words it needs unchanged; a large feature's longer assignment is a
working paper, never committed.

## The review

One review per feature. Pass `mode`:

- `drive` when the change reaches something a user of the project meets: a
  screen, a command's output or options, an API's responses, a library's public
  functions. The reviewer uses it as that user would: opens the screen, runs
  the command, calls the API.
- `gates` (reads the diff) for everything else: refactors, tests, docs, build
  setup.

Accept or send back from its findings and a skim of the diff's shape, never a
line-by-line review of your own. Start a
second review (`verify`) only after a large fix set: more than a handful of
findings, or fixes that reached code the feature had not touched. After a small
one, green checks and your skim are enough.

## Scenarios

A scenario is a project command under `.runcastle/scenarios/` that seeds a
state and prints `ENTRY_URL=<where>`, so a drive starts where the feature is
instead of redoing signup. `get_feature_context`'s `scenarios.setUp` says
whether the project has them (a runner recorded, the folder on the base branch).

- **A state is slow to reach** when someone driving would build it by hand
  first: signing in, onboarding, data that takes several steps. Copy changes,
  settings toggles and the opening screen get none.
- **When `setUp` is true**, the work that builds a slow state ships a scenario,
  named after where it lands (`checkout/expired-coupon-at-payment.ts`), on the
  `_fixtures` ladder (`./scenario-setup.md`). An API change also ships a
  sibling `.http` request, printing `TOKEN=` when authenticated.
- **When `setUp` is false and there is a slow state**, set scenarios up
  yourself before the review (`./scenario-setup.md`), and say so in your
  playback. Never hand setup to a worker: it needs a drive.
- **Prove each new scenario** before any review: run it on `feature_drive` and
  have an `agent-browser` subagent confirm `ENTRY_URL` shows the state, signed
  in. Stop the drive when done.
- **After the review**, write and prove a scenario for every "No scenario
  reaches <state>" it reported, before you say ready.
- **When the drive cannot carry scenarios** (it will not start, or `drive.env`
  lacks the database to seed), say so once (`wait_for_you`, or `hand_back` on
  autopilot), recommend the orchestrator's project preparation, and go on.
  Never edit the drive setup yourself.
- Pass the scenario that fits as `declare_ready`'s `scenario`.
- Drive data copies live in `scenarios.dataDir`, outside git, read through
  `RUNCASTLE_SCENARIO_DATA`; copy only from this feature's own drives.
- A feature's scenarios leave with it, except the setup and base signed-in
  scenario when this feature set them up. Your ready message lists them, which
  to pick for what, and which stay. When the human says the work is good, ask
  once which others to keep, delete the rest, and rewrite kept data as seed code.
