# How involved am I

## Problem

Runcastle has two controls for how much the human is asked: the "plan with me or
plan automatically" choice made when a feature is cut, and autopilot on an epic.
Neither says what the human wants to say: "show me the screens but decide the
rest", or "build it all and show me before merging". This feature adds one stored
setting per feature, "Involve me in", with four nested levels (decisions 1, 5).

## Approach

From the user's side:

- Each feature has a level: Everything (the default), Designs and result, Result
  only, Nothing. It shows as "Involve me in: <level>" with the level's mark, in the
  feature's header and on each created row of the orchestrator's "features
  created" card, and both change it (decision 3).
- The epic's header holds "Set all to…", the same picker for every feature of
  the epic that has not shipped, saying "Mixed" when they differ (decisions 4, 7).
- The orchestrator cuts each feature at the level it recommends. The card appears
  after creation, as today; its picker is how the human changes a level.
- When a level changes, the feature's lead is told. If it was waiting on the
  human's answer and the new level no longer asks that kind of question, it
  decides it itself, records it and carries on (decision 3).
- Below Everything the lead decides its open questions itself. Below Designs and
  result it settles new screens itself too (decision 6). Each such decision is
  written to `decisions.md` with the mark `**Decided without you.**`, and the
  review package lists them.
- At Nothing, a lead's "ready" merges the feature when no defect is open; else
  it waits for the human as today.
- At every level the lead still stops before money, accounts, anything outside
  git that cannot be undone, and anything the brief names as the human's
  (decision 2).

### Core (`packages/core`)

- `involvement.ts` (exists): the levels, labels, hints and the three predicates
  (`asksDecisions`, `showsDesigns`, `humanMerges`).
- `db-schema.ts`: `features.involvement` text, not null, default `'everything'`.
- `schemas.ts`: `Feature.involvement: InvolvementSchema`.
- `review-package.ts`: `ReviewPackage.decidedWithoutYou: { n: number; title: string }[]`.
- A parser for `decisions.md` entries carrying the mark, pure (string in, list out).

### Server (`packages/server`)

- Migration `0076_involvement.sql` (generated, `db:generate`), copying the shape
  of `0073_autopilot.sql`. `rowToFeature` carries the field; `list()` and
  `getFeatureFull` return it.
- `services/involvement.ts`: `setInvolvement(featureId, level)` and
  `setEpicInvolvement(chatId, level)` (every feature of the epic that is neither
  shipped nor archived). Each emits `feature.involvement_changed` per changed
  feature and tells its lead through `deliverToLead`: `reason: 'question'` when
  the lead's chat waits on the human and the new level no longer asks, else
  `'news'`, background. The line names the new level and what it now stops for.
- tRPC: `feature.setInvolvement({ featureId, level })` and
  `feature.setEpicInvolvement({ chatId, level })`.
- MCP `create_feature` (orchestrator form): `involvement` replaces `planning`.
  The brief line becomes "Involve me in: <level>". The level is stored.
- MCP `get_feature_context`: the header carries `involvement` and one line on
  what the level stops for.
- `declareReady`: at Nothing with no open defect, it calls `mergeFeatureFlow`
  (as the actor `runcastle`). A refused or failed merge falls back to today's
  "Ready to test" wait, with the reason told to the lead. The epic on autopilot
  is told it merged.
- `reviewPackage`: reads the feature's `decisions.md` on its branch and fills
  `decidedWithoutYou`.

### Skills (`packages/skills`)

- Feature skill: a rule that the lead reads its level from context and obeys it,
  and the `**Decided without you.**` mark, both in a new reference
  `references/involvement.md` (the skill's size budget left no room in
  `SKILL.md` or `decisions-and-spec.md`). The
  planning-alone and design references follow the level. On a "level changed"
  line while waiting: decide, record, withdraw the wait, carry on.
- Project skill: the cut asks per feature for a level (with the pick) instead of
  "plan with me / plan automatically"; `create_feature` passes `involvement`.

### Web (`apps/web`)

- `components/involvement/Involvement.tsx` (exists; look approved): the per-feature
  picker and "Set all to…".
- Feature header (`Workspace.tsx`) and phone bar: the picker, `size="md"`.
- Epic page header (`ProjectWorkspace.tsx`): "Set all to…".
- `FeaturesCard` in the thread: the picker on created rows, fed from the feature
  list.
- Thread notice when the level changes in a feature's chat.
- Review package: a "Decided without you" section in the aside.

## Out of scope

- Removing autopilot, the locked chats and the run plan ("Autopilot retires").
- The "Start / Plan automatically" buttons on a new feature: they stay until
  "Autopilot retires" folds them in.
- Undo for "Set all to…" (decision 7).

## Open questions

- None.
