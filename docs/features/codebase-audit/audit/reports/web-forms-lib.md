# Audit report — `apps/web` forms, dialogs, onboarding & plumbing layer

Leaf agent. Scope: `apps/web/src/components/{NewFeatureForm,QuickChangeForm,FormOverlay,
DeleteFeatureDialog,MergeFeatureDialog,FirstRunWizard,OpenProject,DirectoryPicker,
SettingsOverlay,EnableAfkCard,UpdateBanner,ErrorBoundary}.tsx`, `apps/web/src/{trpc,main,ui,
icons}.tsx`, `apps/web/src/styles.css`, and `apps/web/src/lib/{settings,live,events,api,env,
first-run,format,mutation-errors,notifications,use-notifications,platform,toast,update,
vocabulary}.ts(x)`.

Static analysis only. No servers started, no tests run, no files edited. Sibling-owned files
(`Workspace.tsx`, `Sidebar.tsx`, `DocPeek.tsx`, `CommandPalette.tsx`, `lib/feature-ui.ts`,
`lib/workspace.ts`, `lib/use-project-*.ts`, server routers) were read for tracing and
comparison only; nothing is filed against them.

Context accepted from parent (not re-derived): `apps/web` does not import
`packages/design-system`; `apps/web` is never typechecked in CI; there are zero component
tests. Those three are not re-filed.

---

## A. Flow map

### A1. Create a feature (New feature door)

```
Sidebar "New feature"  → ws.startCreate()          (lib/workspace.ts, sibling)
  → ProjectShell.tsx:97  view === 'create'
    → NewFeatureForm.tsx:21
      ├─ trpc.project.branches.useQuery({projectId})     NewFeatureForm.tsx:39
      │    → server: packages/server/src/trpc/routers/project.ts:36  project.branches
      │    → defaultBaseBranch() (lib/feature-ui.ts, sibling) → effectiveBase   :48-49
      ├─ trpc.feature.list.useQuery({projectId})          NewFeatureForm.tsx:64
      │    → routers/feature.ts:47  feature.list   (shares the rail's cache entry)
      │    → duplicateTitleWarning()  → inline <div role="status">              :124
      ├─ trpc.feature.create.useMutation({onError→toast}) NewFeatureForm.tsx:55
      │    → routers/feature.ts:21  feature.create
      │    → onSuccess: await utils.feature.list.invalidate()                   :88
      └─ trpc.feature.launchSession.useMutation()  ← NO onError                 :51
           → routers/feature.ts:59  feature.launchSession
           → failure falls through to MutationCache.onError (main.tsx:22)
             → unhandledMutationError (lib/mutation-errors.ts:34) → pushToast (lib/toast.tsx:36)
      shell: FormOverlay.tsx:17  (dirty-guard, Escape, backdrop mousedown)
```

### A2. Create a feature (Quick change door)

```
Sidebar "Quick change" → ProjectShell.tsx:100 → QuickChangeForm.tsx:20
  ├─ trpc.project.branches.useQuery({projectId})       QuickChangeForm.tsx:34
  └─ trpc.feature.quickChange.useMutation({onSuccess,onError→toast})  :37
       → routers/feature.ts:36  feature.quickChange
       → onSuccess: utils.feature.list.invalidate() → onCreated(feature.id)
  shell: FormOverlay.tsx:17  (identical wrapper, different everything else — see D1)
```

### A3. First run

```
Shell.tsx:36  (nav.projects.length === 0)
 → FirstRunWizard.tsx:29
   ├─ trpc.setup.doctor.useQuery({refetchOnWindowFocus:false})   FirstRunWizard.tsx:36
   │    → routers/setup.ts:29  setup.doctor → runDoctor(...)     ← no `env` (E2E F1 root cause)
   ├─ screen 'intro'    → IntroStep                              :124
   ├─ screen 'identity' → IdentityStep                           :149
   │    trpc.setup.gitIdentity.useMutation  → routers/setup.ts:40
   │    onSuccess: utils.setup.doctor.invalidate() → onNext()
   ├─ screen 'afk'      → AfkStep → EnableAfkCard.tsx:21
   │    ├─ setup.doctor (second observer, same cache key)
   │    ├─ RuntimeRow  → trpc.setup.runtimeGuide  → routers/setup.ts:37
   │    ├─ ImageRow    → trpc.setup.startTerminal({kind:'build-image'}) → routers/setup.ts:55
   │    │                 → TerminalView over /ws/terminal/:sessionId
   │    └─ TokenRow    → trpc.setup.startTerminal({kind:'setup-token'})
   │                    → trpc.setup.afkToken({token})  → routers/setup.ts:45
   └─ screen 'project'  → OpenProject.tsx:18  (firstRun)          :51-53  ← rail vanishes here
        trpc.project.open.useMutation  → routers/project.ts:40
        + DirectoryPicker.tsx:21 → project.roots (:23) / project.browse (:26)
```

### A4. Settings

```
Titlebar/palette → ProjectShell.tsx:182 → SettingsOverlay.tsx:24
  ├─ trpc.settings.get.useQuery()             → routers/settings.ts:13  (global scope)
  ├─ trpc.settings.get.useQuery({projectId})  → routers/settings.ts:13  (project scope)
  ├─ trpc.project.prep.useQuery({projectId})  → routers/project.ts:103
  │      → services/prep.ts:127 prepView → services/findings.ts:242 listFindings
  │        → `commitsSince()` — a git rev-list PER distinct establishedSha
  ├─ globalRows/projectRows/stepModelRows  (lib/settings.ts:477/487/502)
  │      → describeField (lib/settings.ts:435) → SettingRow
  └─ Field.save → trpc.settings.update.useMutation → routers/settings.ts:17
        → onSuccess: utils.settings.get.invalidate() + utils.project.prep.invalidate()
```

### A5. Live sync (the plumbing spine)

```
App.tsx:8  useLiveSync()               ← mounted exactly once
 → lib/live.ts:137  new EventSource('/api/stream')
     → packages/server/src/routes/stream.ts  (Hono streamSSE)
   'ready'  (:139) → setLiveStatus('live') + invalidateDbBacked() + invalidateTranscript()
   'live'   (:148) → JSON.parse → signal.kind==='transcript' ? transcript : invalidateDbBacked()
   'error'  (:165) → setLiveStatus(CLOSED ? 'offline' : 'connecting')
   cleanup  (:169) → source.close() + setLiveStatus('connecting')

 invalidateDbBacked (live.ts:111-131) fans out to NINE roots:
   events · feature.list · feature.get · feature.driveInfo · notes ·
   project.prep · run.get · project.list · docs.read

 lib/live.ts:88  useLivePoll(ms) → live ? 30_000 : ms
   consumed by 17 query sites (AgentTranscript, ReviewBody×2, RunBody, TicketsBody,
   Inspector, PortfolioHome, ProjectShell, ProjectWorkspace, Sidebar, StatusBar,
   Titlebar, Workspace×4, lib/events.ts:22, lib/use-notifications.ts:83,
   lib/use-project-nav.ts:33)
   BYPASSED by 5 sites that hardcode refetchInterval — see D6.
```

---

## B. Dead code

### B1. `dead-export:icons` — six exported icon components with zero importers
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** none

`apps/web/src/icons.tsx:109` `IconX`, `:161` `IconActivity`, `:177` `IconArrowRight`,
`:185` `IconPlay`, `:193` `IconStop`, `:209` `IconSparkle`.

Verified by repo-wide importer search (`grep -rn "\bIconPlay\b" --include=*.ts{,x} .`
excluding `node_modules` and `icons.tsx` itself): **0 hits outside the definition file** for
each of the six. `apps/web` does not import `packages/design-system`, so no cross-package use
is possible either.

```tsx
// icons.tsx:185
export function IconPlay({ size = 13 }: { size?: number }) {
```

### B2. `dead-css:styles` — CSS rules for class names that no source file can ever emit
**Kind:** violation · **Confidence:** high (one caveat noted) · **Effort:** S · **Risk:** none

Method: extracted all 677 class selectors from `styles.css`, subtracted every literal
occurrence across `apps/web/src/**/*.{ts,tsx,html}` + `index.html`, then subtracted every
class whose prefix is produced by a template literal in source (`phase-fg-${…}`,
`chip-ticket-${…}`, `toast-${…}`, `is-${…}`, `sess-dot-${…}`, `afk-dot-${…}`, and 40 others).
That leaves 15; a further repo-wide grep resolves them:

| selector | `styles.css` line | only other occurrence in repo | verdict |
|---|---|---|---|
| `.chip-blocked` | 284 | none | dead |
| `.gate-hint` | 2445 | none | dead |
| `.grill-empty` | 1406 | none | dead |
| `.nf-form` | 810 | none | dead |
| `.spec-doc` / `.spec-meta` / `.spec-body` | 1515 / 1522 / 1523 | none | dead |
| `.terminal-placeholder` | 3155 | none | dead |
| `.sidebar-foot` | 801 | `apps/web/prototypes/multi-project.html` | dead in the app |
| `.ghost-link` (+`:hover`,`:disabled`) | 252/261/264 | `packages/design-system/src/components/GhostLink.tsx` | dead in the app (DS not imported) |
| `.lg-commits` | 1734 | `packages/design-system/src/screens/TicketsScreen.tsx` | dead in the app |
| `.tb-app` / `.tb-dot` | 369 / 384 (+ `.tb-home:hover .tb-app` :3284) | design-system + prototypes | dead in the app |
| `.peek-pre` | 2796 | `site/index.html` | dead in the app |
| `.contains-task-list` | — | none in source | **NOT dead** — emitted by `remark-gfm` at runtime |

Caveat recorded honestly: `.contains-task-list` is excluded from the claim precisely because a
naive grep would have called it dead. The remaining 14 have no such generator.

### B3. `dead-prop:first-run-wizard` — `FirstRunWizard.onCancel` can never fire
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** none

`FirstRunWizard.tsx:33` declares `onCancel: () => void`; `Shell.tsx:36` passes
`nav.cancelOpen`. The wizard forwards it to exactly one place:

```tsx
// FirstRunWizard.tsx:52
if (screen === 'project') return <OpenProject firstRun onOpened={onOpened} onCancel={onCancel} />
```

`OpenProject` invokes `onCancel` from exactly two places, both gated on `!firstRun`:

```tsx
// OpenProject.tsx:101
if (e.key === 'Escape' && !firstRun) onCancel()
// OpenProject.tsx:121
{!firstRun && (<Button variant="ghost" onClick={onCancel} …>Cancel</Button>)}
```

The intro / identity / afk screens never call it. So the prop is threaded through two
components and is unreachable. (The UX consequence — a first-run user has no way out of the
wizard — may be deliberate; the dead wiring is not.)

### B4. `over-exported:settings-lib` — five exports with no consumer outside their own module
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** none

`lib/settings.ts:14 FIELD_ENV_VAR`, `:32 MODEL_OPTIONS`, `:36 isStepModelKey`,
`:39 stepOf`, `:54 STEP_KEYS`. Each is used *inside* `settings.ts` and nowhere else —
verified: 0 importers in `apps/web/src` (excluding `lib/settings.ts`) and 0 references in
`apps/web/test`. Not dead code, but five names of published interface that no caller needs.
(`STALE_COMMIT_THRESHOLD:362` and `describeField:435` are also src-unused but *are*
referenced by `test/settings.test.ts`, so they are test surface, not accidental.)

---

## C. Redundancy & repeated logic

### C1. `redundant:modal-shell` — seven independent modal implementations, no shared primitive
**Kind:** judgement call · **Confidence:** high · **Effort:** M · **Risk:** low-medium (touches every dialog)

`ui.tsx` publishes nine primitives (`Button`, `SectionTitle`, `DimLine`, `EmptyState`,
`CheckLine`, `PhaseTag`, `TicketStatusChip`, `RunStatusChip`, `SessionStatusDot`) and **no
dialog primitive**. Every overlay therefore re-implements the same seven concerns by hand.
Rows 1–5 are mine; 6–7 are siblings' files, read for comparison only.

| implementation | backdrop dismiss | drag-out guard | Escape | focus trap | focus restore | `role="dialog"` | `aria-modal` | `aria-label` | scroll lock | portal | initial focus |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `FormOverlay.tsx:55` | `onMouseDown` + `e.target===e.currentTarget` | **yes** (:59) | yes, + focus-ownership guard + dirty confirm (:30-47) | no | no | **no** | **no** | no | n/a (in-flow) | no | delegated (child `autoFocus`) |
| `DeleteFeatureDialog.tsx:37` | `onClick` | no | yes (window, :28-34) | no | no | yes (:40) | yes | yes | no | no | `autoFocus` input (:66) |
| `MergeFeatureDialog.tsx:43` | `onClick` | no | yes (window, :34-40) | no | no | yes (:46) | yes | yes | no | no | **none** |
| `SettingsOverlay.tsx:47` | `onClick` | no | yes (window, :38-44) | no | no | yes (:50) | yes | yes | no | no | **none** |
| `DirectoryPicker.tsx:68` | `onClick` | no | yes (window, :51-57) | no | no | yes (:71) | yes | yes | no | no | **none** |
| `DocPeek.tsx:33` *(sibling)* | `onClick` | no | yes (window, :24-30) | no | no | **no** | **no** | no | no | no | none |
| `CommandPalette.tsx:180` *(sibling)* | `onClick` | no | input `onKeyDown` only (:169) | no | no | **no** | **no** | no | no | no | `inputRef.focus()` |

Seven copies of `useEffect(() => { window.addEventListener('keydown', …Escape…) })`, five
copies of `<div className="peek-backdrop" onClick={x}><div className="peek" onClick={e =>
e.stopPropagation()}>`, and five copies of the `peek-head` + `peek-close` header.

**Missing primitive, named precisely:** `Dialog` in `apps/web/src/ui.tsx`, with the interface

```
Dialog({ label, onDismiss, dismissOnBackdrop = true, initialFocusRef?, children })
```

owning: `role="dialog"` + `aria-modal="true"` + `aria-label`, the `keydown` Escape listener,
backdrop dismissal via `onMouseDown` target-equality (the drag-out guard `FormOverlay` already
proved it needs — D2), a focus trap, focus restore to `document.activeElement` on unmount, and
the `peek-head`/`peek-close` chrome. **Two real adapters exist today (five, in fact), so this
is a real seam, not a hypothetical one.**

### C2. `redundant:localstorage-preference` — four hand-rolled `try/catch` localStorage wrappers, three key conventions
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

| site | key | wrapper |
|---|---|---|
| `lib/use-notifications.ts:25,36-50` | `'runcastle:notifications'` | `readPref` / `writePref` |
| `lib/update.ts:12` + `UpdateBanner.tsx:17-35` | `'runcastle.update.dismissed'` | inline `try/catch` ×2 |
| `Sidebar.tsx:16,20,113` *(sibling)* | `'runcastle.sidebar.showArchived'` | inline `try/catch` ×2 |
| `lib/workspace.ts:43-56` *(sibling)* | `runcastle.workspace.*:<projectId>` | `readLS` / `writeLS` |

Four copies of the identical private-mode `try/catch`, and the key namespace is split between
`runcastle:` (colon) and `runcastle.` (dot). Suggested single module: `lib/prefs.ts` exposing
`readPref(key, fallback)` / `writePref(key, value)` over one `runcastle.` prefix.
`UpdateBanner.tsx` is the clearest tell — it imports the *key constant* from `lib/update.ts`
but re-implements the storage access inline, so the constant and its access are already split
across two files for no gain.

### C3. `redundant:input-control` — six near-identical text-input rules, one of which disagrees on focus colour
**Kind:** judgement call · **Confidence:** high · **Effort:** M · **Risk:** low

Six class families dress the same control, with the same declaration list and drifting values:

```css
/* styles.css:2274 */ .nf-input       { height:36px; font-size:13px;   padding:0 12px; radius: --radius     }
/* styles.css:2454 */ .override-input { height:26px; font-size:12px;   padding:0 8px;  radius: --radius-sm  }
/* styles.css:2862 */ .settings-input { height:32px; font-size:12.5px; padding:0 10px; radius: --radius     }
/* styles.css:3547 */ .op-input       { height:32px; font-size:13px;   padding:0 10px; radius: --radius     }
/* styles.css:3595 */ .dir-path-input { height:28px; font-size:11.5px; padding:0 8px;  radius: --radius     }
/* styles.css:2627 */ .cmdk-input     { height:46px; font-size:14px;   padding:0 16px; borderless           }
```

All six share `background: var(--panel-inset); border: 1px solid var(--hairline); color:
var(--text)`. Their focus rings then disagree:

```css
styles.css:2288  .nf-input:focus       { border-color: var(--accent); }
styles.css:2464  .override-input:focus { border-color: var(--accent); }
styles.css:2875  .settings-input:focus { border-color: var(--accent); }
styles.css:3608  .dir-path-input:focus { border-color: var(--accent); }
styles.css:3557  .op-input:focus       { outline: none; border-color: var(--accent-line); }   ← the odd one
```

`--accent` is `#7c6cf6`; `--accent-line` is `#3d3670`. So the four inputs on the onboarding
path (`OpenProject`, `FirstRunWizard` name/email, `EnableAfkCard` token) get a *dim violet
hairline* on focus while every other input in the app gets a bright violet one — the first
inputs a new user ever touches are the ones with the weakest focus indicator. Cross-borrowing
already happens and proves the families are not semantic: `DeleteFeatureDialog.tsx:62` uses
`className="settings-input mono"` for a field that has nothing to do with settings.

Same story for labels: `op-label` (×4), `settings-field-label` (×3), `nf-base-label`,
`dir-path-label` — four families, one job. Suggested primitives in `ui.tsx`: `TextInput`,
`TextArea`, `Select`, `Field({label, help, error, children})`.

### C4. `redundant:prepared-label-table` — a hand-synced duplicate of the field label map
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// lib/settings.ts:186-196
/** … Kept in sync with `META` labels. */
export const PREPARED_LABEL: Record<string, string> = {
  setupCommand: 'Setup command', verifyCommands: 'Verify commands', …
}
```

All eight entries duplicate the `label` field of the corresponding `META` entry
(`lib/settings.ts:136-181`). They agree today — I diffed all eight — but the comment concedes
the sync is manual. `metaFor(key).label` already returns exactly these strings and already
handles unknown keys (`META[key] ?? { label: key, … }`, `:414`). Replacing the table with
`export const preparedLabel = (key: string): string => metaFor(key).label` deletes 10 lines and
the drift class with them.

### C5. `redundant:relative-time` — three relative-time formatters in the same app
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

- `lib/settings.ts:212 relativeAge(ts)` → `just now` / `3m ago` / `5h ago` / `2d ago`
- `lib/format.ts:47 relTime(ts)` → `now` / `12s` / `4m` / `3h` / `2d`
- `lib/format.ts:60 fmtDuration(from,to)` → `1m 04s` / `1h 03m`

`relativeAge` and `relTime` are the same function with different thresholds (90s vs 5s cutoff,
`Math.round` vs `Math.floor`) and different suffixes, living in two modules that are already
both imported by the settings surfaces. `relativeAge` sits in `lib/settings.ts` — a
presentation-logic module — purely because that is where its first caller was. It belongs in
`lib/format.ts` beside its twin, and the two should become one function with a `style`
argument.

---

## D. Inconsistencies & structural smells

### D1. `inconsistent:creation-form` — the two creation doors disagree about six things
**Kind:** judgement call · **Confidence:** high · **Effort:** M · **Risk:** low

Both wrap `FormOverlay`, both take a title + prose, both create a feature on a base branch,
both invalidate `feature.list` and call `onCreated`. Then:

| | `NewFeatureForm.tsx` | `QuickChangeForm.tsx` |
|---|---|---|
| submit-guard shape | inline, recomputed per button: `!title.trim() \|\| busy \|\| branchesQ.isPending` (:192,:200) — and a *different* guard inside `submit` (`!t \|\| branchesQ.isPending \|\| busy`, :73) | one named `ready` const (:47) reused by both the guard and the handler |
| second field required? | no (`oneLiner` optional) | yes (`prose` required) |
| Enter key | submits (both inputs, :119/:136) | title Enter does nothing; textarea needs ⌘/Ctrl-Enter (:95) |
| duplicate-title warning | yes, `duplicateTitleWarning` + `role="status"` (:65,:124) | **none** — same collision, no warning |
| base-branch picker | `<details>` Advanced + `<select>` (:140-179) | none by design (documented, :17-19) |
| in-flight label | per-button via a second `starting` state (:54,:195,:202) | `busy ? 'Creating…'` (:109) |

The `starting`/`busy` split in `NewFeatureForm` is the shotgun-surgery tell: it exists only
because two buttons share one mutation, and it is reset in `create.onError` (:57) but **not**
in `launch`'s failure path — `launch` has no `onError` at all (:51). That is survivable today
only because `onCreated(feature.id)` unmounts the form immediately (:95). It is a landmine for
whoever adds a "stay on the form" branch.

### D2. `bug:backdrop-drag-dismiss` — four dialogs discard user input on a text-selection drag
**Kind:** violation (latent bug) · **Confidence:** high · **Effort:** S · **Risk:** low

`FormOverlay` diagnosed and fixed this, in a comment:

```tsx
// FormOverlay.tsx:57-61
// mousedown, not click: a click that STARTS inside the card and ends on
// the backdrop (selecting text and releasing outside) is not a dismissal.
onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}
```

The four `peek-backdrop` dialogs did not get the fix:

```tsx
DeleteFeatureDialog.tsx:37   <div className="peek-backdrop" onClick={onCancel}>
MergeFeatureDialog.tsx:43    <div className="peek-backdrop" onClick={onCancel}>
SettingsOverlay.tsx:47       <div className="peek-backdrop" onClick={onClose}>
DirectoryPicker.tsx:68       <div className="peek-backdrop" onClick={onCancel}>
```

A `click` event is dispatched on the nearest common ancestor of the `mousedown` and `mouseup`
targets, so selecting the slug text in `DeleteFeatureDialog` (or the path in
`DirectoryPicker`) and releasing outside the card dispatches `click` **on the backdrop
itself** — `e.stopPropagation()` on `.peek` cannot help, because the backdrop is the target.
The dialog closes and the typed slug / navigation state is gone. The fix already exists eight
files away.

### D3. `inconsistent:disabled-affordance` — half the primary buttons refuse to say why
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** none
*(this is E2E **F3** at code level, generalised)*

| primary button | disabled when | reason shown? |
|---|---|---|
| `FirstRunWizard.tsx:202` Continue | `!valid` where `valid = name.trim() !== '' && email.includes('@')` (:163) | **no** — no inline error, no `title`, no `aria-describedby`. E2E F3 exactly. |
| `NewFeatureForm.tsx:200` Start grill session | `!title.trim() \|\| busy \|\| branchesQ.isPending` | **no** |
| `NewFeatureForm.tsx:191` Create without starting | same | `title=` attr explains the *action*, not the disablement |
| `QuickChangeForm.tsx:108` Create ticket | `!ready` (title, prose, branches) | **no** |
| `DirectoryPicker.tsx:204` Open this folder | `!current` | **no** |
| `EnableAfkCard.tsx:230` Save & verify | `tokenText.trim() === ''` | **no** |
| `DeleteFeatureDialog.tsx:75` Delete feature | `!armed` | **yes** — "Type `<slug>` to confirm" (:58) |
| `EnableAfkCard.tsx:169` Build image | `!runtimeOk` | **yes** — `title="Install a container runtime first"` (:170) |
| `OpenProject.tsx:126` Open | `repoPath.trim() === ''` | **yes-ish** — persistent hint (:114) + full inline error with `aria-invalid` / `aria-describedby` / `role="alert"` (:97-98,:109) |

`OpenProject` is the house standard and nothing else follows it. Note the identity step is the
worst case *and* the first screen a new user meets.

### D4. `inconsistent:validation-strictness` — the client validates an email the server does not
**Kind:** judgement call (wrong-tool) · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// FirstRunWizard.tsx:163
const valid = name.trim() !== '' && email.includes('@')
```
```ts
// packages/server/src/trpc/routers/setup.ts:41
.input(z.object({ name: z.string(), email: z.string() }))
```

Hand-rolled `includes('@')` on the client; **no** validation at all on the server, in a repo
whose house rule is "zod is the schema lib". So `a@` passes the UI and `""` passes the wire.
The validation belongs in one zod schema in `@runcastle/core` that both sides import — which
would also give the form a message to render, fixing D3's worst row for free.

### D5. `inconsistent:credential-input` — the OAuth token is a plain text field
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** none
*(E2E **F4**, confirmed in code)*

```tsx
// EnableAfkCard.tsx:218-226
<input
  id="afk-token-input"
  className="op-input mono"
  value={tokenText}
  placeholder="sk-ant-oat01-…"
  spellCheck={false}
  autoComplete="off"
/>
```

No `type="password"`, no reveal toggle. `spellCheck`/`autoComplete` are already set, so the
author was thinking about the field's credential nature and stopped one attribute short. It is
the only credential input in the app, so there is no precedent to follow — which is itself an
argument for a `ui.tsx` `SecretInput` when C3's primitives land. (No secret value is
reproduced here — this is the input element, not a token.)

### D6. `inconsistent:poll-cadence` — five queries bypass the `useLivePoll` seam entirely
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

`lib/live.ts:88` exists to make every poll back off from 1.5s to 30s while the stream is up,
and its docstring (`:69-87`) explains at length why. Seventeen call sites obey it. Five do
not, hardcoding a raw interval that keeps firing at full rate forever:

```
components/bodies/ReviewBody.tsx:70          { refetchInterval: 5000 }
components/Workspace.tsx:79                  { refetchInterval: 5000 }   // feature.commitCount
components/PreparationWorkspace.tsx:48       { refetchInterval: 3000 }   // project.prep
components/PreparationWorkspace.tsx:53       { refetchInterval: 1500 }   // project.prepSession
lib/use-project-talk.ts:29                   { refetchInterval: 1500 }   // project.projectSession
```

`PreparationWorkspace.tsx:48` is the expensive one: `project.prep` shells out to git
(`services/findings.ts:253 commitsSince(...)`) once per distinct `establishedSha`, on a
hard 3-second timer that never backs off. Those five files are siblings' — the *seam* is mine,
and the seam is unenforceable because it is opt-in. Passing up as H2.

### D7. `inconsistent:combobox-empty-commit` — the same combobox commits `''` in one section and refuses it in the other
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

`ModelCombobox` (`SettingsOverlay.tsx:280`) is used from two places with two different
`onCommit` contracts:

```ts
// SettingsOverlay.tsx:367 (AdvancedModels)
const commit = (key, value) => { const trimmed = value.trim(); if (trimmed === '') return; … }
// SettingsOverlay.tsx:151 (Field)
const save = (raw) => { const trimmed = raw.trim(); if (trimmed === row.value.trim()) return; … }  // no empty guard
```

So blanking a custom model id in Advanced is a no-op, and blanking the same control in Global
sends `''` to the server. The guard belongs inside `ModelCombobox`, once.

### D8. `inconsistent:pending-granularity` — one shared `isPending` disables an entire section
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

`Field` (`SettingsOverlay.tsx:137`) owns one mutation per row, so one row saves at a time and
only that row shows `saving…`. `AdvancedModels` (`:355`) owns **one** mutation shared by every
step-model row, so `update.isPending` renders `saving…` on all of them (`:398`) and disables
all of them (`:402,:409,:425`). Same overlay, same control, two granularities.

### D9. `smell:contradictory-authorities` — the AFK card shows a success verdict beside a failure dot
**Kind:** judgement call (UI) · **Confidence:** high · **Effort:** S · **Risk:** low
*(client-side face of E2E **F1**)*

`TokenRow` renders two independent authorities on the same fact with no reconciliation:

```tsx
// EnableAfkCard.tsx:80-84 — from setup.doctor
<span className={`afk-dot afk-dot-${ok ? 'ok' : 'warn'}`} />
<div className="afk-row-detail mono">{probe.detail}</div>
// EnableAfkCard.tsx:236-247 — from setup.afkToken's own return value
{verdict && <div className={`afk-verdict ${verdict.valid ? 'is-ok' : 'is-warn'}`}>…</div>}
```

The root cause is server-side (`routers/setup.ts:29` calls `runDoctor` without the data-dir
`.env` merge that `doctor/cli.ts:22-29` does) and is out of my scope. What is in scope: the
card is *structured* so that this can happen at all. `onDone()` is `doctor.refetch()`
(`:28,:194`); when the refetch comes back still-amber the card shows `✓ token captured` in
green immediately under `⚠ no CLAUDE_CODE_OAUTH_TOKEN`. A card that derives its row state from
the last verdict when one exists would have masked the server bug instead of amplifying it.

### D10. `leak:setup-terminal` — the `setup-token` PTY has no teardown path from anywhere
**Kind:** violation (latent leak) · **Confidence:** high · **Effort:** M · **Risk:** low
*(E2E **F5**, root-caused)*

```tsx
// EnableAfkCard.tsx:181  const [sessionId, setSessionId] = useState<string | null>(null)
// EnableAfkCard.tsx:203-208  {sessionId ? <TerminalView sessionId={sessionId}/> : <Button…>}
// EnableAfkCard.tsx:193-197  save.onSuccess: setVerdict(res); if (res.valid) onDone()
```

`TokenRow` never clears `sessionId` and offers no close affordance, so after a successful
capture the terminal sits in a live OAuth prompt. `ImageRow` at least has a "Done — re-check"
button that clears its own `sessionId` (`:156-163`) — but that only unmounts the view.

Neither kills the process, and **there is no way to**: `setup.startTerminal`
(`routers/setup.ts:55`) creates a raw `ptyRegistry().create({…})` with a `setup_`-prefixed id
and **no DB session row**, while the only teardown the client has is
`feature.endSession` (`EndSessionButton.tsx:24`), which takes a session id. Verified: `grep -rn
"ptyRegistry" packages/server/src/trpc/routers/` returns exactly one file — `setup.ts` — and it
only calls `.create`. There is no `setup.stopTerminal`. Passing up as H4.

### D11. `smell:wizard-rail-vanishes` — the last wizard step has no progress indicator
**Kind:** judgement call (UI) · **Confidence:** high · **Effort:** S · **Risk:** none
*(E2E minor paper cut, confirmed)*

```tsx
// FirstRunWizard.tsx:51-53
if (screen === 'project') {
  return <OpenProject firstRun onOpened={onOpened} onCancel={onCancel} />
}
```

The early return bypasses the whole `wizard-card` shell, so `WizardSteps`
(`Git identity · AFK burns · First project`, `:102`) never renders on the step it would be
labelling. `lib/first-run.ts:36-40` already models `project` as a first-class `SetupStep` with
a label — the data is there; only the render path drops it.

### D12. `smell:doctor-error-swallowed` — the wizard has no error state for its only query
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```tsx
// FirstRunWizard.tsx:36-49
const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })
const identity = doctor.data?.results.find((r) => r.id === 'git-identity')
if (doctor.isLoading) return <div className="open-project"><DimLine>preparing setup…</DimLine></div>
```

`doctor.error` is never read. On failure the wizard renders the intro, then
`firstSetupStep(undefined)` (`lib/first-run.ts:43`) sends the user to the identity step with no
indication that the probe failed — while `EnableAfkCard.tsx:52` (the *other* consumer of the
same query) does render `doctor.error`. Two consumers, two policies.

Related and narrower: `EnableAfkCard.tsx:25-28` looks probes up by string id
(`probe('container-runtime')`, `probe('sandcastle-image')`, `probe('afk-token')`) and `Row`
returns `null` for a missing probe (`:75`). A renamed probe id on the server makes an entire
prerequisite row disappear silently rather than fail loudly — stringly-typed coupling across
the wire with no compile-time link.

### D13. `smell:overlay-misnomer` — `FormOverlay` is not an overlay
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** none

```css
/* styles.css:2255 */ .nf-overlay { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
```

No `position: fixed`, no `inset: 0`, no z-index — it is an in-flow workspace body, rendered
inside `<section className="workspace">` (`ProjectShell.tsx:98`). It is nonetheless named
`FormOverlay`, sits in a `nf-overlay` div, and carries a focus-ownership guard written for a
stacked-modal world:

```tsx
// FormOverlay.tsx:35-38
const focused = document.activeElement
const mine = focused === null || focused === document.body || !!cardRef.current?.contains(focused)
if (!mine) return
```

The guard is correct (Settings *can* open on top of it) but it is a symptom: because there is
no shared `Dialog` with a stacking discipline, each component reasons about who owns Escape
using `document.activeElement` heuristics. One more reason for C1.

### D14. `data-clump:setting-row` — `SettingRow` is a 15-field bag threaded through three components
**Kind:** judgement call · **Confidence:** medium · **Effort:** M · **Risk:** medium

`lib/settings.ts:370-396` defines `SettingRow` with 15 fields; `describeField` (`:435`) is a
long `if/else` chain over `field.source` / `gitDetected` / `overridden` / `field.scope`
producing one of five `note` strings; `SettingsOverlay.Field` (`:129`) then re-switches on
`row.readOnly` / `row.control` / `row.allowCustom` to pick one of five controls. So the same
field is classified twice — once into a row, once into a control — with the second switch
unable to be exhaustive because `control` is a bare string union (`ControlKind`, `:59`) and
`allowCustom` is a fifth orthogonal boolean. A discriminated union
(`{kind:'readonly'} | {kind:'text'} | {kind:'number'} | {kind:'textarea'} | {kind:'select',
options} | {kind:'combobox', options}`) would make the render a total switch and delete
`allowCustom` and `readOnly` as separate axes.

---

## E. Wrong-tool & weak typing

### E1. `unvalidated-wire:live-signal` — the SSE frame is `JSON.parse`d and cast, with a hand-copied type
**Kind:** violation · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
// lib/live.ts:22-26
/** Mirrors `LiveSignal` in packages/server/src/services/bus.ts. */
type LiveSignal =
  | { kind: 'event'; projectId: string; featureId?: string; eventId: number }
  | { kind: 'transcript'; ticketId: string }
```
```ts
// lib/live.ts:152
signal = JSON.parse((ev as MessageEvent<string>).data) as LiveSignal
```

Two problems on one line. (a) `JSON.parse` + `as` on a network boundary, in a repo whose house
rule names zod as the schema lib — the taxonomy's item 5 verbatim. (b) The type is *manually
mirrored* from `packages/server/src/services/bus.ts:22-36`, so nothing catches drift — and
`apps/web` already has the machinery to avoid that: `lib/api.ts:12` infers every other wire
type from `AppRouter`. `LiveSignal` is the one wire shape that escaped, because it travels over
SSE rather than tRPC. Either move `LiveSignal` into `@runcastle/core` as a zod schema and
`.parse()` it here, or at minimum `import type { LiveSignal } from '@runcastle/server'` the
same way `trpc.ts:6` imports `AppRouter`.

Softening note: the failure mode is benign today (`catch` falls back to a full invalidate,
`:154-157`), and the union is narrow. It is the *absence of a link*, not a live bug.

### E2. `bug:number-coercion` — blanking a numeric setting sends `0`, and the help text promises otherwise
**Kind:** violation (latent bug) · **Confidence:** high · **Effort:** S · **Risk:** low

```tsx
// SettingsOverlay.tsx:151-155
const save = (raw: string) => {
  const trimmed = raw.trim()
  if (trimmed === row.value.trim()) return
  const value = row.control === 'number' ? Number(trimmed) : trimmed
  update.mutate({ ...(projectId ? { projectId } : {}), key: row.key, value })
}
```

`Number('') === 0`. Now trace `burnCpus`:

```ts
// lib/settings.ts:131-135
burnCpus: { label: 'Burn CPU limit',
  help: 'CPU ceiling per burn container (--cpus). Blank leaves it unconstrained. …',
  control: 'number' }
```
```ts
// packages/server/src/services/settings.ts:150-155
{ key: 'burnCpus', … valueSchema: z.number().positive().max(256) }
// packages/core/src/config.ts:169   burnCpus: z.number().positive().max(256).optional()
```

`0` is not positive, so the documented way to unconstrain the CPU limit — blank the field —
is rejected by the schema. The user gets an error toast and the draft snaps back
(`SettingsOverlay.tsx:146-148`). The `null` clear path exists (`services/settings.ts:420`) but
is reachable only via "Clear override", which renders only when
`row.overridden && projectId` (`SettingsOverlay.tsx:263`) — and `burnCpus` is a global-only
field with no `projectColumn`, so it has no Clear affordance at all. Verified end to end
across three files.

### E3. `weak-typing:record-string` — six string-keyed maps where the key space is known
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```ts
lib/settings.ts:14   export const FIELD_ENV_VAR: Record<string, string>
lib/settings.ts:44   const STEP_LABEL: Record<string, string>
lib/settings.ts:74   const META: Record<string, FieldMeta>
lib/settings.ts:187  export const PREPARED_LABEL: Record<string, string>
lib/settings.ts:36   isStepModelKey(key: string): boolean
lib/settings.ts:39   stepOf(key: string): string
```

`MODEL_STEPS` and `DRIVE_LOOP_KEYS` are already exported from `@runcastle/core`
(`lib/settings.ts:1`) and `PREPARED_KEYS`/`PreparedKey` exist server-side
(`services/findings.ts:258`), so the key spaces *are* enumerable. Typing these as
`Record<PreparedKey, …>` / `Record<ModelStep, string>` would make `STEP_LABEL`'s eight entries
(`:44-53`) exhaustive-checked against `MODEL_STEPS` — today a new step added in core silently
falls back to `STEP_LABEL[step] ?? step` (`:408`) and renders a raw config identifier in the
UI. Same for `META[key] ?? { label: key, help: '' }` (`:414`), which silently ships an unlabelled
field with no help text.

The `stepModels.` prefix (`:35`) is stringly-typed key construction on both sides of the wire
(`services/settings.ts:401 input.key.startsWith('stepModels.')`) — primitive obsession across a
package boundary.

### E4. `weak-typing:probe-lookup` — the doctor report is indexed by untyped string ids
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** low

```tsx
// EnableAfkCard.tsx:25-28
const probe = (id: string) => report?.results.find((r) => r.id === id)
const runtime = probe('container-runtime'); const image = probe('sandcastle-image'); const token = probe('afk-token')
// FirstRunWizard.tsx:40
const identity = doctor.data?.results.find((r) => r.id === 'git-identity')
```

Four magic strings across two components, matched against ids defined in
`packages/server/src/doctor/doctor.ts`. `RouterOutputs['setup']['doctor']['results'][number]`
is already imported as `Probe` (`EnableAfkCard.tsx:65`), so the type is in reach — only `id` is
`string`. A `DoctorProbeId` union in core would make all four lookups compile-checked.

### E5. `weak-typing:query-result-cast` — `as SettingsView` / `as PrepView` casts at four call sites
**Kind:** judgement call · **Confidence:** medium · **Effort:** S · **Risk:** low

```tsx
components/bodies/ReviewBody.tsx:86   driveCapabilities(settings.data as SettingsView | undefined)
components/bodies/TicketsBody.tsx:70  effectiveStepModel(settings.data as SettingsView | undefined, 'implement')
components/PreparationWorkspace.tsx:70 const view = prep.data as PrepView | undefined
components/Workspace.tsx:247          unverifiedDriveKeys((prepQ.data as PrepView | undefined)?.findings ?? [])
```

Those four files are siblings' — but all four cast to types published by **my** `lib/api.ts`,
and they cast because the consuming helpers in **my** `lib/settings.ts` (`driveCapabilities:283`,
`effectiveStepModel:515`, `unverifiedDriveKeys:254`) declare narrower parameter types than
what `useQuery().data` infers. The lint-invisible risk is that these are the one place where a
wire-shape change stops being a compile error. Since `apps/web` is not typechecked in CI at
all, that matters more here than it normally would. Passing up as H5.

### E6. Clean results worth recording

- **No `any`, no `as any`, no `@ts-ignore`, no `@ts-expect-error` anywhere in `apps/web/src`.**
  Verified with `grep -rn "\bas any\b|: any\b|@ts-ignore|@ts-expect-error"` — zero hits.
- **`trpc.ts` is a 9-line, cast-free module** with a precise comment about why the `import type`
  is safe (`trpc.ts:2-6`). Nothing to report.
- **Only two `JSON.parse` sites** in the whole app: `lib/live.ts:152` (E1) and `lib/terminal.ts:168`
  (sibling's file).

---

## F. Shallow modules / deletion-test candidates

### F1. `shallow:env` — a one-constant module that documents its own obsolescence
**Kind:** judgement call · **Confidence:** high · **Effort:** S · **Risk:** none

`lib/env.ts` is 14 lines: 13 of comment and `export const SANDBOX_MODE = 'docker'`. The
comment says the other constant that lived here was a lie and was removed, and that this one
should be read from the server "if the server config ever gets a `config.get` field". Deletion
test: inline the string at its one consumer (`StatusBar`) and the module vanishes with no
complexity reappearing anywhere. It is a placeholder for a seam that does not exist yet —
speculative generality with one caller. **Keep-or-delete is a judgement call**, but the
honest options are "delete and inline" or "actually read it from `settings.get`", not "leave a
hardcoded mirror of a server default in the client".

### F2. `shallow:update` — `bannerVisible` is a three-term boolean behind a module
**Kind:** judgement call · **Confidence:** medium · **Effort:** S · **Risk:** none

```ts
// lib/update.ts:19-21
export function bannerVisible(info: UpdateInfo, dismissedVersion: string | null): boolean {
  return info.updateAvailable && info.latest !== null && info.latest !== dismissedVersion
}
```

One caller (`UpdateBanner.tsx:26`), which then *re-checks two of the three terms itself*:

```tsx
// UpdateBanner.tsx:26
if (!info || !info.latest || !bannerVisible(info, dismissed)) return null
```

So `info.latest !== null` is evaluated twice and the extraction bought nothing at the call
site. **However** — the deletion test does not cleanly pass: `test/update.test.ts` exists and
covers it, and the stated purpose ("pure so the show/dismiss decision is testable without a
DOM", `:1-3`) is real given there are zero component tests. Verdict: shallow but *earning its
keep as the only testable seam*. The genuine finding is the duplicated `!info.latest` guard at
the call site, and that `DISMISS_KEY` lives here while its `localStorage` access lives in the
component (see C2).

### F3. `shallow:ui-primitives` — `ui.tsx` is thin where the app needs depth
**Kind:** judgement call · **Confidence:** high · **Effort:** M · **Risk:** low

Not a deletion candidate — a *depth* finding. Five of the nine exports are one-line className
wrappers:

```tsx
ui.tsx:79  export function PhaseTag({phase}) { return <span className={`tag phase-fg-${phase}`}>{phase}</span> }
ui.tsx:83  export function TicketStatusChip({status}) { return <span className={`chip chip-ticket-${status}`}>{status}</span> }
ui.tsx:87  export function RunStatusChip({status}) { return <span className={`chip chip-run-${status}`}>{status}</span> }
ui.tsx:91  export function SessionStatusDot({status}) { return <span className={`status-dot sess-dot-${status}`} title={status}/> }
ui.tsx:26  export function SectionTitle({children}) { return <div className="section-title">{children}</div> }
```

Meanwhile the things that *would* be deep — a dialog, an input, a labelled field, a form-error
line — are absent, and the app pays for it: **40 raw `<button>` elements across 21 component
files** (`grep -rc "<button"`), six input class families (C3), seven modal implementations
(C1). Quantified answer to the parent's question: **inline `style={{…}}` is essentially not
the problem — only 5 occurrences app-wide, none in my scope** (`TerminalView.tsx` ×3,
`Sidebar.tsx`, `bodies/TicketsBody.tsx`). The bypass is entirely via **raw elements + one-off
classNames**, which is a much better-behaved failure mode but a wider one.

Raw `<button>` in my scope specifically: `DirectoryPicker.tsx` ×4, `SettingsOverlay.tsx` ×4,
`DeleteFeatureDialog.tsx` ×1, `MergeFeatureDialog.tsx` ×1, `NewFeatureForm.tsx` ×1,
`UpdateBanner.tsx` ×1 = 12. Six of those are the `.peek-close` ✕ (five copies) plus
`.settings-advanced-toggle`.

### F4. `shallow:mutation-errors` — thin, and correct, and it works. Not a finding.

`lib/mutation-errors.ts` is 37 lines and two functions, one of which is a three-branch string
coalesce. It passes the deletion test *for the wrong-looking reason*: deleting it would move
untestable logic into `main.tsx`'s `QueryClient` constructor, and `test/mutation-errors.test.ts`
is the only reason that logic is covered at all. **I verified the net actually catches what
call sites forget:**

- 46 `useMutation` sites in `apps/web/src`.
- Exactly 4 declare no `onError`: `bodies/RunBody.tsx:193,194,195` and `Workspace.tsx:154`.
  Of those, the three RunBody ones pass a shared `onMutated` object that *does* contain
  `onError` (`RunBody.tsx:189-192`), so they are handled; `Workspace.tsx:154` genuinely has
  none and is genuinely caught by the net. So is `NewFeatureForm.tsx:51`
  (`trpc.feature.launchSession.useMutation()`), in my own scope.
- **Zero** call sites use per-call `mutate(vars, { onError })`. Verified with a 6-line context
  grep across all `.mutate(` sites.

The one fragility worth recording (below) is real but currently latent.

### F5. `smell:opt-out-by-shape` — the safety net opts out on the *presence* of a handler, not on the error being reported
**Kind:** judgement call · **Confidence:** medium · **Effort:** S · **Risk:** low

```ts
// lib/mutation-errors.ts:34-37
export function unhandledMutationError(error: unknown, mutation: MutationLike): string | null {
  if (typeof mutation.options.onError === 'function') return null
  return mutationErrorMessage(error)
}
```

Two ways to defeat it, one of which already exists in my scope:

1. **A deliberately-empty handler counts as handled.** `OpenProject.tsx:41-44`:
   ```tsx
   // No toast: a rejected path is a fact about the field two inches away …
   onError: () => undefined,
   ```
   That is *correct* there (the error renders inline at `:109`), and it is exactly why the
   mechanism is "declared a handler", not "reported it". But it means the net cannot
   distinguish "handled inline" from "swallowed by accident" — the very failure the module
   exists to prevent.
2. **Per-call `mutate(vars, {onError})` callbacks are not on `mutation.options`**, so a call
   site that handles errors that way would raise *two* toasts. No call site does this today,
   so this half is speculative — flagged, not asserted.

A stronger contract would be an explicit opt-out (`meta: { handlesError: true }` on the
mutation), which is declarative, greppable, and cannot be satisfied by accident. Effort S.

---

## G. Deepening / consolidation / extraction opportunities — ranked

Ranked by (value × confidence) ÷ effort.

### G1. Extract `Dialog` into `apps/web/src/ui.tsx` — **effort M, blast radius 7 files, confidence high**
Seven independent modal implementations (C1) with five different a11y postures, a
copy-paste-shaped drag-dismiss bug in four of them (D2), and no focus trap or focus restore
anywhere in the app. **Five real adapters already exist**, so this is a real seam by the
briefing's own two-adapter test. Concentrates: Escape ownership, backdrop semantics, ARIA,
focus management, scroll lock, and the `peek-head`/`peek-close` chrome. Callers gain: correct
keyboard behaviour for free, and one place to add a focus trap. Blast radius is wide but
shallow — each call site loses ~15 lines and gains a wrapper.

### G2. Extract form primitives (`TextInput` / `TextArea` / `Select` / `Field` / `SecretInput`) — **effort M, blast radius ~12 files, confidence high**
Six input class families (C3) whose declarations are 80% identical and whose focus rings
already disagree in a way that penalises the onboarding path. `Field({label, help, error,
disabledReason})` would also close D3 (half the primary buttons refuse to explain their
disablement) mechanically rather than by remembering, and give D5's credential input a home.
Do this *after* G1 so `Dialog` can compose them.

### G3. Make `useLivePoll` the only way to poll — **effort S, blast radius 5 files, confidence high**
D6. The seam exists and is well-documented at `lib/live.ts:69-90`; it is simply opt-in, and
five sites opted out — including `project.prep` on a 3s timer that shells out to git. Either
move the cadence decision into a `trpc`-level `defaultOptions` for the affected procedures, or
add a lint-visible convention. Cheapest high-value item in the report.

### G4. Make `invalidateDbBacked` surgical — **effort M, blast radius 1 file, confidence medium-high**
`lib/live.ts:111-131` throws away every field of the signal it just parsed:

```ts
if (signal.kind === 'transcript') invalidateTranscript()
else invalidateDbBacked()                       // ← signal.projectId / featureId unused
```

The signal carries `projectId`, `featureId?` and `eventId`, and the client discards all three
to invalidate nine query roots app-wide. Per E2E F14 the stream is reaped and re-`ready`d on a
~13-second cycle, and **`ready` also calls `invalidateDbBacked()`** (`:144`) — so this
nine-root fan-out is firing roughly every 13 seconds regardless of whether anything changed.
The allowlist comment (`:108-110`) says the list is deliberate because "`setup.doctor` shells
out to probe the machine, so a blanket invalidate would re-run real work on every signal" —
but `project.prep` is *on* the allowlist (`:124`) and also shells out
(`services/findings.ts:253` `commitsSince` → a git `rev-list` per distinct sha). The stated
principle and the actual list disagree.

Concrete deepening: use `signal.featureId` to scope `feature.get` / `notes` / `docs.read`
invalidations, and drop `project.prep` from the per-signal path (it already has its own
3s poll at `PreparationWorkspace.tsx:48`, and its own targeted invalidate after a settings
write at `SettingsOverlay.tsx:143`). Note: the server-side `idleTimeout` fix (E2E F11/F14) is
the primary cure and is out of my scope — this is the client-side hardening that makes the
client cheap even when the stream *is* healthy.

### G5. Extract `lib/prefs.ts` — **effort S, blast radius 4 files, confidence high**
C2. Four hand-rolled `try/catch` localStorage wrappers and two key-prefix conventions. Small,
mechanical, and it lets `lib/update.ts`'s `DISMISS_KEY` stop being a constant whose access
lives in another file.

### G6. Move `relativeAge` out of `lib/settings.ts` into `lib/format.ts` and merge with `relTime` — **effort S, blast radius 3 files, confidence high**
C5. Also shrinks `lib/settings.ts`, which is otherwise a coherent module (see below).

### G7. Replace `PREPARED_LABEL` with `metaFor(key).label` — **effort S, blast radius 2 files, confidence high**
C4. Ten lines and a documented manual-sync obligation, deleted.

### G8. Type the settings key spaces — **effort S–M, blast radius 2 files, confidence medium**
E3. `Record<ModelStep, string>` for `STEP_LABEL`, `Record<PreparedKey, …>` for
`PREPARED_LABEL`, and a `DoctorProbeId` union in core for E4. Makes a step or probe added in
core a compile error rather than a raw identifier rendered in the UI.

### G9. Discriminate `SettingRow.control` — **effort M, blast radius 2 files, confidence medium, risk medium**
D14. Turns `SettingsOverlay.Field`'s five-branch ternary chain into a total switch and removes
`allowCustom` / `readOnly` as orthogonal booleans. Worth doing only alongside G2.

**Verdict on `lib/settings.ts` (the parent asked directly): one deep module, not a grab-bag.**
540 lines, but they are one coherent job — turning the `settings.get` wire contract into render
rows, with all the provenance/staleness/verification wording that decides whether a human
trusts a value. Interface is small (`describeField`, `globalRows`, `projectRows`,
`stepModelRows`, `unsetStepKeys`, `effectiveStepModel`, `driveCapabilities`,
`unverifiedDriveKeys`, `verificationBadge`) relative to the ~200 lines of copy and the
five-way `note` decision behind it. **There is no persistence and no schema validation in it at
all** — it never touches localStorage, never parses JSON, never validates: everything comes
pre-validated through tRPC/zod from `services/settings.ts`, which is exactly right. The
briefing's "hand-rolled `JSON.parse` with no schema" smell is **absent** here. Two things
genuinely do not belong: `relativeAge` (G6) and `PREPARED_LABEL` (G7). And one thing that
should live *in* it lives in the component instead: the number/empty coercion at
`SettingsOverlay.tsx:154` (E2) is exactly the kind of type decision `describeField` already
makes for display (`toDisplay`, `:398`) and should make for input.

---

## H. Cross-cutting candidates to pass UP

These are the items most likely to have twins in sibling scopes. Canonical keys are chosen so a
sibling naming the same smell collides on the key.

### H1. `redundant:modal-shell` — no shared `Dialog` primitive anywhere in `apps/web`
**Kind:** judgement call · **Confidence:** high**
Seven implementations, five of them mine, two (`DocPeek.tsx`, `CommandPalette.tsx`) in sibling
scopes. `ui.tsx` (mine) is where the primitive belongs, so **whoever owns the `ui.tsx`
consolidation should own this**. The `role="dialog"`/`aria-modal` posture splits cleanly on
scope boundaries — all four *my* peek dialogs have it, both *sibling* overlays lack it —
which is itself evidence that the convention travels by copy-paste, not by contract. Related
sub-smell for the parent to check across all web scopes: **zero focus traps and zero focus
restores exist anywhere in `apps/web`** (verified: no `createPortal`, no
`document.body.style` scroll lock, no saved `activeElement`).

### H2. `inconsistent:poll-cadence` — the `useLivePoll` seam is opt-in and five sites opted out
**Kind:** violation · **Confidence:** high**
The seam is mine (`lib/live.ts:88`); four of the five bypasses are in sibling scopes
(`bodies/ReviewBody.tsx:70`, `Workspace.tsx:79`, `PreparationWorkspace.tsx:48,53`,
`lib/use-project-talk.ts:29`). Any sibling auditing those files will report "hardcoded 3000ms
poll" independently — this key should merge them into one repo-wide finding. The expensive
instance is `project.prep` at 3s, which does git work per call.

### H3. `coarse-invalidation:live-sync` — one SSE signal invalidates nine query roots, discarding its own scoping fields
**Kind:** judgement call · **Confidence:** medium-high**
`lib/live.ts:111-161`. Compounded by the server-side missing `idleTimeout` (E2E F11/F14) that
makes `ready` — and therefore the full fan-out — fire every ~13 seconds. **The server fix
belongs to whichever scope owns `packages/server/src/index.ts:105`; this is the client half,
and the two should be reported together.** Also note the internal contradiction: the allowlist
excludes `setup.doctor` because it shells out, but includes `project.prep`, which also shells
out (`services/findings.ts:253`).

### H4. `leak:setup-terminal` — `setup.startTerminal` has no stop counterpart anywhere in the system
**Kind:** violation · **Confidence:** high**
E2E **F5**, root-caused across scopes. Client side is mine (`EnableAfkCard.tsx:181-213` never
clears `sessionId` and offers no dismiss); the actual gap is that
`packages/server/src/trpc/routers/setup.ts:55` creates a bare `ptyRegistry()` PTY with no DB
session row, so `feature.endSession` — the only teardown the web app has — cannot address it.
**A server-scope sibling should confirm the PTY registry side.** Fix needs both halves.

### H5. `weak-typing:query-result-cast` — `as SettingsView` / `as PrepView` at the `useQuery().data` boundary
**Kind:** judgement call · **Confidence:** medium**
Four sites, all in sibling scopes (`bodies/ReviewBody.tsx:86`, `bodies/TicketsBody.tsx:70`,
`PreparationWorkspace.tsx:70`, `Workspace.tsx:247`), all casting to types published by my
`lib/api.ts` and consumed by my `lib/settings.ts`. Likely to be reported by ≥2 leaves. Worth a
single repo-wide decision about whether `lib/api.ts` should publish narrower helper types or
the helpers should widen their parameters.

### H6. `stringly-typed:cross-package-ids` — probe ids, setting keys and the `stepModels.` prefix cross the wire as bare strings
**Kind:** judgement call · **Confidence:** high**
My instances: `EnableAfkCard.tsx:25-28` + `FirstRunWizard.tsx:40` (four doctor probe ids),
`lib/settings.ts:14/44/74/187` (four `Record<string, …>` key tables), `lib/settings.ts:35`
(`'stepModels.'` prefix, mirrored at `packages/server/src/services/settings.ts:401`). The
server side almost certainly has the mirror-image finding. Enumerating these in
`@runcastle/core` is one change that would close both.

### H7. `dead-css:styles` and `dead-export:icons` — verified dead UI assets
**Kind:** violation · **Confidence:** high · **Effort:** S**
14 dead CSS rule blocks and 6 dead icon exports (B1, B2), all verified by repo-wide importer
search with dynamic-classname and markdown-generated selectors explicitly excluded. Passing up
because four of the dead selectors (`ghost-link`, `lg-commits`, `tb-app`, `tb-dot`) exist
*only* in `packages/design-system` — they are fossils of the fork the parent already
established, and are evidence for that finding rather than independent ones.

### H8. `undefined-token:styles` — six CSS custom properties are used but never defined
**Kind:** violation (latent visual bug) · **Confidence:** high · **Effort:** S · **Risk:** low**

This is the sharpest single finding in my scope and it is likely to recur in any other
stylesheet in the repo, so it goes up. `apps/web/src/styles.css` defines 47 custom properties
and references 50. Six are never defined:

| token | uses | fallback? | consequence |
|---|---|---|---|
| `--warn` | **17** | `#d9a441` | see below |
| `--text-1` | 2 (`:2965`, `:3060`) | **none** | `color: var(--text-1)` is invalid-at-computed-value-time → the property falls back to *inherit*, so `.prep-cta-title` and `.prep-finding-key` silently take their parent's colour instead of the intended one |
| `--border` | 1 (`:691`) | **none** | `border: 1px solid var(--border)` → the whole shorthand becomes `unset` → the row-actions menu loses its border entirely |
| `--drive-line` | 1 (`:2146`) | `var(--accent-line)` | harmless |
| `--border-1` / `--text-5` | 1 (`:3103`) | `#333` | harmless but hardcoded |

The `--warn` case is the substantive one. `:root` defines the app's amber as
`--needs: #d7a94a` (`styles.css:45`). Seventeen rules instead reference a **non-existent**
`--warn` with a hardcoded `#d9a441` fallback — a *different* amber. So the app ships two amber
colours, and every warning surface I own is painted with the wrong one:

```css
styles.css:2065  .check-dot.is-warn   { background: var(--warn, #d9a441); }  /* MergeFeatureDialog's warning rows */
styles.css:2327  .nf-discard          { border: 1px solid color-mix(in srgb, var(--warn, #d9a441) 45%, …) }  /* FormOverlay's discard prompt */
styles.css:2338  .nf-dupe             { color: var(--warn, #d9a441); }       /* NewFeatureForm's duplicate-title note */
styles.css:3782  .afk-dot-ok          { background: var(--ok, #3fb950); }    /* --ok IS defined, and matches */
styles.css:3783  .afk-dot-warn        { background: var(--warn, #d9a441); }  /* --warn is NOT defined */
styles.css:3808  .afk-verdict.is-warn { color: var(--warn, #d9a441); }
```

The `--ok` and `--danger` rules next door use the same `var(TOKEN, #hex)` shape and *do*
resolve — `--ok: #3fb950` matches its fallback exactly, `--danger: #f4594e` differs from its
`#e5534b` fallback but at least resolves. So the pattern was copied from a stylesheet where
`--warn` existed, and only that one token failed to come across. Either define
`--warn: var(--needs)` in `:root` or replace all 17 references with `--needs`. Effort S.

Also worth the parent's attention as a house-convention question: `var(--token, #hardcoded)`
is a pattern that **hides exactly this class of error** — the page renders, so nothing ever
fails loudly. The two tokens with no fallback (`--text-1`, `--border`) are visibly broken; the
17 with a fallback are invisibly wrong.

---

## Appendix — verification notes

- Dead-code claims (B1, B2) used repo-wide `grep -rn` excluding `node_modules`, plus a
  dynamic-classname exclusion pass for B2. `.contains-task-list` was explicitly rescued from the
  dead list as a `remark-gfm` runtime output.
- The mutation-error safety net (F4) was verified positively, not assumed: all 46 `useMutation`
  sites enumerated, all 4 handler-less ones traced, zero per-call `onError` found.
- E2 (`burnCpus`) was traced across three packages: `apps/web/src/components/SettingsOverlay.tsx:154`
  → `apps/web/src/lib/settings.ts:133` (the promise) → `packages/server/src/services/settings.ts:154`
  and `packages/core/src/config.ts:169` (the schema that rejects it).
- H8 was produced by diffing the set of `--token:` definitions against the set of `var(--token`
  references in `styles.css`; both `--text-1` and `--border` were re-checked by hand for a
  fallback argument.
- Not run, per instructions: dev servers, `bun run test`, `bun run build`, `tsc`.
- No secret values appear anywhere in this report; D5 cites the input element only.
