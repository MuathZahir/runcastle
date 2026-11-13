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
state and prints `ENTRY_URL=<where>`, so a test drive starts where the feature
is. `get_feature_context`'s `scenarios` field says whether the project has them
set up (`setUp`).

- **When `setUp` is true**, the work that builds a hard-to-reach state (an
  account, a cart with an expired coupon) ships one, named after where it lands
  (`checkout/expired-coupon-at-payment.ts`), reusing `_fixtures`. An API change
  also ships a sibling `.http` request, and prints `TOKEN=` when authenticated.
  Copy changes and settings toggles get none. Pass the one that fits as the
  `scenario` of `declare_ready`. When `setUp` is false, tell the human once
  that ＋ New scenario in a test drive sets them up.
- A copy of drive data lives in `scenarios.dataDir`, outside git (it can hold
  passwords), read through `RUNCASTLE_SCENARIO_DATA`; copy only from this
  feature's own drives.
- A feature's scenarios leave with it. Your ready message lists them and which
  to pick for what. When the human says the work is good, ask once which to
  keep, delete the rest, and rewrite any kept data copy as seed code.
