# The shapes of `decisions.md` and `spec.md`

Read this before you write or change either file, in `docs/features/<slug>/`.

## `decisions.md`: what the human decided

Only decisions that change what the human gets, or that they might
overturn. Anything an engineer settles while building (wording, internal
formats, test coverage) goes to the spec. A decision the brief records under
`## Decided with the human` is already theirs: copy it in with no mark.

Append each one the moment it settles, never in a batch at the end, so a
session that dies keeps what was settled:

```markdown
## <n>. <short title>
**Decision:** <the choice, in the project's own words>
**Why:** <the reason, and what it was chosen over>
```

**Marks**, each one line under **Why:**

- `**Assumed.** Alternative: <the main alternative>.` A decision made without
  the human (a planning run with nobody present, or an orchestrator message
  that does not count as theirs).
- `**Changed by the orchestrator:** <why>` A decision an orchestrator message
  changed or made. It keeps its `**Assumed.**` line, or gains one: the human
  has not seen it.
- `**Decided by autopilot.**` A decision the epic made while it runs this
  feature on autopilot, where its answer counts as the human's.
- `Supersedes: <n>` A later decision that replaces an earlier one. Never
  rewrite the old one: append the new one, and amend `spec.md` where it is
  affected.

Example:

```markdown
## 4. Tags and dates are left out of the PDF
**Decision:** The PDF carries the title and body only.
**Why:** The brief asks for the note, not its filing.
**Assumed.** Alternative: a small footer with tags and the last-edited date.
```

Only the human's own words in their chat remove `**Assumed.**` and
`**Changed by the orchestrator:**`, in the same edit that records their answer;
decisions they did not touch keep their marks.

**Check first.** A plan made with nobody present carries one line under the
intro, `Check first: 2, 5, 7`: at most five decision numbers the human should
look at first. Keep it in step with the Plan's Check first group, and drop a
number once the human confirms that decision. A plan made with the human has no
such line.

Whenever `decisions.md` changes and a `preview.html` exists, redraw the Plan in
the same move (`./preview.md`). Commit it like any other doc.

## `spec.md`: what the feature is

Write it once what the feature does is settled, whether you build it or workers
do. It is written from the conversation and `decisions.md`, not a new
interview. Use the project's own words and respect its ADRs in the area.

```markdown
# <Feature title>

## Problem
The problem, from the user's side.

## Approach
The solution from the user's side, then its shape: modules built or changed,
their interfaces, schema, API and contract choices, key interactions. Prose,
not a file-by-file plan.

## Seams
The boundaries to test at, each named with what it lets you observe, marked
existing or new.

## Out of scope
What this feature does not cover, including scope parked as backlog features.

## Open questions
Anything unresolved or deliberately deferred.
```

- **Seams:** prefer existing ones, as high as possible, as few as possible;
  ideally one. They feed the workers' checks and the tests.
- **No file paths or code**: they go stale. The exception is a snippet that pins
  a decision better than prose (a state machine, a schema, a type), with where
  it came from.
- When a later decision changes what the feature does, amend the affected
  sections in place.

## Scenarios

A scenario is a project command under `.runcastle/scenarios/` that seeds a
state and prints `ENTRY_URL=<where>`, so a drive (the human's, the review's,
your own) starts where the feature is instead of redoing signup.
`get_feature_context`'s `scenarios` field says whether the project has them
set up (`setUp`: a runner recorded and the folder on the base branch).

- **A state is slow to reach** when someone driving the feature would build it
  by hand first: signing up or in, onboarding, data that takes several steps.
  Copy changes, settings toggles and the screen the app opens on get none.
- **When `setUp` is true**, the work that builds a slow state ships a scenario,
  named after where it lands (`checkout/expired-coupon-at-payment.ts`), built on
  the `_fixtures` ladder (`./scenario-setup.md`). An API change also ships a
  sibling `.http` request, and prints `TOKEN=` when authenticated.
- **When `setUp` is false and the feature has a slow state**, you set scenarios
  up yourself before the first review, by `./scenario-setup.md`, and say so in
  the Plan's who builds what. Never hand setup to a worker: it needs a drive.
- **Prove each new scenario** before any review: run it on `feature_drive`
  and have an `agent-browser` subagent confirm the `ENTRY_URL` shows the state,
  signed in. Stop the drive when done.
- **After the full review**, write and prove a scenario for every "No scenario
  reaches <state>" it reported before you start the verify review.
- **When the drive cannot carry scenarios** (it will not start, or its
  `drive.env` does not hand over the database the scenario must seed), say so
  once (`wait_for_you`, or `hand_back` on autopilot), recommend the
  orchestrator's project preparation, and go on: the review sets the state up by
  hand. Never edit the drive setup yourself.
- Pass the scenario that fits as the `scenario` of `declare_ready`.
- A copy of drive data lives in `scenarios.dataDir`, outside git (it can hold
  passwords), read through `RUNCASTLE_SCENARIO_DATA`; copy only from this
  feature's own drives.
- A feature's scenarios leave with it, except the setup and the base signed-in
  scenario when this feature set scenarios up: those stay. Your ready message
  lists the scenarios, which to pick for what, and which stay. When the human
  says the work is good, ask once which others to keep, delete the rest, and
  rewrite any kept data copy as seed code.
