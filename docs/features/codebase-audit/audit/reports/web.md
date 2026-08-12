# Consolidated audit report — WEB FRONTEND

Scope: `apps/web/**` (src, test, prototypes, public, config) + `packages/design-system/**`.
Static analysis only; no source edited, no servers started.

**Sub-scopes and their reports:**

| Sub-scope | Report | Analyst |
|---|---|---|
| shell / navigation / workspace | `web-shell-nav.md` | leaf |
| session / terminal / pipeline bodies | `web-session-pipeline.md` | leaf |
| forms / dialogs / onboarding / plumbing | `web-forms-lib.md` | leaf |
| design-system / prototypes / tests / config | `web-design-system.md` | orchestrator, direct |

Every cross-leaf claim below was **re-verified against source by the orchestrator** before
merging; adjudications are recorded inline. Section G is ranked across all four scopes, not
within them.

---

## Executive summary

The web frontend is in **better shape than the taxonomy's usual hunting grounds suggest**, and
the report should not be read as a list of sins. Verified clean across the whole surface:
**zero `any` / `as any` / `@ts-ignore`**, zero `dangerouslySetInnerHTML` in shipped code,
correct and complete xterm/WebSocket teardown, reconnect backoff matching UI-SPEC §5, a global
mutation-error safety net with all 46 `useMutation` sites enumerated, and a genuinely good
pure/impure split in `lib/` that made ~1800 lines of derivation logic unit-testable.

The findings cluster into four themes:

1. **Six latent bugs**, five of them new (not in `E2E-FINDINGS.md`), one of which explains
   the audit's headline E2E finding. See §"Latent bugs" — these are the actionable core.
2. **One verification gap that dwarfs the rest**: `apps/web` (12.3k src lines, 15.6k with tests) and
   `packages/design-system` are typechecked by *nothing*, including the release workflow.
   Two `--filter` flags fix it. Every other finding in this report is a finding that a
   type-and-test gate could not have caught anyway — but this is the reason nobody noticed.
3. **A design layer that forked and drifted**: `packages/design-system` has zero product
   consumers, duplicates 94 CSS class names against the app's own stylesheet under drifted
   tokens, and `docs/UI-SPEC.md` still describes the design system's palette and an abandoned
   tab model.
4. **A consistent accessibility gap with a single shape**: nine dismissable overlay surfaces,
   nine hand-rolled Escape handlers, **zero focus traps and zero focus restores** anywhere in
   the application.

---

## Answers to the two questions only this scope can settle

### Q(a) — Is `packages/design-system` an orphan package: migration target or residue?

**Residue that is still load-bearing for a live workflow — not a migration target, and not
deletable as-is.** Precisely:

- **Orphan to the product: yes, verified.** Zero imports in `apps/web`, absent from
  `apps/web/package.json`, no tsconfig path, no vite alias, no CSS import.
- **Orphan to the repo: no.** It has 25 real importers under `.design-sync/previews/*.tsx`, and
  `.design-sync/config.json` names it as the sync package with a live `buildCmd`. Deleting it
  breaks the Claude Design round-trip.
- **Never built in CI, never typechecked: confirmed.** Its `build`/`typecheck` scripts
  (`package.json:25-26`) are invoked by no caller; `release.yml` never touches it.
- **Direction of travel is backwards.** `.design-sync/NOTES.md` records that it was
  *extracted from* `apps/web/src/styles.css` + `ui.tsx`, and that a redesign returns to the app
  *"by re-wiring tRPC data/handlers into the new layout, not as a file swap."* So it was never
  intended to become the app's dependency — the app is upstream of it, not downstream.

**Verdict: residue of a one-way export, mislabelled as a package.** The harm is not the code —
it is that `README.md:216` and `CLAUDE.md`'s package map both present it as a first-class peer
of core/server/web, so anyone orienting from the docs believes the app consumes it. The cheapest
correct action is to **label it** (one line in `src/index.ts` + the README row) rather than
migrate to it or delete it. Migrating *to* it would first require re-extraction, because its
tokens and screens are a release behind the app (§D-1).

### Q(b) — What event types does the web timeline actually render / switch on?

**The timeline is type-agnostic. It switches on almost nothing, which is exactly why the
skill-vs-service event-type divergence is invisible.**

- Server emits **80 distinct event types** (`grep "type: '<ns>.<name>'" packages/server/src`).
- `apps/web` references **11** event-type literals in total, and uses them for **state
  derivation, not rendering**: `feature.shipped`, `feature.status`, `merge.conflict`,
  `run.finished`, `gate.overridden`, `burn.started`, `session.{ended,kickoff,
  kickoff_undelivered,not_ready,resume_failed}`.
- **The Activity feed renders every event generically.** `lib/activity.ts` has no switch on
  `event.type` at all except `isToolEvent(event.type)` at `:82`; everything else becomes
  `stripMarkdown(event.message)` truncated to 140 chars. Critically, `:89` and `:105` fall back
  to **`event.type` itself as the summary** when the message is empty.

**Direct answer on the four named types:**

| Event type | Emitted by | Consumed by web | Effect |
|---|---|---|---|
| `tickets.stored` | service (`services/tickets.ts:114`) | ❌ nothing | renders as a generic timeline line |
| `tickets.emitted` | **skills only** — not by any server code | ❌ nothing | renders as a generic timeline line |
| `phase.advanced` | service (`launcher/launcher.ts:843`) | ❌ nothing | renders as a generic timeline line |
| `phase.completed` | **skills only** — not by any server code | ❌ nothing | renders as a generic timeline line |

Also relevant: the server itself uses **three** different phase-event spellings —
`phase.advanced` (`launcher.ts:843`), `phase.changed` (`services/repo.ts:191`),
`phase.complete_requested` (`mcp/server.ts:298`) — and the web consumes none of them.

**The consequence, which is the finding:** a skill emitting `tickets.emitted` or
`phase.completed` produces a timeline row that looks perfectly normal and drives **zero** UI
state. Nothing in the web app can detect that the wrong vocabulary was used, and the generic
fallback at `activity.ts:89` means even a completely bogus type degrades to printing a machine
identifier in a human-facing feed rather than failing loudly. **The web app is not the place to
fix `drift:event-type-vocabulary` — it is the place that proves the drift is undetectable
downstream, which is why it needs fixing at the schema.** This corroborates the
`periphery-skills` sibling's finding and supplies the missing half: there is no consumer-side
safety net whatsoever.

### Correction accepted: the `F<N>` citation namespace

The coordinator is right, and it changes how these comments must be read. Code comments in
`apps/web` of the form `(findings F10.6)` / `(F25.2)` / `(findings F17.3)` cite
**`docs/features/identify-random-issues-throughout-the-system/findings.md`**, *not* the root
`E2E-FINDINGS.md`. The tell is the sub-numbering (`F10.5`, `F10.6`, `F10.7`, `F10.8`, `F10.9`,
`F17.3`, `F25.2`), which the root file does not use, and `F2x` numbers, which the root file
(F1–F19) does not reach.

**Re-checked: no finding in this report resolved a code comment against the wrong file.** Every
`E2E F<N>` reference here (F1, F3, F5, F9, F12, F14, F18) came from reading root
`E2E-FINDINGS.md` directly and was traced to code independently. The ~20 in-code `findings F<N>`
comments were read as prose context only.

**This is itself a finding — `ambiguous:findings-namespace`.** Two files share the F1–F25
namespace, ~20 code comments cite bare `F<N>` with no file named, and the two are trivially
confusable by exactly the kind of agent this repo is built to run. Passed up as §H-15.

---

## A. Flow map

Two disjoint trees. The design system is not in the product's tree at all.

```
apps/web/index.html:11 → main.tsx
  main.tsx:10  './styles.css'  (3859 lines, the app's OWN design layer)
  main.tsx:8-9 @fontsource-variable/{inter,jetbrains-mono}
  main.tsx:14  QueryClient  { retry:false, refetchOnWindowFocus:true }
  main.tsx:21  MutationCache.onError → lib/mutation-errors.ts:34 → lib/toast.tsx:36
  main.tsx:6   <App>
    │
    ├─ App.tsx:8  useLiveSync()            ← THE LIVE SPINE, mounted once
    │    lib/live.ts:137  new EventSource('/api/stream')
    │      → packages/server/src/routes/stream.ts (Hono streamSSE, HEARTBEAT_MS=25_000)
    │    'ready' (:139) → setLiveStatus('live') + invalidateDbBacked() + invalidateTranscript()
    │    'live'  (:148) → JSON.parse → invalidateDbBacked()   ← discards signal.featureId
    │    invalidateDbBacked (:111-131) fans out to NINE query roots
    │    useLivePoll(ms) (:88) → live ? 30_000 : ms   ← 17 sites honour it, 5 bypass it
    │    ⚠ App.tsx:8 DISCARDS the returned LiveStatus (verified: 0 consumers repo-wide)
    │
    └─ Shell.tsx:36  projects.length === 0 ? FirstRunWizard : ProjectShell
         ├─ FirstRunWizard.tsx:29 → intro │ identity │ afk (EnableAfkCard) │ project (OpenProject)
         │     → routers/setup.ts:29 setup.doctor   ← no `env` arg = E2E F1 root cause
         │     → routers/setup.ts:55 setup.startTerminal → bare ptyRegistry PTY, NO db session row
         │                                              ⇒ feature.endSession cannot reach it (E2E F5)
         └─ ProjectShell.tsx:97+  view switch  (lib/workspace.ts, lib/use-project-nav.ts)
              ├─ Sidebar.tsx:83   triage() ← lib/feature-ui.ts:265
              ├─ Titlebar / StatusBar      ← both read feature.list for a "health" dot
              ├─ NewFeatureForm │ QuickChangeForm │ SettingsOverlay │ dialogs (FormOverlay shell)
              └─ Workspace.tsx (771)  7 queries · 9 mutations · 11-arm runAction switch
                   └─ lib/feature-ui.ts (1455)  nextStep() :805-1237  ← the pipeline brain
                        └─ bodies/{Grill,Tickets,Run,Review,Shipped}Body.tsx
                             + SessionPanel → TerminalView → lib/terminal.ts → /ws/terminal/:id

packages/design-system/**  ←── imported by .design-sync/previews/*.tsx ONLY.
                               Zero importers in apps/web. Not a dependency. (verified)
```

---

## Latent bugs (read this section first)

Called out distinctly from cleanliness findings, per the briefing.

### 1. `bug:shipped-body-merged-at` — the shipped hero has never shown a merge time, for any feature
**Kind:** violation · **Confidence:** high · **Effort:** S · **New — not in E2E-FINDINGS.md**

`apps/web/src/components/bodies/ShippedBody.tsx:20-23` reverses the id-ordered event log and
takes the first of `{feature.shipped, merge.conflict, feature.status}`, then renders
`· merged X ago` only `if (merged.type === 'feature.shipped')` (`:35`).

The server emits `feature.shipped` **then** `setFeatureStatus`
(`packages/server/src/trpc/routers/feature.ts:207-208` → `services/repo.ts:212`), so
`feature.status` always carries the higher event id and always wins the reverse scan. The
condition can never be true. The merge timestamp is silently absent on every shipped feature.

This is also the cleanest instance of the methodology finding in §H-11: it is the *one*
event-feed derivation that lives inline in a `.tsx` instead of in `lib/`, and it is the *one*
that is wrong. The five equivalents inside `feature-ui.ts` are all tested and all correct.

### 2. `bug:next-step-conflict-hides-burn` — the mechanism behind E2E F18's dead end
**Kind:** violation · **Confidence:** high · **Effort:** S

`apps/web/src/lib/feature-ui.ts:1167` — the merge-conflict branch `return`s early. The branch
that offers **Burn the pending tickets** is at `:1193` and is therefore **unreachable whenever
a conflict stands**.

E2E F18 reported this as "the pending ticket has no Burn button anywhere on the screen". It is
not missing — it is *shadowed*. That closes the loop on the audit's headline runtime finding,
and the full picture is worse than either half alone:

- **ADR-0007 §6 explicitly designs** two human escape hatches for a landing conflict:
  *"'Resolve with agent' (the AFK path…) and 'Resolve in terminal' (a revisit session briefed
  with the ticket, its branch, and the conflicting files)."*
- `feature-ui.ts:457` and `:482` build exactly those kickoffs — **two hand-maintained copies of
  the same prose**, already drifting typographically (`feature’s` at `:462` vs `feature's` at
  `:498`).
- Both instruct a `revisit` session to edit source files, which
  `packages/server/src/launcher/edit-guard.ts:36` (`guardsEdits(kind) { return kind !== 'project' }`)
  **denies**.
- And the one remaining forward path — burn the ticket the agent emitted instead — is hidden by
  `:1167`.

So an ADR-blessed recovery flow has one path blocked by a guard and the other shadowed by a
`return`. **The fix is not in the UI copy**: it is (a) exempt conflict-resolution revisit
sessions in the guard, per ADR-0007's own design, and (b) let the conflict branch fall through
to the burn affordance. Filed here rather than left to the server scope because only the web
side reveals *why* the user is stuck.

### 3. `stale-client-state:test-drive` — the active test drive is client-only state
**Kind:** violation · **Confidence:** high · **Effort:** M

`ProjectShell.tsx:35` holds the active drive in React `useState`, while the server is
authoritative and `feature.driveInfo` — which carries `featureId`, `branch`, `dryRun` — is
**already being polled** at `Workspace.tsx:103` and `ReviewBody.tsx:72` with only
`dryRun`/`devUrl` read off it.

Consequences on reload mid-drive: the Stop button disappears (`StatusBar.tsx:69`), the UI
offers "Start test drive" for a drive the server refuses as a singleton, and `Iterate`'s
"Stop the test drive first" guard silently un-disables (`Workspace.tsx:248,300`). The data
needed to fix it is already on the wire and being thrown away.

### 4. `undefined-token:warn` — 17 warning surfaces are painted with an undefined token
**Kind:** violation · **Confidence:** high · **Effort:** S

Orchestrator-verified: `var(--warn` appears **17 times** in `apps/web/src/styles.css`;
`--warn:` is defined **zero** times. The app's real amber is `--needs: #d7a94a`
(`styles.css:45`). All 17 rules fall through to a hardcoded `#d9a441` — a *different* amber:

```css
styles.css:2065  .check-dot.is-warn  { background: var(--warn, #d9a441); }   /* merge dialog */
styles.css:3782  .afk-dot-ok         { background: var(--ok, #3fb950); }     /* --ok IS defined */
styles.css:3783  .afk-dot-warn       { background: var(--warn, #d9a441); }   /* --warn is NOT */
```

The app therefore ships two ambers, and every warning surface uses the wrong one. Two further
tokens have **no** fallback and are visibly broken: `--text-1` (`:2965`, `:3060` — colour falls
back to *inherit*) and `--border` (`:691` — the shorthand becomes `unset`, so the row-actions
menu loses its border entirely).

**House-convention question for the root:** `var(--token, #hardcoded)` is a pattern that hides
exactly this class of error. The two tokens without a fallback are visibly broken; the 17 with
one are *invisibly wrong*.

### 5. `bug:number-coercion` — the documented way to unconstrain `burnCpus` is rejected by the schema
**Kind:** violation · **Confidence:** high · **Effort:** S · **New — traced across three packages**

`SettingsOverlay.tsx:154`:

```ts
const value = row.control === 'number' ? Number(trimmed) : trimmed
```

`Number('') === 0`. The `burnCpus` help text promises *"Blank leaves it unconstrained"*
(`lib/settings.ts:133`), but `packages/server/src/services/settings.ts:154` and
`packages/core/src/config.ts:169` both type it `z.number().positive()` — so the blank the UI
invites is coerced to `0` and rejected. `burnCpus` is global-only, so it also has no
"Clear override" affordance to fall back on (`SettingsOverlay.tsx:263`). The user is told to do
the one thing that cannot work.

This is also the type decision that belongs *in* `lib/settings.ts` — `describeField` already
owns the display direction (`toDisplay`, `:398`) and should own the input direction too.

### 6. `bug:backdrop-drag-dismiss` — four dialogs discard your work if you select text and release outside
**Kind:** violation · **Confidence:** high · **Effort:** S

`FormOverlay.tsx:57-61` diagnosed this and fixed it, in a comment: it uses `onMouseDown` plus
`e.target === e.currentTarget` because *"selecting text and releasing outside is not a
dismissal"*. The four `peek-backdrop` dialogs never got the fix and use a bare
`onClick={onCancel}`: `DeleteFeatureDialog.tsx:37`, `MergeFeatureDialog.tsx:43`,
`SettingsOverlay.tsx:47`, `DirectoryPicker.tsx:68`.

Because `click` dispatches on the mousedown/mouseup **common ancestor** — the backdrop —
`stopPropagation()` on the `.peek` panel cannot prevent it. Select the slug text in the delete
confirmation, release outside the panel, and the dialog dismisses. One overlay knows the answer
and the other four do not: the strongest possible argument for §G-3's shared `Dialog`.

---

## B. Dead code — all claims orchestrator-verified

Every item below was re-verified with a repo-wide importer search by the orchestrator, not
taken on a leaf's word. Reference counts are total occurrences including the definition.

| Item | `file:line` | Refs | Verdict |
|---|---|---|---|
| `phaseGlyph` | `lib/feature-ui.ts:73` | **1** (definition only) | **dead** |
| `IconX` | `icons.tsx:109` | 1 | **dead** |
| `IconActivity` | `icons.tsx:161` | 1 | **dead** |
| `IconArrowRight` | `icons.tsx:177` | 1 | **dead** |
| `IconPlay` | `icons.tsx:185` | 1 | **dead** |
| `IconStop` | `icons.tsx:193` | 1 | **dead** |
| `IconSparkle` | `icons.tsx:209` | 1 | **dead** |
| `sortForSidebar` | `lib/feature-ui.ts:183` | 3 (def + test import + test use) | **test-only**; superseded by `triage()` (`:265`, live at `Sidebar.tsx:83`) |
| `LiveStatus` type + status | `lib/live.ts:27,35,38` | 5, all inside `live.ts` | **no consumer** — see §H-3 |
| `MARKDOWN_POLICY` | `Markdown.tsx:11` | 6 (def + test only) | **not read by the render path** — `:28` hardcodes the plugins, so adding `rehypeRaw` would leave every test green. A test-pinned constant that pins nothing. |
| `workspace.deselect` | `lib/workspace.ts:100-102` | — | dead (leaf-verified) |
| `FirstRunWizard.onCancel` | `FirstRunWizard.tsx:33` → `OpenProject.tsx:101,121` | — | **unreachable** — both call sites gated on `!firstRun`, and the wizard only passes it on the `firstRun` path |
| 14 dead CSS rule blocks | `styles.css` (`.chip-blocked:284`, `.gate-hint:2445`, `.grill-empty:1406`, `.nf-form:810`, `.spec-doc:1515`, `.terminal-placeholder:3155`, …) | — | dead; method excluded template-literal-generated classes and rescued `.contains-task-list` (emitted by `remark-gfm` at runtime) |
| `apps/web/prototypes/multi-project.html` | 685 lines | 0 | **stale** — self-declared throwaway (*"Fold the winner into apps/web; bin the rest"*, `:13`); the winner shipped as issue #45 |
| `packages/design-system` (whole package) | — | 0 in `apps/web` | **dead as a library**, alive as a design-tool export — see §D-1 |

Five `lib/settings.ts` exports (`FIELD_ENV_VAR:14`, `MODEL_OPTIONS:32`, `isStepModelKey:36`,
`stepOf:39`, `STEP_KEYS:54`) are module-internal but exported — over-exposed interface rather
than dead code.

---

## C. Redundancy & repeated logic

### C-1. Nine overlay surfaces, nine Escape handlers, zero focus management
**Orchestrator-adjudicated.** The three leaves gave three different counts (7, 5, and a partial
list). The authoritative census, verified directly:

| Overlay | `role="dialog"` + `aria-modal` | Escape | Focus trap | Focus restore |
|---|---|---|---|---|
| `SettingsOverlay.tsx:50-51` | ✅ | ✅ `:40` | ❌ | ❌ |
| `DeleteFeatureDialog.tsx:40-41` | ✅ | ✅ `:30` | ❌ | ❌ |
| `MergeFeatureDialog.tsx:46-47` | ✅ | ✅ `:36` | ❌ | ❌ |
| `DirectoryPicker.tsx:71-72` | ✅ | ✅ `:53` | ❌ | ❌ |
| `DocPeek.tsx` | ❌ | ✅ `:26` | ❌ | ❌ |
| `CommandPalette.tsx` | ❌ | ✅ `:169` | ❌ | ❌ (only `.focus()` in the app, `:61`) |
| `FormOverlay.tsx` | ❌ | ✅ `:32` | ❌ | ❌ |
| `ProjectSwitcher.tsx` | ❌ | ✅ `:22` | ❌ | ❌ |
| `FeatureActionsMenu.tsx` | ❌ | ✅ `:30` | ❌ | ❌ |

**Repo-wide, `.focus()` / `activeElement` / `createPortal` appear 3 times total** in all of
`apps/web/src` — `CommandPalette.tsx:61` (initial focus), and `FormOverlay.tsx:36` which reads
`activeElement` to *arbitrate* nested Escape, not to restore. So: **zero focus traps, zero
focus restores, zero portals, no scroll lock.** Nine adapters is far past the briefing's
two-adapter bar for a real seam.

Note the split is exactly along scope lines — the four with dialog semantics are all in one
leaf's scope, the five without are spread across the other two. That is direct evidence the
convention travels by copy-paste rather than by contract.

### C-2. `useEventLog` / transcript: the cursor is in the query key
**Named by 2 leaves independently.** `lib/events.ts:12` and `AgentTranscript.tsx:92` both put
an accumulating cursor **in the TanStack query key**, so every new event mints a cache entry
that is never reused again — unbounded key growth. `useEventLog` is mounted **3–5 times
simultaneously on one screen** (`Workspace.tsx:74` *and* `:652` in the same component, plus
`Inspector.tsx:28`, `SessionPanel.tsx:112`, `RunBody.tsx:39`, `ShippedBody.tsx:19`), each an
independent key family with its own poll timer and its own full-history refetch. A 29-minute
burn polling at 1s (`AgentTranscript.tsx:100`) leaves ~1000 dead entries.

`lib/live.ts:68-90` documents honestly that the poll storm was *worked around, not fixed*. The
unbounded key growth is a separate, undocumented consequence.

### C-3. Three copies of copy-to-clipboard, one of them wrong
`Workspace.tsx:766-771`, `StatusBar.tsx:49-55`, `RunBody.tsx:196` do it correctly;
`TicketsBody.tsx:100-103` does `void navigator.clipboard.writeText(sha)` — unhandled rejection,
and the success toast fires before the promise settles. 1 of 4 copies is a bug, which is the
canonical argument for extraction.

### C-4. Two hand-maintained conflict-kickoff prose templates
`feature-ui.ts:457` and `:482` — see Latent bug #2. Five obligations stated verbatim in both,
already drifting. The duplication is load-bearing: a fix must be made twice, and there is no
single place a server-side guard exemption could key off.

### C-5. Six input class families, four localStorage wrappers, two amber tokens
Lower-tier redundancy from the forms/lib scope: six input class families with ~80% identical
declarations and disagreeing focus rings; four hand-rolled `try/catch` localStorage wrappers
with two key-prefix conventions; `PREPARED_LABEL` duplicating `metaFor(key).label` with a
documented manual-sync obligation.

---

## D. Inconsistencies & structural smells

### D-1. The design system forked from the app and both drifted from the spec
**Verified directly.** `apps/web` has **zero** imports of `@runcastle/design-system` and does
not list it in `apps/web/package.json`. Its only importers are `.design-sync/previews/*`.

`packages/design-system/src/styles.css` declares 186 top-level class selectors;
`apps/web/src/styles.css` declares 613; **94 names are defined in both** under drifted token
values (`--bg` `#0a0c0f` vs `#090b10`, `--accent` `#8b5cf6` vs `#7c6cf6`, `--radius` 5px vs 7px,
`--sidebar-w` 240 vs 252, …).

**The revealing part: the design system still matches `docs/UI-SPEC.md` §4 on every token; the
shipped app has drifted from both.** So the DS and the spec are a stale *pair*, two documents
describing a palette nothing renders. This means every "the app doesn't match the spec's
colours" finding anywhere in this audit collapses into this one root cause — see §H-8.

`.design-sync/NOTES.md` documents the drift explicitly (*"The DS package has drifted from the
app and is the next thing to re-extract"*), which downgrades it from surprise to known debt —
but no ADR or `CONTEXT.md` entry covers it (verified: `docs/adr/0001-0010` contain nothing on
UI or the design system), while `README.md:216` and `CLAUDE.md`'s package map both present it
as a first-class package peer to core/server/web.

The DS `screens/*` additionally encode the **typed-tab model** (`Tabs.tsx`, `TabsProps`,
close buttons) that the pipeline-first app abandoned, and re-declare the six-phase `Phase`
union verbatim in three files plus `Tag.tsx:8`.

### D-2. Nothing typechecks `apps/web` or `packages/design-system`
`package.json:17` — `"typecheck": "bun run --filter '@runcastle/core' --filter '@runcastle/server' typecheck"`.
Both excluded packages **do** define working `typecheck` scripts (`apps/web/package.json:9`,
`packages/design-system/package.json:26`) that no caller ever invokes.
`.github/workflows/release.yml:61-63` runs that same filtered script; its only other web step
(`:68-72` → `packages/server/scripts/build-package.ts:73`) is a **vite** build, which strips
TypeScript without checking it. ~12.3k lines of source can be type-broken and still cut a release.
There is no PR/push CI workflow at all — `release.yml` is the only one.

### D-3. Two health dots that disagree, and a live status that is discarded
`StatusBar.tsx:34` and `Titlebar.tsx:39` both render a server-health dot, both derived from
`feature.list`, and they **disagree with each other on cold start and at zero projects**.
Meanwhile `useLiveSync()` computes the real SSE connection status and `App.tsx:8` throws it
away (verified: `LiveStatus` has zero consumers). This is the code-level reason E2E **F14**
survived to release — the stream was being reaped every ~10s and both dots stayed green.

### D-4. The `useLivePoll` seam is opt-in, and 5 of 22 sites opted out
**Named by 2 leaves.** `lib/live.ts:88` exists specifically to back polling off to 30s while
the SSE stream is up. 17 sites honour it; 5 hardcode `refetchInterval` and defeat it:
`use-project-talk.ts:29` (1500), `Workspace.tsx:79` (5000), `PreparationWorkspace.tsx:48,53`
(3000/1500), `ReviewBody.tsx:70`. The expensive one is `project.prep` at 3s, which shells out
to git per call (`services/findings.ts:253` `commitsSince` → a `rev-list` per distinct sha).

### D-5. One SSE signal invalidates nine query roots and discards its own scoping fields
`lib/live.ts:111-131` parses a signal carrying `projectId`, `featureId?` and `eventId`, then
throws all three away and invalidates nine roots app-wide. Per E2E F14 the stream is reaped and
re-`ready`d on a ~13-second cycle, and `ready` **also** calls `invalidateDbBacked()` (`:144`) —
so the nine-root fan-out fires roughly every 13 seconds whether or not anything changed. The
allowlist's own comment (`:108-110`) justifies excluding `setup.doctor` because it shells out —
but `project.prep` is *on* the list and also shells out. The stated principle and the actual
list disagree.

### D-6. The client hand-mirrors server preconditions in seven places
`feature-ui.ts:834` (*"matches the server's `burn` acceptance check"*), `:857` `canAdvance`,
`TicketsBody.tsx:249`, `RunBody.tsx:72`, `ReviewBody.tsx:157`, `SessionPanel.tsx:225`
(*"mirrors the launcher's own resume test"*), `GrillBody.tsx:52`. Each is individually
well-reasoned and each names the server function it copies in a comment. Collectively: seven
copies, no shared contract, no test comparing the two sides. **E2E F18 is what this pattern
looks like when one copy goes stale.**

### D-7. `nextStep()` is a 433-line wide interface, and its consumer switch is hand-synced
`feature-ui.ts:805-1237` mixes action-availability, ~40 hardcoded copy strings, 7 Resume/Start
branches, 9 inline pluralisers, and heading-matching. It passes the deletion test loudly — it
earns its keep — but it is *wide*, not deep, and `Workspace.runAction` (`:261`) keeps a 15-arm
switch in sync with it by hand with no exhaustiveness check.

`Workspace.tsx` itself (771 lines) is **not** a god component — the decisions were already
extracted into the tested `lib/feature-ui.ts`. What remains is wiring.

### D-8. Vocabulary collisions confirmed against `CONTEXT.md`
- **E2E F12 confirmed:** `PreparationWorkspace.tsx:388` prints the literal word `verified` for
  `source === 'session'`, while `VerificationBadge` at `:326` prints `verified`/`unverified`
  meaning "a dry run proved this" — same row (`:390`, `:395`), same `settings-badge` class.
  Both are inline JSX ternaries, so nothing can compare them.
- **E2E "Burn N tickets" confirmed and worse:** `feature-ui.ts:1024`/`:1099` label
  `Burn ${t}` (all tickets) while `:1200` uses `pending`. At `:1097-1099` the *title* uses
  `pending` and the *label* two lines below uses `t` — the same bar can read "Review & burn the
  ticket" over "Burn 3 tickets". `feature-ui.test.ts:1140-1141` currently pins that as correct.
- **Session chip confirmed:** `SessionPanel.tsx:69` renders the raw `SessionKind` enum;
  `PreparationWorkspace.tsx:116` hardcodes `'prepare'`. No `SESSION_KIND_LABELS` table exists,
  though `PHASE_LABELS` does.
- `lib/vocabulary.ts` exists so *"every surface says the same thing"* (`:7`) and holds five
  explainers, while `feature-ui.ts:805-1237` alone hardcodes ~40 user-facing sentences **and
  ~200 words of agent-facing prompt prose**. That second category is the boundary where F18
  lives: the web app is a client-side author of agent prompts.

### D-9. E2E F9 traced to its cause
`project.prepSession` already exists (`packages/server/src/trpc/routers/project.ts:79-81`) and
is queried in exactly one place — `PreparationWorkspace.tsx:53`, i.e. only *after* you have
navigated in. The **project** session gets a full liveness path
(`use-project-talk` → `projectSessionState` → `ProjectRow` spinner); the **prepare** session,
returned by the same `activeProjectSession` server helper, gets none. So `prepRailRow`
(`lib/project-workspace.ts:152-181`) is purely a function of `prepared/pendingCount/staleCount`
and cannot know a session is live and waiting on the user.

### D-10. Tri-state queries collapsed to two
`ProjectShell.tsx:71` (`?? 0`), `:43` (`?? true`) turn "in flight" into "empty", flashing the
wrong state before data lands. The repo *knows* better in three places — `Shell.tsx:28`,
`project-workspace.ts:152-155`, and `services/feature.ts:184`: *"`count` is undefined when git
cannot tell, which the UI must not paint as zero."*

### D-11. `ui.tsx`'s `Button` is adopted by about a third of call sites
**Orchestrator-verified repo-wide:** `apps/web/src` contains **81 raw `<button>` vs 44
`<Button>`**. Several raw ones hand-write the exact class string `ui.tsx:19` generates —
`EndSessionButton.tsx:39`, `ProjectShell.tsx:214,217`, `PortfolioHome.tsx:38`,
`GrillBody.tsx:160,437,474,485`, `ReviewBody.tsx:286,290,297,345,348,511`. `ReviewBody` uses
both forms 40 lines apart (`:233` vs `:286`).

**Inline-style drift is a non-finding** — both leaves checked and found only **5**
`style={{…}}` sites in all of `apps/web/src`, three of them deliberate and documented
(`TerminalView.tsx:119/129/132`, self-styled to survive any shell stylesheet). Only
`TicketsBody.tsx:117` is drift. Reported here so the root does not carry a styling-drift
finding the evidence does not support.

---

## E. Wrong-tool & weak typing

> **Read this section knowing nothing enforces it.** The briefing's "skip anything tooling
> enforces" rule does **not** apply to `apps/web` or `packages/design-system`: neither is
> typechecked by any command any human or CI job runs (§D-2). Every item below is therefore a
> live defect surface, not a note about style a compiler already polices. The `string`-widened
> enums, the four `useQuery` casts, and the unvalidated SSE parse are all load-bearing
> precisely because `tsc` never sees this package.

- **Zero `any`, zero `as any`, zero `@ts-ignore`, zero `@ts-expect-error`** across the whole web
  surface, and only 2 `JSON.parse` sites app-wide. One justified non-null assertion
  (`Workspace.tsx:632`). The house convention holds — and holds *without* enforcement, which is
  worth crediting.
- **`unvalidated-wire:live-signal`** — `lib/live.ts:152` does
  `JSON.parse(...) as LiveSignal`, and the `LiveSignal` type is **hand-mirrored** from
  `packages/server/src/services/bus.ts:22` (`lib/live.ts:22` says so in a comment). Every other
  wire type in the app is inferred from `AppRouter` through `lib/api.ts:12`; the SSE channel is
  the one shape that escaped the type link — an unvalidated `JSON.parse` on a cross-process
  boundary, which is exactly the briefing's named smell. It is also the channel that drives all
  nine invalidation roots.
- **Domain enums widened to `string` in derivation code.** `@runcastle/core` exports
  `Phase`/`TicketStatus`/`RunStatus`/`GateId`/`SessionKind`, and `ui.tsx:83-92` uses them
  correctly, but: `feature-ui.ts:626` `interface RunFigure { status: string }`, plus `:631`,
  `:770`, `:1412`; `RunBody.tsx:202,425`; `TicketsBody.tsx:251`; `Inspector.tsx:86`
  `GATE_NAMES: Record<string, string>` (should be `Record<GateId, string>`), `:331`.
- **Query-result casts at the boundary:** `as SettingsView` / `as PrepView` at four sites —
  `ReviewBody.tsx:86`, `TicketsBody.tsx:70`, `PreparationWorkspace.tsx:70`, `Workspace.tsx:247`.
- **Stringly-typed cross-package ids:** four doctor probe ids hardcoded at
  `EnableAfkCard.tsx:25-28` + `FirstRunWizard.tsx:40`; four `Record<string, …>` key tables in
  `lib/settings.ts:14/44/74/187`; the `'stepModels.'` prefix at `lib/settings.ts:35` mirrored
  at `packages/server/src/services/settings.ts:401`.
- **Design-system a11y contracts that are stated but not implemented:** `StatusDot.tsx:7` and
  `Spinner.tsx:4` document `title` as an *"accessible label"* on a bare `<span>` with no role
  or `aria-label`; `Tabs.tsx:36-42` sets `role="tab"` on non-focusable `<div>`s with no
  `tabIndex`, no `onKeyDown` and no roving tabindex; `Toast.tsx:14` has no `aria-live`.
- **`lib/settings.ts` is NOT a grab-bag** (the orchestrator asked directly). 540 lines doing one
  coherent job, with a small interface relative to ~200 lines of copy behind it. It contains
  **no persistence and no schema validation at all** — everything arrives pre-validated through
  tRPC/zod. The briefing's "hand-rolled `JSON.parse` with no schema" smell is **absent**.

---

## F. Shallow modules / deletion-test candidates

- `DimLine.tsx:12` and `SectionTitle.tsx:11` in the design system are one-line class wrappers
  that accept neither `className` nor `...rest` — strictly less capable than the `<div>` they
  wrap. Deletion test: no complexity reappears anywhere. Counter-argument recorded: for a
  package whose unit is the design-tool catalogue card, a semantic wrapper can earn its place
  for non-code reasons. Worth an explicit decision, not a silent one.
- Genuinely **deep** modules, called out so consolidation does not flatten them:
  `TerminalClient` (`lib/terminal.ts`), `mapTerminalKey` (`lib/terminal-keys.ts`),
  `lib/settings.ts`, and the React-free tested trio `projects.ts` / `project-workspace.ts` /
  `activity.ts` — which is the right template for every extraction proposed below.

---

## G. Deepening / consolidation / extraction opportunities — ranked across all scopes

Ranked by value × confidence ÷ effort.

1. **`fix:typecheck-coverage`** — add two `--filter` flags to `package.json:17`. **Effort S,
   value very high.** Both target scripts already exist. Closes a gate that currently lets
   12.3k untypechecked lines into a published release. Expect it to fail on first run —
   nothing has ever enforced it. *The single highest value-per-effort item in this report.*
2. **Fix the four latent bugs** — `ShippedBody.tsx:20-23` (S), `feature-ui.ts:1167` (S),
   `--warn` + `--text-1` + `--border` tokens (S), `TicketsBody.tsx:100-103` (S).
   All small, all independently shippable, three of them invisible to any test the repo could
   currently run.
3. **`extract:Dialog` into `ui.tsx`** — **effort M, blast radius 9 files.** Nine adapters,
   five a11y postures, zero focus management. Concentrates Escape ownership, backdrop
   semantics, ARIA, focus trap/restore, and scroll lock. Each call site loses ~15 lines.
4. **`fix:poll-cadence`** — make `useLivePoll` the only way to poll (5 bypasses). **Effort S.**
   The seam exists and is documented; it is simply opt-in.
5. **`unsurfaced-state:live-status`** — consume the `LiveStatus` `App.tsx:8` already discards,
   and reconcile the two disagreeing health dots onto it. **Effort S.** This is the
   *observability* fix that would have surfaced E2E F14 within seconds instead of a release.
6. **`stale-client-state:test-drive`** — read the drive from `feature.driveInfo`, already
   polled. **Effort M.**
7. **`extract:event-log-provider`** — one per-feature event-log provider replacing 3–5
   simultaneous cursor-keyed observers; move the cursor out of the query key. **Effort M.**
8. **`extract:design-tokens`** — one `tokens.css` consumed by the app, the design system, and
   the design-sync template. **Effort M, risk medium (visual).** Three real adapters already
   disagree; this stops the drift recurring rather than re-fixing it.
9. **`decide:design-system-status`** — label it, re-extract it, or invert the dependency.
   **Effort S (decision) / L (re-extraction).** No ADR covers it; README and `CLAUDE.md` both
   currently mislead.
10. **`extract:form-primitives`** — `Field({label, help, error, disabledReason})` would close
    the "disabled with no reason" class (E2E F3) mechanically rather than by remembering.
    **Effort M.** Do after #3 so `Dialog` can compose them.
11. **`fix:invalidate-scoping`** — use `signal.featureId` instead of a nine-root fan-out.
    **Effort M.** Client-side hardening; the server `idleTimeout` fix is the primary cure.
12. Smaller, mechanical: `extract:prefs` (4 localStorage wrappers), `extract:clipboard-copy`
    (4 copies, 1 buggy), move `relativeAge` into `lib/format.ts`, delete the dead icons / CSS /
    `phaseGlyph` / prototype, type the settings key spaces.

---

## H. Cross-cutting candidates to pass UP

Promoted per the briefing: every smell named by ≥2 leaves, plus single-leaf items that cross a
package boundary. Keys chosen to collide with sibling scopes' naming.

| # | Canonical key | Kind | Conf | Named by | Why it goes up |
|---|---|---|---|---|---|
| H-1 | `gap:typecheck-coverage` | violation | high | orchestrator | `package.json:17` filters to core+server; `apps/web` (12.3k src lines, 15.6k with tests) + `packages/design-system` typechecked by nothing, release included (`release.yml:61-63`; the vite build at `:68-72` strips types). Both have working unused `typecheck` scripts. **Repo-wide gate finding** — root should check whether any other package is orphaned from the gate, and whether having only `release.yml` (no PR/push CI) is deliberate. |
| H-2 | `redundant:overlay-shell` + `a11y:no-focus-management` | violation | high | **3 leaves** | 9 overlays, 9 Escape handlers, 4 with `role="dialog"`, **0 focus traps / 0 restores / 0 portals repo-wide** (verified: 3 total `.focus()`/`activeElement`/`createPortal` refs in all of `apps/web/src`). Convention travels by copy-paste — the a11y posture splits exactly on scope lines. |
| H-3 | `unsurfaced-state:live-status` | violation | high | shell-nav | `useLiveSync()` computes SSE status; `App.tsx:8` discards it; `LiveStatus` has 0 consumers. **This is why E2E F14 survived to release.** Pairs with the server-side missing `idleTimeout` (`packages/server/src/index.ts:105`) — **report the two halves together**; the server fix is the cure, this is why nobody saw it. |
| H-4 | `redundant:accumulating-cursor-query` | judgement | high | **2 leaves** | Cursor in the TanStack query key (`lib/events.ts:12`, `AgentTranscript.tsx:92`) ⇒ unbounded cache-key growth; `useEventLog` mounted 3–5× per screen, each its own key family + poll timer. `live.ts:68-90` documents the poll storm as worked-around-not-fixed; the key growth is undocumented. |
| H-5 | `inconsistent:poll-cadence` | violation | high | **2 leaves** | `useLivePoll` (`live.ts:88`) is opt-in; 5 of 22 sites hardcode `refetchInterval` and defeat the SSE backoff. Expensive instance: `project.prep` at 3s does git `rev-list` work per call. |
| H-6 | `inconsistent:mirrored-server-rules` | judgement | high | session-pipeline | Client hand-mirrors server preconditions in **7** places, each naming the server function it copies. No shared contract, no test comparing the sides. **E2E F18 is this pattern going stale.** Candidate for an action-availability contract in `@runcastle/core` — **the server scope should be asked whether it sees the mirror image**. |
| H-7 | `weak-typing:stringly-typed-domain-enums` | judgement | high | **3 leaves** | Core exports `Phase`/`GateId`/`SessionKind`/`TicketStatus`/`RunStatus`; web derivation code re-types them as bare `string` (9 sites), the design system re-declares the `Phase` union verbatim **4 times**, and probe ids / setting keys / the `'stepModels.'` prefix cross the wire as bare strings (mirrored at `services/settings.ts:401`). **Server almost certainly has the mirror finding**; root should count total copies repo-wide — "how many files must change to add a phase" is the shotgun-surgery number that matters. |
| H-8 | `redundant:design-tokens` + `doc-drift:ui-spec` | violation | high | orchestrator | ~60 tokens declared 3× with different values; 94 CSS class names defined in both stylesheets. **The design system still matches `docs/UI-SPEC.md` §4 and the app has drifted from both** — so every "app doesn't match the spec's colours" finding anywhere in this audit collapses into this one. §2's typed-tab model also describes an abandoned interaction model. **Likely the largest doc-drift cluster in the repo**; recommend the root give build-time-doc drift one disposition rather than N per-scope reports. |
| H-9 | `leak:setup-terminal` | violation | high | forms-lib | **E2E F5, root-caused across scopes.** `routers/setup.ts:55` creates a bare `ptyRegistry()` PTY with **no DB session row**, so `feature.endSession` — the only teardown the web app has — cannot address it; `EnableAfkCard.tsx:181-213` never clears `sessionId` and offers no dismiss. **Needs both halves; a server-scope sibling should confirm the PTY registry side.** |
| H-10 | `coarse-invalidation:live-sync` | judgement | med-high | forms-lib | One SSE signal → 9 query roots, discarding `projectId`/`featureId`/`eventId`; fires ~every 13s because of the server `idleTimeout` defect. Internal contradiction: the allowlist excludes `setup.doctor` for shelling out but includes `project.prep`, which also shells out. **Pair with H-3 and the server fix.** |
| H-11 | `untested:inline-derivations` | judgement | high | **2 leaves** | Methodology, not a bug list. `feature-ui.ts` owns 5 event-feed derivations — all in `lib/`, all tested, all correct. The **one** derivation that lives inline in a `.tsx` (`ShippedBody.tsx:20`) is untested and **wrong**. With pure-lib vitest and no jsdom, logic inside a component is unverifiable *by construction*. Worth a repo-level rule — *derivations live in `lib/`* — rather than N fixes. Compounded by H-1. |
| H-12 | `brittle-test:copy-assertions` | judgement | med | session-pipeline | `feature-ui.test.ts` has ~142 exact-string assertions, ≥26 pinning **user-facing copy** (`expect(ns.title).toBe('Writing the spec')` `:293`). Every copy fix the E2E paper cuts ask for breaks a test that was not testing behaviour — including the "Burn N tickets" miscount, currently pinned as correct at `:1140-1141`. Root should know the copy fixes carry test churn. |
| H-13 | `inconsistent:copy-vs-vocabulary` | judgement | high | **2 leaves** | `lib/vocabulary.ts` exists so *"every surface says the same thing"* yet `feature-ui.ts` hardcodes ~40 user sentences **and ~200 words of agent-facing prompt prose**. Confirmed collisions: `verified` meaning two things on one row (F12), the session chip naming the launch not the work, the burn count naming all tickets. **If a sibling audits `packages/skills` prompt copy, note that `feature-ui.ts` is a second, client-side author of agent prompts — that boundary is where F18 lives.** |
| H-14 | `dead:design-system-package` | violation | high | orchestrator | Passed up not for deletion but because `README.md:216` and `CLAUDE.md`'s package map both present `@runcastle/design-system` as a first-class peer to core/server/web. Any sibling orienting from those docs will believe the app consumes it. Belongs on the root's `CLAUDE.md`/README reconciliation list. Note `.design-sync/` is live tooling — the package is dead *as a library*, not orphaned. |

| H-15 | `ambiguous:findings-namespace` | violation | high | orchestrator | Two files share the F1–F25 namespace — root `E2E-FINDINGS.md` (F1–F19) and `docs/features/identify-random-issues-throughout-the-system/findings.md` (sub-numbered F10.5, F17.3, F25.2…). ~20 code comments across `apps/web` cite a bare `F<N>` naming neither file (`GrillBody.tsx:269`, `ReviewBody.tsx:41,65,91,357,444,491`, `Inspector.tsx:26,125,157,363`, `DirectoryPicker.tsx:29,115`, `FormOverlay.tsx:8`, `CommandPalette.tsx:214`, `ErrorBoundary.tsx:14`, `DocPeek.tsx:45`, `FirstRunWizard.tsx:214`, `TicketsBody.tsx:38`, `RunBody.tsx:91`). **A sibling orchestrator already mis-resolved these once.** In a repo whose whole premise is agents reading their own history, an ambiguous citation scheme is a correctness hazard, not a style nit. Cheapest fix: cite `findings.md F10.6` rather than bare `F10.6`. |
| H-16 | `undetectable:event-type-drift` | violation | high | orchestrator (answering Q(b)) | The web consumes **11 of 80** server event types and its Activity feed does not switch on `type` at all (`lib/activity.ts` — only `isToolEvent` at `:82`), falling back to printing the raw `type` string as the summary (`:89`, `:105`). So skill-emitted `tickets.emitted` / `phase.completed` render as normal-looking rows and drive **zero** state, and nothing downstream can detect the wrong vocabulary was used. **Supplies the missing half of the `periphery-skills` sibling's `drift:event-type-vocabulary` finding: there is no consumer-side safety net, so the fix must be at the schema.** Note the server itself spells phase events three ways (`phase.advanced`, `phase.changed`, `phase.complete_requested`). |
| H-17 | `unvalidated-wire:live-signal` | violation | high | forms-lib | `lib/live.ts:152` `JSON.parse(…) as LiveSignal` with the type hand-mirrored from `packages/server/src/services/bus.ts:22`. The **only** wire shape in the app not inferred from `AppRouter`, on the channel that drives all nine invalidation roots, in the one package `tsc` never checks. **Server scope should be asked whether `bus.ts` can publish an inferable type.** |
| H-18 | `inconsistent:disabled-affordance` | violation | high | **2 leaves** | E2E **F3** generalised: 6 of 9 primary buttons disable with no reason shown. The house standard exists and is good — `OpenProject.tsx:97-98,109` (inline error + `aria-invalid` + `aria-describedby` + `role="alert"`) — and is followed by only 3 sites. Worst offender is `FirstRunWizard.tsx:163,202`, the first screen a new user sees. UI-SPEC §3 also promises "disabled with reason tooltip when gate unsatisfied", so this is a spec deviation as well as a UX one. A `Field({disabledReason})` primitive closes the class mechanically (§G-10). |

### Do not flatten these — what this scope does well

Recorded so consolidation upward does not read absence of praise as absence of quality:
per-feature `ErrorBoundary` (`ProjectShell.tsx:131-135`); the deliberate offline-but-keep-
rendering path that keeps the terminal mounted through a server restart
(`Workspace.tsx:210-225`); `UnrecognizedPhase` degrading a bad enum into a reportable pane;
complete and correct xterm/WebSocket teardown (`TerminalView.tsx:95-102`) with capped reconnect
backoff per UI-SPEC §5; **zero `dangerouslySetInnerHTML`** and markdown HTML escaped by default;
the global `MutationCache` safety net verified positively across all 46 `useMutation` sites; and
the pure/impure `lib/` split that made ~1800 lines of pipeline logic testable without a DOM.
