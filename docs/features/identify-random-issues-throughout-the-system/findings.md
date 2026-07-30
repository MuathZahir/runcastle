# Findings — UX audit of runcastle

Compiled from the agent-browser sweeps (fresh new-user instance; read-only copy of real data) and code-level root-causing. Severity classes per decisions.md §6: `blocker` / `major` / `minor` / `note`.

## Triage summary

**Blockers (4):** F2 rethink resumes wrong conversation + briefing swallowed → agent self-implements · F3 rethink during test drive wedges feature unrecoverably · F4 lap-blind next-step silently skips the whole lap · F19 unknown phase value blank-screens the app.

**Majors (15):** F1 preparation vanishes (re-run path undiscoverable) · F5 converge/burn flip-then-launch fragility · F6 kickoff recovery silently degrades · F7 update banner overlays everything + "0.0.0" · F8 next-step says Merge & ship over an active merge conflict · F9 competing resume CTAs in spec phase · F13 wizard never explains the product, opens on step 2 · F14 health chip reports wrong port · F15 can't create a feature without launching a session · F16 undefined jargon everywhere · F20 long project name blows up layout · F21 Merge & ship is one unconfirmed click · F22 test drive fakes "driving now" with no dev server · F23 review summary shows wrong data in green · F24 gate override silently advances phase, no undo.

**Minor bundles (3):** F10 returning-user polish (10 items) · F17 first-run friction (9 items) · F25 hostile-input & consistency (6 items).

**Notes (4):** F11 duplicate polling · F12 burn copy mechanics · F18 log-flavored surfaces · missing global MutationCache onError default (guard-sweep note).

**Ticket-shaping proposal (per decisions.md §6; final slicing happens at tickets phase):**
1. Kickoff delivery + revisit prompt integrity — F2, F6 (launcher/sessions/artifacts).
2. Rethink guards + transactional phase flips + rename Rethink→Iterate — F3, F5 (+F24's transactional cousin).
3. Lap-aware gates and next-step — F4.
4. Preparation persistence: permanent rail row, re-prepare, prepared state — F1.
5. Review-phase honesty: truthful summary, conflict-aware next-step, merge confirm, honest test drive — F8, F21, F22, F23.
6. Resilience & layout: feature-level error boundary, name length/truncation, update banner layering, gate-override consequence copy + undo — F19, F20, F7, F24.
7. First-run & vocabulary: wizard intro/step fix, create-without-session, jargon subtitles — F13, F15, F16.
8. UX polish batch — F10, F17, F25 minors (+ notes worth doing: F11 poll dedupe, F12 burn sentence, F18, MutationCache default).

## F1 — Preparation vanishes after completion (seed bug 1) — **major**
**Where:** Sidebar rail foot + project workspace body; root cause in `apps/web/src/lib/project-workspace.ts:103-105` and `packages/server/src/services/prep.ts:44-47`.
**What happens:** `prepared` is a monotonic, irreversible flag (any ended `prepare` session sets it forever), and it is the visibility predicate for *both* preparation surfaces — the featureless whole-body call-to-action and the rail-foot nudge. The moment preparation completes, both disappear at once. Nothing represents a *finished* preparation.
**What the user can't find (but exists):** ⌘K → "Preparation" still works (`CommandPalette.tsx:297-313`) and re-launches the prep session — but the palette match is a substring-of-haystack test (`CommandPalette.tsx:99`) so "re-prepare", "reprepare", "redo", "re-run" all return no match. Findings survive in the db and are partly visible in Settings (with a tooltip that literally says "re-prepare to refresh it" while offering no way to do so, `SettingsOverlay.tsx:160-168`).
**Also:** a re-run today *resumes* the old prep conversation (`launcher.ts:552`) rather than starting fresh; and the `preparing` UI state is ephemeral React state that any navigation or reload drops (`workspace.ts:119,154`).
**Fix direction (per root-cause agent, aligned with user's suggestion):**
1. Replace boolean `showsPrepNudge` with a variant row (`todo`/`done`) that renders **unconditionally** at the rail's foot — "Prepare this project (n)" when todo, "Re-prepare the project" when done, with a stale count (`project-workspace.ts`, `Sidebar.tsx:189-199`).
2. Give `PrepCallToAction` a prepared branch: "Re-prepare this project", the Established findings frame hoisted up, resume vs start-fresh buttons (`PreparationWorkspace.tsx:181-223`).
3. Persist `preparing` so an open preparation survives reload/navigation (`workspace.ts`).
4. Widen the palette haystack with "re-prepare redo findings stale" (`CommandPalette.tsx:99`).
5. Server: add `talkToPrep({ fresh: true })` to skip resume, and a `preparedAt` field on `PrepView` so the rail can say "prepared 12 days ago".

## F2 — Rethink resumes the wrong conversation and the briefing is swallowed, so the ideation agent self-implements (seed bug 2) — **blocker**
**Where:** `packages/server/src/launcher/launcher.ts`, `launcher/sessions.ts`, `launcher/artifacts.ts`, `trpc/routers/feature.ts`.
**Root-cause chain:**
1. `feature.rethink` flips phase review→ideation and bumps `lap` **before** launching (`feature.ts:96-105`).
2. The launcher resumes `mostRecentResumableSession` with **no kind filter** (`launcher.ts:412`, `sessions.ts:646-666`) — a Rethink resumes whatever conversation ended last on the feature, often an implementation-flavoured revisit transcript — producing `--resume <id>`, the exact flag that shows Claude's "Start from summary?" chooser (`sessions.ts:141`).
3. The lap briefing is typed blind into the PTY 1.5s after SessionStart with a bare `\r` (`sessions.ts:364-408`). Into the chooser, that `\r` *answers the dialog* — silently picking summary-resume; the briefing never arrives. The code's own safety comment (`sessions.ts:118-121`) is contradicted 20 lines later (`sessions.ts:137-143`).
4. The retry budget then self-destructs: the resumed session's own first prompt is treated as "the human typed first" and settles delivery as `superseded` (`sessions.ts:449-462`) — attempts 2 and 3 never happen.
5. The injected system prompt actively contradicts the lap: artifacts are written **after** the phase flip so the revisit prompt sees `ideation`, skips all lap framing, and says "Do NOT call `complete_phase`" (`artifacts.ts:283`) — opposite of the lap kickoff's instruction.
6. Nothing blocks edits: `acceptEdits` permission mode, full checkout worktree, no PreToolUse deny hook (`launcher.ts:529-533`, `artifacts.ts:575-586`). The "Never implement" rule lives only in the skill the swallowed briefing would have invoked.
**Broken invariant:** a session's first instruction is delivered before the agent acts, and its injected prompt agrees with that instruction.
**Fix direction:** (a) skip the resume lookup when a kickoff line is set — a fresh session whose briefing IS the opening move removes `--resume`, the chooser, and the swallow (`launcher.ts:405-418`); (b) fix `noteKickoffPrompt` to only settle on prompts arriving *after* our first write; (c) pass `lap` into `renderRevisitPrompt` independent of phase, make the "Do NOT complete_phase" rule conditional, add "you do not write code" + a PreToolUse edit-deny hook for non-project kinds; (d) thread `lap` into the SessionStart digest (`hooks.ts:245-265`). Plus the rename: **Rethink → Iterate** (user decision).

## F3 — Rethink during a test drive wedges the feature, unrecoverably (seed bug 3) — **blocker**
**Where:** `services/features.ts:471-491`, `services/git.ts:310-354,1369-1390`, `trpc/routers/feature.ts:96-105`, `apps/web/src/lib/feature-ui.ts:772`.
**Root-cause chain:** test drive checks the feature branch out in the real repo (`git.ts:1375-1390`); Rethink flips phase+lap first, then launches; worktree creation fails ("branch already checked out") **before** any session row exists; no rollback. Feature lands at `ideation`, lap N+1, no terminal — and `features.rethink` refuses non-review phases, so retry is impossible. The existing test-drive guard protects only `merge` and `deleteFeature` (`feature.ts:176-181`, `features.ts:751-756`) — `rethink` never consults `git.activeTestDriveFeatureId()`, and the UI offers Rethink unconditionally even while `ctx.driving` is known (`feature-ui.ts:769-772`).
**Broken invariant:** a phase/lap flip is not committed until the session it exists to open has actually started.
**Fix direction:** (a) pre-mutation guard in `features.rethink`: refuse while the feature's test drive is active, same shape as merge's; (b) make the route transactional — on launch failure restore phase/lap and emit `lap.aborted`; (c) UI: disable Rethink while driving with tooltip "Stop the test drive first — the branch is checked out"; (d) make `ensureTalkWorktree` reattach a detached-but-registered worktree (like `ensureProjectWorktree` does, `git.ts:392-396`) — fixes the post-drive case alone.

## F4 — Lap-blind ideation next-step silently skips the whole lap — **blocker**
**Where:** `apps/web/src/lib/feature-ui.ts:578-657`, `services/features.ts:331-348`, `services/gates.ts:26-27`.
**What happens:** the ideation next-step bar never looks at `feature.lap`. Gate G1 checks only that `decisions.md` exists — lap 1 already wrote it — so a wedged lap-2 feature shows "Promote the idea → advance" and `features.advance` crosses G1 with **no session at all**. G2 passes the same way (spec.md exists), landing the feature at `tickets` with zero lap-N tickets, where G3's lap-scoped check refuses. A silent path that skips the entire lap and dead-ends. The "Start/Resume grill session" escape launches a generic ideation session with no lap framing either (`sessions.ts:177-178`).
**Fix direction:** make the ideation next-step and G1/G2 gate checks lap-aware (for lap > 1, require the lap's own session/decisions delta), and give the lap-N grill session the lap kickoff framing.

## F5 — Same flip-then-launch fragility in converge and burn — **major**
**Where:** `launcher.ts:815-826` (converge), `features.ts:446-450` (burn's review→implementation loop-back).
**What happens:** `converge` sets phase + overrides the gate *before* launching the session; a launch failure strands the feature post-G1 with no session (a rescue path `reconverge` exists for converge but not for laps). `burn`'s loop-back flips to `implementation` before `startRun`; a throwing `startRun` leaves `implementation` with no run.
**Fix direction:** same transactional pattern as F3(b): commit the flip only after the session/run exists, or roll back on throw.

## F6 — Kickoff escape hatches silently degrade — **major**
**Where:** `sessions.ts:493-501,523-539`, `feature-ui.ts:500-512`.
**What happens:** `resendKickoff` falls back to the per-kind *generic* line when the delivery record is gone (the lap override was consumed at launch), so the recovery button silently downgrades the lap briefing to "work through what the human brings up". The session-ready watchdog only fires while `status === 'launching'`; a live session whose kickoff settled `undelivered` is surfaced only in the session panel — which the review-phase next-step bar doesn't show.
**Fix direction:** persist the kickoff override until delivered (don't delete at consume time); surface undelivered-kickoff in the next-step bar.

---

# Guard-sweep verification (code)

All 31 `useMutation` call sites in apps/web/src carry an `onError → toast.push` handler (verified by sweep; the two apparent exceptions are false positives — shared `onMutated` object in `RunBody.tsx:179-185`, and `testDrive`'s handler further down `Workspace.tsx:116+`). There is no global MutationCache default, so a *future* call site that forgets `onError` fails silently — worth a default handler — but today errors reach the user. Toast *placement/transience* is the real gap (see F17.2). The dead-end-risk actions themselves are covered by F2–F6, F21–F24.

---

# Browser sweep — deep states + hostile input (fresh instance, forced states)

Observed on the 4599 instance by forcing phases via sqlite and exercising every non-agent-launching action; screenshots in `scratchpad/shots/b-deepstates/`. Zero 4xx/5xx and zero console errors across the whole session — the "silent HTTP failure" class essentially doesn't exist; the failures found are rendering and honesty problems. Cross-confirms F7 (banner overlaps the phase rail too) and F14 (":4512 ok" on a 4599 instance).

## F19 — Unknown `phase` value blank-screens the entire app — **blocker**
A feature row with an unrecognized phase (corrupt row, schema drift after upgrade, or a future phase name from a newer server) renders the whole app as a solid blank page — no sidebar, no header, empty accessibility tree. All tRPC calls return 200; it's a client-side render crash with no effective React error boundary. No message, no way back except DB surgery.
**Fix direction:** error boundary at the feature-view level ("this feature has unrecognized data — phase 'x'"), rest of app keeps working; tolerant phase parsing (unknown → banner + read-only).
Shot: `28-bogus-phase.png`.

## F20 — Long project name destroys the workspace layout — **major**
A 324-char project rename is accepted (no length cap, no feedback). Card and sidebar truncate, but the top breadcrumb does not — the page overflows horizontally and shoves the main content and details rail off-canvas. App effectively unusable until renamed back.
**Fix direction:** max-length on input/server + ellipsis truncation on the breadcrumb.
Shots: `26-rename-long.png`, `27-longname-in-app.png`.

## F21 — "Merge & ship" is one click, no confirmation, honors nothing — **major**
On a review feature with 0 commits shown, no run, no test drive taken, Merge & ship fires a real git merge to main instantly with only a small toast. The most irreversible action in the pipeline has less friction than deleting a throwaway feature (which has an exemplary type-the-slug dialog).
**Fix direction:** lightweight confirm summarizing what's about to merge (N commits, run status, test-drive status), with extra friction when the summary shows missing artifacts.
Shot: `10-merge-clicked.png`.

## F22 — Test drive fakes success when there's nothing to drive — **major**
With no dev command configured, Start test drive flips the UI to "driving now" with a pulsing "dev server" chip and copy about the branch being booted "on its own port" — when all that happened was a `git checkout`. No process, no port, no warning. The user sits wondering what URL to open. (Start/stop themselves are honest at the git layer and restore `main` correctly.)
**Fix direction:** when no dev command exists: "the branch is checked out, but nothing was started — set a dev command in Settings"; don't show a dev-server chip for a process that doesn't exist.
Shots: `07-testdrive-clicked.png`, `08-testdrive-after-wait.png`.

## F23 — Review SUMMARY shows wrong data with all-clear colors — **major**
The SUMMARY card said "changes — 0 commits" with a **green** dot while the branch was verifiably 1 commit ahead of main; "tickets 0/0 done" and "0/1 done" both get green dots; "no run recorded" is neutral grey; and NEXT STEP says "Checks are in." with no run recorded — while the gate rail simultaneously says a ticket isn't terminal. The one card meant to inform the merge decision can't be trusted.
**Fix direction:** commit count from git (merge-base..branch); amber/grey for zero-done tickets and missing runs; "Checks are in" only when a run exists.
Shots: `06-phase-review-nobranch.png`, `08-testdrive-after-wait.png`.

## F24 — Gate override silently advances the phase, cannot be undone — **major** (upgrades F17.6)
"Override with reason…" + Apply instantly jumped implementation → review. No warning of the consequence in the form, no toast, no un-override — the only ways back are agent actions or DB surgery. (The Activity log does record the override + reason — good audit trail.) "Override" reads like "waive this gate", not "skip ahead now".
**Fix direction:** consequence copy in the form ("Overriding G4 moves this feature to review"), and an undo affordance.
Shots: `18-override-form.png` – `20-activity-after-override.png`.

## F25 — Hostile-input & consistency batch — **minor** (bundle)
1. **"Burn 0 tickets" offered as enabled primary CTA** in implementation phase with zero tickets, above an empty state whose copy contradicts the bar. (Tickets-phase body handles the same state correctly.)
2. **Escape silently discards typed text** in New-feature and Quick forms; click-outside on Quick preserves it — inconsistent dismissal semantics, no draft preservation.
3. **No duplicate-title guard** on the New feature form (inline check missing; server-side rejection unverified — testing it would spawn a session).
4. **Settings save silently** — values persist (verified across reload) but nothing distinguishes a saved change from a doomed one. (Extends F17.7.)
5. **Quick ticket spawns a whole sibling feature** (own branch, born at implementation) — coherent result, well-explained in the event log, but the form never says a new feature + branch will be created; users may expect it to attach to the selected feature.
6. **Empty rename silently reverts** (safe but mute).
Shots: `05-phase-implementation.png`, `12-new-duplicate-title.png`, `01-quick-form-filled.png`, `25-rename-empty.png`.

**Phase bodies under forced inconsistent state:** spec (no spec.md) and tickets (zero tickets) cope well with honest empty states; implementation copes badly (F25.1); review is mixed (F22/F23); shipped is clean; unknown phase is catastrophic (F19).

**What worked well (deep-state pass):** delete confirmation is exemplary (type-the-slug arming; copy enumerates exactly what's destroyed vs what survives); delete of a feature with no git branch degrades gracefully; archive/unarchive tidy; activity tab is a genuinely good audit log (override reasons, quick-change provenance); phase forcing reflects in UI within ~2s; merge produced a correct real merge commit; settings persist reliably.

---

# Browser sweep — returning-user pass (copied real data, read-only)

Observed on the 4598 instance; screenshots in `scratchpad/shots/c-returning/`. Console clean, all requests 200. Confirms in the UI what F1/F3 found in code: prep entry point inconsistent across projects (badge "8" unexplained, affordance absent entirely in one project), and Rethink sits next to Start test drive with zero guard or tooltip.

## F7 — Update banner floats over content on every screen, including modals — **major**
The "runcastle 1.1.1 is available · you're on 0.0.0" pill is fixed top-center and z-indexed above everything: it covers feature titles/branch labels, doc-peek modal headers, the Settings dialog header, and the search palette. Also shows "you're on 0.0.0" (missing-version fallback) which erodes trust in the prompt itself.
**Fix direction:** banner in its own layout row (or always below modal overlays), persistently dismissible; hide the version comparison when the installed version is unknown.
Shots: `09-demo-doc-peek-brief.png`, `19-settings.png`, `03-demo-realtime-collab.png`.

## F8 — Review next-step recommends "Merge & ship" while an unresolved merge conflict is displayed — **major**
NEXT STEP highlights **Merge & ship** as primary directly above a red MERGE CONFLICT panel that says to use "Resolve with agent" first. The two panels contradict; following the trusted next-step bar re-runs a merge that will fail. Conflict panel also carries no timestamp (the conflict event was 15 days old — possibly stale).
**Fix direction:** when a conflict is recorded, next-step switches to "Resolve the merge conflict first" and demotes/disables Merge & ship; timestamp the conflict panel.
Shots: `05-demo-entry-tags.png`, `06-demo-entry-tags-activity.png`.

## F9 — Spec phase shows two competing resume CTAs with no guidance — **major**
NEXT STEP says "Write the spec → Resume grill" while a separate bar says "The converge session ended before tickets were emitted → Resume converge", and the gate panel talks about tickets on a feature with no spec yet. The user cannot tell which session is the right one.
**Fix direction:** one canonical resume action per state; if converge is right, the next-step bar should say so.
Shots: `02-demo-project-home.png`, `21-kickoff-map-document.png`.

## F10 — Returning-user polish batch — **minor** (bundle)
1. **Status bar shows wrong port**: green ":4512 ok" while the server runs on 4598 (port appears hard-coded in the indicator).
2. **No "while you were away" signal**: project cards have no last-activity timestamp and nothing says *which* features need you; answering "what happened?" requires opening every feature's Activity tab.
3. **Project card stuck in rename-edit state**: a portfolio card rendered its title inside a focused text input with Rename/Close footer without the user initiating a rename; a stray Enter could commit a rename.
4. **Entering a project auto-selects an arbitrary (shipped) feature** instead of the top NEEDS YOU or last-viewed one.
5. **Activity events truncate with no expand**, and raw agent internals leak into the feed (`Bash cd /home/agent/repo && git add…`, raw `##` markdown as plain text).
6. **"Resume session" offered inside read-only retrospective phase views** on shipped features.
7. **Empty map document renders as bare heading stubs** ("DESTINATION —, NOTES —, …" under "No waypoints yet").
8. **Search palette shows selected feature's phase as "current"** instead of its actual phase.
9. **Doc peek shows raw ISO timestamps** ("Created: 2026-07-14T14:58:23.231Z").
10. **No read-only transcript viewer** for ended sessions — the only path back into a conversation is "Resume session", which a cautious user won't click just to re-read.
Shots: `01-portfolio-home.png`, `10-runcastle-project-home.png`, `18-janalearn-activity.png`, `12-registry-activity.png`, `23-mood-filter-tickets-view.png`, `21-kickoff-map-document.png`, `22-search-palette.png`.

## F11 — Aggressive duplicate polling — **note**
Identical `feature.list`/`events.list`/`project.projectSession` batches fire many times per second (dozens of duplicates within ~2s), well beyond the documented 1.5s poll. Will heat laptops on all-day sessions.
**Fix direction:** dedupe/coalesce queries (shared query keys / single poller).

## F12 — Burn affordance explains "what" but not the mechanics — **note**
"Burn 10 tickets… review them, then burn" is clear that burning = approval, but nothing says tickets run in parallel sandboxed sessions producing commits on the feature branch, or expected duration.
**Fix direction:** one more sentence on the burn bar.

---

# Browser sweep — first-run / new-user pass (fresh instance)

Observed on the 4599 instance; screenshots in `scratchpad/shots/a-firstrun/`. Console clean; only deliberate bad-path 400s. Cross-confirms F7 (banner overlays the directory picker and feature headers too; on a fresh install it says "you're on 0.0.0 — run `bun add -g runcastle@latest`", i.e. a brand-new user is told their install is outdated → suppress when version unknown and during onboarding).

## F13 — First-run wizard never explains what runcastle is, and opens on step 2 — **major**
Cold load drops straight onto "ENABLE AFK BURNS / Run features unattended" — Docker runtimes, sandcastle images, `CLAUDE_CODE_OAUTH_TOKEN` — for a concept never introduced. The stepper lists "Git identity" first but that step is never shown and steps aren't clickable, so the user can't tell whether git identity was detected or needs attention. "WELCOME TO RUNCASTLE" appears only on the *last* step. No screen explains the pipeline or what a burn is.
**Fix direction:** a one-screen intro (product + pipeline + "you approve at gates"), auto-passed steps shown with a checkmark/"detected" summary, "burn" defined at first use.
Shots: `01-cold-load.png`, `03-cold-load-clean.png`.

## F14 — Status-bar health chip reports ":4512 ok" regardless of actual server — **major**
The green chip says `:4512 ok` while this server runs on 4599 (Settings proves it). Either the label hardcodes the default port or the health check hits the wrong instance — meaning if the real server died the chip could still say "ok". Seen identically on the 4598 instance (was F10.1, promoted here). Related note: with multiple runcastle instances on one machine, nothing in the UI says which instance/data-dir you're looking at except Settings → Server port.
**Fix direction:** chip reflects the actual origin the page talks to (or just "server ok"); consider surfacing the data dir in Settings/About.
Shots: `13-feature-ideation.png`, `15-settings.png`.

## F15 — No way to create a feature without launching an agent session — **major**
The "+ New" form's only submit is **"Start grill session"**; Cancel is the only other exit. A user who wants to jot down an idea must either launch an AI session immediately or lose the typed text. The session-less ideation state already exists and renders fine ("No session yet / Start a session from the bar above") — only the UI entrance is missing.
**Fix direction:** secondary "Create without starting" action on the form.
Shots: `11-new-feature-filled.png`, `13-feature-ideation.png`.

## F16 — Pervasive undefined jargon — **major**
"Grill session", "burn", "lap 1", "G1", "AFK", "what is already red" appear at every key action with no definition anywhere. "Grill" and "burn" read aggressive/destructive to a newcomer ("burn money/tokens?").
**Fix direction:** first-use tooltips or plain-language subtitles ("grill session — a Q&A chat with Claude to pin down the idea"; "burn — run implementation agents on the tickets").
Shots: `11-new-feature-filled.png`, `14-quick-form.png`, `20-preparation-screen.png`.

## F17 — First-run friction batch — **minor** (bundle)
1. **Preparation copy never says it opens a Claude/terminal session** ("a short conversation in your own checkout" — with whom?). Same ambiguity on the palette's "Preparation" action (navigate or launch?).
2. **Repo-open errors are raw bottom-right toasts** far from the form ("not a git repository: …"), auto-dismissing, with no "git init" hint or affordance for non-git dirs.
3. **Directory picker**: ignores the typed path (always opens at home), no path input inside, 8+ clicks to deep dirs, OS junction noise shown with "Hidden" unchecked, no marking of which folders are git repos, "Open this folder" always enabled and fires the error toast on non-repos.
4. **Platform blindness on Windows**: "⌘K" hint (works as Ctrl+K) and `/path/to/your/repo` placeholder.
5. **Unexplained "8" badge** on "Prepare this project" (means 8 unanswered repo facts; nothing says so).
6. **Gate "Override with reason…"** offers a bypass with zero consequence copy ("what does overriding do? is it reversible?").
7. **Settings**: literal `burnMaxIterations` label amid humanized ones, raw option values ("noSandbox", "inherit"), unlabeled per-project fields (empty a11y tree), and no Save/Cancel — persistence model unknowable.
8. **"Close" on project cards is ambiguous** (remove-from-list? archive? delete data?) with no undo affordance.
9. **"notify" button is a silent no-op** when notification permission is denied — no state, no explanation.
Shots: `20-preparation-screen.png`, `05-bad-path-error.png`, `07-browse-picker.png`, `15-settings.png`, `22-gate-override.png`, `25-notify-click.png`.

## F18 — Log-flavored surfaces — **note**
Activity feed uses developer event slugs ("feature.created (feature/test-audit-feature ← main)"); brief.md viewer shows raw ISO timestamps. (Same class as F10.5/F10.9 from the returning-user pass.)

**What worked well (first-run pass):** the project-open happy path is fast (paste path → workspace, branch auto-detected, confirmation toast); the pipeline rail + NEXT STEP bar gives exactly one highlighted action on every screen; the command palette is complete and discoverable; empty states are purposeful; Quick vs New copy differentiates well once vocabulary is known; wizard checks show live-detected values instead of making the user type them.

**What worked well (returning-user pass):** sidebar triage (NEEDS YOU / IN PROGRESS / SHIPPED with phase-dot strips) answers "where is everything" at a glance; NEXT STEP + CURRENT GATE pattern makes the expected human action explicit in almost every phase; read-only retrospective phase views are a genuinely good history affordance; test-drive explainer copy is excellent. Stale-session reconciliation works (dead sessions correctly show "Session ended").
