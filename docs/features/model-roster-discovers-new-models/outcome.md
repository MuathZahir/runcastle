# Outcome — Model roster discovers new models

New Claude and Codex models show up in the model roster without waiting for a runcastle release or a hand-typed entry, discovered from the providers or the CLIs.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

21 commits · 34 files

### Lap 1
- 6 tickets landed: #1 Roster gains a discovered layer, served to every consumer; #2 Discovery runs at boot and on Refresh (Agent SDK + Codex cache); #3 Settings → Models shows new / no-longer-offered / retirement and a Refresh; #5 Previously discovered annotated models lose the “no longer offered” warning; #6 Withdrawn discovered defaults and step models disappear instead of warning; #7 First successful discovery hides every model without a “new” badge
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: eba000223e1ad835b28626815806e14828be66c2
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 3168e50bcad945c156549c5450302de2f0c28b54
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Settings → Models shows new / no-longer-offered / retirement and a Refresh

# Ticket 3 — Settings → Models: new / no longer offered / retirement, and a Refresh button

## What was done
- `apps/web/src/lib/settings.ts`: `RosterRow` gained five fields: `displayName`, `discovered`, `isNew` (the id is in its source's `newIds`), `noLongerOffered: AgentRuntime | null` and `retirement`. `custom` is now false for discovered ids, so they get no remove ✕, and clearing an annotated discovered model's note drops the operator entry so the model falls back to discovery. `rosterVisibleRows` now also shows `isNew` rows. `hiddenCuratedCount` was renamed to `hiddenRosterCount`, and the label now reads "N more models not shown". New pure helper `discoveryStatusLines(view, now)` produces lines like "Claude: 7 models · 2h ago", "Codex: failed — <error> (last good 3d ago)" and "Codex: not run yet". New constant `DISCOVERY_SOURCE_LABEL` maps runtimes to Claude and Codex.
- The rule for "no longer offered": the row is referenced (it has a note, is the default, or a step uses it), it is not custom, its runtime's source status is `ok`, and the id is missing from that source's models. A failed or never-run source flags nothing.
- `RosterTable.tsx`: a green **New** pill sits next to the id. The display name shows in the id's tooltip. An amber line under the row shows "no longer offered by Claude/Codex" and/or "retires <at> → <replacement>".
- `ModelsPage.tsx`: a `DiscoveryStatus` block sits under the Roster heading. It shows one line per source (failed lines in amber) and a small Refresh button. The button calls `settings.refreshModels`, reads "Refreshing…" and is disabled while pending, invalidates `settings.get` on success, and shows the error as an alert if the call fails.
- Tests: helper cases were added to `apps/web/test/settings.test.ts`. Tier-2 component cases were added to `settings-models.test.tsx` (status lines, not run yet, Refresh calls the mutation and refetches, pending state, new badge, collapsed discovered row, retirement hint, no-longer-offered flag, a discovered id picked from the Default dropdown). `settings-dialog.test.tsx`'s tRPC mock gained `refreshModels`.

## Surprises
- There is no snapshot of discovery's "previous run" on the wire. That means a discovered model the operator annotated and that later drops out of discovery looks exactly like an operator-typed id (custom). The rule therefore does not flag it; only curated ids get flagged. Fixing this needs the server to expose a "was ever discovered" set.
- A curated id that Claude discovery reports under a different pinned id (e.g. a dated `resolvedModel`) will be flagged "no longer offered" when it is the default or used by a step. That is correct by the rule, but may be noisy depending on what ticket 2's SDK ids look like.
- `settings.refreshModels` is still the ticket-1 stub in this sandbox (it throws), so until ticket 2 lands, Refresh shows "Refresh failed: …".
- The repo has no formatter config. Running `bunx prettier` with its defaults rewrites whole files, so don't.
- Full suite: 2 failures, both outside this diff. `dev-pane.test.ts` was already reported red in this sandbox by ticket 1. `test-notes-router.test.ts` is an ordering flake under load: it passes 6/6 when run alone. Typecheck is clean.

## Left undone
- The settings filter (`pageSearchItems`) does not search `displayName`.
- No drive-script changes: this ticket adds no service, env var, seed or process.

#### 5. Previously discovered annotated models lose the “no longer offered” warning

# ticket(5) — withdrawn discoveries keep their "no longer offered" warning

## What was done

`rosterRows` decided "this provider stopped offering the model" from `!custom`,
and `custom` was computed only from the curated set plus the *latest* discovery.
So once a source withdrew a discovered-only model, the operator's note was all
that kept the row, the id looked operator-typed, and the warning the spec
promises was suppressed. The fix gives discovery the missing identity: each
`DiscoverySource` now carries `knownIds` — every id that source has offered in a
successful run — added in `packages/core/src/schemas.ts` and accumulated in
`nextSource` in `packages/server/src/services/model-discovery.ts` (it survives a
failed run because the failure branch spreads `previous`). `rosterRows` now flags
a *referenced* model whose source's latest run succeeded without it when the id
is either curated or previously known, instead of when it is "not custom". An
annotated withdrawal is therefore both `custom: true` (still the operator's to
remove) and `noLongerOffered: 'codex'`, which is what the ticket asked for — I
deliberately did not flip `custom`, since the acceptance criterion names only
`noLongerOffered` and the row genuinely is removable from `config.models`.
`RosterTable` already renders the warning independently of `custom`, so no
component change was needed.

I re-ran the reviewer's repro step exactly, as a new test in
`apps/web/test/settings.test.ts` ("flags a withdrawn model its source once
offered…"): a `status: 'ok'` Codex source with no models, an annotated
non-curated id it previously supplied. Before the fix that row is
`custom: true, noLongerOffered: null`; after it is `custom: true,
noLongerOffered: 'codex'`. It passes. A second test at the discovery-service
seam pins that `knownIds` accumulates across withdrawals and survives a failure.

## Surprises

- `knownIds` is declared `.default([])` so snapshots already written to
  `~/.runcastle/discovered-models.json` still parse. That matters more than it
  looks: `readDiscoverySnapshot` swallows any parse error and returns
  `EMPTY_DISCOVERY_SNAPSHOT`, so a required field would have silently wiped every
  existing operator's discovery cache rather than failing loudly.
- The server's `typecheck` does not cover `packages/server/test/**`, so three
  server fixtures missing the new field compiled fine and only failed at runtime
  on deep-equality round-trips. The web's typecheck *does* cover its tests.
- The verify baseline in the prompt is stale — it predicts 118 files / 1768
  tests, and the suite is now 265 files / 3856 tests.
- **One pre-existing failure, not mine:**
  `packages/server/test/dev-pane.test.ts > kills the child process tree…` asserts
  a detached process group is gone after stop, and gets `true`. It fails the same
  way on a targeted run, touches nothing in my diff, and was last changed by
  another feature's `ticket(1)` — it is the sandbox not reaping a process group
  the way the host does. Everything else is green:
  `bun run typecheck` 0 errors; `env -u GIT_ASKPASS bun run test` 3820 passed,
  35 skipped, that 1 failed.
- Drive machinery needed no edit: this ticket adds no service, no required env
  var, no seed and no extra process. I checked that rather than running
  `.runcastle/drive-setup.ts`, which the brief forbids in a sandbox.

## Left undone

- Ticket 4's review reported a second half of this defect that is **not** in my
  ticket: a discovered-only model referenced by the *default* or by a *step*, but
  never annotated, vanishes from the roster entirely once withdrawn, so there is
  no row to flag at all. `rosterFromView` only unions curated + current
  discovered + operator entries, so nothing puts that id back. `knownIds` is now
  the obvious material for whoever fixes it — the ids are on record even after the
  model leaves `models`.
- `knownIds` grows without bound. Harmless at model-roster scale, and pruning it
  would need a policy nobody has asked for, but it is the one thing in the new
  field that has no upper limit.

#### 6. Withdrawn discovered defaults and step models disappear instead of warning

# ticket(6) — Withdrawn discovered defaults and step models keep their row

## What was done

`rosterRows` in `apps/web/src/lib/settings.ts` built its rows only from
`rosterFromView(view)`, so a model id that the global default or a per-step
override still points at simply had no row once every roster layer (curated,
currently discovered, operator) stopped carrying it. It now collects those
unrostered references first and appends a row for each, so the reference is
always visible and can carry the `no longer offered by …` warning.

One thing the ticket did not spell out: a withdrawn id carries no runtime
anywhere — the snapshot keeps only ids in `newIds` and drops withdrawn models
entirely, and this codebase deliberately never infers a runtime from an id's
spelling. So a new helper, `withdrawnSource`, attributes the withdrawal to the
one discovery source whose latest run succeeded; with both sources succeeded the
tie goes to `DEFAULT_RUNTIME` (the runtime a launch would use for an unknown id,
and what `stepRows` already reports for it), and with neither succeeded nothing
is flagged. The synthesized row is also `custom: false`, because there is no
operator roster entry behind it and the Models page renders a Remove button for
custom rows.

## Re-running the reviewer's repro

I re-ran the repro verbatim in a scratch test (Codex status `ok` with an **empty**
model list, no operator `models` entry, once with `model` and once with
`stepModels.implement` pointing at `gpt-6-astra`). Before the fix the row was
`undefined` — the three tests I added went red exactly that way. After the fix
both variants return a row with `noLongerOffered: 'codex'`. The scratch file was
deleted; the committed coverage lives in `apps/web/test/settings.test.ts` under
`rosterRows with discovery`.

## Surprises

- `env -u GIT_ASKPASS bun run test` is **not** fully green on this branch, and
  the stated baseline (118 files / 1768 tests) no longer matches it (265 files /
  3857 tests). Two server tests fail on timing in this sandbox —
  `packages/server/test/dev-pane.test.ts` ("kills the child process tree") and
  `packages/server/test/pty-teardown.test.ts` ("returns within the deadline").
  They fail on a targeted run with nothing of mine loaded, and the second passed
  on a later full run, so they are flaky/environmental, not this diff. Typecheck
  is 0 errors.
- The first post-commit sync push was rejected with "stale info" because the
  clone had no `origin/…` refs yet; `git fetch origin` then a plain push fixed
  it. Both commits are on the mirror.

## Left undone

- The review of this lap reported two other defects that are *not* this ticket:
  an annotated discovered id that gets withdrawn is still misclassified as
  `custom` (so it loses the warning), and the first successful discovery clears
  all `newIds`. I left both alone.
- Drive machinery: this change adds no service, env var, seed or process, so
  none of the `.runcastle/` hooks needed an edit. I checked the trigger
  conditions only; I did not run `drive-setup` (no app or services here).

#### 7. First successful discovery hides every model without a “new” badge

# ticket(7) — First successful discovery hides every model without a "new" badge

## What was done

`nextSource` in `packages/server/src/services/model-discovery.ts` special-cased a
source whose previous status was `never` and assigned it `newIds: []`, so on a fresh
install the very models this feature exists to surface got no **new** badge and were
collapsed behind "show all". The special case is gone: the spec's rule — an id is new
when the latest successful run reported it and the run before did not — already handles
a first run, because its previous id set is empty. The `sameSet` short-circuit that keeps
the previous run's badges until the set actually changes is untouched. No deviation from
the approach the ticket described; the fix is three lines of the one function named in
the ticket, plus the two test assertions it falsified.

I re-ran the reviewer's repro step exactly, in a throwaway test file (written inside the
checkout so it could import both packages, then deleted — not committed): from a fresh
data dir where `readDiscoverySnapshot()` equals `EMPTY_DISCOVERY_SNAPSHOT`, called
`refreshModelDiscovery` with a Codex fake returning `gpt-next`, then passed the snapshot
through `rosterRows`/`rosterVisibleRows`. Before the fix `codex.newIds` was `[]` and
`gpt-next` was hidden; after it, `codex.newIds = ["gpt-next"]` and the visible rows are
`["claude-opus-5","gpt-next"]`. The repro no longer reproduces.

## Surprises

- The existing service test encoded the bug twice, not once. Besides the first-run
  assertion, it asserted `newIds: []` on the later Codex *failure* — a failed source
  spreads its previous state, so once the first run legitimately badges `gpt-one`, the
  failure retains that badge. That follow-on assertion was updated for the same reason,
  not as a behaviour change to the failure path.
- The web side needed nothing. `rosterVisibleRows` already treats `isNew` as
  "worth showing" and `apps/web/test/settings.test.ts` already pins it, so the whole
  defect lived in the one server-side conditional.
- **The stated baseline is stale and one test fails for reasons outside this change.**
  `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` reports 265 files /
  3818 passed (not the 118 / 1768 in the prompt) with **1 failure**:
  `packages/server/test/dev-pane.test.ts:183` — `expect(pidAlive(-pgid)).toBe(false)`,
  a process-group-reaping assertion. It fails identically on a targeted run of that file
  alone, it does not import anything I touched, and my diff is confined to model
  discovery. It is an environment/pre-existing failure, not this ticket's.
- On a first run every discovered id that is *also* curated (e.g. `claude-opus-5`) now
  carries the **new** badge for that one run. That follows directly from the spec's rule
  and from the ticket's own framing, so I took it rather than inventing a curated-id
  exception the spec does not describe.

## Drive machinery

No edit needed and none made: this change adds no service, no required env var, no seed
and no extra process. I did not run `drive-setup`/`drive-stop` (correctly — the sandbox
has no services); nothing in `.runcastle/` is referenced by the diff.

## Left undone

- The review's other two findings (annotated discovered-only models misclassified as
  custom; default-/step-only references dropping out of the roster entirely, so the
  "no longer offered" warning cannot fire for them) are separate tickets and were left
  alone.
- The `dev-pane.test.ts` process-group failure above is worth someone's attention as an
  environment issue; it is not part of this feature.

#### 8. Verify the fixes that landed

Gates verification pass

Verified all three fixes landed after pass #4 against their original findings and repro steps.

- #5 holds: discovery sources persist `knownIds` across successful withdrawals and failures, and `rosterRows` uses that history independently of `custom`. An annotated, non-curated Codex model that was previously discovered and is now absent remains `custom: true` while receiving `noLongerOffered: 'codex'`. Focused web and discovery-service regression tests cover the row result and history retention.
- #6 holds: `rosterRows` adds default and per-step model references that are absent from every current roster layer, marks those synthesized rows non-custom, and flags them when the applicable source's latest run succeeded. Focused tests cover both a withdrawn default and a withdrawn `stepModels.implement` value with an empty current Codex offering.
- #7 holds: `nextSource` no longer suppresses `newIds` when the previous source status is `never`; it compares the first successful result with the empty previous model set. The service regression test expects first-run Claude and Codex IDs in `newIds`, and the existing web helper exposes such rows through `rosterVisibleRows`.

No verify commands are configured, so no gates were run; the full Gates pass was spent on the landed diffs as instructed. No plainly broken behavior was found in the scoped fixes, and no verification findings were reported.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: All three landed fixes match their findings and retain focused regression coverage; no configured gates exist.
