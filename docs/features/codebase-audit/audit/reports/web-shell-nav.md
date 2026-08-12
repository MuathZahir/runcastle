# Audit report — `apps/web` shell / navigation / workspace surfaces

Leaf agent. Scope: `App.tsx`, `components/{Shell,ProjectShell,ProjectWorkspace,Workspace,Sidebar,StatusBar,Titlebar,PortfolioHome,ProjectSwitcher,CommandPalette,FeatureActionsMenu,EndSessionButton}.tsx`,
`lib/{workspace,project-workspace,use-project-nav,use-project-talk,projects,activity}.ts`.

Read for tracing only (findings NOT filed against them): `lib/feature-ui.ts`, `lib/live.ts`,
`lib/events.ts`, `lib/mutation-errors.ts`, `trpc.ts`, `main.tsx`, `ui.tsx`, `styles.css`,
`components/bodies/*`, `components/PreparationWorkspace.tsx`,
`packages/server/src/trpc/routers/{feature,project}.ts`, `packages/server/src/services/git.ts`.

Inputs taken as given (not re-derived): root `E2E-FINDINGS.md` (F9, F14, F11, F3, paper cuts),
`docs/UI-SPEC.md`, `CONTEXT.md`, and the parent's established context (`apps/web` does not use
`packages/design-system`; `apps/web` is never typechecked in CI; zero component tests).

---

## Answer to the parent's framed question first: styling bypass

**Not a finding. Quantified and clean.** Across all 13 components in scope there is exactly **one**
ad-hoc inline style — `Sidebar.tsx:163` `<div style={{ padding: '10px 8px' }}>` wrapping the
loading `DimLine`. Everything else is `className` against `styles.css`, and every class I spot-checked
(`ws-banner`, `is-broken`, `broken-detail`, `readonly-bar`, `nextstep-fog/warn`, `pipeline-lap`,
`project-pin`, `prep-nudge`, `cmdk-item`, `tb-menu`, `pw-frame`, `pw-rest`, `home-grid`, `open-card`,
`sb-driving`, `triage-group`, `lane-expander`) is defined in `styles.css`. There is no orphan-class
drift and no inline-style creep.

The real bypass is a different one, and it is worth a line (filed as **C-4** below): **33 raw
`<button>` elements vs 6 uses of the `Button` primitive** from `ui.tsx` in this scope, and several
of the raw ones hand-write the exact class string `Button` would have produced.

| file | raw `<button>` | `<Button>` |
|---|---|---|
| `ProjectShell.tsx` | 3 | 0 |
| `Workspace.tsx` | 3 | 5 |
| `Sidebar.tsx` | 7 | 0 |
| `StatusBar.tsx` | 3 | 0 |
| `Titlebar.tsx` | 5 | 0 |
| `PortfolioHome.tsx` | 5 | 0 |
| `ProjectSwitcher.tsx` | 4 | 0 |
| `CommandPalette.tsx` | 0 (uses `<div onClick>` — see D-1) | 0 |
| `FeatureActionsMenu.tsx` | 2 | 0 |
| `EndSessionButton.tsx` | 1 | 0 |
| `ProjectWorkspace.tsx` | 0 | 1 |

---

## A. Flow map

### A.1 Root → project → workspace body

```
main.tsx:65        createRoot(<StrictMode><Root/></StrictMode>)
main.tsx:16-43       QueryClient { retry:false, refetchOnWindowFocus:true, refetchOnReconnect:true }
main.tsx:21-26       MutationCache.onError → unhandledMutationError → pushToast   ← global mutation net
main.tsx:48        httpBatchLink('/api/trpc')                                    ← Vite proxy → :4512
App.tsx:8          useLiveSync()                    → EventSource('/api/stream')  [live.ts:137]
                                                     'ready'/'live' → invalidateDbBacked() [live.ts:111-131]
                                                     RETURN VALUE DISCARDED       ← finding D-2
App.tsx:9          <Shell/>
Shell.tsx:23         useProjectNav()                → trpc.project.list.useQuery(undefined,
                                                        { refetchInterval: useLivePoll(5000) })
                                                        server: project.ts (router) project.list
Shell.tsx:28-49      branch on nav.projects/nav.view:
                       undefined              → <DimLine>loading projects…</DimLine>   ✅ loading state
                       'open' && len===0      → <FirstRunWizard/>
                       'open'                 → <OpenProject/>
                       'project' && id        → <ProjectShell key={projectId}/>        ✅ remount on switch
                       else                   → <PortfolioHome/>
```

```
ProjectShell.tsx:33   useWorkspace(projectId)        [lib/workspace.ts:124]  localStorage-backed nav state
ProjectShell.tsx:35   useState<DriveState|null>      ← CLIENT-ONLY drive truth. finding D-3 (latent bug)
ProjectShell.tsx:36   trpc.feature.list({projectId}, {refetchInterval: useLivePoll()})
ProjectShell.tsx:39   useProjectTalk(projectId)      [lib/use-project-talk.ts:29]
                        trpc.project.projectSession.useQuery({projectId}, {refetchInterval: 1500})
                                                     ↑ HARDCODED 1500, not useLivePoll — finding D-4
ProjectShell.tsx:42   trpc.project.prep({projectId}) — NO refetchInterval here (Sidebar's is also bare)
ProjectShell.tsx:43   prepared = prep.data?.prepared ?? true     ← optimistic default
ProjectShell.tsx:47-50 useEffect: auto-select list.data[0] when nothing selected  ← finding D-5
ProjectShell.tsx:60-69 window keydown ⌘K/Ctrl-K → setCmdk(true)   ✅ cleanup present
ProjectShell.tsx:71   workspaceView({...ws, featureCount: list.data?.length ?? 0, prepared})
                        [lib/project-workspace.ts:73-86]  ← undefined ≡ 0. finding B-1 (empty-state flash)
ProjectShell.tsx:72   showsInspector(view, ws.inspectorCollapsed)  [project-workspace.ts:93]
ProjectShell.tsx:97-155 five-way body switch:
                        'create'  → QuickChangeForm | NewFeatureForm
                        'prepare' → PreparationWorkspace
                        'project' → ProjectWorkspace
                        'feature' → <ErrorBoundary key=ws-<id>><Workspace/></ErrorBoundary>  ✅
                        else      → EmptyWorkspace  ("Select a feature to begin")  ← E2E F9 lands here
```

### A.2 Feature workspace (`Workspace.tsx`, 771 lines)

Seven live queries mount for **every** selected feature, regardless of phase:

| line | query | interval | server procedure | phase-gated? |
|---|---|---|---|---|
| `Workspace.tsx:67` | `feature.get({id})` | `useLivePoll()` | `feature.get` | no (correct) |
| `Workspace.tsx:74` | `useEventLog(featureId)` | `useLivePoll()` | `events.list` | no |
| `Workspace.tsx:79` | `feature.commitCount` | **hardcoded 5000** | `feature.ts:185` → `git.reviewCommitCount` (shell-out) | **no** — finding D-6 |
| `Workspace.tsx:82` | `notes.list({featureId})` | `useLivePoll()` | `notes.list` | **no** |
| `Workspace.tsx:89` | `docs.read({relPath: mapDocPath})` | none | `docs.read` | `enabled: !!mapRelPath` ✅ |
| `Workspace.tsx:99` | `project.prep({projectId})` | `useLivePoll()` | `project.ts:103` | **no** |
| `Workspace.tsx:103` | `feature.driveInfo()` | `useLivePoll()` | `feature.ts:179` → `git.activeDriveInfo()` | no |
| `Workspace.tsx:652` | `useEventLog(featureId)` **again** | `useLivePoll()` | `events.list` | — finding C-1 |

Render states, in order (`Workspace.tsx:200-237`):

```
q.isLoading            → <DimLine>loading feature…</DimLine>                     ✅
!q.data                → <DimLine>could not load feature: …</DimLine>            ⚠️ dead end, finding D-7
parsePhase()===null    → <UnrecognizedPhase/>  (named value + Copy details)      ✅ excellent
q.error && q.data      → offline banner + keep rendering last-good               ✅ excellent
```

Then: `PipelineStepper` (`:486`) → `readonly ? readonly-bar : <NextStepBar ns={nextStep(...)}>` (`:380-390`)
→ `PhaseBody` switch on `effective` (`:455-483`) → `GrillBody | TicketsBody | RunBody | ReviewBody | ShippedBody`.

`runAction` (`Workspace.tsx:261-336`) is an 11-case switch mapping `ActionKind` → one of nine
mutations. Every mutation carries `onError → toast.push` (and `main.tsx:21` is the net for any that
forget). **Mutation error handling in this scope is genuinely good** — no swallowed failures found.

### A.3 Test-drive flow (the one that is actually broken)

```
NextStepBar → runAction('testDriveStart')                       Workspace.tsx:294
  → testDrive.mutate({featureId, action:'start'})               → feature.ts:169 → git.testDrive
  → hook-level onSuccess  Workspace.tsx:155-190                 toasts hookFailure / dbDrift / carriedChanges
  → call-level onSuccess  Workspace.tsx:298-303                 onDriveChange({featureId, branch})
      → ProjectShell.tsx:35 setDriving(...)   ← React state, in memory, per-tab
          → Workspace.tsx:242  isDriving = driving?.featureId === feature.id
          → nextStep(ctx.driving) [feature-ui.ts:1135,1147,1156,1197,1210,1219]
          → StatusBar.tsx:69-81  the "driving <branch> — stop" chip
          → ReviewBody.tsx:64,122 <DriveStatus/>
Meanwhile the SERVER truth is polled and thrown away:
  Workspace.tsx:103   driveQ = feature.driveInfo  → only `driveQ.data?.dryRun` is read (:248)
  ReviewBody.tsx:72   drive   = feature.driveInfo → only used for devUrl/devPaneId
```

`git.ts:83-96` `DriveInfo` carries `featureId`, `branch`, `dryRun`, `devPaneId`, `devUrl` — everything
`DriveState` holds and more. See **D-3**.

### A.4 Command palette

```
ProjectShell.tsx:169  <CommandPalette open={ws.cmdkOpen} features={list.data ?? []} nav={nav} .../>
CommandPalette.tsx:101-119  rows = [...features, ...projects, ...actions]   ← source of truth #1
CommandPalette.tsx:264,275,286,302  hand-computed running index per ActionRow ← source of truth #2 (C-2)
CommandPalette.tsx:159-173  keydown on the INPUT only: ↑↓ / ↵ / esc
CommandPalette.tsx:200,229,356  rows are <div onClick> — no role, no tabIndex   ← D-1
CommandPalette.tsx:184  backdrop <div onClick={onClose}> — no role="dialog", no aria-modal, no focus trap
```

### A.5 Preparation liveness (E2E F9 traced to code)

```
Sidebar.tsx:75    prep = trpc.project.prep({projectId})          — NO refetchInterval
Sidebar.tsx:76-82 prepRailRow({prepared, pendingCount, staleCount})
project-workspace.ts:152-181  pure function of exactly those three numbers
                              → variant 'done' → "Re-prepare the project"
ProjectShell.tsx:71 workspaceView(...) → 'empty' (features exist, nothing selected/prepared true)
                              → EmptyWorkspace "Select a feature to begin"
```

The signal that would fix it **already exists and is already exposed**:
`packages/server/src/trpc/routers/project.ts:79-81` `project.prepSession` →
`activeProjectSession(ctx, projectId, 'prepare')`. It is queried in exactly one place in the whole
web app — `PreparationWorkspace.tsx:53` — i.e. only *after* you have already navigated into
preparation. The shell never asks. See **D-8**.

Note the asymmetry that makes this a structural finding rather than a one-off: the **project**
session gets a first-class liveness path (`use-project-talk.ts` → `projectSessionState` →
`Sidebar.tsx:154 ProjectRow` → spinner + "opening"/"live"), and the **prepare** session — the other
project-scoped session, same `activeProjectSession` helper, same shape — gets none.

---

## B. Dead code

Verified with a repo-wide importer search (`apps/web/src` + `apps/web/test`) for every exported
symbol in the six lib modules in scope. **No dead exports.** Every one of `initialView`,
`projectStats`, `aggregateRuns`, `repoOpenFailure`, `activityLine`, `stripMarkdown`,
`projectSessionState`, `projectBranchNote`, `workspaceView`, `showsInspector`, `matchesPreparation`,
`prepRailRow`, `PROJECT_BRANCH`, `TALK_IT_THROUGH`, `DriveState`, `WorkspaceApi` has a real importer
(most have both a component and a test). That is a good result and worth saying plainly.

What *is* dead is at a finer grain:

### B-1 — `select(null)` and the whole "deselect to reach the project home" capability are unreachable

**Key:** `dead:workspace-deselect` · **Kind:** violation · **Confidence:** high

`lib/workspace.ts:100-102` documents the null branch as product behavior:

```ts
  /** Select a feature, or `null` to return to the project home (clears the
   *  phase pin, the project row, and closes the create form). */
  select: (featureId: string | null) => void
```

Repo-wide search for `select(null)` / `.select(` returns **zero call sites passing null**. The four
bindings are `ProjectShell.tsx:90` (`onSelect={ws.select}` — Sidebar always passes an id),
`:103`/`:109` (`onCreated={ws.select}` — always an id), `:174` (palette — always an id).

And even if something did call it, `ProjectShell.tsx:47-50` would immediately undo it:

```ts
  useEffect(() => {
    if (!selectedFeatureId && !projectSelected && list.data && list.data.length > 0)
      select(list.data[0].id)
  }, [selectedFeatureId, projectSelected, list.data, select])
```

So on any project with ≥1 feature, `selectedFeatureId === null` is a state the app snaps out of
within one render. The `null` half of the `select` signature is speculative generality carrying a
documented promise the code contradicts.

### B-2 — `PrepRailRow.count` and `.stale` are computed, typed, tested, and never read

**Key:** `dead:prep-rail-row-fields` · **Kind:** violation · **Confidence:** high

`project-workspace.ts:132-145` declares six fields. `Sidebar.tsx:212-224` — the only consumer —
reads `variant`, `label`, `badge`, `title`. `count` and `stale` are passed straight through from the
inputs (`:161-163`, `:172-174`) and consumed by nobody. Deletion test: removing both fields costs
nothing at any call site.

### B-3 — `Row`'s `name` / `branch` / `current` in the command palette are write-only

**Key:** `dead:cmdk-row-fields` · **Kind:** violation · **Confidence:** high

`CommandPalette.tsx:31`:

```ts
  | { kind: 'project'; id: string; name: string; branch: string; current: boolean }
```

`CommandPalette.tsx:103-104` fills all four; `activate()` (`:137-138`) reads only `row.id`; the
rendered project rows (`:226-244`) map over `filteredProjects` directly, not over `rows`. `current`
is additionally always the literal `false` (`:104`) even though `filteredProjects` is by construction
the *non*-current projects (`:82`) — so the field is both dead and a lie.

---

## C. Redundancy

### C-1 — `useEventLog(featureId)` mounted twice in the same component

**Key:** `redundant:event-log-observers` · **Kind:** violation · **Confidence:** high

`Workspace.tsx:74` and `Workspace.tsx:652` (inside `useResumeFailedAlert`, called from `:68`) both
call `useEventLog(featureId)` for the same feature in the same render tree. `lib/events.ts:15-23`
documents exactly why this is not free:

```ts
  const afterId = events.length ? events[events.length - 1].id : undefined
  const query = trpc.events.list.useQuery(
    { featureId, afterId },
    // Each consumer accumulates its own cursor, so each has its OWN query key —
    // five mounted logs are five independent polls, not one shared fetch
```

So `Workspace` alone is two full event-history fetches on mount, two accumulating `EventRow[]`
arrays, and two independent poll timers for identical data. Across the app there are **six** call
sites (`RunBody.tsx:39`, `ShippedBody.tsx:19`, `Inspector.tsx:28`, `SessionPanel.tsx:112`,
`Workspace.tsx:74`, `Workspace.tsx:652`); a feature in review with the inspector open mounts four to
five of them concurrently. `lib/live.ts:68-90` says out loud that it papered over this rather than
fixing it ("Rather than restructure who owns which query…"). The two inside `Workspace.tsx` are the
cheapest ones to collapse — pass the array down instead of re-subscribing.

### C-2 — Command-palette row indices are derived twice, by hand, in two different ways

**Key:** `duplicated:cmdk-row-index` · **Kind:** violation · **Confidence:** high

`CommandPalette.tsx:101-119` builds the canonical flat `rows` array in a fixed order. Then the JSX
recomputes the same indices arithmetically:

```tsx
{showSettings && (
  <ActionRow
    index={
      projectsEnd +
      (showNewFeature ? 1 : 0) +
      (showHome ? 1 : 0) +
      (showOpen ? 1 : 0)
    }
```
(`CommandPalette.tsx:286-291`; same shape at `:264`, `:275`, `:302-308`)

Two independent encodings of one ordering. Adding a seventh row kind means editing `rows`, editing
the `(showX ? 1 : 0)` chain in *every* later `ActionRow`, and the `featuresEnd`/`projectsEnd`
boundaries at `:176-177`. Silent failure mode: ↵ activates a different row than the one highlighted.
Nothing tests it (no component tests exist). The fix is to render from `rows` and let the index be
the map index.

### C-3 — "copy this text to the clipboard, toast the result" implemented three times

**Key:** `redundant:copy-to-clipboard` · **Kind:** violation · **Confidence:** high

Three near-identical implementations, two of them in this scope:

- `Workspace.tsx:766-771` — `copyText(text, toast)`, `.then/.catch`, `copied ${text}` / `copy failed`
- `StatusBar.tsx:49-55` — `copyBranch()`, `.then(onOk, onErr)`, `copied ${branch}` / `copy failed`
- (sibling scope) same pattern again for commit shas in `RunBody`

`Workspace.tsx` already extracted it into a module-level helper taking the toast — `StatusBar` just
never adopted it. One `useCopy()` hook in `lib/` closes this; the seam is real (two callers here,
three repo-wide).

### C-4 — `ui.tsx` `Button` bypassed by hand-written `btn btn-*` class strings

**Key:** `bypassed:ui-button-primitive` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** high

`ui.tsx:12-23` renders `` `btn btn-${variant}${className ? ' ' + className : ''}` ``. Several raw
buttons reconstruct that string literally:

- `EndSessionButton.tsx:39` — `className="btn btn-xs btn-ghost sess-end"` ≡ `<Button variant="ghost" className="btn-xs sess-end">`
- `ProjectShell.tsx:214,217` — `className="btn btn-ghost"` ≡ `<Button variant="ghost">`
- `PortfolioHome.tsx:38` — `className="btn btn-ghost btn-xs"`

The other ~28 raw buttons carry genuinely bespoke classes (`tb-home`, `feature-row-main`,
`project-row`, `prep-nudge`, `pc-main`, `sb-branch`…) and are fine — those are structural chrome, not
button variants. Only the `btn btn-*` reconstructions are the finding; they mean a change to the
`Button` primitive silently misses three call sites.

### C-5 — Two different, disagreeing definitions of "server health", in adjacent chrome

**Key:** `inconsistent:server-health-indicator` · **Kind:** violation · **Confidence:** high

`StatusBar.tsx:34`:
```ts
  const healthy = !list.isError && list.data !== undefined
```
`Titlebar.tsx:39`:
```ts
  const healthy = !featureQueries.some((q) => q.isError)
```

Both paint the same `.health-dot`, 24px apart vertically. They disagree in two live states:

1. **First load, before any response.** StatusBar says **down** (`data === undefined`); Titlebar says
   **ok** (nothing has errored yet). Every cold start shows one red dot and one green dot.
2. **Zero open projects.** `Titlebar`'s `some()` over an empty array is vacuously `false` → **ok**,
   unconditionally, with no request ever made.

Neither reflects the thing that actually determines whether the UI is live — see D-2.

---

## D. Inconsistencies & structural smells

### D-1 — Command palette rows are non-semantic `<div onClick>`; no listbox semantics, no focus trap, no focus restore

**Key:** `inaccessible:command-palette` · **Kind:** violation · **Confidence:** high

`CommandPalette.tsx:200-206` (features), `:229-235` (projects), `:356-361` (`ActionRow`):

```tsx
<div
  key={f.id}
  ref={bindRow(i)}
  className={`cmdk-item${i === activeIndex ? ' is-active' : ''}`}
  onMouseEnter={() => setActiveIndex(i)}
  onClick={() => activate(i)}
>
```

Every issue in one place:

- **No `role`, no `tabIndex`, no key handler on the row.** The rows are invisible to assistive tech
  as options and unreachable by Tab. The *keyboard* works only because `onKeyDown` is on the input
  (`:192`) and drives an `activeIndex` integer — which is a reasonable roving pattern, but nothing
  communicates it: no `role="listbox"`/`role="option"`, no `aria-selected`, no `aria-activedescendant`,
  and the input has no `role="combobox"` / `aria-expanded` / `aria-controls`. A screen-reader user
  gets a bare textbox and silence while arrowing.
- **No focus trap.** Tab from the input escapes straight into the shell behind the backdrop, which is
  still fully interactive.
- **No focus restore on close.** `onClose` (`:171`, `:184`, `:156`) never returns focus to the ⌘K
  button (`Titlebar.tsx:64`) or to whatever was focused before. After ⌘K → esc, focus is on `<body>`.
- **No dialog semantics.** `:184` backdrop is a plain `<div onClick={onClose}>`; the panel at `:185`
  has no `role="dialog"` / `aria-modal` / labelled name.
- **Mouse and keyboard fight.** `onMouseEnter` sets `activeIndex` (`:204`). Arrowing calls
  `scrollIntoView` (`:127`), which moves rows under a stationary cursor, which fires `mouseenter`,
  which snaps `activeIndex` back to whatever is now under the pointer. Standard palettes suppress
  hover-selection until the mouse actually moves; this one does not.

This is the highest-value a11y fix in the scope: the palette is the app's declared keyboard surface
(`CommandPalette.tsx:11` — "Linear/Raycast keyboarding") and it is the one component where semantics
were skipped.

### D-2 — The SSE stream's own status is computed, returned, and thrown away — so a dead stream is invisible

**Key:** `unsurfaced-state:live-status` · **Kind:** violation (latent bug) · **Confidence:** high

`lib/live.ts:92-97`:
```
 * Mount once, at the app root. Returns the stream's connection state so the
 * shell can show that updates are flowing (or that it fell back to polling).
 */
export function useLiveSync(): LiveStatus {
```

`App.tsx:8`:
```tsx
  useLiveSync()
```

The return value is discarded, and `LiveStatus` has **no other consumer anywhere in `apps/web/src`**
(verified by importer search: `LiveStatus` appears only inside `live.ts`; `useLiveSync` only in
`App.tsx`). `useLiveStatus` is module-private (`live.ts:50`). So the one piece of state that says
whether the UI is receiving push updates or has silently degraded to a 30-second safety poll is
computed on every frame and shown to nobody.

This is the code-level reason E2E **F14** ("31 seconds to show a session that went live in 2") was
invisible for a whole release. The server's `idleTimeout` bug reaped `/api/stream` every ~10s; the
client dutifully tracked `connecting`/`offline` in `liveStatus`; and the two health dots in the
chrome (C-5) were both reading `feature.list` — which kept succeeding the whole time, so both stayed
**green** while realtime was dead. The UI had the diagnosis in a module variable and no pixel for it.

Fix shape: thread `useLiveSync()`'s return down (or export `useLiveStatus`) and make **one** health
indicator the truth — `stream live` / `polling (stream down)` / `server down` — replacing both of C-5's
disagreeing dots.

### D-3 — The active test drive is client-only React state; the server's authoritative `driveInfo` is fetched and ignored

**Key:** `stale-client-state:test-drive` · **Kind:** violation (latent bug) · **Confidence:** high

`ProjectShell.tsx:35`:
```tsx
  const [driving, setDriving] = useState<DriveState | null>(null)
```

`DriveState` (`lib/workspace.ts:19-24`) is `{ featureId, branch }` and is only ever set from a
mutation's own `onSuccess` (`Workspace.tsx:300`, `:311`; `StatusBar.tsx:42`). It is not persisted, not
derived from the server, and not seeded on mount. Meanwhile the server exposes the whole truth and
the client is already polling it:

- `packages/server/src/services/git.ts:83-96` — `DriveInfo { featureId?, dryRun?, branch, devPaneId?, devUrl? }`
- `packages/server/src/trpc/routers/feature.ts:179` — `driveInfo: publicProcedure.query(() => git.activeDriveInfo())`
- `Workspace.tsx:103` — polls it, then at `:248` reads **only** `driveQ.data?.dryRun`
- `ReviewBody.tsx:72` — polls it again, uses only `devUrl`/`devPaneId`, and still gates the whole
  `<DriveStatus/>` panel on the client flag (`ReviewBody.tsx:64,122`)

Consequences, all reachable:

1. **Reload with a drive live** → `driving` is `null`. The StatusBar drive chip and its **Stop**
   button vanish (`StatusBar.tsx:69`), `ReviewBody`'s drive panel vanishes, and `nextStep` offers
   **"Start test drive"** again (`feature-ui.ts:1135-1143`) for a drive the server will refuse as a
   singleton. The user's only remaining route to stopping it is the preparation dry-run stop or
   digging through the review body.
2. **`Iterate` un-blocks itself.** `feature-ui.ts:1156-1158` disables Iterate with *"Stop the test
   drive first — the branch is checked out"* purely on `ctx.driving`. After a reload that guard is
   gone while the checkout is still switched.
3. **Second tab / second browser** never sees the drive at all.
4. **Drive started elsewhere** (a preparation dry run holds the same singleton slot per decision 9)
   is only half-modelled: `dryRunActive` is read from the server, `driving` is not.

This is one substitution — derive `driving` from `driveQ.data` (`featureId` present and matching)
instead of from mutation callbacks — and it deletes a whole class of desync. `DriveState` then
becomes a projection of `DriveInfo` rather than a parallel truth.

### D-4 — `use-project-talk` hardcodes `refetchInterval: 1500`, opting out of the SSE backoff

**Key:** `inconsistent:poll-interval` · **Kind:** violation · **Confidence:** high

`lib/use-project-talk.ts:29`:
```ts
  const q = trpc.project.projectSession.useQuery({ projectId }, { refetchInterval: 1500 })
```

Every other query in this scope routes through `useLivePoll()` (`live.ts:88-90`), which backs off to
30s while push is live. This one polls a real server round-trip at 1.5s forever, in every project
shell, whether or not a session exists. Its own docstring (`use-project-talk.ts:12-15`) claims it is
"Polled at 1.5s alongside the rail's own `feature.list` poll" — which stopped being true when
`feature.list` moved to `useLivePoll`. `Workspace.tsx:79` (`commitCount`, 5000) is the other
hardcoded interval; `PreparationWorkspace.tsx:53` has the same 1500 (sibling scope). Three
independent opt-outs of a mechanism built precisely to stop this.

### D-5 — Auto-select effect makes the project home unreachable and defeats `select(null)`

**Key:** `overreaching-effect:auto-select-feature` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** high

`ProjectShell.tsx:47-50`. The comment says "Land on a feature: select the first one **once**, if
nothing is selected yet" — but there is no once-guard. The condition is re-evaluated on every
`list.data` identity change (i.e. on every poll tick that returns a new array), so `selectedFeatureId
=== null` is corrected on the next tick, permanently. Combined with B-1 this makes the documented
"return to the project home" state structurally unreachable, and it means `EmptyWorkspace` — a
carefully written screen with three doors (`ProjectShell.tsx:194-234`) — is only ever seen by
projects with zero features, plus the flash in D-9.

### D-6 — `feature.commitCount` shells out to git every 5s for every open feature, in every phase

**Key:** `wasteful-poll:commit-count` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** high

`Workspace.tsx:79`:
```tsx
  const commits = trpc.feature.commitCount.useQuery({ featureId }, { refetchInterval: 5000 })
```

It is consumed in exactly one place — the merge confirmation dialog (`Workspace.tsx:411`), which only
renders when `confirmMerge` is true, which is only reachable from the review phase. The server side
(`packages/server/src/trpc/routers/feature.ts:185-190` → `git.reviewCommitCount`) is a `git rev-list`
subprocess. So an ideation-phase feature sitting open spawns a git process every five seconds
forever, for a number nothing on screen shows. The same applies (more cheaply, but with a live poll)
to `notes.list` (`:82`) and `project.prep` (`:99`), both of which are also review-only reads. All
three want `enabled: effective === 'review'` — the pattern `mapQ` at `:89-92` already uses correctly.

### D-7 — "could not load feature" is a dead end with no recovery affordance

**Key:** `missing-recovery:feature-load-error` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`Workspace.tsx:216-224` renders one dim line and nothing else. This is not hypothetical: `selectedFeatureId`
is restored from `localStorage` (`workspace.ts:127`) and survives the feature being **deleted**
(`Sidebar.tsx:95-107` re-selects only if the delete happened in this tab) or the data dir being
reset. Compare the sibling failure paths in the same file, which are excellent —
`UnrecognizedPhase` (`:746`) and `FeatureCrash` (`:726`) both use `BrokenFeaturePane` with a named
value and a **Copy details** button. The plain load error gets neither the pane nor a "pick another
feature" escape. It is recoverable via the sidebar, so this is a polish finding, not a trap.

### D-8 — The prepare session has no liveness surface, while the project session has a full one (E2E F9's structural cause)

**Key:** `missing-live-state:prep-rail-row` · **Kind:** violation (latent UX bug) · **Confidence:** high

Two project-scoped sessions, produced by the same server helper
(`packages/server/src/trpc/routers/project.ts:79-81` and `:94-96`, both
`activeProjectSession(ctx, projectId, kind)`), get completely asymmetric client treatment:

| | project session | prepare session |
|---|---|---|
| hook | `lib/use-project-talk.ts` | none |
| derived state | `projectSessionState()` `project-workspace.ts:37-44` | none |
| rail indication | `Sidebar.tsx:154` `<ProjectRow state={talk.state}>` → spinner + "opening"/"live" (`:273-280`) | `Sidebar.tsx:212` `prep-nudge`, purely `prepRailRow(prepared, pendingCount, staleCount)` |
| polled by shell | yes (`ProjectShell.tsx:39`) | **no** — only `PreparationWorkspace.tsx:53`, i.e. after you're already inside |

`project-workspace.ts:152-181` is a pure function of three numbers and cannot express "a session is
live and asking you a question", exactly as E2E F9 describes. The whole apparatus to fix it already
exists — `useProjectTalk` is the template, `prepSession` is the query, `ProjectRow` is the widget.
The correct shape is a `useProjectSession(projectId, kind)` that both callers share, and a fourth
`variant: 'live'` on `PrepRailRow`.

### D-9 — `workspaceView` cannot distinguish "no features" from "features not loaded yet", so the empty state flashes

**Key:** `missing-loading-state:workspace-view` · **Kind:** violation · **Confidence:** high

`ProjectShell.tsx:71`:
```tsx
  const view = workspaceView({ ...ws, featureCount: list.data?.length ?? 0, prepared })
```

`?? 0` collapses `undefined` (in flight) into `0` (genuinely empty). `project-workspace.ts:85`:

```ts
  return state.featureCount === 0 && !state.prepared ? 'prepare' : 'empty'
```

So on entering a project with no persisted `selectedFeatureId`, the first paint is the full
`EmptyWorkspace` screen — logo, "Select a feature to begin", three buttons — which is then replaced
by a feature once `feature.list` resolves and D-5's effect fires. `Shell.tsx:28-33` handles the
identical situation one level up **correctly** (`nav.projects === undefined` → `loading projects…`),
and `prepRailRow` handles it correctly at a third level (`project-workspace.ts:152-155` returns
`null` while in flight, with a docstring explaining precisely why guessing is wrong). The same file
that argues the case is called by the one place that ignores it. `featureCount` should be
`number | undefined` with a `'loading'` view.

### D-10 — `PortfolioHome`'s project card nests interactive content inside a `<button>`

**Key:** `invalid-nesting:project-card` · **Kind:** violation · **Confidence:** high

`PortfolioHome.tsx:131-170`: `<button className="pc-main">` contains `<div className="pc-head">`,
`<div className="pc-stats">`, and — while renaming — an `<input>` (`:134-152`). HTML forbids
interactive content inside `<button>`, and `<div>` is flow content where only phrasing is allowed.
The `onClick`/`onKeyDown` `stopPropagation` calls at `:141` and `:144` are the tell: they exist to
paper over the fact that the input is a button's descendant. Practical effects: the rename input is
announced as part of the button's accessible name, Enter/Space semantics collide, and browsers vary
in whether the inner input is focusable at all. The card should be a `<div>` with a nested button (or
a stretched-link pattern).

### D-11 — Two floating menus, two independent implementations, neither manages focus

**Key:** `redundant:dropdown-menu` · **Kind:** judgement call · **Effort:** M · **Risk:** low · **Confidence:** high

`ProjectSwitcher.tsx:16-30` and `FeatureActionsMenu.tsx:24-38` are the same 15-line component:
`useState(open)` + `useRef` + an effect registering outside-mousedown and Escape, cleaned up on
close. They differ for no stated reason:

- listener target: `window` (`ProjectSwitcher.tsx:24-25`) vs `document` (`FeatureActionsMenu.tsx:32-33`)
- one stops propagation on the trigger (`FeatureActionsMenu.tsx:50`), the other does not
- both set `role="menu"` + `role="menuitem"` but **neither** implements the menu keyboard contract:
  no focus moved into the menu on open, no ↑↓ between items, no Home/End, no focus restore to the
  trigger on Escape or select, no `tabindex` management. `role="menu"` without arrow-key navigation
  is worse than no role — it promises a contract to assistive tech that the code does not honour.

Two callers = a real seam. One `useDismissable(open, onClose)` hook plus a `<Menu>` wrapper that
actually implements roving tabindex would close both, and `CommandPalette` could borrow the focus
half.

### D-12 — Rename state in `ProjectCard` never re-syncs with its prop

**Key:** `stale-derived-state:project-rename` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`PortfolioHome.tsx:105` `const [name, setName] = useState(project.name)` initialises once. `project.list`
polls at `useLivePoll(5000)` (`use-project-nav.ts:33`), so a rename landing from anywhere else leaves
this component's `name` stale; the next time the user clicks Rename it is re-seeded (`:176-177`), so
the bug window is narrow — but `submitRename` (`:123-127`) compares against `project.name` and can
therefore fire a mutation restoring an old name. Low severity, easy to make impossible by keying the
input on `project.name`.

### D-13 — `selectedFeatureId` is persisted but never cleared

**Key:** `leak:selected-feature-localstorage` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** high

`lib/workspace.ts:150-152`:
```ts
  useEffect(() => {
    if (selectedFeatureId) writeLS(selectedKey, selectedFeatureId)
  }, [selectedFeatureId, selectedKey])
```

The guard means a transition to `null` never writes `''`/removes the key, so the previous id survives
a deselect across reload. Consistent with B-1/D-5 (deselect is unreachable anyway), but it is the
mechanism behind D-7: a deleted feature's id stays in `localStorage` indefinitely, and there is no
validation of the restored id against `feature.list` before it is handed to `Workspace`.

### D-14 — Copy drift from `CONTEXT.md`'s locked vocabulary

**Key:** `copy-drift:vocabulary` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`CONTEXT.md` §15 locks the review verbs as **Fix / Rethink / Merge**, and the code deliberately
renames the third: `Workspace.tsx:135-139` explains that the *procedure* keeps its `rethink` name
while the *button* reads `Iterate` (`feature-ui.ts:1154`), citing ADR-0010 §3. That is a documented,
correct divergence and **not** a finding. What is:

- **`ProjectWorkspace.tsx:88`** — *"Every merged feature's docs, already on disk in its worktree"*.
  `CONTEXT.md` §6 reserves worktrees for **talk sessions** ("docs-only worktrees"); merged features'
  docs live in the repo at `docs/features/<slug>/` (§5) on the base branch. The sentence describes a
  worktree that a merged feature does not have. Minor, but it is a promise about where the session
  can read from.
- **`ProjectWorkspace.tsx:63`** — the panel is headed *"What this session already has"* and then lists
  two items the session does have plus one qualified *"when the repo has them"* — a header asserting
  certainty over a list that is partly conditional. `PreparationWorkspace`'s "Established" list has
  the same shape and is honest about provenance; this one is not.
- The E2E paper cuts (`"Burn 3 tickets"` counting done tickets; the session chip reading `ideation`
  while the phase advances) both originate in `lib/feature-ui.ts` and `components/SessionPanel.tsx`
  — **sibling scope**, flagged here only so it is not lost: `feature-ui.ts:1200` does use the correct
  `pending` count, so the "Burn N" defect is in a *different* label; I did not chase it into a
  sibling's file.

### D-15 — `Workspace.tsx` is a switchboard, not a deep module

**Key:** `god-component:workspace` · **Kind:** judgement call · **Effort:** L · **Risk:** medium · **Confidence:** high

771 lines holding six distinct responsibilities:

1. **Data assembly** (`:65-103`) — seven queries with four different caching policies.
2. **Mutation registry** (`:105-198`) — nine mutations, each with its own invalidate + toast.
3. **Action dispatch** (`:261-336`) — an 11-arm `switch (kind)` over `ActionKind`.
4. **Top-level render-state machine** (`:200-237`) — loading / no-data / unrecognized-phase / offline.
5. **Presentation** — `PipelineStepper` (`:486`), `NextStepBar` (`:524`), `BrokenFeaturePane` (`:688`),
   `FeatureCrash` (`:726`), `UnrecognizedPhase` (`:746`).
6. **A stateful alert subsystem** (`useResumeFailedAlert`, `:651-680`) with its own event
   subscription and two timers.

The good news, and it matters for the ranking: the *decisions* were already extracted. `nextStep`,
`pipelineSteps`, `effectivePhase`, `isReadonlyView`, `mergeSummary`, `unresolvedMergeConflict`,
`testDriveTaken` all live in `lib/feature-ui.ts` and are unit-tested. So this is not a god-component
in the "business logic buried in JSX" sense — it is a **switchboard**: wiring, in one file, with no
depth. Two clean seams fall out (see G-1, G-2). The repeated switch on `Phase` in three places
(`PhaseBody` `:455`, `pipelineSteps`, `nextStep`) is the classic *repeated switch* smell but is
arguably the right shape here — each answers a different question about the same enum.

---

## E. Wrong tool & weak typing

The scope is **clean on the house rules**: zero `any`, zero `as any`, zero `@ts-ignore`, zero
non-null `!` assertions except one justified case, no manual validation where zod belongs (all
validation is server-side, all wire types are inferred from `AppRouter` via `lib/api.ts:12-25` —
which is the right pattern and worth calling out). Three narrow items:

### E-1 — Two `as` casts on `project.prep` that discard the query result's shape

**Key:** `unsafe-cast:prep-view` · **Kind:** violation · **Confidence:** high

`ProjectShell.tsx:42`:
```tsx
  const prep = trpc.project.prep.useQuery({ projectId }) as { data?: PrepView }
```
`Sidebar.tsx:75` — identical. `Workspace.tsx:247`:
```tsx
    unverifiedDriveKeys: unverifiedDriveKeys((prepQ.data as PrepView | undefined)?.findings ?? []),
```

`useQuery`'s result is *already* typed as `PrepView`; these casts throw away `isLoading`, `isError`,
`error` and `refetch` at the two call sites that most need `isLoading` (they are the ones that go on
to conflate "not loaded" with "loaded and empty" — D-9, and the `?? true` optimism at
`ProjectShell.tsx:43`). Whatever inference problem motivated the cast, `lib/api.ts:27-33` documents
the correct remedy for exactly this class of issue (`QueryOf<T>`), and it was not used here.

### E-2 — `copyText`'s toast parameter is structurally typed instead of using the toast API's type

**Key:** `structural-typing:toast-param` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`Workspace.tsx:766`:
```ts
function copyText(text: string, toast: { push: (m: string, k?: 'error' | 'info' | 'success') => void }): void
```

The tone union is re-declared inline rather than imported from `lib/toast`, so adding a fourth tone
means fixing this signature by hand. (It is also the third copy of the tone union in the app.)
Folded into C-3's fix.

### E-3 — `ns.primary!` non-null assertion

**Key:** `assertion:nextstep-primary` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** high

`Workspace.tsx:632`:
```tsx
                onClick={() => click(ns.primary!)}
```

Guarded by `{ns.primary && (` two lines above (`:627`), so it is safe today; TS just cannot narrow
across the closure. Genuinely the least-bad option available without restructuring, noted only for
completeness — this is the *only* `!` in the scope.

---

## F. Shallow modules

Applying the deletion test honestly, most of `lib/` in this scope passes. Two do not.

### F-1 — `use-project-nav.ts` `cancelOpen` / `goHome` / `showOpen` are three setState wrappers

**Key:** `shallow:project-nav-setters` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`use-project-nav.ts:60-68`. `goHome` and `showOpen` are one `setView` call each. Delete them and
callers write `setView('home')` — no complexity reappears. The hook as a *whole* earns its keep
(`initialView` landing logic `:42-48`, the disappeared-project fallback `:51-58`, the `didInit` ref);
it is only these three that are interface-shaped noise. `cancelOpen` (`:66-68`) does carry a real
decision (where "cancel" goes depends on whether a project is bound) and should stay.

### F-2 — `EndSessionButton` is a mutation + a button with a caller-supplied escape hatch

**Key:** `shallow:end-session-button` · **Kind:** judgement call · **Effort:** S · **Risk:** low · **Confidence:** medium

`EndSessionButton.tsx:11-47`. 36 lines: one mutation, a conditional invalidate, an `onEnded?.()`
callback, and a `<button>`. The `featureId?` / `onEnded?` pair is the tell — the component does not
actually know what to refresh, so it takes both a feature id *and* a caller callback and branches
between them (`:26-30`). `ProjectWorkspace.tsx:94-97` supplies the callback because it has no
feature; every other caller supplies the id. The abstraction is not paying for itself: it is one
mutation call and a label, wrapped so that the caller has to explain the refresh anyway.

Counter-argument I'll record honestly: it does concentrate one non-obvious decision — *"confirm-free
on purpose"*, with the reasoning in its docstring (`:4-10`) — and it is used from four surfaces. It
is borderline, not clearly wrong. The right move is probably to keep it and let it take a single
`onEnded` (dropping `featureId` entirely, since every caller can invalidate what it owns).

**Explicitly passing the deletion test** (i.e. not findings): `lib/projects.ts` (`initialView` +
`projectStats` + `repoOpenFailure` all concentrate real branching, all tested), `lib/activity.ts`
(`stripMarkdown` is 12 regexes' worth of accumulated knowledge behind a one-string interface — the
deepest module in the scope), `lib/workspace.ts` (localStorage policy + which state persists), and
`project-workspace.ts`'s `workspaceView` / `prepRailRow`.

---

## G. Deepening / extraction opportunities, ranked

Ranked by (latent-bug severity × how many callers gain leverage) ÷ effort.

### G-1 — Derive drive state from the server; delete `DriveState` as a parallel truth
**Key:** `deepen:drive-state` · **Effort:** S–M · **Risk:** low · **Fixes:** D-3

`feature.driveInfo` is already polled from two components. Replace `ProjectShell.tsx:35`'s `useState`
with a `useActiveDrive()` hook reading that query, returning
`{ featureId, branch, dryRun, devUrl, isMine(featureId) }`. `onDriveChange` disappears from four prop
lists (`Workspace`, `StatusBar`, `ReviewBody`, `ProjectShell`); the mutations just invalidate.
Three callers gain, one whole desync class dies, and it is the single highest-severity item in the
scope. **Two callers already exist → real seam, not hypothetical.**

### G-2 — One `useProjectSession(projectId, kind)` covering both project-scoped sessions
**Key:** `deepen:project-session-hook` · **Effort:** M · **Risk:** low · **Fixes:** D-8, D-4, and E2E F9

`use-project-talk.ts` is 80% of it already. Generalise over `kind: 'project' | 'prepare'`, route it
through `useLivePoll()`, add a `'live'` variant to `PrepRailRow`, and give the prep nudge the same
spinner `ProjectRow` has. Callers: `Sidebar` (both rows), `ProjectShell`, `ProjectWorkspace`,
`PreparationWorkspace`, `CommandPalette`'s preparation row. **Five callers — the strongest seam here.**

### G-3 — Make the live-stream status visible and collapse the two health dots into it
**Key:** `deepen:health-indicator` · **Effort:** S · **Risk:** low · **Fixes:** D-2, C-5

Export `useLiveStatus` (or thread `useLiveSync()`'s return through context), then have exactly one
component own health: `stream live` / `polling — stream down` / `server unreachable`. Removes two
contradicting definitions and would have made E2E F14 self-reporting. Cheap and high-signal.

### G-4 — A real `<Menu>` / `useDismissable` primitive, and give the palette listbox semantics
**Key:** `deepen:overlay-primitives` · **Effort:** M · **Risk:** low · **Fixes:** D-1, D-11

One hook (`useDismissable(open, onClose)`: outside-click + Escape + **focus restore**) and one
`<Menu>` implementing roving tabindex. Callers today: `ProjectSwitcher`, `FeatureActionsMenu`, and
the focus half serves `CommandPalette`, `SettingsOverlay`, `MergeFeatureDialog`, `DeleteFeatureDialog`
(the last three in sibling scope, so coordinate). The palette's `role="listbox"`/`option` +
`aria-activedescendant` retrofit is independent and can land first — it is ~20 lines and it is the
app's flagship keyboard surface.

### G-5 — Split `Workspace.tsx` along its two natural seams
**Key:** `deepen:workspace-split` · **Effort:** M · **Risk:** medium · **Fixes:** D-15

Two extractions, no redesign:
1. **`useFeatureActions(featureId, { onViewPhase })`** — everything from `Workspace.tsx:105` to `:359`
   (the nine mutations, `invalidate`, the `runAction` switch, `runMerge`, `busy`). That is ~200 lines
   of pure wiring with one input and one output (`(kind, reason?) => void` plus `busy`), and it makes
   the action layer testable without a DOM — the only part of this component a test could ever reach
   given there is no jsdom in the repo.
2. **`components/FeatureFallbacks.tsx`** — `BrokenFeaturePane`, `FeatureCrash`, `UnrecognizedPhase`
   (`:688-764`). Self-contained, zero coupling to the rest of the file, and `FeatureCrash` is already
   imported *out* of `Workspace` by `ProjectShell.tsx:14` — the seam is being used from outside
   already.

Leaves `Workspace.tsx` at ~350 lines of genuine composition.

### G-6 — Render the command palette from its own `rows` array
**Key:** `deepen:cmdk-rows` · **Effort:** S · **Risk:** low · **Fixes:** C-2, B-3

Map `rows` to JSX with a per-kind renderer, using the map index. Deletes the `(showX ? 1 : 0)` chains
at `:264/:275/:286/:302`, the `featuresEnd`/`projectsEnd` boundaries (`:176-177`), the dead `Row`
fields (B-3), and the class of bug where ↵ activates a row other than the highlighted one. Pairs
naturally with G-4's semantics work.

### G-7 — Gate the review-only queries on phase; route the three hardcoded intervals through `useLivePoll`
**Key:** `deepen:query-gating` · **Effort:** S · **Risk:** low · **Fixes:** D-6, D-4

`enabled: effective === 'review'` on `commitCount` / `notes.list` / `project.prep` in
`Workspace.tsx:79/82/99` (the pattern `mapQ` at `:89-92` already models), and swap the literal
`5000`/`1500` for `useLivePoll()`. Removes a `git rev-list` subprocess every 5s per open feature.

### G-8 — One `useCopy()` hook
**Key:** `deepen:clipboard` · **Effort:** S · **Risk:** low · **Fixes:** C-3, E-2

Three callers repo-wide, two in this scope. Trivial, and it also fixes the only place a clipboard
rejection is handled inconsistently.

### G-9 — Teach `workspaceView` about "loading"
**Key:** `deepen:workspace-view-loading` · **Effort:** S · **Risk:** low · **Fixes:** D-9

`featureCount: number | undefined` → a `'loading'` view → one `DimLine`, matching `Shell.tsx:28-33`.
`project-workspace.ts` is already unit-tested (`apps/web/test/project-workspace.test.ts:34-77`), so
this lands with a test, which is rare in this scope.

---

## H. Cross-cutting candidates to pass UP

These are the ones I believe recur outside my files, or need a decision above my scope.

| # | canonical key | kind | conf. | claim | evidence in my scope | why it goes up |
|---|---|---|---|---|---|---|
| H-1 | `redundant:event-log-observers` | violation | high | `useEventLog` gives every consumer its own cursor, hence its own query key, poll timer and full-history refetch. `live.ts:68-90` documents that the F11 poll storm was **worked around, not fixed**. | `Workspace.tsx:74` **and** `:652` in one component | 6 call sites, only 2 mine (`RunBody.tsx:39`, `ShippedBody.tsx:19`, `Inspector.tsx:28`, `SessionPanel.tsx:112`). Needs one owner: a per-feature event-log provider. **Cache-key growth is also unbounded** — every new event mints a new query key. |
| H-2 | `stale-client-state:test-drive` | violation (latent bug) | high | The active test drive lives in React state while the server is authoritative and already polled; a reload loses the Stop button, re-offers "Start test drive", and un-disables Iterate. | `ProjectShell.tsx:35`, `Workspace.tsx:103,248,300,311`, `StatusBar.tsx:42,69` | Crosses into `ReviewBody.tsx:64,72,122` and `feature-ui.ts:1135-1219`. Same *shape* as E2E **F3** (a disabled/absent control with no explanation). Highest-severity item I found. |
| H-3 | `unsurfaced-state:live-status` + `inconsistent:server-health-indicator` | violation | high | The SSE status is computed and discarded; the two health dots that *are* shown read `feature.list` and disagree with each other on cold start and at zero projects. | `App.tsx:8`, `live.ts:92-97`, `StatusBar.tsx:34`, `Titlebar.tsx:39` | This is why E2E **F14** was invisible for a release: the stream was dying every 10s and both dots stayed green. Server-side fix (`idleTimeout`) is another agent's; the *observability* gap is the web app's and it will hide the next such bug too. |
| H-4 | `missing-live-state:prep-rail-row` | violation (latent UX bug) | high | Two project-scoped sessions from one server helper; one has a full liveness path, the other has none. Directly E2E **F9**. | `Sidebar.tsx:154` vs `:212`; `project-workspace.ts:152-181`; `project.ts:79-81` vs `:94-96` | Touches `PreparationWorkspace.tsx` (sibling) and possibly the server's `activeProjectSession` contract. The fix is one shared hook. |
| H-5 | `inconsistent:poll-interval` | violation | high | Hardcoded `refetchInterval` literals bypass `useLivePoll()`, defeating the SSE backoff that exists specifically to stop duplicate polling. | `use-project-talk.ts:29` (1500), `Workspace.tsx:79` (5000) | `PreparationWorkspace.tsx:53` has the same 1500 — sibling scope. Likely more across `bodies/*`. Worth a repo-wide sweep + a lint-shaped rule (there is no lint step, so: a convention note). |
| H-6 | `inaccessible:overlays` | violation | high | No overlay in the app traps or restores focus; `role="menu"` is set without the arrow-key contract; the command palette's rows are `<div onClick>` with no listbox semantics. | `CommandPalette.tsx:184,200,229,356`; `ProjectSwitcher.tsx:52-58`; `FeatureActionsMenu.tsx:57-61` | `SettingsOverlay`, `MergeFeatureDialog`, `DeleteFeatureDialog`, `DocPeek` are siblings and almost certainly share it. One `useDismissable` + `<Menu>` primitive serves all of them. |
| H-7 | `redundant:copy-to-clipboard` | violation | high | Same clipboard-then-toast dance implemented per call site. | `Workspace.tsx:766-771`, `StatusBar.tsx:49-55` | Third instance in `bodies/RunBody` (commit shas). Two in my scope alone = real seam. |
| H-8 | `bypassed:ui-button-primitive` | judgement call | high | 33 raw `<button>` vs 6 `<Button>` in my scope; three of the raw ones hand-write the exact `btn btn-*` string `ui.tsx:19` generates. | `EndSessionButton.tsx:39`, `ProjectShell.tsx:214,217`, `PortfolioHome.tsx:38` | Feeds the parent's design-layer question: `ui.tsx` is a 6-atom primitive set that the app only partially adopts. Whether that's a problem is a call above me — but the *duplicated class strings* are objectively a defect. |
| H-9 | `missing-loading-state:tri-state-queries` | violation | high | `?? 0` / `?? true` / `?? []` collapse "in flight" into "empty", so screens flash the wrong state before data lands. | `ProjectShell.tsx:71` (`?? 0`), `:43` (`?? true`) | The repo *knows* better in three places (`Shell.tsx:28`, `project-workspace.ts:152-155`, `feature.ts:184` — *"`count` is undefined when git cannot tell, which the UI must not paint as zero"*). Worth checking every `?? 0` / `?? []` on a query result repo-wide. |
| H-10 | `untestable:web-components` | judgement call | medium | Every finding in C-2, D-1, D-3, D-9 is exactly the kind a single render test would have caught, and `apps/web` has no jsdom/testing-library and is not typechecked in CI (established by parent). | `apps/web/test/` is 4 pure-lib suites; `Workspace.tsx` (771 lines) has zero coverage | Already known to the parent — passed up only to note *where it bites*: the palette's index arithmetic (C-2) and the empty-state flash (D-9) are both silent-failure bugs in code that is unreachable by the current test setup, in the one package CI does not typecheck. |

### Consistency notes for the parent (not findings)

Things this scope does **well**, so they don't get "fixed" by a consolidation pass:

- **Failure containment is genuinely good.** `ErrorBoundary` keyed per feature (`ProjectShell.tsx:131-135`),
  the offline-but-keep-rendering path (`Workspace.tsx:210-225`) which deliberately keeps the terminal
  mounted through a server restart, and `UnrecognizedPhase` (`:746`) degrading a bad enum into a
  reportable pane rather than a blank app. Don't flatten these.
- **Mutation errors are systematically handled** — every `useMutation` in scope has `onError`, and
  `main.tsx:21-26` + `lib/mutation-errors.ts` is a correct net for the ones that don't.
- **Wire types are inferred, never hand-written** (`lib/api.ts:12-25`), and `lib/api.ts:27-33`
  documents the one inference trap. The two `as PrepView` casts (E-1) are the only deviations.
- **The pure/impure split in `lib/` is real** — `projects.ts`, `project-workspace.ts`, `activity.ts`
  have no React/tRPC imports and are unit-tested; the stateful halves (`use-project-nav`,
  `use-project-talk`) sit beside them. This is the right shape and should be the template for G-1/G-2.
