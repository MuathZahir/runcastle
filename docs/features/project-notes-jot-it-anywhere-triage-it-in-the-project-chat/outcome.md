# Outcome — Project notes: jot it anywhere, triage it in the project chat

A project-scoped inbox of raw notes (one line + optional screenshot) capturable from any screen, surfaced as a badge on the project chat door, and handed to the project session as its intake material — the session routes each note into a quick change, a feature, or nothing, and marks it triaged.

- Shipped: 2026-09-24
- Laps run: 2

## What shipped

45 commits · 69 files

### Lap 1
- 9 tickets landed: #1 Project notes store: table, service, tRPC router, screenshot routes; #2 Project skill learns notes triage (triage.md reference + SKILL.md edits); #3 Project-session MCP tools for notes + burner resolves project-note screenshots; #4 Capture from anywhere: note popover, ⌘/Ctrl+J, titlebar button, palette entry, rail badge; #5 Notes inbox card + 'Triage N notes' launches a briefed triage chat; #7 Claude triage sessions are not pre-authorized to call the project-note tools; #8 Codex project sessions cannot load the required notes-triage procedure; #9 The project Notes card duplicates the review-note thumbnail instead of using a shared primitive; #10 Project-note screenshot routes duplicate the existing test-note upload and download pipeline
- 0 waived
- 0 failed

### Lap 2
- 9 tickets landed: #12 Capture redesign: palette-shaped bar, icon titlebar button, in-place saved line, focus on every open; #13 Inbox redesign: Notes card as a dense list with hover/focus actions; #15 Notes row icons never take their colours: Delete never turns red, resting icons aren't muted (button { color: inherit } beats text-* on the button); #16 The Triage button's "violet ghost" text is not violet: Button's new `accent` variant sets text-accent-hi on the <button>, which the unlayered rule overrides; #17 The saved line lets clicks through to the page, then the 1.5s auto-close yanks focus back to the pre-capture element; #18 Ctrl/⌘+J (or the pencil) while the saved line is showing does nothing, and the bar then closes: no fresh note; #19 "Noted in <project> · N open" shows the pre-save count first (N-1), because invalidate isn't awaited; #20 View on the saved line doesn't bring the Notes inbox into view (prototype scrolls to it); #21 Closing capture mid-save then reopening lets the old save hijack the new session (text wiped, bar auto-closes)
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: bdf35470066f0740932c1a8fdfd446e3910ea008
- Landed since: 13
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 42fb5a4ee9b599a2e3713abd7542241a1eeeac78
- Landed since: 9
- Outcome: done

### Lap 2 · review

- Reviewed commit: b5712192853e13d37700d704dd55f84104069295
- Landed since: 7
- Outcome: done

### Lap 2 · verification

- Reviewed commit: 876f0a1d40d68a36b42a3e8b533bf03c919763fd
- Landed since: 0
- Outcome: done

- **Saved line can overcount by one (N+2) when the SSE refetch lands before the optimistic setData bump** — open

## Notes record

- The UI is pretty bad. This looks like a school project.. — carried → lap 2
- Bad UI again.. And UX. When first opened, the focus is not on the text input, so I have to use the mouse to click on the input before typing — carried → lap 2
- And what is this?? Very bad UI — carried → lap 2
- The "Note" button at the top bar looks out of place too — carried → lap 2
- Create a prototype to show me how it should look — carried → lap 2

## Per-ticket digests

### Lap 1

#### 2. Project skill learns notes triage (triage.md reference + SKILL.md edits)

# ticket(2) — Project skill learns notes triage

## What was done

Content-only, entirely inside `packages/skills/packs/runcastle/skills/project/`.

- New `references/triage.md` (~180 lines, written in the skill's voice, matching
  `health-sweeps.md` as the closest pattern): what a project note is and why
  triage is not sorting; the three project-notes MCP tools; movement 1 (read
  every note **and** `Read` every `screenshotPath`, cluster into themes, play the
  grouping back and let the human correct it before any grilling); movement 2
  (grill theme by theme — one question at a time, always with a recommendation,
  consulting the portfolio as §1a requires — with drop / merge / reframe rules and
  "done when the intent is clear enough to route"); movement 3 (route to one of
  §2's five destinations carrying the grilled reasoning: a real brief with
  screenshots named by absolute path; ONE batched `create_feature({ title,
  oneLiner, tickets })` per triage session with each ticket string carrying its
  note's `attachmentSentence` verbatim; handoff lines for revisit / another lap;
  `dropped: <why>` for nothing). Then a table pinning the five outcome-line
  formats, the rule that `featureId` is passed whenever the destination is a
  feature (`create_feature` returns `id`), deferral via `update_project_note`,
  skipped notes staying open, and "never create work the human has not
  confirmed".
- `SKILL.md`: "Your tools" is now **Eight** with the three new tools listed and a
  sentence that they are registered for this kind only; "Two procedures load on
  demand" → **Three**, naming `./references/triage.md`; §0 gained the two things
  that displace the default opening question (a triage briefing → load the
  reference and start movement 1; a "This project has N open notes" prompt line →
  offer triage in the opening line, load the reference if they take it); §2's
  quick-change rule notes it widens to one batched quick change per triage
  session; and a short unnumbered `## Notes triage` section sits between §6 and
  §7 pointing at the reference.

Deviation, deliberate: the new section is **unnumbered** rather than a new §7.
Numbering it would have renumbered the closing move and forced edits to the "§7"
cross-references in `SKILL.md` and `references/charter.md`; the ticket asked for a
"`## Notes triage` section", so it is titled exactly that.

Also deliberate: outcome lines are pinned in the ticket's plain form
(`→ new feature <title>`), not `decisions.md` #8's italicised `*X*` — the line is
stored verbatim and rendered in the inbox, so stray asterisks would show.

## Surprises

- **The Codex runtime copies only `SKILL.md`, never `references/`**
  (`packages/server/src/launcher/runtimes/codex.ts:337` `writeCodexSkills`). So a
  project session on Codex cannot load `triage.md` — exactly as it already cannot
  load `charter.md` or `health-sweeps.md`. Pre-existing and out of this ticket's
  scope, but it means triage as specced works on the Claude Code runtime only.
- **`packages/skills/packs/README.md` now has a stale layout tree** — it lists
  `project/references/` with only `charter.md` and `health-sweeps.md`. Acceptance
  criterion 5 forbids touching anything outside the project skill dir, so it was
  left alone. One line to add whenever that fence lifts.
- **Baseline drift.** The prompt's baseline said 118 files / 1768 tests; the suite
  actually runs 264 files / 3825 tests.

## Verification

- `bun run typecheck` — exit 0 (core, server, web, scripts).
- `env -u GIT_ASKPASS bun run test` — 262 files passed, **1 failed**:
  `packages/server/test/dev-pane.test.ts:183` ("the process group must be gone" —
  `pidAlive(-pgid)` still true). Confirmed on a single targeted re-run of that one
  file; it is a process-group-reaping property of this container and cannot be
  reached by a markdown-only diff in the skills pack.
- Drive machinery: no edit needed — this ticket adds no service, no required env
  var, no seed and no process, so `.runcastle/drive-setup.ts` / `drive-stop.ts` are
  already covered. I did not run them (no services in this sandbox); I only
  established that nothing in the diff triggers the standing instruction.

## Left undone

- The README layout tree above.
- The three tools are described here exactly as the ticket specified them; if the
  parallel tools ticket lands different field names (`screenshotPath`,
  `attachmentSentence`), `triage.md` and the `SKILL.md` tool bullets need a
  matching word-level fix.
- `SKILL.md`'s framing lines ("You are an advisor, not a griller", §1b's "this is
  not a grilling", and the Do NOT bullet "never run an ideation grilling") were
  left untouched. `triage.md` scopes its grilling explicitly to intent rather than
  design, so it stays on the right side of that prohibition — but if a real triage
  chat turns out to hedge about grilling, that Do NOT bullet is where to add the
  carve-out.

#### 4. Capture from anywhere: note popover, ⌘/Ctrl+J, titlebar button, palette entry, rail badge

# ticket(4) — Capture from anywhere

## What was done

Note capture now exists on every in-project screen and nowhere else. `NoteCapture`
(`apps/web/src/components/NoteCapture.tsx`) is the popover — one focused line, a
pasted screenshot as a removable thumbnail, Enter saves, Escape discards, empty
text does not save. It is mounted by `ProjectShell`, which is what makes it absent
on the portfolio home, and all three doors (titlebar **Note** button, ⌘/Ctrl+J,
the ⌘K **New note** row) set the same shell flag. `apps/web/src/lib/project-notes.ts`
holds `uploadProjectNoteScreenshot` and the `isNoteHotkey` predicate; the rail's
pinned project row carries the open count, hidden at zero, and `lib/live.ts`
invalidates `projectNotes` on every stream frame.

Two deviations from the ticket's sketch, both small. The popover runs on the shared
`Dialog` primitive rather than a hand-rolled floating panel, because STYLE.md makes
that a house rule — that is where Escape-discards, focus-on-open and focus-restore
come from. And "Saved · N open" is shown *in* the popover for 2.5s before it closes
itself, rather than after it closes: decision #10 says the popover confirms, the
count has to stay clickable, and a second floating surface would have been a new
hand-rolled overlay for one line of text.

The terminal half was done in `terminal-keys.ts` rather than with a capture-phase
window listener. Verified against the installed xterm build: `_keyDown` calls the
custom handler first and returns early on `false`, *before* its own
preventDefault/stopPropagation — so swallowing the chord there both keeps Ctrl+J's
LF out of the PTY and lets the event reach the shell's ordinary bubble-phase
listener. A capture-phase listener alone would have opened the popover and *also*
submitted whatever was in the Claude prompt.

## Surprises

- The ticket points at "the pencil icon from `apps/web/src/icons.tsx`". There isn't
  one — `IconPencil` is new in this diff.
- `imageOnClipboard` was private to `components/review/NoteComposer.tsx` and is
  exactly what a second capture surface needs, so it moved to `lib/reviews.ts`
  beside `toPngBlob`. `note-composer.test.tsx`'s module mock had to stop replacing
  the whole module.
- Adding a query to `ProjectRow` broke two existing Sidebar-rendering tests
  (`intake-copy`, `sidebar-delete`) whose tRPC mocks are exhaustive object
  literals; both needed a `projectNotes.openCount` stub. Anything that mounts the
  rail in future will need the same.
- `platform.ts` only knew how to spell ⌘K. `modKeyLabel` now delegates to a
  `shortcutLabel(key, …)` so the modifier is written once and the Note button can
  say ⌘J / Ctrl+J.
- The prompt's baseline ("118 files, 1768 passed") does not describe this repo —
  the suite is 270 files / 3856 tests. `packages/server/test/dev-pane.test.ts`
  ("kills the child process tree") fails here and failed the same way in isolation;
  it is the PTY process-group cleanup fault ticket 1 already reported, it is server
  code, and this diff touches no server code. Everything else is green:
  `bun run typecheck` 0 errors, `env -u GIT_ASKPASS bun run test` 1 failed /
  3820 passed.

## Left undone

- The Notes card and the inbox are ticket 5's; the "Saved · N open" count navigates
  to the project chat door (`selectProject`), which is where that card will land.
- Drive machinery needed no change: this adds no service, env var, seed or
  companion process. I checked that `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` exist and parse (`bun build --no-bundle`); I did not
  run them, as the sandbox has no app or services.
- The popover has no "attach from disk" button — the review composer has one, but
  the spec says plain image paste only, so it was left out deliberately.
- Re-pasting over a staged picture replaces it silently. The review composer asks
  first; here the popover lives for seconds and nothing is saved yet, so the
  question would cost more than the mistake.

#### 5. Notes inbox card + 'Triage N notes' launches a briefed triage chat

# ticket(5) — Notes inbox card + a briefed triage chat

## What was done

`launchProjectSession` takes `input.purpose: 'triage'`. It forces the launch fresh (it clears
the resume row id before anything reads it, so a `resumeSessionId` passed alongside it is
ignored) and swaps the per-kind kickoff for a new explicit one, `projectTriageKickoffFor`,
which lives beside the other per-runtime kickoff spellings in `launcher/runtimes/skills.ts` so
the `/runcastle:project` skill reference cannot disagree with the CLI reading it. The purpose
rides through `project.talkToProject` as `z.literal('triage').optional()`. `ProjectBrief` gained
a required `openNotes: number`, counted at launch from the project-notes service, and
`renderProjectPrompt` appends `This project has N open notes — offer to triage them.` to its
task section only when N > 0.

On the web side, `apps/web/src/components/project/NotesCard.tsx` is new and sits between
`NewChatCard` and `ConversationList`. It renders nothing at all until the project has had a
note; open notes are sorted newest-first in the component (not trusted from the server's
order) with a thumbnail that opens the existing review `Lightbox`, inline edit in a textarea
(Enter saves, Escape cancels), Dismiss and Delete; triaged notes sit in a `<details>` labelled
`Triaged (N)` carrying each outcome line, a link to its feature and Reopen. `useProjectTalk`
gained `triage()` and a `replace(purpose?)` that carries the purpose across the
end-then-relaunch (held in a ref, because the relaunch happens in `endSession`'s callback).

Three deviations worth naming. **(a)** The ticket said the prompt render is pinned by
`packages/server/test/launch-artifacts.test.ts`; it is not — the `renderProjectPrompt` cases
live in `packages/server/test/project-session.test.ts`, so the new assertions went there and
`launch-artifacts.test.ts` only had its three `projectBrief` fixtures widened. **(b)** The
feature link is a plain `<a href={pathFor(...)}>` rather than an in-app selection: navigation
is prop-drilled from `ProjectShell`, which the ticket forbids touching, and nothing in the
workspace can select a feature. It is a real address the shell resolves at mount, so it works
(with a reload) and is linkable. **(c)** Delete has no confirmation dialog, unlike the feature
test-note delete — the smaller reading of "delete works on open notes", and a ten-second note
is cheap to re-jot.

The Triage button is `ghost`, not `solid`: STYLE.md allows exactly one solid button per view
and `NewChatCard`'s "New chat" already is it in this same resting page.

## Surprises

- `packages/server/test` is **not** typechecked (`packages/server/tsconfig.json` includes only
  `src`), which is why the existing `projectBrief` fixtures were already missing the required
  `base` field. `apps/web/test` **is** typechecked.
- `SessionPurpose` in core is a persisted enum (`resolve-conflict`) wired into the session row
  and the edit guard. Adding `triage` to it would have rippled into core's schema and the DB
  column for no gain, so the triage purpose is a local literal on `launchProjectSession`'s own
  input and is not stored on the session row.
- Rendering `ProjectWorkspace` in a happy-dom test works fine even though it statically imports
  `TerminalView` (and through it xterm plus its CSS) — the terminal is only constructed in an
  effect. But with a live session the resting list is behind `hidden`, so a test has to click
  `← Conversations` first to reach the card, exactly as a human does.
- `bun run test` has **one** failure that is not mine:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is
  not orphaned` — a process-group reaping fault in this sandbox, confirmed on a single targeted
  run of that file alone. Ticket 1's digest reported the same class of failure. My diff touches
  no PTY, dev-pane or process code. Everything else is green: 267 files / 3811 tests passed,
  and `bun run typecheck` is 0 errors.

## Left undone

- The badge on the rail's pinned project row and the capture popover/hotkey are tickets 3 and 4;
  the card deliberately invalidates the whole `projectNotes` router on every mutation so the
  badge moves with it once that lands.
- `live.ts` was not touched (ticket 4 owns it), so until its `u.projectNotes.invalidate()`
  arrives the card refreshes on its own tRPC poll rather than off the SSE stream.
- No drive-machinery change was needed or made: this ticket adds no service, no required env
  var, no seed and no companion process. `.runcastle/drive-setup.ts` and `drive-stop.ts` both
  still exist and are unreferenced by this diff; I did not run them (no services in the sandbox).
- A one-click "note → quick change" promote stays out of scope (decisions #12), and nothing in
  the card creates work.

#### 7. Claude triage sessions are not pre-authorized to call the project-note tools

# ticket(7) — pre-authorize the project-note MCP tools

## What was done

Added the three notes-triage tools to `RUNCASTLE_MCP_ALLOW_RULES` in
`packages/server/src/launcher/artifacts.ts`: `mcp__runcastle__list_project_notes`,
`mcp__runcastle__triage_project_note`, `mcp__runcastle__update_project_note`, with a
comment in the file's existing voice explaining that they are project-only at the MCP
server (so inert for every other kind, exactly like the `create_feature` trio above them)
and that an un-allowed `list_project_notes` stalls a triage chat on a permission prompt
before triage says its first word. Pinned it with an assertion in
`packages/server/test/launch-artifacts.test.ts` beside the existing per-group assertions —
written red first (it failed on the missing three), then green. No deviation from the
approach the ticket described; the change is those two files and nothing else.

I re-ran the reviewer's repro step exactly: rendered settings for a `project` session and
inspected `permissions.allow`. Before the change the three names were absent (the new test
failed listing them as missing); after it, all three are present — printed `ALLOWED` for
each. The second half of the repro (launching a real Claude triage chat and invoking
`list_project_notes`) is not runnable in this sandbox — there is no app, no Claude Code
session — so the rendered-settings half is the check that was actually performed.

## Surprises

`bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` is 272 files /
3839 passed with **one** failure: `packages/server/test/dev-pane.test.ts:183`, which
asserts a spawned process group has been reaped (`pidAlive(-pgid)` → false) and gets
`true`. It is not in the prompt's baseline, but it is not mine: both the test file and
`packages/server/src/pty/dev-pane.ts` are byte-identical to the pre-change commit
(`git diff bdf35470` → 0 lines each), and it fails the same way on a targeted solo run.
It is the container failing to reap a process group, not a code defect — worth adding to
the stated baseline for later tickets on this branch, since it will cost every one of them
a confirmation run.

Also worth knowing: `RUNCASTLE_MCP_ALLOW_RULES` is *not* a mirror of the registered tool
roster. `resolve_finding`, `review_drive`, `report_finding` and `add_test_note` are all
registered in `mcp/server.ts` but absent from the allow list, so the same class of stall
exists for them. Out of this ticket's scope, left alone.

## Left undone

- The gap above (allow list vs. `TOOL_AUDIENCES` roster drifting apart). Nothing keeps the
  two in sync, and each new tool has to remember this file by hand — a test that derives
  the expected rules from the roster would end the class of defect, but that is a design
  change the ticket did not ask for.
- Drive machinery: no edit needed and none made. This change adds no service, no required
  env var, no seed, and no process the dev environment must run — it only lengthens a list
  of permission strings baked into a rendered `settings.json`, so the existing idempotent
  `.runcastle/drive-setup.ts` covers it unchanged. I did not run the drive scripts (no
  services in this sandbox); I verified only that the change has none of the four triggers.

#### 8. Codex project sessions cannot load the required notes-triage procedure

# ticket(8) — Codex project sessions can now load the triage reference

## What was done

`writeCodexSkills` (`packages/server/src/launcher/runtimes/codex.ts`) copied only each
skill's `SKILL.md` into `.agents/skills/<name>/`. It now copies the whole skill
directory with `cpSync(..., { recursive: true })`, so every on-demand
`references/*.md` lands beside its `SKILL.md`. The "a directory with no `SKILL.md`
is not a skill" gate and the `.git/info/exclude` behaviour are unchanged; the
returned file list (which becomes the launch spec's `files`) is now the recursive
listing of what was written, via a small local `filesUnder` walker. The
now-redundant `mkdirSync` before the copy was dropped — `cpSync` creates the
target tree itself.

A test was added at the existing seam (`packages/server/test/launch-artifacts.test.ts`,
`codexRuntime.writeArtifacts`): it writes artifacts for a Codex **project** session and
asserts `references/triage.md` and `references/charter.md` are in `spec.files` and on
disk beside `SKILL.md`. It was red before the fix, green after.

**Re-ran the reviewer's repro step verbatim.** I drove the real `codexRuntime.writeArtifacts`
for a project session against a temp worktree and listed `.agents/skills/project/`: it now
contains `SKILL.md`, `references/triage.md`, `references/charter.md` and
`references/health-sweeps.md`, and following SKILL.md's Notes-triage instruction reads
triage.md successfully (8737 bytes, first line "# Notes triage — the pile the human
jotted"). The repro no longer reproduces.

## Surprises

- The bug was **not** new with this feature. `project/references/charter.md`,
  `project/references/health-sweeps.md` and `prepare/references/recipes.md` already
  existed and were equally missing from every Codex worktree — triage.md just made the
  gap load-bearing. Copying the whole directory fixes all four at once, which is why the
  fix is dir-shaped rather than triage-specific.
- The stated verify baseline in the prompt is stale for this branch: the suite is
  272 files / 3876 tests, not 118 / 1768.
- `bun run typecheck` is clean (exit 0). `env -u GIT_ASKPASS bun run test` has **one**
  failure, `packages/server/test/dev-pane.test.ts` "the process group must be gone"
  (`pidAlive(-pgid)` still true after kill). Confirmed on a single targeted re-run of
  that one file. It is a process-group reaping quirk of this sandbox and is untouched by
  this diff, which only edits `codex.ts` and `launch-artifacts.test.ts`.

## Drive machinery

No edit needed and none made: this change adds no service, no required env var, no seed
and no extra process — it only changes which files a launch copies into a worktree. I
did not run `.runcastle/drive-setup.ts` or `drive-stop.ts` (no services here to run them
against) and made no change that would alter them.

## Left undone

- The Claude adapter path was not examined for the same gap; it passes the plugin dir
  through directly, so references travel there already, but I did not prove it.
- Nothing prunes stale `.agents/skills/<name>/` entries from a worktree when a skill or
  a reference is deleted from the pack — a relaunch overlays the new files onto the old
  ones. Out of scope here, worth a look if the pack ever loses a file.

#### 9. The project Notes card duplicates the review-note thumbnail instead of using a shared primitive

# ticket(9) — one shared note thumbnail

## What was done

The project Notes card and the review work list had the same note thumbnail written
out twice: the same `<button>`, the same `<img>`, the same 96×54 dimensions, hairline
border, hover colour, `title="see the whole picture"` and alt text. That is exactly
what `apps/web/STYLE.md`'s Primitives rule forbids ("Build one there rather than
styling the same thing twice in two surfaces").

`NoteThumbnail` now lives in `apps/web/src/ui.tsx` — the shared-primitives file, not
`src/ui/`, which STYLE.md reserves for the four floating primitives — and both
`components/review/NoteRow.tsx` and `components/project/NotesCard.tsx` render it. It
takes a **nullable** url and renders nothing without one, which was a small deviation
from the literal "extract the markup" reading: both call sites had also duplicated the
`picture && (...)` guard, so folding that into the primitive removed the guard as well
as the markup and let `NoteRow` drop a now-dead local. A catalogue row was added to
STYLE.md beside `NoteAuthorChip`, since that table documents every primitive in
`ui.tsx`.

New tier-1 test `apps/web/test/note-thumbnail.test.ts`: the thumbnail's markup, that
it renders nothing without a url, and — the anti-duplication assertion itself — that
`NoteRow`'s output contains the bare primitive's own markup while neither surface file
still contains the `h-[54px]` class string.

**I re-ran the reviewer's repro step.** Comparing `NotesCard.tsx` `NoteLine`'s picture
rendering against `NoteRow.tsx`'s: both are now a single `<NoteThumbnail ... />` line
importing from `../../ui`, and a repo-wide grep finds the class string only in
`ui.tsx`. The repro no longer reproduces, and the test encodes it so it cannot come back.

## Surprises

- **React's preload hoist.** `renderToStaticMarkup` emits a `<link rel="preload"
  as="image">` ahead of whichever render is outermost, so a bare `NoteThumbnail`
  render and the same thumbnail inside a `NoteRow` are not string-comparable
  end-to-end. The test compares from `<button` on; the comment in it says why.
- **One unrelated test fails, and it is not mine.** `packages/server/test/dev-pane.test.ts
  > "kills the child process tree so the port-holder is not orphaned"` fails on
  `expect(pidAlive(-pgid)).toBe(false)`. I confirmed it on a single targeted run of
  that one file — it fails in isolation too. My diff is five files, all under
  `apps/web`, and touches nothing in `packages/server`; the assertion is about POSIX
  process-group reaping, which is a container behaviour. The prompt's baseline claims
  a fully green suite, but that baseline is also stale in its counts (it says 118
  files / 1768 tests; this branch now runs 273 files / 3878 tests), so I read this as
  environmental rather than as a regression. `bun run typecheck` is clean, and every
  other test passes — 3842 passed, 1 failed, 35 skipped.
- The existing `project-notes-card` and `note-row` tests both kept passing untouched,
  which is the useful signal that the extraction changed no rendered output.

## Left undone

- **A second, different thumbnail pair.** `components/NoteCapture.tsx:191` and
  `components/review/NoteComposer.tsx:83` carry their own near-identical `h-[54px]
  w-24 rounded-sm border border-hairline bg-black object-cover` — but as a bare
  `<img>` preview of the screenshot you just pasted, with no button, no hover border
  and no lightbox. It is a preview of an unsaved paste rather than a door onto a
  stored note's picture, the review did not report it, and the ticket's citation names
  only the NoteRow ↔ NotesCard pair, so I left it. If someone wants it shared later,
  it is a *different* primitive from `NoteThumbnail`, not a third caller of it.
- **Drive machinery: checked, no edit needed.** This change adds no service, no
  required env var, no seed and no process — it is one web component extraction — so
  the `.runcastle/` steps are already covered. I confirmed `drive-setup.ts` and
  `drive-stop.ts` are both present; I did not run them, per the "check it, never run
  it" instruction.

#### 10. Project-note screenshot routes duplicate the existing test-note upload and download pipeline

# ticket(10) — one screenshot pipeline for both kinds of note

## What was done

The project-note screenshot routes in `packages/server/src/routes/reviews.ts` were a
line-for-line copy of the test-note pair: the same PNG-signature check and 400 reply, the
same `fileSize` / `content-length` header construction, the same zero-byte-versus-stream
branch. Both pairs now run through two shared handlers, `receiveScreenshot` and
`serveScreenshot`, parameterised by a small `NoteScreenshot` record that holds all either
kind actually contributes — how to find the row an id names (`getNote` / `getProjectNote`),
where that row's PNG lives (`annotationPath` / `projectNotePath`), and how to record
uploaded bytes (each service's `attachScreenshot`). The four route registrations stay
explicit and literal so the paths remain greppable and Hono still types `:noteId` from the
route constant; each is now a one-line delegation.

No behaviour changed: same status codes, same headers, same response bodies, same 404 for
an unknown id and 400 for non-PNG bytes. The walkthrough-video route was deliberately left
alone — it serves a different contract (byte ranges, `video/webm`) and the ticket cited only
the screenshot pair.

I re-ran the reviewer's repro step verbatim — comparing the project-note handlers against
the test-note ones for duplicated `isPng` error handling and `fileSize` / header /
`fileStream` logic. It no longer reproduces: there is exactly one `isPng` rejection branch,
one image header construction and one screenshot `fileStream` call in the file, and the two
kinds of note differ only in the three functions they supply.

## Surprises

- A doc comment describing "the note this id names … so a URL segment never reaches the
  filesystem" had come loose from its function in an earlier edit and was sitting above
  `PNG_MAGIC`, where it documented nothing. Rather than leave a misleading floating comment
  next to new code, I folded its point into the `path` field's doc on the new interface.
- The verify baseline in the burn prompt (118 files, 1768 tests) is stale for this branch:
  the suite is now 272 files / 3875 tests.
- `bun run typecheck` is green. `env -u GIT_ASKPASS bun run test` has **one** failure,
  `packages/server/test/dev-pane.test.ts` — "the process group must be gone" after a
  dev-pane kill. I confirmed it on a single targeted run of that one file. It is pre-existing
  and environmental (process-group reaping in this container), from commit `ce376600` outside
  this run; my diff touches only `routes/reviews.ts`, which that test does not import.
- The first `git commit` had its sync push rejected as "stale info"; a plain retry of the
  push succeeded, and the mirror now matches local `HEAD`.

## Drive machinery

Nothing to update. This ticket adds no service, no required env var, no seed and no process
the dev environment must run — it is a pure refactor inside one already-mounted route file —
so none of the `.runcastle/` triggers fire. I did not run the drive scripts (correctly, per
the standing instruction).

## Left undone

- The walkthrough-video GET still has its own `fileSize` / header / `fileStream` sequence.
  Merging it with the screenshot path would mean threading range handling and content type
  through the shared helper for one caller each — worth more than it costs only if a third
  media route ever appears.
- No test was added: this is a behaviour-preserving refactor, and both route pairs are
  already covered at the seam (`project-notes-http.test.ts` and the screenshot block of
  `review-artifacts.test.ts` — 24 tests, all green after the change). The zero-byte-file
  branch in `serveScreenshot` remains untested, as it was before.

#### 11. Verify the fixes that landed

Gates verification pass

Verified the four fixes landed after pass #6 against their original findings and repro steps on `feature/project-notes-jot-it-anywhere-triage-it-in-the-project-chat`.

- Ticket #7 held: `RUNCASTLE_MCP_ALLOW_RULES` now includes `mcp__runcastle__list_project_notes`, `mcp__runcastle__triage_project_note`, and `mcp__runcastle__update_project_note`; the launch-artifacts seam asserts all three are rendered into `permissions.allow`.
- Ticket #8 held: `writeCodexSkills` now recursively copies each complete skill directory and reports the recursively written files. The project skill contains `references/triage.md`, `references/charter.md`, and `references/health-sweeps.md`, and the launch-artifacts seam checks that the triage and charter references exist beside `SKILL.md` in a Codex project worktree.
- Ticket #9 held: `NotesCard` and `NoteRow` now both render the shared `NoteThumbnail` primitive from `apps/web/src/ui.tsx`. The duplicated thumbnail class string occurs only in that primitive, and the focused test guards both usage and no-image behavior.
- Ticket #10 held: test-note and project-note screenshot routes now delegate to shared `receiveScreenshot` and `serveScreenshot` handlers, parameterized only by row lookup, path resolution, and attachment. The PNG rejection, response headers, and file-streaming logic each occur once.

No verify commands are configured, so there were no automated gates to run. No landed fix failed verification, and no plainly broken touched surface was found in the diff inspection.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: All four landed fixes close their reported repros; no verify commands were configured.

### Lap 2

#### 12. Capture redesign: palette-shaped bar, icon titlebar button, in-place saved line, focus on every open

# Ticket 12 — capture redesign

**What was done.**
- Rebuilt `NoteCapture` to look like the prototype. It opens top-centre at the ⌘K palette's width and 12vh offset, over a light scrim (0.28). It has one borderless 16px input with an accent pencil icon and no Save button.
- The footer strip sits on `panel-2` and shows "Paste a screenshot", or a thumbnail chip with a working ×. Then comes "to <project>" and the ↵ save / esc close hints.
- After a save the bar shows "Noted in <project> · N open" and a View link that opens the inbox. The scrim goes clear at once and stops catching clicks. The bar closes itself after 1500ms.
- `projectName` is a new required prop, passed from ProjectShell (`nav.currentProject?.name`).
- The focus bug (decision #18) is fixed at the root. The reset now runs during the render that opens the bar (a `wasOpen` check), not in an effect, so the input exists when Dialog's focus effect runs. There are no timers.
- The reopen test was written first and failed on the old code, where the panel got the focus.
- The titlebar Note door is now an icon-only `size-8` ghost pencil like Settings. It has the title "Jot a note (⌘J/Ctrl+J)", `aria-label`, and `aria-pressed`. It uses the `bg-accent-soft` / `text-accent-hi` tint while a new `noteOpen` prop (from ProjectShell's `capturing`) is set.

**Deviation / surprise.**
- I changed the shared `Dialog` primitive (`ui.tsx`) where the ticket expected `backdropClassName`. Dialog's own `bg-bg/70` and `pt-[8vh]` would clash with any background or padding passed that way. Without tailwind-merge, which of two such classes wins depends on how Tailwind happens to order them.
- So Dialog gained a `palette` size (560px, and the backdrop moves to 12vh) and a `scrim` lookup (`dim` default / `light` / `none`). The `none` value makes the backdrop ignore clicks and lets the panel take them. Both are documented in STYLE.md.
- ⌘/Ctrl+J from a terminal is tested with a small stand-in shell (a textarea plus the real `isNoteHotkey` listener). It checks the input takes the focus on two opens in a row. The terminal-side swallowing is already covered by terminal-keys.test.ts.
- The first commit sync failed with "stale info". Fetching the remote-tracking ref and re-pushing fixed it.

**Test status.** Typecheck is clean. In the full suite 3849 tests passed and 1 failed: `packages/server/test/dev-pane.test.ts` "kills the child process tree so the port-holder is not orphaned". It fails the same way when run alone. This diff touches only `apps/web`, so it looks like a sandbox process-handling fault, not a regression. It is not in the stated baseline, though.

**Left undone.**
- The saved line has no "Saving…" state; the old Save button showed one.
- The drive machinery did not need changing (UI only, no new services or env vars).

#### 13. Inbox redesign: Notes card as a dense list with hover/focus actions

# Ticket 13 — Notes card as a dense list

**What was done.** I rebuilt `NotesCard.tsx` from the prototype's `#notesPanel`. The header now holds an `h3` "Notes", an open-count pill (hidden at 0, `title="N open"`), one subtitle line, and a "Triage N" button. The label changed from "Triage N notes" to the bare count, so `project-triage-launch.test.tsx`'s button names were updated to match. The old SectionTitle above the card and the explanatory paragraph are gone. Each open note is one grid row: a `NoteThumbnail size="sm"` (40×26) or a quiet accent-line dot, then the text, then the mono relative time. Edit, Dismiss and Delete are icon buttons (`aria-label` and `title`) that sit at `opacity-0` and become visible on `group-hover` / `group-focus-within`, taking the time's place. They are always in the tab order and use the global `:focus-visible` ring. Delete turns `hover:text-danger` only on hover. Edit is an inline `<input>`: Enter saves, Escape cancels. There are no Save or Cancel buttons any more. Triaged notes sit in a `<details>` with a "N triaged" summary and a rotating chevron. Each row shows the text dimmed, the outcome line with the feature link, and a Reopen icon revealed the same way. Triaged rows keep a small thumbnail when they have one, which differs from the prototype: it keeps the frozen record's picture reachable.

Shared additions:
- `NoteThumbnail` gained `size: 'md' | 'sm'`. `md` has the same classes as before, so the review NoteRow is unchanged.
- `Button` gained an `accent` variant (the violet ghost) rather than overriding ghost's border with className, because clashing utilities resolve by the order Tailwind emits them, not the order they are written.
- `icons.tsx` gained `IconTrash` and `IconUndo`.
- The STYLE.md catalogue documents the variant and the size.

**Surprises.** The post-commit sync push failed with "stale info" because the clone had no remote-tracking ref for the `--force-with-lease`. I fetched that ref and pushed, and the mirror is now at HEAD. In the full suite, `settings-dialog.test.tsx` timed out under load; it passes on its own. `packages/server/test/dev-pane.test.ts` ("kills the child process tree") fails even when run alone. It is server process-group code this web-only diff does not touch, so it looks like a sandbox environment fault rather than a baseline failure.

**Left undone.** The card is not shown in the browser, and nothing checks that the hover and focus reveal actually looks right. There were no drive-machinery triggers.

#### 15. Notes row icons never take their colours: Delete never turns red, resting icons aren't muted (button { color: inherit } beats text-* on the button)

## What was done
- `RowAction` in `apps/web/src/components/project/NotesCard.tsx` no longer puts colours on the `<button>`. The resting `text-text-3` and the hover tone (`text-text`, or `text-danger` for Delete) now sit on a `<span>` inside it. This matches Titlebar and NoteCapture.
- The tone needs the button's *own* hover. The row `<li>` already uses the unnamed `group`, so the button is the named group `group/act` and the span uses `group-hover/act:text-*`. Background, disabled and cursor utilities stay on the button: the legacy rule only sets `color` and `font-family`.
- The card's tier-2 test now checks this. No verb button carries a `text-text`/`text-danger` utility. The button is `group/act`. The inner span carries `text-text-3` and `group-hover/act:text-danger` (Delete) or `group-hover/act:text-text` (Edit). Delete is still not red at rest.

## Repro re-run
No browser drive was possible in this sandbox, so I re-ran the repro against the built stylesheet instead of devtools. `vite build` produced `.group-hover\/act\:text-danger:is(:where(.group\/act):hover *){color:var(--color-danger)}`, which targets the span. Nothing unlayered in `styles.css` targets `span` or `svg`, so no rule overrides it, and the icons draw with `currentColor`. So hovering the trash icon should now turn it red, and resting icons should be muted. Nobody has seen this on screen yet; a short human drive would confirm it.

## Surprises
- The full suite had 2 failures, both in server process-teardown tests, outside this web-only diff:
  - `dev-pane.test.ts` ("kills the child process tree") also fails on its own. Ticket 14's implementers reported the same failure in their sandboxes.
  - `pty-teardown.test.ts` passes on its own and only failed under full-suite load.
- `bun run typecheck` is clean.
- The post-commit sync push was rejected ("stale info") because the clone had no up-to-date tracking ref for the branch. Fetching that ref and pushing again fixed it; the mirror is now at the new commit.

## Left undone
- The Triage button's violet ghost variant has the same `button { color: inherit }` problem, according to ticket 14's review. That is a separate fix ticket, and I did not touch it.

#### 18. Ctrl/⌘+J (or the pencil) while the saved line is showing does nothing, and the bar then closes: no fresh note

## What was done

A second Ctrl/⌘+J (or pencil, or palette "New note") while capture is already up now reaches the bar. `ProjectShell` counts every door press (`jots`, bumped by `jot()`, which the hotkey listener now also calls) and passes it to `NoteCapture` as the new optional `openRequest` prop. When that count changes during the saved confirmation, `NoteCapture` resets to a fresh empty note during render. That unmounts the confirmation, and its 1.5s close timer is cancelled with it. An effect keyed on `openRequest` then focuses the input. If the press lands while a line is half-typed, the text is kept and only the cursor goes back, as the prototype's `openCapture()` does (notes-ui.html:342).

Repro re-run as a component test (`apps/web/test/note-capture.test.tsx`, "pressed again while the bar is up"): Ctrl+J, save a line, Ctrl+J again 500ms later. The result is an empty input with focus, and the bar is still up 2s later. The same test fails against the pre-fix `NoteCapture`. There is also a second test for the half-typed case. No browser drive: the sandbox has no app.

## Surprises

- The post-commit sync push was rejected ("stale info") because there was no remote-tracking ref for the lease. Fetching the branch and pushing again fixed it.
- In the full suite, 6 tests failed outside this diff. On a targeted re-run, settings-dialog, settings-models, mcp-large-batch and projects passed, so they look like load flakes. `packages/server/test/dev-pane.test.ts` ("kills the child process tree") fails consistently in this sandbox. Earlier implementers reported the same; it is server-only.

## Left undone

- Drive machinery is untouched: this change is web-only, with no new service, env var, seed or process.

#### 21. Closing capture mid-save then reopening lets the old save hijack the new session (text wiped, bar auto-closes)

## What was done
Ticket 21 fixed the capture race. `NoteCapture` now keeps a session counter (a ref), which goes up each time `open` flips, in the same render-time reset block that ticket 14 added. `submit` records the session it started in. After its awaits it sets `saved` and clears `saving` only if that session is still the current one. The note is still saved, and the open count still gets its bump and invalidate, because the note really exists. If the bar was closed or reopened in the meantime, the late save does not show the confirmation and does not start the auto-close timer. The new session's `saving` flag is not touched either, so the fresh line can be saved at once. This is the approach the ticket suggested. One commit on the ticket branch.

## Repro re-run
I re-ran the repro as a component test in `apps/web/test/note-capture.test.tsx`, "keeps a reopened bar when the save from an earlier open lands late". In it, `add` is held pending. The test types "a", presses Enter, closes, reopens and types "b". Then it lets the first request land and advances 2s. Before the fix it failed: "Noted in runcastle-demo · 3 open" replaced the input. After the fix the input still holds "b", `onClose` is never called, and a second Enter saves "b" and confirms normally. I did not drive it in a real browser with network throttling. There is no app or browser in this sandbox.

## Surprises
- The full suite has one failure, `packages/server/test/dev-pane.test.ts` "kills the child process tree…", in a server file this diff doesn't touch. It still fails when run on its own, and the implementers of ticket 14 reported the same failure in their sandboxes, so it looks like an environment issue.
- The first post-commit sync was rejected with "stale info", because the force-with-lease tracking ref was missing. A fetch of that ref followed by a push fixed it.
- Typecheck is clean.

## Left undone
- If the late save's screenshot upload fails, the toast still appears. That is the correct behaviour: it reports on a note that really exists.
- I made no change to the drive machinery. This is a web-only UI fix, so none was needed.

#### 22. Verify the fixes that landed

Lap 2 · gates mode · GATES FAILED · nothing verified — no verify gates configured and no drive in Gates mode; fixes checked by reading only, and #19's count bump can overcount by one when the SSE refetch lands first

Gates verification pass — pass #14's seven fixes (#15–#21) checked by reading each diff against its finding

No verify commands are configured for this project, so there were no gates to run. Nothing was driven in a browser. Every verdict below comes from reading the diffs on `feature/project-notes-jot-it-anywhere-triage-it-in-the-project-chat` against `main`, including the merged `NoteCapture.tsx` / `ProjectWorkspace.tsx`.

## Fixes that hold (by reading)

- **#15 Row icon colours**: the colour classes moved off the `<button>` onto an inner `<span>`. The button is the named group `group/act` (the row already uses the unnamed `group`), and the span uses `group-hover/act:text-danger` / `text-text`, with `text-text-3` at rest. The legacy `button { color: inherit }` no longer reaches the colour. **Holds.**
- **#16 Violet Triage label**: `text-accent-hi` left `BUTTON_VARIANT.accent`, and a new `BUTTON_LABEL` map wraps the children in a `display: contents` span that carries the colour. The button's layout is unchanged. Only the `accent` variant is affected. **Holds.** (The pre-existing `solid`/`danger` variants have the same problem. That was left alone on purpose and is out of scope here.)
- **#17 Focus yank on auto-close**: Dialog's cleanup now gives focus back to the opener only if focus was still the dialog's when it closed (null, body, detached, or inside the panel). Passive-effect cleanup runs after the panel has left the DOM, so a normal close (focus inside → body) still restores. A focus the human moved into the page stays put. **Holds.**
- **#18 Re-press over the saved line**: every door press goes through `jot()`, which bumps a `jots` counter passed down as `openRequest`. A render-time check resets to a fresh note when the saved line is showing, which unmounts the confirmation and clears its timer through the `[saved]` effect cleanup. An effect keyed on the request then focuses the input. A half-typed line is kept and only gets the cursor back. **Holds.**
- **#20 View brings the inbox into view**: `openInbox` selects the project and raises `inboxRequest`. The workspace leaves a live chat or transcript for its resting page. NotesCard runs `scrollIntoView({block:'center'})` once its section exists (the effect also waits for `hasNotes`), then clears the request. **Holds.**
- **#21 Stale save taking over a reopened bar**: a session ref goes up on every open/close edge. `submit` sets `saved`/`saving` only if its session is still current, and the note count bump and invalidate still run. The interaction with #18's `fresh()` (which doesn't bump the session) is safe: the saved state has no save in flight. **Holds.**

## Fix that mostly holds

- **#19 Pre-save count**: the first frame no longer shows N−1. But the fix adds 1 to whatever the cache holds, and `project_note.added` already makes live.ts refetch the active `openCount` query. With a screenshot attached, `submit` waits for the upload, so that refetch can write N+1 first and the bump then makes it N+2. The line can briefly read "· 4 open" where "· 3" is right. Reported as a low-severity defect (finding_MtwsSm1sxR1V). It stays open for the human.

## Still unseen

As in pass #14, nobody has checked on screen that the colours match the prototype (#15, #16) or that the hover/focus reveal looks right. A short human drive is still the only way to confirm these.

REVIEW-MODE: gates
REVIEW-VERDICT: unverified
REVIEW-REASON: no verify gates configured and no drive in Gates mode; fixes checked by reading only, and #19's count bump can overcount by one when the SSE refetch lands first
