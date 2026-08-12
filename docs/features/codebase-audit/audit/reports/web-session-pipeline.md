# Audit report — `apps/web` session / terminal / pipeline-body surfaces

Leaf agent. Scope: `SessionPanel`, `TerminalView`, `AgentTranscript`,
`PreparationWorkspace`, `Inspector`, `Markdown`, `DocPeek`, `bodies/{Grill,Run,Review,Tickets,Shipped}Body`,
`lib/feature-ui.ts`, `lib/terminal.ts`, `lib/terminal-keys.ts`.
Read-only tracing across `Workspace.tsx`, `lib/{live,events,activity,vocabulary}.ts`, `ui.tsx`,
`trpc.ts`, `packages/server/src/trpc/routers/*`, `packages/server/src/launcher/edit-guard.ts`,
`apps/web/test/feature-ui.test.ts`.

Inputs ingested, not re-derived: `E2E-FINDINGS.md` (F12/F13/F14/F17/F18 + paper cuts),
`docs/UI-SPEC.md`, `CONTEXT.md`, and the parent's established context (no design-system
dependency in `apps/web`; `apps/web` is never typechecked in CI; zero component tests).

---

## Two questions the parent asked me to settle first

**1. Do my components bypass `ui.tsx` with ad-hoc inline styles? No — quantified.**
Repo-wide there are exactly **five** `style={{…}}` sites in all of `apps/web/src`:

| site | verdict |
|---|---|
| `TerminalView.tsx:119`, `:129`, `:132` | deliberate and documented (`TerminalView.tsx:15` — *"Self-styled via inline styles (no external CSS class dependency) so it renders correctly regardless of the surrounding shell stylesheet"*). Not a finding. |
| `TicketsBody.tsx:117` — `<span style={{ flex: 1 }} />` | one-off spacer where `grill-strip-spacer` / `ws-title-spacer` / `drive-pane-spacer` / `prep-dryrun-spacer` classes already exist for exactly this. Trivial; filed in D as drift, not a styling problem. |
| `Sidebar.tsx:163` | sibling's scope. |

So **inline-style drift is not a finding in this scope.** What *is* real is a different
bypass: the `Button` primitive (`ui.tsx:12`) is used **11** times across my files while
raw `<button className="btn btn-xs btn-ghost">` — the exact markup `Button` emits — is
hand-written **13** times, plus 34 total `<button>` elements with bespoke classes
(`lane-btn`, `peek-close`, `mr-toggle`, `panel-tab`, `doc-card`, `ledger-head`,
`commit-sha`, `td-edit-open`, `gate-override-link`, `act-msg-toggle`, `follow-pill`).
See **D-4**.

**2. Does `apps/web/test/feature-ui.test.ts` (1824 lines) cover the derivation surface?**
Broadly yes for `nextStep` and the event-feed derivations, with two real gaps and one
brittleness pattern — see **D-8**.

---

## A. Flow map

### A.1 The spine: phase → body → derivation → tRPC → server

Every feature screen is one `Workspace` (`Workspace.tsx:46`) that owns a single
`feature.get` query and a single `nextStep` call, then dispatches to a body.

```
Workspace.tsx:67   trpc.feature.get.useQuery({id}, {refetchInterval: useLivePoll()})
                     └─ server: packages/server/src/trpc/routers/feature.ts:51  `get`
                     └─ cache key ['feature','get',{id}]  — shared by 4+ observers
Workspace.tsx:74   useEventLog(featureId)  → events.list (own cursor key, see A.4)
                     └─ server: routers/events.ts
Workspace.tsx:75   unresolvedMergeConflict(events)     ← feature-ui.ts:526
Workspace.tsx:76   testDriveTaken(events)              ← feature-ui.ts:599
Workspace.tsx:79   trpc.feature.commitCount  (5000ms)  ← routers/feature.ts:185
Workspace.tsx:82   trpc.notes.list                     ← routers/test-notes.ts
Workspace.tsx:89   trpc.docs.read (map.md, enabled)    ← routers/docs.ts
Workspace.tsx:99   trpc.project.prep                   ← routers/project.ts
Workspace.tsx:103  trpc.feature.driveInfo              ← routers/feature.ts:179
Workspace.tsx:238  effectivePhase()                    ← feature-ui.ts:354
Workspace.tsx:240  pipelineSteps()                     ← feature-ui.ts:367
Workspace.tsx:243  nextStep(full, ctx)                 ← feature-ui.ts:805   ← THE hub
Workspace.tsx:389  <NextStepBar ns=… onAction={runAction}>
Workspace.tsx:261  runAction(kind) — 15-arm switch on ActionKind → 10 mutations
Workspace.tsx:420  <PhaseBody effective=…>             ← Workspace.tsx:436, 6-arm switch
```

`PhaseBody` (`Workspace.tsx:455`) routes:

| effective phase | body | how it gets data |
|---|---|---|
| `ideation`, `spec` | `GrillBody` (`GrillBody.tsx:35`) | **takes `full`** |
| `tickets` | `TicketsBody` (`TicketsBody.tsx:30`) | **takes `featureId`, re-queries `feature.get`** (`:44`) |
| `implementation` | `RunBody` if `runId` else `TicketsBody` (`Workspace.tsx:474`) | **takes `featureId`, re-queries** (`RunBody.tsx:34`) |
| `review` | `ReviewBody` (`ReviewBody.tsx:46`) | **takes `full`** + 3 of its own queries |
| `shipped` | `ShippedBody` (`ShippedBody.tsx:18`) | **takes `full`** + its own `useEventLog` |

The `full` vs `featureId` split is arbitrary — see **D-1**.

### A.2 The review flow end-to-end (the flow that carries F18)

```
feature.phase = 'review'
 → Workspace.tsx:75   conflict = unresolvedMergeConflict(events)      feature-ui.ts:526
 → Workspace.tsx:243  nextStep(full, { conflict, driving, dryRunActive, unverifiedDriveKeys })
 → feature-ui.ts:1121 case 'review':
     :1135  testDriveAction   (disabled if ctx.dryRunActive)
     :1147  unverified = driving||dryRunActive ? [] : ctx.unverifiedDriveKeys
     :1150  iterate           (hidden if live; disabled if driving)
     :1167  if (ctx.conflict)  ────► RETURNS EARLY, secondary = [blockedMerge, drive, iterate]
     :1193  if (pending > 0)   ────► Burn primary  ← UNREACHABLE while a conflict stands
     :1217  default            ────► Merge & ship primary
 → Workspace.tsx:326  case 'resolveConflict': launch.mutate({kind:'revisit', kickoffLine: mergeConflictKickoff(...)})
                                                                       feature-ui.ts:457
 → server routers/feature.ts:59  launchSession
 → launcher writes settings.json registering the PreToolUse edit guard
 → packages/server/src/launcher/edit-guard.ts:36  guardsEdits(kind) { return kind !== 'project' }
                                                  ► 'revisit' IS guarded ► Edit/Write DENIED
```

Simultaneously `ReviewBody.tsx:99` renders `ConflictCard` (`:421`) whose *"Resolve with
agent"* (`:466`) fires the **same** launch with the **same** kickoff — two call sites,
one derivation, correctly shared. Then `MergeFeatureDialog` reads `mergeSummary`
(`feature-ui.ts:695`) via `Workspace.tsx:411` → `merge` (`routers/feature.ts:194`).

### A.3 The session/terminal flow

```
any body → <SessionPanel featureId sessions [full] showResume>   SessionPanel.tsx:36
  :56  pickPanelSession(sessions)                                 SessionPanel.tsx:215
  :62  sessionDoneState(full, session)                            feature-ui.ts:1387
  :85  <BriefingBanner>  → useEventLog(featureId)  (its OWN cursor/query key)
                          → kickoffTrouble(events, sessionId)     feature-ui.ts:746
                          → trpc.feature.resendKickoff            routers/feature.ts:116
  :88  <TerminalView sessionId>                                   TerminalView.tsx:31
        └─ new Terminal + FitAddon; ResizeObserver; attachCustomKeyEventHandler
           → mapTerminalKey(ev)                                   terminal-keys.ts:53
        └─ new TerminalClient(...).connect()                      terminal.ts:77
           → ws://host/ws/terminal/:sessionId  (packages/server/src/pty/ws.ts)
           → backoff 250→5000ms, CONNECT_TIMEOUT 8s, STALL_TIMEOUT 3s
  :95  else <EndedSessionCard> → trpc.feature.launchSession
```

`ReviewBody.tsx:520` mounts a **second** `TerminalView` for the drive dev pane
(`drive.devPaneId`), and `PreparationWorkspace.tsx:133` mounts a **third** — but
Preparation re-implements the whole `grill-strip` shell by hand rather than using
`SessionPanel` (**C-1**).

### A.4 Polling / invalidation topology

`useLivePoll()` (`live.ts:88`) returns 30 000 ms while the SSE stream is up, 1 500 ms when
it is down. Per E2E F14 the stream is reaped by Bun at ~10 s (server-side defect, out of
my scope), so in practice the 30 s safety poll does the work.

On a single review screen these observers are mounted at once:

| query key | observers |
|---|---|
| `['feature','get',{id}]` | `Workspace.tsx:67`, `Inspector.tsx:24`, (+`TicketsBody.tsx:44` / `RunBody.tsx:34` at other phases) |
| `['events','list',{featureId, afterId:N}]` | `Workspace.tsx:74`, `Inspector.tsx:28`, `SessionPanel.tsx:112`, (+`RunBody.tsx:39`, `ShippedBody.tsx:19`) — **each with its own accumulating cursor, so each is a distinct key** (`events.ts:18-21` documents this) |
| `['notes','list',{featureId}]` | `Workspace.tsx:82`, `ReviewBody.tsx:173` |
| `['feature','commitCount']` | `Workspace.tsx:79`, `ReviewBody.tsx:68` |
| `['feature','driveInfo']` | `Workspace.tsx:103`, `ReviewBody.tsx:72` |
| `['project','prep']` | `Workspace.tsx:99` (+ `PreparationWorkspace.tsx:48` on its own screen) |

`live.ts:111` `invalidateDbBacked()` invalidates the whole allowlist on every SSE signal.

---

## B. Dead code

### B-1 `dead:feature-ui.phaseGlyph` — violation, high confidence
`apps/web/src/lib/feature-ui.ts:73`
```ts
/** Sidebar status glyph per phase (mono). */
export function phaseGlyph(phase: Phase): string {
```
Repo-wide search for `phaseGlyph` across `.ts`/`.tsx`/`.md` (excluding `node_modules`,
`vendor`) returns **zero** hits outside its own definition — not even the 1824-line test
file. The sidebar it names now renders `miniSegments` (`Sidebar.tsx:308`) instead. 16 dead
lines carrying a six-arm switch on `Phase` that a future `Phase` addition would silently
have to satisfy.

### B-2 `dead:feature-ui.sortForSidebar` — violation, high confidence
`apps/web/src/lib/feature-ui.ts:183`
```ts
/** Sidebar sort: needs-me first, then active, then shipped (dimmed). Stable
 *  within groups (the server returns newest-first). */
export function sortForSidebar(features: FeatureListItem[]): FeatureListItem[] {
```
Only importers are `apps/web/test/feature-ui.test.ts:18` and `:1758`. The product now
groups with `triage()` (`feature-ui.ts:265`, used at `Sidebar.tsx:83`), which supersedes
it — `triage` even re-implements the same rank ordering as bucket order. This is
**test-only product code**: the test proves a behaviour nothing ships. Deleting both the
function and its `describe` block loses nothing.

### B-3 `dead:ShippedBody.mergedPredicate` — violation, high confidence (also a latent bug, see D-2)
`apps/web/src/components/bodies/ShippedBody.tsx:20-23`
```tsx
const merged = [...events].reverse()
  .find((e) => e.type === 'feature.shipped' || e.type === 'merge.conflict' || e.type === 'feature.status')
const when = merged && merged.type === 'feature.shipped' ? relTime(merged.ts) : ''
```
Two of the three predicate arms (`merge.conflict`, `feature.status`) can only ever make
`when` empty — they are pure suppressors. And one of them suppresses *unconditionally*
(D-2), so the `relTime(merged.ts)` branch is unreachable in practice for any feature
shipped through the merge button.

### B-4 `over-export:feature-ui` — judgement call, medium confidence, effort S, risk none
`feature-ui.ts:217` `PHASE_TIP` and `:226` `phaseIndex` are `export`ed but consumed only
inside `feature-ui.ts` (`:380` and `:339,:363` respectively) — no importers anywhere.
`NeedsMeKind` (`:90`) and `RowChipKind` (`:137`) likewise have no direct importers, though
`RowChip.needs` is read at `Sidebar.tsx:319`, so the *type* is transitively public. Not
dead code; it inflates the module's interface, which is the thing under audit.

---

## C. Redundancy

### C-1 `redundant:session-strip` — judgement call, high confidence, effort M, risk low
`PreparationWorkspace.tsx:112-137` hand-rolls the live-session strip that `SessionPanel`
already owns:

```tsx
// PreparationWorkspace.tsx:113
<div className="grill-panel pw-session">
  <div className="grill-strip">
    <span className="grill-kind">prepare</span>
    <SessionStatusDot status={session.status} />
    <span className="grill-live-label">{session.status === 'launching' ? 'launching…' : 'live'}</span>
    <span className="grill-strip-spacer" />
    <span className="grill-sid" title={session.ccSessionId ?? session.id}>
      {(session.ccSessionId ?? session.id).slice(0, 8)}</span>
    <EndSessionButton … />
```
versus `SessionPanel.tsx:65-84`, which is the same six elements, same class names, same
`slice(0, 8)`, same `ccSessionId ?? id` fallback. The differences are all incidental:
Preparation hardcodes the kind string `'prepare'` instead of `session.kind`, passes
`onEnded` to `EndSessionButton` instead of `featureId`, and **omits `BriefingBanner`
entirely** — so a prep session whose kickoff was swallowed (`session.kickoff_undelivered`)
gets no "Send briefing" affordance at all, while every feature session does. That omission
is the redundancy biting: the fix landed in one copy.

### C-2 `redundant:conflict-kickoff` — judgement call, high confidence, effort S, risk low. **Confirms E2E F18.**
`feature-ui.ts:457` `mergeConflictKickoff` and `feature-ui.ts:482` `ticketConflictKickoff`
are two hand-maintained prose templates that share five obligations verbatim:

```
:460  `Proceed with your task: RESOLVE A MERGE CONFLICT. …`
:493  `Proceed with your task: RESOLVE A MERGE CONFLICT. Ticket #… `
:461  `Your working directory IS the talk worktree, already checked out on ${branch}. `
:495  `Your working directory IS the talk worktree, already checked out on ${input.featureBranch}. `
:462  `Run \`git merge ${base}\`, then resolve every conflict using this feature’s spec.md and decisions.md`
:496  `Run \`git merge ${input.branch}\`, read both sides before resolving … spec.md and decisions.md`
:463  `and commit the merge. Do NOT push and do NOT advance the phase (never call complete_phase).`
:499  `Run the tests over the touched code, then commit the merge. Do NOT push and do NOT advance the phase (never call complete_phase).`
:458  `const list = files.length ? files.join(', ') : '(run git status to see the conflicts)'`
:490  `const list = input.files.length ? input.files.join(', ') : '(run git status after the merge to see them)'`
```
Note the **typographic drift already present**: `:462` uses a curly apostrophe in
`feature’s`, `:498` a straight one in `feature's` — the tell that these were copied and
edited apart.

**And the duplication is load-bearing for the bug.** Both hand a `revisit` session an
instruction to edit non-doc source files; `edit-guard.ts:36`
(`guardsEdits(kind) { return kind !== 'project' }`) denies exactly that for `revisit`.
Because the instruction lives in **two** hand-written strings rather than one builder, a
fix must be made twice — and there is no single place a server-side exemption could be
keyed off. E2E F18's `:459`/`:493` line refs are accurate against the current tree.

### C-3 `redundant:overlay-shell` — judgement call, high confidence, effort M, risk low
**Five** components independently re-implement the same overlay shell — backdrop div,
`window` keydown Escape effect, `stopPropagation` on the panel:

| file:line | `role="dialog"` / `aria-modal` |
|---|---|
| `DocPeek.tsx:24-34` (**mine**) | **absent** |
| `MergeFeatureDialog.tsx:34-50` | present (`:46`) |
| `DeleteFeatureDialog.tsx:30-37` | present |
| `DirectoryPicker.tsx:53-72` | present |
| `SettingsOverlay.tsx:40-51` | present |

Five adapters is far past the "two = real seam" bar. The duplication is what produced the
a11y divergence (**D-5**), and none of the five restores focus — `.focus()` appears exactly
once in all of `components/` (`CommandPalette.tsx:61`) and never as a restore.

### C-4 `redundant:autoscroll-follow` — judgement call, high confidence, effort S, risk low
`AgentTranscript.tsx:24-36` and `RunBody.tsx:392-403` (`EventStream`) are the same
follow-the-tail widget, character-for-character on the arithmetic:

```tsx
// AgentTranscript.tsx:34   and   RunBody.tsx:401
const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
setFollowing(atBottom)
```
Both then render the identical escape hatch:
```tsx
{!following && (<button className="follow-pill agent-follow" onClick={() => setFollowing(true)}>Follow ⇣</button>)}
```
— `RunBody.tsx:416` literally reuses `AgentTranscript`'s `agent-follow` class name inside
the events pane. Two adapters, one seam: a `useFollowTail()` hook (or a `<TailScroll>`
wrapper) would concentrate the threshold, the effect deps and the pill. See **G-4**.

### C-5 `redundant:event-tone` — judgement call, high confidence, effort S, risk low
Two different keyword classifiers over `EventRow['type']`, in two files, disagreeing:

```ts
// RunBody.tsx:425  eventLevel(type): 'error'|'ok'|'active'|'info'
if (type === 'merge.conflict.resolved') return 'ok'
if (type === 'merge.conflict.resolving') return 'active'
if (/(error|fail|conflict|cancel|stopped)/i.test(type)) return 'error'
if (/(done|succeed|finished|shipped|merged)/i.test(type)) return 'ok'
if (/(start|burn|launch|advance|running|retry|resum)/i.test(type)) return 'active'

// Inspector.tsx:331  eventTone(type): string
if (type.includes('failed') || type.includes('error') || type.includes('blocked')) return 'is-danger'
if (type.includes('done') || type.includes('shipped') || type.includes('merged')) return 'is-ok'
if (type.startsWith('phase') || type.startsWith('gate')) return 'is-accent'
```
Same event, two colours: `merge.conflict` is **error/red** in the run stream and
**neutral/uncoloured** in the activity feed. `session.not_ready` is neutral in both but
`ticket.cancelled` is red in one and neutral in the other. `gate.overridden` is accented
in Inspector and `active` in RunBody. Neither is tested, and neither lives beside the
event vocabulary it classifies.

### C-6 `redundant:commit-sha-copy` — judgement call, medium confidence, effort S, risk none
Copy-a-sha is written three ways in two files:
- `RunBody.tsx:196-201` — `navigator.clipboard?.writeText(sha).then(ok, fail)` with an optional-chain guard and a failure toast.
- `TicketsBody.tsx:100-103` — `void navigator.clipboard.writeText(sha)` with **no** guard, **no** `.catch`, and a success toast fired *before* the promise settles (so it says "copied" even when the write rejects).
- `Workspace.tsx:766` `copyText()` — a third variant with `.catch`.

All three render the same `<button className="commit-sha">`. `TicketsBody`'s is the buggy
one: an unhandled rejection plus a lying toast.

### C-7 `redundant:MAP_SECTIONS` — judgement call, low severity, documented
`GrillBody.tsx:177` duplicates the server's `MAP_SECTIONS` list with an explicit rationale
(`:171-176` — *"duplicated here rather than imported so the web bundle stays free of the
server's node-only knowledge module"*). Deliberate and documented. **Not filed as a
finding**, but noted: the four strings are a wire-shape contract with no shared constant
in `@runcastle/core`, which is where an IO-free contract belongs.

---

## D. Inconsistencies & structural smells

### D-1 `inconsistent:body-props` — judgement call, high confidence, effort M, risk low
The five bodies split on how they receive the feature, for no stated reason:

| body | signature | consequence |
|---|---|---|
| `GrillBody.tsx:35` | `{ full: FeatureFull, effective, readonly, mapRailCollapsed, onToggleMapRail }` | uses parent's data |
| `ReviewBody.tsx:46` | `{ full, driving, conflict, readonly }` | uses parent's data |
| `ShippedBody.tsx:18` | `{ full }` | uses parent's data |
| `TicketsBody.tsx:30` | `{ featureId, readonly }` | `:44` re-queries `feature.get`, adds its own loading/error branches `:72-77` |
| `RunBody.tsx:24` | `{ featureId, runId, readonly }` | `:34` re-queries `feature.get`, `:35` queries `run.get` |

The two re-querying bodies then have to *re-derive* state the parent already computed:
`RunBody.tsx:70` recomputes `live` from `sessions`, which `ReviewBody.tsx:62` also
recomputes, which `GrillBody.tsx:54` also recomputes — three copies of
`sessions.some((s) => s.status === 'live' || s.status === 'launching')` in three files,
none of them the `feature-ui.ts` helper that already exists next door
(`liveSessionBlocker`, `:1431`, uses the identical predicate). Four copies total.

The `readonly` prop is also declared-and-ignored in one place: `RunBody.tsx:22` — *"`readonly` is
accepted but ignored"* — except it *is* threaded to `Lane` at `:120` and to `SessionPanel`
at `:96`. The doc comment is stale.

### D-2 `bug:ShippedBody.mergedAt` — **violation / latent bug**, high confidence
`ShippedBody.tsx:20-23` never shows a merge time. Traced:

```ts
// packages/server/src/trpc/routers/feature.ts:207-208 — the ONLY ship path
setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
setFeatureStatus(ctx, input.featureId, 'shipped')   // → repo.ts:212 emits 'feature.status'
```
`feature.status` is emitted **after** `feature.shipped`, so it always carries the higher
event id. `ShippedBody` reverses the id-ordered log (`events.ts:32` sorts by id) and takes
the first match of `{feature.shipped, merge.conflict, feature.status}` — which is always
`feature.status`. The guard `merged.type === 'feature.shipped'` then fails, and:

```tsx
{when ? ` · merged ${when} ago` : ''}   // ShippedBody.tsx:35
```
renders empty **for every feature ever shipped**. The hero silently loses the one fact it
claims to report. Zero component tests means nothing caught it. Fix is one line
(`.find((e) => e.type === 'feature.shipped')`), but the real lesson is that a UI derivation
over event *ordering* lives in a `.tsx` where the pure-lib test suite cannot reach it,
while five structurally identical derivations (`unresolvedMergeConflict`,
`undoableOverride`, `testDriveTaken`, `kickoffTrouble`, `phaseTransition`) correctly live
in `feature-ui.ts` **and are all tested**. See **G-2**.

### D-3 `bug:nextStep.conflictHidesBurn` — **violation / latent bug**, high confidence. **Extends E2E F18.**
`feature-ui.ts:1167` returns early:
```ts
if (ctx.conflict) {
  …
  return {
    kick: 'MERGE CONFLICT', …
    primary: live ? undefined : { label: 'Resolve the merge conflict', kind: 'resolveConflict' },
    secondary: [blockedMerge, testDriveAction, ...iterate],   // ← no burn
    …
  }
}
// feature-ui.ts:1193 — never reached while a conflict stands
if (pending > 0) {
  return { …, primary: { label: `Burn ${pending} ticket…`, kind: 'burn' }, … }
}
```
E2E F18 reported *"The pending ticket … has no Burn button anywhere on the screen."* This
is the mechanism, and it is **precise**: the Burn affordance exists, at `:1200`, and is
made unreachable by the conflict branch's early return. The state F18 hit — conflict
standing **and** a pending merge-carrying ticket — is exactly the intersection the two
branches don't compose over.

Compounding it: `resolveConflict` (`Workspace.tsx:326`) and the `ConflictCard`
(`ReviewBody.tsx:466`) both launch a `revisit` whose kickoff instructs source edits that
`edit-guard.ts:36` denies, so the *offered* primary cannot succeed either. The review
screen's entire action set in that state is: one action that structurally cannot complete,
one disabled, one that restarts the feature, and one drive. The one action that *would*
work (Burn the pending ticket) is the one suppressed. **Fix shape from the UI side:** move
the `pending > 0` burn into the conflict branch's `secondary` array, or reorder so
`pending` composes with `conflict` rather than being shadowed by it.

### D-4 `inconsistent:button-primitive` — judgement call, high confidence, effort M, risk low
`ui.tsx:12` `Button` exists precisely so `btn btn-{variant}` is written once
(`ui.tsx:7` — *"Exactly one `solid` button is visible per view"* is an invariant only a
single component can enforce). In my scope it is used 11 times and bypassed 13 times with
literally the string it emits:

```tsx
SessionPanel.tsx:127   <button type="button" className="btn btn-xs btn-ghost" …>   // Send briefing
SessionPanel.tsx:196   <button type="button" className="btn btn-xs btn-solid strip-work-next" …>
SessionPanel.tsx:265   <button type="button" className="btn btn-xs btn-ghost session-ended-resume" …>
GrillBody.tsx:159      <button type="button" className="btn btn-xs btn-ghost" …>   // Resume converge
GrillBody.tsx:437      <button type="button" className="btn btn-xs btn-solid" …>   // Work
GrillBody.tsx:474/483  <button … className="btn btn-xs btn-danger|btn-ghost" …>
ReviewBody.tsx:286/290/296  <button className="btn btn-xs btn-ghost" …>            // Edit/Delete/→ticket
ReviewBody.tsx:345/348 <button className="btn btn-xs btn-ghost" …>
ReviewBody.tsx:510     <button type="button" className="btn btn-xs btn-ghost drive-pane-toggle" …>
```
Meanwhile `ReviewBody.tsx:233/319/322/462`, `PreparationWorkspace.tsx:216/219/252/313`,
`Inspector.tsx:198/265/273` use `<Button>`. **`ReviewBody` uses both, 40 lines apart**
(`:233` `<Button variant="ghost">Add</Button>` vs `:286` `<button className="btn btn-xs btn-ghost">Edit</button>`).
`type="button"` is also inconsistent — present on some, absent on `ReviewBody.tsx:286-303`
and every `RunBody` `lane-btn` (`:261`, `:291`, `:317`, `:338`), which inside a form would
default to submit.

### D-5 `a11y:DocPeek-not-a-dialog` — **violation**, high confidence
`DocPeek.tsx:33-40` is the **only** overlay in `apps/web` without dialog semantics:
```tsx
<div className="peek-backdrop" onClick={onClose}>
  <div className="peek" onClick={(e) => e.stopPropagation()}>
```
No `role="dialog"`, no `aria-modal="true"`, no `aria-label` — while its four siblings all
have all three (`MergeFeatureDialog.tsx:46-48`, `DeleteFeatureDialog.tsx`,
`DirectoryPicker.tsx:71`, `SettingsOverlay.tsx:50`). Escape *is* handled (`:26`), which
satisfies UI-SPEC §2, but:
- the backdrop `div` has `onClick` with **no `role`, no `tabIndex`, no `onKeyDown`** — invisible to keyboard and to screen readers;
- **no focus move on open and no focus restore on close** in any of the five overlays;
- the doc content is mounted behind the reader with no focus containment.

`DocPeek` is reachable from two places in my scope (`GrillBody.tsx:131`,
`Inspector.tsx:319`), so it is on the main path, not a corner.

### D-6 `a11y:streaming-output-not-live` — judgement call, high confidence, effort S, risk none
Three continuously-updating regions announce nothing:
- `AgentTranscript.tsx:39` `<div className="agent-body" ref={scrollRef} onScroll={onScroll}>` — the burn transcript, appended once per second. No `role="log"`, no `aria-live`.
- `RunBody.tsx:406` `<div className="stream-body" …>` — the event stream. Same.
- `TerminalView.tsx:130` the status strip (*"disconnected — reconnecting… keystrokes are dropped"*) is `pointerEvents: 'none'` decoration with no `role="status"` — the one message the E2E run specifically called out as needing to be unmissable (`TerminalView.tsx:105-107`) is unannounced.

By contrast the codebase *does* know the idiom: `Workspace.tsx:393` `role="status"`,
`:400` `role="alert"`, `GrillBody.tsx:458` `role="alert"`. So this is drift, not ignorance.

### D-7 `a11y:xterm-focus-and-keys` — judgement call, medium confidence, effort M, risk medium
`TerminalView.tsx:31` never focuses the terminal, and nothing else does — `.focus()`
appears once in all of `components/` and it is the command palette's input
(`CommandPalette.tsx:61`). The terminal is the product's primary input surface; reaching it
requires a mouse click on the xterm canvas. There is also no documented escape key to leave
the terminal's keyboard capture, and `attachCustomKeyEventHandler` (`:83`) intercepts
Shift/Ctrl+Enter globally while focused. Not a regression — a gap.

### D-8 `test-gap:feature-ui` — judgement call, high confidence
`apps/web/test/feature-ui.test.ts` (1824 lines, 29 `describe` blocks) covers `nextStep`
richly (ideation/spec/tickets/implementation/review, laps, mapped, conflicts, unverified
keys, archived) and every event-feed derivation. **Two real gaps:**

1. **The pipeline/view derivations are untested**: `phaseIndex`, `miniSegments`,
   `effectivePhase`, `isReadonlyView`, `pipelineSteps`, `mapDocPath`, `PHASE_TIP`,
   `phaseGlyph`, `triageOf`/`triage`. `triage` is the sidebar's whole information
   architecture and `pipelineSteps` decides which steps are clickable — both pure, both
   trivially testable, neither covered. (`capLane`, `rowChip`, `ticketProgress`,
   `sortForSidebar` *are* covered.)
2. **The one derivation not in `feature-ui.ts` is the one that's broken** (D-2). The test
   suite's reach ends at the module boundary, and `ShippedBody`'s inline event scan sits
   just outside it.

**Brittleness:** ~142 exact-string assertions, of which ≥26 pin user-visible copy —
`expect(ns.title).toBe('No tickets to burn')` (`:190`, `:210`),
`expect(ns.desc).toBe('2 waypoints still open — resolve or drop them')` (`:1279`),
`expect(ns.primary?.label).toBe('Burn 2 tickets')` (`:1141`),
`expect(ns.title).toBe('Writing the spec')` (`:293`). Every copy edit — exactly the kind of
edit the E2E paper cuts ask for — breaks a test that was not testing behaviour. And since
`apps/web` is not typechecked in CI, this test file is the *only* automated signal over
1455 lines, so it is load-bearing and simultaneously over-specified.

### D-9 `inconsistent:burn-count-copy` — judgement call, high confidence. **Confirms E2E paper cut.**
`nextStep` counts tickets for the Burn label three different ways:
```ts
feature-ui.ts:1024  primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' }   // t = tickets.length — ALL
feature-ui.ts:1099  primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' }   // t — ALL
feature-ui.ts:1200  primary: { label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}` }     // pending only
```
`pending` is computed at `:836` (`status !== done && !== failed && !== cancelled`) and its
own comment says it *"matches the server's `burn` acceptance check"*. So `:1024`/`:1099`
promise to burn N and the server burns fewer — E2E's *"Burn 3 tickets when one of the three
is already done"*. Worse, `:1097` already uses `pending` for the **title**
(`pending === 1 ? 'Review & burn the ticket' : '…the tickets'`) while `:1099` uses `t` for
the **label** two lines below: the same bar can read *"Review & burn the ticket"* over a
button saying *"Burn 3 tickets"*. `feature-ui.test.ts:1140-1141` pins that exact pairing
as correct, so the test is currently locking in the bug.

### D-10 `inconsistent:session-kind-chip` — judgement call, high confidence. **Confirms E2E paper cut.**
`SessionPanel.tsx:69` `<span className="grill-kind">{session.kind}</span>` renders the raw
`SessionKind` enum. Per CONTEXT vocabulary and the phase pipeline the chip should say what
the session is *doing*, not how it was launched — an `ideation` session drives itself
through `spec` and `tickets` (`runcastle:ideate` → `runcastle:spec` → `runcastle:tickets`)
while the chip still reads `ideation`. There is no mapping table: `PHASE_LABELS`
(`feature-ui.ts:207`) exists for phases, nothing equivalent exists for session kinds, and
`PreparationWorkspace.tsx:116` sidesteps the problem by hardcoding `'prepare'`. Two
renderers, one raw enum, one literal, no shared vocabulary — the seam that a
`SESSION_KIND_LABELS` map would occupy is simply missing.

### D-11 `inconsistent:vocabulary-verified` — **violation**, high confidence. **Confirms E2E F12.**
Verified against the current tree:
```tsx
// PreparationWorkspace.tsx:386-389 — the SOURCE badge
{f.source === 'human' ? 'yours'
  : f.source === 'session' ? 'verified'          // ← the word
  : HOST_ONLY_PREPARED.has(f.key) ? 'proposed' : 'measured'}
```
```tsx
// PreparationWorkspace.tsx:326-341 — the VERIFICATION badge, 60 lines up
function VerificationBadge({ finding }: { finding: ProjectFinding }) {
  const badge = verificationBadge(finding)          // renders 'verified' / 'unverified'
  const proven = finding.verifiedAt !== undefined
  title={ proven ? 'A preparation dry run ran this value on the real drive machinery and it worked' : … }
```
The two badges sit **on the same row** (`:390` then `:395`), both use the class
`settings-badge`, and both can print the string `verified` meaning two unrelated things.
The `title` attributes are correct and contradictory (*"Established in a conversation on
your own machine"* vs *"A preparation dry run ran this value…"*), which is the proof the
collision is accidental. CONTEXT locks the vocabulary; `verified` is not in it as a
provenance term, only as a proof term.

Both badge strings are inline ternaries in JSX rather than lookup tables, so nothing
compares them and no test can.

### D-12 `smell:repeated-switch-on-phase` — judgement call, high confidence, effort L, risk medium
`Phase` is switched or keyed on in **eight** places, five of which are `feature-ui.ts`:

| site | form |
|---|---|
| `feature-ui.ts:63` `PHASE_ORDER` | array |
| `feature-ui.ts:74` `phaseGlyph` | `switch` (dead, B-1) |
| `feature-ui.ts:207` `PHASE_LABELS` | `Record<Phase, string>` |
| `feature-ui.ts:217` `PHASE_TIP` | `Record<Phase, string>` |
| `feature-ui.ts:861` `nextStep` | `switch` — **377 lines**, `:861`–`:1236` |
| `Workspace.tsx:455` `PhaseBody` | `switch` |
| `Workspace.tsx:547` `kickClass` | nested ternary on `ns.kick` |
| `Inspector.tsx:86` `GATE_NAMES` | `Record<string, string>` (gate ids, parallel axis) |

Adding a phase means editing at least five of these, in two files, with no compiler help
for the two that are `string`-keyed (`GATE_NAMES: Record<string, string>` at
`Inspector.tsx:86` — a `Record<GateId, string>` would be checked; it isn't). Classic
shotgun surgery on a closed enum. The `Record<Phase, …>` tables *are* exhaustive-checked,
which is why they've stayed correct — the `switch`es and the string-keyed maps are where
drift lives.

### D-13 `smell:nextStep-is-a-grab-bag` — judgement call, high confidence, effort L, risk medium
`nextStep` (`feature-ui.ts:805-1237`) is 433 lines returning a 7-field view-model
(`NextStep`, `:428`) that mixes at least five separable concerns, all inlined:

1. **Availability** — which actions the server would accept: `canAdvance` (`:857`),
   `ctx.dryRunActive` (`:1140`), `ctx.driving` (`:1157`), `live` (`:1150`), `pending`
   (`:836`). This is a mirror of server-side gate/precondition logic, maintained by hand
   with comments that name the server function it mirrors (`:834` *"matches the server's
   `burn` acceptance check (features.ts)"*, `TicketsBody.tsx:249` *"the same pair
   `editTicket` enforces"*, `ReviewBody.tsx:158` *"The server refuses every one of those
   transitions anyway"*).
2. **Copy** — ~40 distinct hardcoded `title`/`desc`/`label` strings, none in
   `lib/vocabulary.ts` where the project's other user-facing sentences live.
3. **Wording variants** — Resume-vs-Start (`hasResumable`, `:770`) recomputed and
   re-branched at `:953`, `:965`, `:995`, `:1009`, `:1046`, `:1084`, `:922`.
4. **Warnings** — `unverifiedWarning` (`:781`), fog parsing (`:870`, which reaches into
   `parseMapSections` and string-matches the literal heading `'Not yet specified'`).
5. **Pluralisation** — `${n === 1 ? '' : 's'}` appears **9** times inside this one function.

The deletion test passes loudly — remove `nextStep` and the complexity reappears in every
body — so the module earns its keep. But it is one **wide** interface, not a deep one: the
caller must know `NextStep`'s 7 fields, `NextAction`'s 5, `ActionKind`'s 12 arms, plus
the `ctx` object's 5 optional keys and their interactions (`:1147` — `unverified` is
suppressed by *two* other ctx flags). And `Workspace.runAction` (`:261`) must then keep a
15-arm switch in perfect sync with `ActionKind` by hand — the compiler does not check that
every `ActionKind` a `nextStep` branch emits has a `runAction` arm (there's no exhaustive
`never` check at `Workspace.tsx:335`).

### D-14 `smell:stringly-typed-status` — judgement call, high confidence, effort S, risk low
`feature-ui.ts` compares ticket/run/waypoint status against bare string literals
throughout, on `interface RunFigure { status: string }` (`:626`) rather than the real
`RunStatus`:
```ts
:631  function ticketRow(tickets: readonly { status: string }[]): CheckRow {
:632    const done = tickets.filter((t) => t.status === 'done').length
:646    run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'danger' : 'warn'
:836    (x) => x.status !== 'done' && x.status !== 'failed' && x.status !== 'cancelled'
:1105   run.status === 'failed' ? … : run.status === 'cancelled' ? … : …
```
`@runcastle/core` exports `TicketStatus` and `RunStatus` (used correctly at
`ui.tsx:83`, `:87`). Typo-ing `'succeeded'` compiles fine here. Same in components:
`RunBody.tsx:202` `['burning','done','failed'].includes(ticket.status)`,
`TicketsBody.tsx:251` `new Set(['pending','failed'])` — an untyped `Set<string>` mirroring
a server enum.

### D-15 `smell:layout-spacer-drift` — judgement call, low, effort S
`TicketsBody.tsx:117` `<span style={{ flex: 1 }} />` where `grill-strip-spacer`
(`SessionPanel.tsx:74`), `ws-title-spacer` (`Workspace.tsx:367`), `drive-pane-spacer`
(`ReviewBody.tsx:503`) and `prep-dryrun-spacer` (`PreparationWorkspace.tsx:312`) already
exist — four class-named spacers and one inline one. Four names for one concept is itself
mild drift.

---

## E. Wrong-tool & weak typing

### E-1 `weak-typing:trpc-data-cast` — judgement call, high confidence, effort M, risk low
The same cast appears **five** times across the workspace tree, each with a comment
apologising for it:
```tsx
ReviewBody.tsx:86         driveCapabilities(settings.data as SettingsView | undefined)
TicketsBody.tsx:70        effectiveStepModel(settings.data as SettingsView | undefined, 'implement')
PreparationWorkspace.tsx:70   const view = prep.data as PrepView | undefined
Workspace.tsx:247         unverifiedDriveKeys((prepQ.data as PrepView | undefined)?.findings ?? [])
```
`ReviewBody.tsx:83-84`: *"(`useQuery().data` infers to `{}` here — the same tRPC-in-component
typing gap the settings overlay documents; the runtime value is a SettingsView.)"* —
the comment is copy-pasted verbatim into `TicketsBody.tsx:68-69`. Five identical unchecked
casts across four files, all narrowing `{}` to a domain type, is a real seam wearing a
comment instead of a module: two typed hooks (`useSettings(projectId)`,
`usePrepView(projectId)`) would concentrate the cast in one place where the "why" is
written once and the risk is bounded. Whatever the underlying tRPC inference bug is, it is
being paid for per call site.

### E-2 `weak-typing:enabled-guard-cast` — judgement call, high confidence, effort S, risk low
```tsx
RunBody.tsx:36        { runId: runId as string },   with  { enabled: !!runId }
TicketsBody.tsx:65    { projectId: projectId as string },   with  { enabled: !!projectId }
GrillBody.tsx:201     { featureId, relPath: relPath ?? 'map.md' },   with  { enabled: !!relPath }
Workspace.tsx:90      { featureId, relPath: mapRelPath ?? 'map.md' },  with  { enabled: !!mapRelPath }
```
Two variants of the same workaround: cast `undefined` to `string` and hope `enabled`
saves you, or invent a sentinel path (`'map.md'`) that becomes part of the **cache key** —
so a feature with no map still occupies key `['docs','read',{featureId, relPath:'map.md'}]`,
and `live.ts:130` `u.docs.read.invalidate()` fans out over those phantom keys. The sentinel
also silently changes the query identity if a real `map.md` ever exists at the root.

### E-3 `wrong-tool:conflict-instructions-as-prose` — judgement call, high confidence, effort M, risk medium
`mergeConflictKickoff` (`:457`) and `ticketConflictKickoff` (`:482`) encode an
**agent capability contract** — which files may be edited, which tools must not be called
(`never call complete_phase`), which direction the merge runs — as unstructured English
strings in a browser bundle. The authority for that contract lives server-side in
`edit-guard.ts` and the launcher's settings rendering. Prose in the client cannot be
validated against a guard in the server, which is exactly how F18 shipped: the instruction
and the enforcement are in different packages, in different languages (English vs a path
predicate), with nothing comparing them. A structured kickoff descriptor (`{intent:
'resolve-conflict', writablePaths, forbiddenTools}`) rendered server-side would make the
contradiction a type error rather than a runtime denial.

### E-4 `wrong-tool:fog-by-heading-string` — judgement call, medium confidence, effort S, risk low
```ts
feature-ui.ts:870-872
const fog = ctx.mapContent
  ? parseMapSections(ctx.mapContent)['Not yet specified']?.trim() || undefined
  : undefined
```
The next-step bar's fog warning is a **markdown heading string match** against a document
the server scaffolds. `GrillBody.tsx:177` holds the canonical list
(`MAP_SECTIONS = ['Destination','Notes','Not yet specified','Out of scope']`) but
`nextStep` does not import it — it re-types the literal. Rename a heading server-side and
the fog warning silently stops appearing, with no test to catch it (the `parseMapSections`
tests at `:1181` test the parser, not this lookup).

### E-5 `weak-typing:unvalidated-event-payloads` — judgement call, medium confidence, effort S, risk low
Three derivations hand-narrow `EventRow['data']` with ad-hoc casts instead of zod, in a
package that has zod available and whose house rule is *"Zod is the schema lib"*:
```ts
feature-ui.ts:530  const d = (e.data ?? {}) as { base?: unknown; files?: unknown }
feature-ui.ts:558  const d = (e.data ?? {}) as { from?: unknown; to?: unknown }
feature-ui.ts:581  forcedGate = ((e.data ?? {}) as { gate?: GateId }).gate ?? null
feature-ui.ts:749  if ((e.data as { sessionId?: unknown } | null)?.sessionId !== sessionId) continue
```
`:530` and `:558` do defend properly afterwards (`Array.isArray`, `parsePhase`). `:581`
does **not** — it casts straight to `GateId` with no validation, so a malformed
`gate.overridden` payload puts an arbitrary string into `UndoableOverride.gate`, which
`Inspector.tsx:202` then sends to `undoGateOverride.mutate({ featureId, gate: undoable.gate })`.
The event shapes are emitted by the server and have no shared schema in `@runcastle/core`.

### E-6 `wrong-tool:window-confirm` — judgement call, high confidence, effort S, risk low
`RunBody.tsx:327`
```tsx
if (confirm(`Discard ticket #${ticket.seq}'s preserved work (if any) and start over?`)) {
```
The one native `confirm()` in the app, for a destructive action (*"Retry fresh"* discards
preserved commits), while the codebase has `DeleteFeatureDialog`, `MergeFeatureDialog` and
`GrillBody`'s inline `wp-confirm` pattern (`:457`) for exactly this. `GrillBody.tsx:376-388`
even argues the case explicitly — *"that refusal is the inline confirm below, not a toast"*.
Native `confirm` also blocks the event loop, which pauses the xterm WebSocket pump and the
polls while it is open.

### E-7 `bug:clipboard-unhandled` — violation, medium confidence
`TicketsBody.tsx:100-103`
```ts
const copySha = (sha: string) => {
  void navigator.clipboard.writeText(sha)
  toast.push(`copied ${shortSha(sha)}`, 'info')
}
```
`void` on a promise that can reject (permissions, non-secure context) = unhandled
rejection; and the toast claims success before the write resolves. `RunBody.tsx:196` gets
this right (`?.` guard + both handlers), `Workspace.tsx:766` gets it right. One of three
copies is wrong — the redundancy in **C-6** is what allowed it.

---

## F. Shallow modules

### F-1 `shallow:Markdown` — judgement call, medium confidence, effort S, risk none — **but it earns its keep**
`Markdown.tsx:25` is 6 lines wrapping `ReactMarkdown`. Interface ≈ implementation.
**Deletion test: it passes.** Delete it and every one of its five call sites
(`GrillBody.tsx:276`, `:423`, `:428`, `TicketsBody.tsx:174`, `:180`, `DocPeek.tsx:46`) must
independently remember `remarkGfm`, the `md` wrapper class, and — critically — *not* to add
`rehype-raw`. That last one is a security property. So the wrapper is thin but load-bearing.

**However, `MARKDOWN_POLICY` (`:11`) is not enforced anywhere.** It is an exported,
test-pinned `const` object that the component never reads:
```ts
export const MARKDOWN_POLICY = { gfm: true, rawHtml: false, syntaxHighlighting: false } as const
…
<ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>   // :28 — reads none of it
```
The policy and the implementation are two independent facts that happen to agree. A test
asserting `MARKDOWN_POLICY.rawHtml === false` proves nothing about the renderer; adding
`rehypeRaw` to line 28 would leave every test green. `judgement call`, medium confidence.

**Sanitisation status (asked explicitly):** `dangerouslySetInnerHTML` appears **zero**
times in `apps/web/src` (only in `apps/web/prototypes/multi-project.html:663,667`, a
non-shipped prototype). `react-markdown` with no `rehype-raw` escapes HTML by default, so
agent-authored markdown is safe as rendered. **No sanitisation bug found.**

**Is `Markdown` the only renderer?** Not quite, and the alternatives are appropriate:
- `lib/activity.ts:37` `stripMarkdown()` — a regex *stripper* for the activity feed's
  one-line summaries, deliberately not a parser (`:32-35` says so). Reasonable.
- `Inspector.tsx:389` `<pre className="act-detail mono">{line.detail}</pre>` — expanded
  event detail rendered as **plain text**, not markdown, even though `activityLine` just
  stripped markdown from it. Text-node rendering, safe.
- `AgentTranscript.tsx:51` `<span className="agent-prose">{b.text}</span>` — agent prose,
  **markdown not rendered and not stripped**, so `## Heading` and `**bold**` appear as
  literal syntax in the burn transcript. This is precisely the complaint `activity.ts:12-13`
  was written to fix (*"`##` headings rendered as literal hashes in the middle of a status
  feed"*) — the fix landed in the activity feed and not in the transcript pane. Filed as
  **D-16** below in spirit; the inconsistency is real and the seam (`stripMarkdown` or
  `Markdown`) already exists two imports away.

### F-2 `shallow:phaseIndex / stepState / effectivePhase / isReadonlyView` — judgement call, medium confidence, effort S, risk none
```ts
feature-ui.ts:226  export function phaseIndex(phase: Phase): number { return PHASE_ORDER.indexOf(phase) }
feature-ui.ts:354  export function effectivePhase(feature, viewedPhase) { return viewedPhase ?? feature.phase }
feature-ui.ts:362  export function isReadonlyView(feature, effective) { return phaseIndex(effective) < phaseIndex(feature.phase) }
feature-ui.ts:338  function stepState(feature, phase): StepState { … 4 lines … }
```
Four one-to-four-line functions over the same `PHASE_ORDER` index arithmetic, three of them
exported, all called from exactly one place (`Workspace.tsx:238`, `:239`, and internally).
Individually each passes the deletion test only weakly — `effectivePhase` is `??`. They are
not harmful; they are the low-value tail of a 1455-line module, and they are the natural
core of the `PipelineView` module proposed in **G-3** (where, grouped, they would become a
genuinely deep unit: "given a feature and a pin, what is shown, what is clickable, and is
it read-only").

### F-3 `shallow:PrepEvidence` — judgement call, low confidence, effort S, risk none
`PreparationWorkspace.tsx:272`
```tsx
function PrepEvidence({ findings, staleCount }) {
  return (<>
    {staleCount > 0 && <StaleWarning count={staleCount} />}
    {findings.length > 0 && <EstablishedFrame findings={findings} />}
  </>)
}
```
Two conditionals. **Deletion test: it passes narrowly** — it is rendered at three sites
(`:156`, `:213`, `:261`) and its docblock (`:266-271`) encodes a real invariant ("*in the
one order that reads: why to act, then what is already there*"). Three callers, one
ordering rule. Keeps its keep; noted only because it is the thinnest thing in the file.

### F-4 Not shallow — `TerminalClient` and `mapTerminalKey` are the two best modules in scope
Called out as the counter-examples the rest should aim at.
`lib/terminal.ts` `TerminalClient` (`:60`) is genuinely **deep**: a 5-method interface
(`connect`/`send`/`resize`/`dispose` + 3 callbacks) over capped exponential backoff,
connect-timeout forcing, half-open detection via `bufferedAmount`, scrollback-replay reset
sequencing, and terminal-`ended` latching. `lib/terminal-keys.ts` `mapTerminalKey` (`:53`)
is a 1-function pure module whose docblock records *why* (`\x1b\r` verified against Claude
TUI v2.1.218) and the keydown/keypress double-fire subtlety. Both have unit seams; both
concentrate knowledge callers would otherwise scatter.

**Lifecycle verification (asked explicitly) — `TerminalView.tsx:95-102` cleanup is correct:**
```ts
return () => {
  cancelAnimationFrame(raf); ro.disconnect(); dataSub.dispose(); resizeSub.dispose()
  client.dispose(); term.dispose()
}
```
rAF cancelled, ResizeObserver disconnected, both xterm subscriptions disposed, WS client
disposed (which nulls all four handlers and clears three timers, `terminal.ts:146-163`),
terminal disposed. Effect deps `[sessionId, wsBase]` are correct and complete. Reconnect
backoff is capped (`terminal.ts:37-38`, 250→5000 ms) per UI-SPEC §5. **No leak found.**

One small wart: `terminal.ts:61-62` `let client: TerminalClient; client = new TerminalClient({… onStatus: (s) => { if (s === 'live') client.resize(…) }})` — a TDZ dance to let the callback close over the instance. It works (the callback cannot fire before construction returns) but `const client: TerminalClient = new …` would not compile, hence the `let`; a `queueMicrotask` or a post-construction `onStatus` assignment would be clearer. Cosmetic.

### F-5 `smell:agent-prose-unrendered` (the D-16 referenced above) — judgement call, high confidence, effort S, risk none
`AgentTranscript.tsx:51` renders raw agent markdown as a text node while
`Inspector.tsx:387` renders the *same class* of content through `stripMarkdown`
(`activity.ts:100`) and `TicketsBody.tsx:174` renders agent prose through `<Markdown>`.
Three surfaces, three different treatments of agent-authored prose, one of which
(`AgentTranscript`) shows raw `##`/`**` syntax to the user during the longest-running,
most-watched operation in the product.

---

## G. Deepening / extraction opportunities (ranked)

Ranked by (leverage × number of real callers) ÷ risk.

### G-1 — Split `nextStep` into three modules behind the same façade
**`deepen:next-step`** · effort **L** · risk **medium** · confidence high
`feature-ui.ts:805-1237` is 433 lines with five interleaved concerns (**D-13**). The
extraction that concentrates the most complexity:

1. **`lib/next-step/availability.ts`** — a table, not a switch: for each
   `(phase, ActionKind)` the predicate over `{gate, live, driving, dryRunActive, pending, run, conflict, lap, mapped, status}`
   and the `disabled` sentence. This is the part that mirrors server preconditions
   (`features.ts` burn check, `editTicket`'s status pair, `assertSpawnable`, the drive
   singleton) and the part where D-3's conflict/pending shadowing becomes *visible*: in a
   table, "conflict standing" and "pending tickets" are two independent rows, not two
   `return`s racing down a function.
2. **`lib/next-step/copy.ts`** — the ~40 title/desc/label strings, joining
   `lib/vocabulary.ts`, with the pluraliser (`n === 1 ? '' : 's'`, 9 occurrences) and the
   Resume/Start variant (7 occurrences) as one helper each. Fixes **D-9** by construction:
   one `burnLabel(count)` cannot disagree with itself.
3. **`lib/kickoff.ts`** — `mergeConflictKickoff` + `ticketConflictKickoff` collapsed into
   one `conflictKickoff({ direction, subject, files, … })` (**C-2**), which is also where a
   `writablePaths` contract would attach (**E-3**).

**Real seams, not hypothetical:** availability has 2 consumers today
(`NextStepBar` at `Workspace.tsx:615/627` reads `disabled`, and every body that
independently re-mirrors a server rule — `TicketsBody.tsx:251`, `RunBody.tsx:74`,
`ReviewBody.tsx:158`). Kickoff has 3 call sites (`Workspace.tsx:331`,
`ReviewBody.tsx:470`, `RunBody.tsx:304`). Copy has as many callers as there are strings.

**Payoff:** `nextStep` stays the single façade `Workspace` calls, so no caller changes;
the 433-line switch becomes ~80 lines of composition; and the three most-repeated defect
shapes in this scope (mirrored-server-rule drift, copy inconsistency, kickoff duplication)
each get a home with a test seam the existing 1824-line suite can target without asserting
prose.

### G-2 — Move the last event-feed derivation into `feature-ui.ts`
**`deepen:event-derivations`** · effort **S** · risk **low** · confidence high
`feature-ui.ts` already owns five event-feed derivations, all tested:
`unresolvedMergeConflict` (`:526`), `phaseTransition` (`:557`), `undoableOverride`
(`:576`), `testDriveTaken` (`:599`), `kickoffTrouble` (`:746`). The sixth —
`ShippedBody.tsx:20-23`'s merged-at scan — is inline in a `.tsx` and is **broken** (D-2).
Extract `shippedAt(events): number | null` beside its five siblings and the bug is fixed,
tested, and structurally prevented from recurring. One caller today, but the pattern has
five prior adapters, so the seam is proven, not speculative. **Highest value-per-effort
item in this report.**

### G-3 — A `PipelineView` module for the phase-index arithmetic
**`deepen:pipeline-view`** · effort **S** · risk **low** · confidence medium
Group `phaseIndex` (`:226`), `stepState` (`:338`), `miniSegments` (`:347`),
`effectivePhase` (`:354`), `isReadonlyView` (`:362`), `pipelineSteps` (`:367`),
`PHASE_ORDER`, `PHASE_LABELS`, `PHASE_TIP` into `lib/pipeline-view.ts` with one entry
point: `pipelineView(feature, viewedPhase) → { effective, readonly, steps, segments }`.
Callers (`Workspace.tsx:238-240`, `Sidebar.tsx:308`) go from three coordinated calls to
one. Collapses four shallow exports (**F-2**) into one deep one, removes the dead
`phaseGlyph` (**B-1**) on the way, and gives the untested pipeline derivations (**D-8**)
an obvious test file. Also shrinks the phase-switch surface (**D-12**) from 8 sites to 5.

### G-4 — `useFollowTail()` for the two tailing panes
**`deepen:follow-tail`** · effort **S** · risk **low** · confidence high
`AgentTranscript.tsx:24-36,71-75` and `RunBody.tsx:389-403,415-419` (**C-4**). Two real
adapters. A hook returning `{ ref, onScroll, following, follow }` plus one `<FollowPill>`
concentrates the 24 px threshold, the effect deps, and — the actual win — is the one place
to add `role="log"` / `aria-live="polite"` (**D-6**) so both panes get announced at once.
A third adapter is already latent: `PreparationWorkspace` and `TerminalView` both host
streaming output with no follow behaviour at all.

### G-5 — One overlay primitive
**`deepen:overlay`** · effort **M** · risk **low** · confidence high
Five adapters (**C-3**). `<Overlay onClose label>` owning: backdrop + `stopPropagation`,
the Escape effect, `role="dialog"` + `aria-modal` + `aria-label`, initial focus, focus
restore on unmount, and a keyboard-reachable close. Fixes **D-5** for `DocPeek` and hardens
the other four in the same change. **Crosses into sibling scopes** — passed up as **H-3**.

### G-6 — Typed query hooks for the `{}`-inference gap
**`deepen:typed-queries`** · effort **M** · risk **low** · confidence medium
`useSettingsView(projectId)` and `usePrepView(projectId)` to hold the five casts of
**E-1** (four files) plus the `enabled`-guard sentinel pattern of **E-2** (four sites).
One place to write the "why", one place to fix when the tRPC inference is repaired, and no
`as` at any call site. Four adapters each — solidly real.

### G-7 — A `SESSION_KIND_LABELS` table and one status-badge vocabulary
**`deepen:vocabulary-tables`** · effort **S** · risk **low** · confidence medium
Fixes **D-10** (raw `SessionKind` chip at `SessionPanel.tsx:69` vs the hardcoded
`'prepare'` at `PreparationWorkspace.tsx:116`) and **D-11** (the `verified` collision at
`PreparationWorkspace.tsx:388` vs `:326`) with the same move: replace inline JSX ternaries
with `Record<SessionKind, string>` / `Record<FindingSource, string>` tables next to
`PHASE_LABELS` (`feature-ui.ts:207`). Exhaustiveness becomes a compile error, and the two
badge vocabularies become comparable — today nothing can see that they both emit
`verified`.

### G-8 — `eventTone` as one classifier beside the event vocabulary
**`deepen:event-tone`** · effort **S** · risk **low** · confidence high
Two adapters that already disagree (**C-5**): `RunBody.tsx:425` and `Inspector.tsx:331`.
Best home is beside `lib/activity.ts` (which already owns event *text*) or in
`@runcastle/core` next to the event-type union, so tone and vocabulary move together.

---

## H. Cross-cutting candidates to pass UP

These are patterns I saw inside my scope that I expect siblings to have hit too, or that
cannot be fixed from my files alone. Canonical keys for merging.

### H-1 `inconsistent:mirrored-server-rules` — **judgement call, high confidence** — likely repo-wide
The web client hand-mirrors server preconditions in at least six places, each with a
comment naming the server function it is copying and promising to stay in sync:

| client site | mirrors |
|---|---|
| `feature-ui.ts:834-838` `pending` | *"matches the server's `burn` acceptance check (features.ts)"* |
| `feature-ui.ts:857` `canAdvance` | gate satisfaction + G3/G5 human-gate exclusion |
| `TicketsBody.tsx:249-251` `EDITABLE_STATUSES` | *"the same pair `editTicket` enforces"* |
| `RunBody.tsx:72-74` `terminalBlocked` | *"the launcher refuses while a run holds the feature branch"* |
| `ReviewBody.tsx:157-159` note transitions | *"The server refuses every one of those transitions anyway"* |
| `SessionPanel.tsx:225-230` `isResumable` | *"mirrors the launcher's own resume test"* |
| `GrillBody.tsx:52-60` `showConvergeResume` | *"The server accepts `feature.converge` again at phase `spec` with no live session and zero tickets"* |

Each is individually well-reasoned (avoid offering a button that will certainly error), and
collectively they are seven independent copies of server logic with no shared contract and
no test that compares the two sides. **F18 is what this pattern looks like when a copy goes
stale** — the client's kickoff prose vs `edit-guard.ts:36`. If sibling agents auditing
`packages/server` see the same rules, this is a candidate for a shared
"action availability" contract in `@runcastle/core`.

### H-2 `redundant:accumulating-cursor-query` — **judgement call, high confidence** — spans web + server
Two hooks implement the same accumulate-by-cursor pattern with the same consequence:
- `lib/events.ts:12` `useEventLog` — key `['events','list',{featureId, afterId}]`, cursor in the key
- `AgentTranscript.tsx:92` `useTicketTranscript` — key `['run','agentTranscript',{ticketId, after}]`, cursor in the key

Because the cursor is part of the query key, **every new event/chunk mints a new TanStack
cache entry that is never reused**, and `live.ts:111-131` invalidates the whole family on
every SSE signal. A 29-minute burn (per E2E F17) polling `agentTranscript` at 1 s
(`AgentTranscript.tsx:100`) creates on the order of a thousand dead cache entries;
`useEventLog` is worse because it is mounted **3–5 times simultaneously** on one screen
(`Workspace.tsx:74`, `Inspector.tsx:28`, `SessionPanel.tsx:112`, `RunBody.tsx:39`,
`ShippedBody.tsx:19`), each with an independent cursor and therefore an independent key
family. `live.ts:78-85` documents the multiplicity honestly and treats it as accepted, but
the unbounded key growth is a separate consequence that is not documented anywhere. Whoever
owns `lib/live.ts` / `lib/events.ts` should judge; I am flagging the memory profile, not
the poll count.

### H-3 `redundant:overlay-shell` — **judgement call, high confidence** — spans 5 components in ≥2 scopes
Five hand-rolled overlays (**C-3**, **G-5**): `DocPeek.tsx:33` (mine),
`MergeFeatureDialog.tsx:43`, `DeleteFeatureDialog.tsx:37`, `DirectoryPicker.tsx:68`,
`SettingsOverlay.tsx:47`. Same backdrop class, same Escape effect, same
`stopPropagation`. **`DocPeek` is the only one missing `role="dialog"`/`aria-modal`**
(**D-5**), and **none of the five** move or restore focus. Needs one owner across scopes.

### H-4 `a11y:no-focus-management` — **judgement call, high confidence** — repo-wide
`.focus()` appears exactly **once** in all of `apps/web/src/components/`
(`CommandPalette.tsx:61`). Consequences visible from my scope: overlays never take focus
and never give it back (H-3); the embedded terminal — the product's primary input — is
mouse-only to reach (**D-7**); streaming output regions have no `aria-live` (**D-6**)
despite `role="status"`/`role="alert"` being used correctly elsewhere in the same files.
Given the parent's finding that there are **zero component tests and no jsdom**, no
automated signal exists for any of this.

### H-5 `inconsistent:copy-vs-vocabulary` — **judgement call, high confidence** — spans web + skills
`lib/vocabulary.ts` exists precisely so *"every surface says the same thing"* (`:7`), and
holds 5 explainers. Meanwhile `feature-ui.ts:805-1237` alone hardcodes ~40 user-facing
sentences, `PreparationWorkspace.tsx` ~12, `ReviewBody.tsx` ~8, and the two conflict
kickoffs (`:457`, `:482`) hold ~200 words of agent-facing prose that duplicate each other
with typographic drift. Confirmed collisions from E2E: `verified` meaning two things on one
row (**D-11** / F12), the session chip naming the launch not the work (**D-10**), the burn
count naming all tickets not the burnable ones (**D-9**). If a sibling is auditing
`packages/skills` prompt copy, the same vocabulary drift is likely to appear across the
web/skills boundary — the kickoff strings are literally client-authored agent prompts.

### H-6 `weak-typing:stringly-typed-domain-enums` — **judgement call, high confidence** — likely repo-wide
`@runcastle/core` exports `Phase`, `TicketStatus`, `RunStatus`, `GateId`, `SessionKind`,
and `ui.tsx:83-92` consumes them correctly — but derivation and body code re-types them as
bare `string`:
`feature-ui.ts:626` `interface RunFigure { status: string }`,
`:631` `readonly { status: string }[]`,
`RunBody.tsx:202` `['burning','done','failed'].includes(ticket.status)`,
`RunBody.tsx:425` `eventLevel(type: string)`,
`TicketsBody.tsx:251` `new Set(['pending','failed'])`,
`Inspector.tsx:86` `GATE_NAMES: Record<string, string>` (should be `Record<GateId, string>`),
`Inspector.tsx:331` `eventTone(type: string)`,
`feature-ui.ts:770` `hasResumable(sessions, kind?: string)`,
`feature-ui.ts:1412` `LiveSessionBlocker { kind: string }`.
Compounded by the parent's finding that **`apps/web` is never typechecked in CI**, so even
the parts that *are* typed are unverified on every commit.

### H-7 `bug:web-derivations-untested-outside-lib` — **judgement call, high confidence** — methodology finding
`feature-ui.ts` is heavily tested (1824 lines) and its derivations are correct.
`ShippedBody.tsx:20-23`'s derivation is untested and **wrong** (**D-2**). The pattern
generalises: pure logic inside `.tsx` is unreachable by this repo's test strategy (pure-lib
vitest, no jsdom), so every derivation living in a component is unverified by
construction. Worth a repo-level rule — *derivations live in `lib/`* — rather than seven
separate fixes. Sibling web agents should check their own bodies for inline derivations;
I found one broken out of one.

---

## Appendix — findings index

| key | kind | conf. | site |
|---|---|---|---|
| `dead:feature-ui.phaseGlyph` | violation | high | `feature-ui.ts:73` |
| `dead:feature-ui.sortForSidebar` | violation | high | `feature-ui.ts:183` |
| `dead:ShippedBody.mergedPredicate` | violation | high | `ShippedBody.tsx:20` |
| `over-export:feature-ui` | judgement | med | `feature-ui.ts:217,226,90,137` |
| `redundant:session-strip` | judgement | high | `PreparationWorkspace.tsx:112` |
| `redundant:conflict-kickoff` | judgement | high | `feature-ui.ts:457,482` |
| `redundant:overlay-shell` | judgement | high | `DocPeek.tsx:33` +4 |
| `redundant:autoscroll-follow` | judgement | high | `AgentTranscript.tsx:24`, `RunBody.tsx:392` |
| `redundant:event-tone` | judgement | high | `RunBody.tsx:425`, `Inspector.tsx:331` |
| `redundant:commit-sha-copy` | judgement | med | `RunBody.tsx:196`, `TicketsBody.tsx:100` |
| `inconsistent:body-props` | judgement | high | `Workspace.tsx:455` |
| `bug:ShippedBody.mergedAt` | violation | high | `ShippedBody.tsx:20` |
| `bug:nextStep.conflictHidesBurn` | violation | high | `feature-ui.ts:1167` |
| `inconsistent:button-primitive` | judgement | high | 13 sites |
| `a11y:DocPeek-not-a-dialog` | violation | high | `DocPeek.tsx:33` |
| `a11y:streaming-output-not-live` | judgement | high | `AgentTranscript.tsx:39`, `RunBody.tsx:406`, `TerminalView.tsx:130` |
| `a11y:xterm-focus-and-keys` | judgement | med | `TerminalView.tsx:31` |
| `test-gap:feature-ui` | judgement | high | `apps/web/test/feature-ui.test.ts` |
| `inconsistent:burn-count-copy` | judgement | high | `feature-ui.ts:1024,1099,1200` |
| `inconsistent:session-kind-chip` | judgement | high | `SessionPanel.tsx:69` |
| `inconsistent:vocabulary-verified` | violation | high | `PreparationWorkspace.tsx:326,388` |
| `smell:repeated-switch-on-phase` | judgement | high | 8 sites |
| `smell:nextStep-is-a-grab-bag` | judgement | high | `feature-ui.ts:805` |
| `smell:stringly-typed-status` | judgement | high | `feature-ui.ts:626` + |
| `weak-typing:trpc-data-cast` | judgement | high | 5 sites |
| `weak-typing:enabled-guard-cast` | judgement | high | 4 sites |
| `wrong-tool:conflict-instructions-as-prose` | judgement | high | `feature-ui.ts:457,482` |
| `wrong-tool:fog-by-heading-string` | judgement | med | `feature-ui.ts:870` |
| `weak-typing:unvalidated-event-payloads` | judgement | med | `feature-ui.ts:530,558,581,749` |
| `wrong-tool:window-confirm` | judgement | high | `RunBody.tsx:327` |
| `bug:clipboard-unhandled` | violation | med | `TicketsBody.tsx:100` |
| `shallow:Markdown` (policy unenforced) | judgement | med | `Markdown.tsx:11` |
| `shallow:phase-index-helpers` | judgement | med | `feature-ui.ts:226,354,362` |
| `smell:agent-prose-unrendered` | judgement | high | `AgentTranscript.tsx:51` |

**Verified clean (explicitly checked, no finding):** xterm/WS lifecycle teardown
(`TerminalView.tsx:95`), reconnect backoff cap (`terminal.ts:37`), `dangerouslySetInnerHTML`
(zero in shipped code), markdown HTML escaping, inline-style drift (5 sites repo-wide, 3
documented as deliberate).
