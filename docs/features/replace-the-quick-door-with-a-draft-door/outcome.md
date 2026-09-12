# Outcome — Replace the Quick door with a Draft door

Replace the sidebar's Quick door with a Draft-only door. Context: the Quick overlay (apps/web/src/components/QuickForm.tsx, opened from ProjectShell.tsx ~lines 216-347 and EmptyWorkspace) has two tabs — 'Quick change' (creates a burn-ready feature from ticket prose) and 'Park a draft'. Decision (overturns decision #8 of docs/features/flow-redesign-project-chat-and-creation-doors/decisions.md, confirmed by the human 2026-09-11): the Quick-change tab dies — all burn-now work is created through the project chat, which uses the same server door (create_feature with tickets) and can take screenshots and consult the portfolio; the form could not. The overlay becomes a single-mode Draft form: rename the sidebar button from 'Quick' to 'Draft', remove the tab bar and the Quick-change mode component entirely (ticket rows, '+ Add another', the 'from <branch>' base picker in the footer, the 'N tickets + review' summary — drafts pass no base and cut no branch), keep the title input and the Notes textarea (stored as the draft's brief), and change the footer button to 'Park draft'. Do NOT touch any server-side creation path (packages/server services stay as-is; the quick-change tickets shape of create_feature remains available to project-chat sessions). Do NOT redesign the project chat. Remove now-dead code this strands: the Quick-change mode component in QuickForm.tsx, its usages of BranchMenu/BaseSelect if no longer referenced from this form, any 'quick' icons in apps/web/src/icons.tsx that lose their last reference, and grep apps/web/src for remaining 'Quick'/'quick' UI references from this flow (Workspace.tsx, lib/feature-ui/next-step/review.ts and implementation.ts, FormOverlay.tsx) — update or remove each, but leave unrelated uses of the word alone. Update component tests that exercise the old two-tab form to the new single-mode form, and keep/adjust the test that a parked draft stores its Notes as brief.md.

- Shipped: 2026-09-12
- Laps run: 1

## What shipped

9 commits · 23 files

### Lap 1
- 3 tickets landed: #1 Replace the sidebar's Quick door with a Draft-only door. Context: the…; #2 Update the intake copy so the two doors explain themselves: chat is…; #4 Static intake-copy assertions use the heavier DOM test tier
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 5c0cd036659f7b242c89373aa7e60ff5e6ca6422
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 92fabeb7c72c861759faea25870aee0613c475f5
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Replace the sidebar's Quick door with a Draft-only door. Context: the…

# Ticket 1 — the Quick door is now a Draft door

## What was done

`QuickForm.tsx` is a single-mode form. The tab bar, the `QuickChangeMode`
component (deleted outright), the ticket rows, "+ Add another", the `from
<branch>` picker and the "N tickets + review" summary are gone, along with the
`project.branches` query, the ticket state and the `feature.quickChange`
mutation call that fed them. What remains is title / one-liner / Notes, and
Notes still land as the draft's `brief`. The footer button reads **Park draft**.
No server file was touched — `feature.quickChange` still exists on the server
and via MCP for project-chat sessions; the web is simply no longer a caller of
it, so the tRPC `feature.quickChange` procedure now has no client in this app.

The rail's and the empty workspace's buttons say **Draft**, and the icon changed
from `IconBolt` (documented as "the quick-change door — a tweak that skips the
conversation", a claim the Draft door does not make) to the existing `IconDoc`.
`IconBolt` lost its last reference and was deleted. I also renamed the door's
state and props — `startQuickChange` → `startDraft`, `onQuickChange` → `onDraft`
— because a door named Quick no longer exists; `creating` / the `'create'`
workspace view kept their names, since parking a draft is still creating.

Every prose reference to the dead door was swept: `FormOverlay`,
`project-workspace.ts`, `routes.ts`, `use-history-sync.ts`, `workspace.ts`,
`combobox.tsx`, `BaseSelect.tsx`, `Workspace.tsx`, `next-step/review.ts`,
`next-step/implementation.ts`, and four test files. Where a comment described a
*feature* born with its tickets already written (rather than the door), it now
says that, because the project chat still creates exactly that shape.

`apps/web/test/quick-form.test.tsx` lost the two quick-change cases, kept the
"Notes become the brief" case (now clicking **Park draft**), gained a case
asserting the form has no tablist, no "+ Add another", no base picker and no
burn summary, and its layout-rhythm block no longer loops over two modes.

## Surprises

- `BaseSelect.tsx` was **already** dead before this ticket — referenced only by
  its own test, not by the quick-change form. I left the component in place
  (removing pre-existing dead code is not this ticket) and only corrected its
  doc comment, which described the quick-change mode.
- `BranchMenu` survives (NewChatCard, NextStepBar), but after this change
  *neither* remaining caller sits inside a `Dialog` — so the Escape-layering
  comment in `combobox.tsx` and in `branch-menu.test.tsx`, which both named the
  Quick footer as the dialog in question, were rewritten to state the rule
  without naming a surface. The behaviour and its test are unchanged.
- There is no ⌘K palette entry for the Quick door, so nothing to update there.
- **A pre-existing test failure not in the baseline:**
  `packages/server/test/dev-pane.test.ts:183` ("kills the whole process group")
  fails — `pidAlive(-pgid)` is still true after the kill. It reproduces on a
  targeted run of that one file, and my diff is `apps/web` only, so it is
  environmental (process-group reaping in this sandbox), not mine. Everything
  else is green: `bun run typecheck` clean, full suite 3651 passed / 1 failed
  (that one) / 4 skipped.

## Left undone

- Two user-facing strings are **deliberately** left saying "Quick", because
  ticket 2 quotes them verbatim as its own work: the sidebar button's `title`
  tooltip (`Sidebar.tsx:236`) and the EmptyWorkspace explainer
  (`ProjectShell.tsx:347`). Between these two tickets landing, the button reads
  "Draft" while its tooltip and the explainer below still describe the Quick
  door. Ticket 2 also owns the overlay's heading and one-liner, which live in
  `quick/ParkDraftMode.tsx` (not in `QuickForm.tsx`, as ticket 2's text assumes).
- I did not rename files: `QuickForm.tsx` and `quick/ParkDraftMode.tsx` keep
  their paths, because ticket 2 addresses `QuickForm.tsx` by name and a rename
  would have collided with it. `ParkDraftMode` is now the only "mode" there is —
  worth folding into `QuickForm` once ticket 2 has landed, though keeping it
  separate is what lets the component test render the form without a tRPC
  provider, which is the convention the rest of `apps/web/test` follows.
- `ArtifactPane.tsx:67` still tells the human "This feature was created as a
  quick change and skipped ideation." I left it: it describes a feature's
  origin, not the door, and the project chat still creates that exact shape
  through the untouched server path.
- Drive machinery: nothing to update. This change adds no service, no required
  env var, no seed and no process. I confirmed `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` are both present and did not run them (no app or
  services in this sandbox).

#### 2. Update the intake copy so the two doors explain themselves: chat is…

# Ticket 2 — intake copy for the two doors

## What was done

Rewrote the project-home explainer in `apps/web/src/components/ProjectShell.tsx`
so New is presented as the door for both features and quick changes — "a
conversation that can read a screenshot, check what already shipped, and emit
burn-ready tickets" — and Draft gets one line: "writes an idea down now, to work
out later". Renamed that screen's second button from `Quick` to `Draft` so the
explainer names the button beside it. Rewrote both rail-head tooltips in
`Sidebar.tsx` to the same two-door story, and the comment above them. Took the
same words into the overlay's own one-liner in `quick/ParkDraftMode.tsx`
("Write it down now, work it out later. Nothing is cut until you Start it."),
updating the one assertion in `apps/web/test/quick-form.test.tsx` that pinned the
old sentence. Added `apps/web/test/intake-copy.test.tsx`, a rendering sweep over
both surfaces in the spirit of the existing `vocabulary-retired` test — it needed
`EmptyWorkspace` exported from `ProjectShell.tsx` (the only non-copy line in the
diff, with a comment saying why).

Deviations: none from the ticket, but two deliberate stop-shorts, both because
ticket 1 owns them and we ran concurrently — the rail-head button's own **label**
still reads `Quick` on this branch (ticket 1's line: "rename the sidebar button
from 'Quick' to 'Draft'"), and the `onQuickChange` prop doc on `Sidebar.tsx:111`
still says "the two-mode overlay", which is true until ticket 1 collapses it. The
copy test is written around this: it asserts on the doors' *tooltips*, never on
the rail button's label, so it stays green both before and after ticket 1 lands.
Expect a small merge conflict in `Sidebar.tsx` lines 231–241 and in
`apps/web/test/quick-form.test.tsx`, where both tickets edit adjacent lines.

## Surprises

- There is **no ⌘K palette entry for the Quick door** — the ticket asked to align
  one "if one exists". `CommandPalette.tsx` has only "Project chat — talk an idea
  through, or reopen a past conversation", which describes the chat, not Quick,
  so it was left alone.
- `EmptyWorkspace` had no test at all, and is a module-local function inside a
  large shell component. Exporting it is what made the headline copy testable;
  mocking `../src/trpc` (the same 20-line mock `sidebar-delete.test.tsx` uses) is
  enough to import `ProjectShell` in happy-dom.
- **One pre-existing full-suite failure, not in the prompt's baseline and not
  mine**: `packages/server/test/dev-pane.test.ts` > "kills the child process tree
  so the port-holder is not orphaned" fails on `expect(pidAlive(-pgid)).toBe(false)`.
  Confirmed on a single targeted run of that one file; it is a process-group
  reaping assertion in this container and cannot be reached by a web copy change.
  Everything else is green: `bun run typecheck` 0 errors, `bun run test`
  247 files / 3657 passed. (The prompt's baseline counts — 118 files, 1768 tests —
  are stale; this tree runs 249 files.)

## Left undone

- `apps/web/src/components/bodies/grill/ArtifactPane.tsx:67` still says "This
  feature was created as a quick change and skipped ideation." It describes how a
  feature was born, not a door, and "quick change" survives as the *kind* of work
  the chat takes, so it reads correctly after this change — but if a later ticket
  retires the phrase entirely, that string is the last user-facing one.
- The Draft door still carries `IconBolt` in the rail head. An icon for a
  parked idea, not a bolt, is ticket 1's call (it owns the icon sweep).
- The remaining `Quick` mentions in `apps/web/src` are code comments and
  identifiers (`workspace.ts`, `routes.ts`, `FormOverlay.tsx`, `BaseSelect.tsx`,
  `use-history-sync.ts`, the `onQuickChange`/`startQuickChange` names) — ticket 1's
  sweep, deliberately untouched here. The `Quick fix` vocabulary in the review
  triage (`TriageStep.tsx`, `NoteRow.tsx`, `FullAccounts.tsx`) is unrelated and
  must stay.

## Drive machinery

No change needed and none made: this ticket adds no service, no required env var,
no seed and no process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` are
untouched (nothing was run — the sandbox has no app).
