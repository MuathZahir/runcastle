# Outcome — Flow redesign: project chat and creation doors

Redesign how work gets born end to end — the project conversation (list, branch-lands-on picker, reopen/transcript), the Quick change / Park a draft form, the draft body, and delete — walked and confirmed with the human before design.

- Shipped: 2026-09-02
- Lap: 1

## 1. Conversation identity and titles: one row per Claude Code conversation

# Ticket 1 — Conversation identity and titles

## What was done

`listProjectConversations` (packages/server/src/services/conversations.ts) now returns one row per
Claude Code conversation instead of one per session row. Sessions are grouped on `ccSessionId`
(`groupByConversation`), the row's `id` is the group's LATEST session (what Reopen hands back to
`talkToProject` as `resumeSessionId`), `status` is the latest session's, and `createdAt` is the
smallest non-null timestamp in the group — computed as a min rather than "take the oldest row"
because rows written before the column exists carry null. Sessions with no `ccSessionId` are
dropped entirely, so `resumable` is now always `true`; the field stays because the client reads it.

`deriveTitle` walks the kickoff-filtered turns instead of taking the first `user` turn: a new
`saidText` helper returns null for a turn starting `<command-name>`, for exactly
`[Request interrupted by user]`, and for one that is nothing but `[Image #n]` tokens, and otherwise
returns the text with those tokens stripped. No surviving turn → null, and the list's fallback is
the literal `"Untitled"` (the date-based `untitled()` helper is gone), uncached. A cached title that
starts with `<command-name>` or `[` is treated as absent, nulled in the DB via a new
`clearSessionTitle` in launcher/sessions.ts, and re-derived in the same pass. A group's title is
derived from and cached on its EARLIEST session — the conversation's real first words.

Tests: a new pure `deriveTitle` describe block plus five list-level tests (collapse, dating by first
launch, exclusion of never-picked-up rows, naming from the earliest session, junk-cache clearing in
both the re-derives and the nothing-to-re-derive case) in
packages/server/test/project-conversations.test.ts.

## Surprises

- Existing list tests all launched sessions that never recorded a `ccSessionId`, so the exclusion
  rule made most of that file's fixtures invisible. The `launch()` helper now stamps a cc id (which
  is what the SessionStart hook does a beat later anyway) and the seeded rows in the transcript
  describe got one too; that is why the diff touches tests it does not otherwise change.
- `bun run test` has one failure on this branch that is not mine and not in the prompt's baseline:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is not
  orphaned` (`expect(pidAlive(-pgid)).toBe(false)`). Confirmed on a single targeted run of that file
  alone; it is a process-group kill assertion, unrelated to conversations. Everything else is green
  (149 files, 2528 passed) and `bun run typecheck` is clean.
- The prompt's stated baseline (118 files / 1768 tests) is stale for this branch — the suite is 151
  files / 2533 tests now.

## Left undone

- The web client is untouched (server-only ticket), but note for the UI tickets: a just-launched
  live chat has no `ccSessionId` for a moment, so it is briefly absent from the list.
  `ProjectWorkspace.tsx`'s `titleFor(...) ?? 'project'` already tolerates that, but the "open
  conversation as the top row" behaviour in decision 7 will want to render the live session from the
  session state rather than assume the list carries it.
- Junk cached titles are only cleared on the group's earliest session — the one the list reads.
  Duplicate rows keep whatever junk title they were given; nothing reads them, and cleaning them
  would be a migration the ticket did not ask for.
- No drive-machinery change was needed: this ticket adds no service, env var, seed or process, so
  `.runcastle/` is untouched and nothing there was run (correctly — the sandbox has no app).

## 2. Workspace at rest: header, New chat card with landing menu, list, transcript pane

# Ticket 2 — Workspace at rest: header, New chat card with landing menu, list, transcript pane

## What was done

`BranchMenu` is now a primitive in `apps/web/src/ui.tsx`: an inline `<prefix> <branch> ▾`
trigger over a popover listbox, filtering `runcastle/*`, `worktree-*` and `afk/*` inside the
primitive, heading the detected main line off from the other local branches, and carrying the
one `missing` (gone-branch) state in the warn colour. `ProjectWorkspace.tsx` dropped from 344
lines to ~135 and now composes three new files under `components/project/` — `NewChatCard`,
`ConversationList`, `TranscriptPane` — plus the header line ("PROJECT · name" pill and "Chats
run on `runcastle/project` and land on `<branch>`."). The `SessionLanding` select, its grey
"applies to the next chat" note, the static branch chip and the whole `SessionFrame` ("What
every chat here already has") card are gone. The landing-branch wiring moved into a new
`lib/use-session-branch.ts` hook, which keeps the existing invalidation pair
(`project.sessionBranch` + `settings.get`) so the settings overlay still sees the write.
`ConversationTranscript` is rebuilt in Tailwind, renders assistant turns through the app's
`Markdown` component, and each of its four empty states is now one dim line.

Two deviations from the ticket's letter, both deliberate:

1. **The page stopped *using* `.ws-head` / `.ws-body` rather than deleting their rules.** The
   ticket listed `.pw-tag`, `.pw-consequence`, `.pw-frame*`, `.ws-head` and `.ws-title*` for
   deletion, but `PreparationWorkspace.tsx`, `Workspace.tsx` and `workspace/FeaturePanes.tsx`
   still render all of them, and those are other flows' surfaces. Deleting the rules would have
   silently unstyled three pages this feature does not own. So the project page lays out its own
   column in Tailwind (same width and gutter as the shell's rail, so nothing shifts sideways)
   and those rules stay for their owners. What did get deleted: every `.pw-landing*`,
   `.pw-newchat*`, `.pw-rest-*`, `.pw-convo*`, `.pw-reading*` and `.convo-*` rule, plus
   `.ws-branch.is-static` — 123 lines, ratchet lowered 4287 → 4164 and green there.
2. **`sessionBranchState` lost its `label` and `note` fields** (and `projectBranchNote` is gone
   entirely, with its tests). Both existed only to feed the copy decision 3 deletes; leaving
   them would have been dead prose in `lib/`.

## Surprises

- **`relTime` already existed** in `lib/format.ts`, so no relative formatter was added — the
  ticket allowed for either.
- **Escape was a shared key.** `BranchMenu` closing on Escape would also have closed the
  `Dialog` it sits inside, which is exactly where tickets 4 and 5 put it (Quick footer, draft
  bar). `Dialog` listens on `window` in the bubble phase and is mounted first, so
  `stopPropagation` from a second bubble listener was too late; the menu captures instead.
  There is a tier-2 test that goes red without the capture flag — I checked.
- **The `.md` legacy rules beat utilities on assistant bubbles.** `Markdown` renders into a
  `div.md`, whose unlayered rule sets font-size, colour and line-height. The bubble therefore
  sets only box utilities (border, background, padding, radius) and no type utilities that
  would be silently overridden. `.md` belongs to another flow, so it stays.
- **One test fails and is not mine:** `packages/server/test/dev-pane.test.ts` > "kills the child
  process tree so the port-holder is not orphaned" — a process-group reaping assertion in a
  server package this diff never touches. Reproducible on a targeted run in isolation; it is a
  sandbox fault. Everything else is green: `bun run typecheck` clean, 2539 passing.
- The prompt's baseline ("118 files, 1768 passed") is stale for this branch — the suite is now
  153 files / 2544 tests.

## Drive machinery

Checked, not run (the sandbox has no services or app). This ticket adds no service, no required
env var, no seed and no extra process — none of the four triggers — so `.runcastle/drive-setup.ts`
and `.runcastle/drive-stop.ts` need no edit. Both files exist at the paths the server's
configured commands name.

## Left undone

- **The list's `Open` action and the "New while a chat is live" notice** (decisions 7 and 12)
  are deliberately absent: they belong to the live-chat screen, which is ticket 3. The live
  branch of `ProjectWorkspace.tsx` is otherwise untouched and still carries `grill-panel`,
  `pw-session` and `pw-term`, whose rules I left in `styles.css` for that ticket to delete.
- **`ConversationList` shows an empty date cell when `createdAt` is null.** Rows predating the
  nullable-`created_at` migration will look slightly bare rather than saying "date unknown"
  (which the brief called out as noise). If ticket 1's backfill leaves any such rows in
  practice, they may want a dim placeholder.
- **`SectionTitle` still carries its `section-title` legacy hook**, so the CONVERSATIONS label
  is styled by a `styles.css` rule rather than its own utilities. That rule has raw callers
  elsewhere in the app; it retires with the last flow, per STYLE.md.
- `.pw-tag`, `.pw-consequence` and `.pw-frame*` are now used **only** by
  `PreparationWorkspace.tsx`. Whoever redesigns the preparation flow can take all four rules
  with them.

## 3. Live chat: the strip, the way back to the list, and the New-while-live notice

What was done
Built the live project-chat strip with Conversations back navigation, title, status, landing branch, short id, and End session.
Kept TerminalView mounted and hidden behind the list so its xterm buffer and socket survive navigation.
Made the open conversation sort to the top, with Open reattaching client-side and its title still opening the transcript.
Added the New-while-live notice and wired its replacement action to end first, then launch a fresh chat.
Removed the project terminal legacy CSS rule and lowered the stylesheet ratchet to 4162.
Added tier-2 component tests for the strip, back/Open behavior, transcript reachability, and both notice actions.

Surprises
PreparationWorkspace also consumed the project terminal height class, so its equivalent height moved inline before the class was retired.
The full suite had 12 unrelated server failures caused by sandbox state: GIT_PAGER rejection, vanished temp repositories, an inherited OAuth token, and process reaping.
Typecheck and all targeted project-chat/ratchet tests passed.

Left undone
No drive machinery changed because this ticket adds no service, boot environment variable, seed, or companion process.

## 4. Quick overlay: one line per mode, branch menu in the footer, Notes become the draft's brief

_no digest captured_

## 5. Draft body and delete dialog on the primitives

What was done
Rebuilt the parked draft body on Tailwind utilities with the PARKED glyph, title, one-liner, Markdown notes, and a concise No notes empty state.
Moved the draft base choice into the next-step bar as the shared BranchMenu beside Start.
Made an unpicked base render the warning “from …” trigger and disable Start with “pick a branch first”; Start still sends the selected baseBranch.
Rebuilt feature deletion on Dialog size sm and Field while preserving exact-slug arming, autofocus, focus return, busy state, and danger/ghost actions.
Removed all draft and delete-dialog legacy CSS and lowered the stylesheet ratchet from 4164 to 4115 lines.
Added render-seam coverage for both draft note states and the disabled bar, plus happy-dom coverage for delete arming.

Surprises
BaseSelect could not yet be deleted because parallel ticket 4 has not landed on this branch and QuickForm still imports it.
The full repository suite had unrelated environment-sensitive server failures involving inherited GIT_PAGER, an inherited auth token, and process-group teardown; all 673 web tests and typecheck passed.
No drive machinery check was needed because this ticket introduced no service, boot variable, seed, or sidecar process.

Left undone
Delete BaseSelect after ticket 4 removes QuickForm’s remaining import; no QuickForm files or its nf-base CSS were touched here.

## 6. Review: drive the whole creation flow

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap rebuilt everything between having an idea and having a feature card, and the shape of it has genuinely landed. The project page at rest is now three things and nothing else — a header line naming the session and landing branches, a single "Talk it through" card, and the conversation history — with every explanatory paragraph and the old "what every chat here already has" card gone. The conversation list is finally readable: one row per real conversation instead of one per launch, each dated from when the thread actually started, and reopening a chat resumes the same session with its scrollback rather than minting a duplicate row. I ended a chat, reopened it, ended it again, and the list still held exactly two rows. The Quick overlay lost both its paragraphs for one line per mode, drafts can now carry notes, and the draft body renders those notes as real Markdown — headings, bold, bullets — instead of the old "No brief yet". Delete keeps its type-the-slug arming and is strict about it: a near-miss and a wrong-case slug both leave the button dead, only the exact string arms it.

What you cannot do yet is the thing all of this leads to. The branch picker — one shared control that decision 13 put in three places — does not accept a selection anywhere. Click a branch in the landing menu and it silently stays on main; click one in the Quick overlay's footer and it stays on "from …", which leaves Create feature permanently disabled; click one on a draft's next-step bar and Start stays disabled too, in a warn state claiming there is no usable base while main sits right there in its own list. So the two creation doors this feature exists to redesign are both shut. That is where I would start, and fixing the one primitive plausibly reopens all three.

Two other things are worth your eye. Backing out of a live chat with "← Conversations" does not actually leave it — the terminal stays drawn on top of the conversation list, so you get the project header, an "A chat is already open" notice, the word CONVERSATIONS, and then a terminal covering the rows underneath. Reattaching itself is fine once you click through, and "End it and start new" genuinely ends the old session and launches a fresh one in one click, so it is the intermediate screen that is broken rather than the mechanism. Separately, the transcript pane renders every conversation as empty — "nothing was said in this conversation" — even though the underlying Claude Code transcripts are there on disk with user and assistant turns in them. The pane's chrome is exactly right; it just never gets any content, which also means the Markdown rendering the spec asked for is unproven rather than confirmed.

Three criteria came out unverified for that reason, all blocked behind the defects rather than the drive: the gone-branch warn state, whether a quick change really births a sibling feature with two implementation tickets plus a review ticket, and Markdown in transcript bubbles. The footer arithmetic at least computes right before submit. On looks, the surfaces read as the new tokens throughout with no legacy stylesheet showing through — the one exception is the Talk it through card, where a 34px gap between the heading and its copy line strands the two apart where the prototype has them tight, and pushes the buttons into an awkward float between them. A walkthrough video of the whole pass is saved alongside this note.

## 7. Landing branch menu selection never takes effect — pick silently reverts to main

What was done
Fixed the shared BranchMenu so a pointer choice commits on mouse-down, before an enclosing surface can dismiss and unmount the option.
Kept keyboard activation explicit and added ArrowUp/ArrowDown/Home/End navigation between branch options.
Added component regressions proving a controlled landing label and selected check move from main to the chosen branch.
Re-ran the reported selection repro at the component seam with both mouse and keyboard: the label and selected option now change to develop when reopened.
The existing settings mutation remains the persistence path; no server contract or drive infrastructure changed.

Surprises
The old test fired click directly, skipping the browser mouse-down phase where the real menu was being lost.
The full suite reached 2,550 passing tests but had 12 unrelated environment failures involving rewritten temp repository paths, inherited GIT_PAGER/OAuth state, and PTY teardown; the touched test and typecheck are green.

Left undone
No adjacent live-chat overlay or transcript defects from the review digest were changed because they are outside ticket 7.
Drive scripts were not run, per the burn instruction; this UI-only change introduced no service, required environment variable, seed, or sidecar process.

## 8. Landing menu over-filters: every `feature/*` branch is hidden, 55 of 86 branches missing

What was done
The project-chat landing query now explicitly requests local feature branches.
The branch service exposes that opt-in while preserving the existing feature-creation default.
The shared menu regression test proves feature/* remains visible beside ordinary branches.
The service regression test proves an existing feature branch reaches an opted-in caller.

Surprises
The menu primitive already filtered exactly the three decided prefixes; the fourth filter lived in the server service.
The exact branch-count repro was re-run, but this ticket clone has 15 local branches and zero feature/* branches rather than the review environment's 86 and 55.
Equivalent fixture-backed checks passed with feature/existing-work visible and the three noise prefixes hidden.
The full suite ran 156 files: 151 passed or skipped and 5 unrelated files failed from exposed host credentials, blocked Git pager env, vanished temp repos, and process timing.
One credential-environment failure was confirmed alone; this ticket's targeted server and web tests both passed.
Typecheck passed for core, server, web, and scripts.

Left undone
Feature-creation base menus still exclude feature/* by design; only project-chat landing opted into the wider list.
Drive scripts were unchanged because this ticket adds no service, environment variable, seed, or process.

## 9. `← Conversations` from a live chat leaves the terminal rendered on top of the conversation list

What was done

Fixed the live project chat so returning to Conversations applies Tailwind's explicit
`hidden` display state to the mounted chat instead of relying on the native hidden
attribute that the chat's `flex` utility overrode. The terminal remains mounted, so
reattaching preserves scrollback and does not launch a new session. Added a DOM-level
regression test covering both hiding on Back and revealing the same terminal on Open.

Surprises

The existing test checked that the terminal stayed mounted but never checked whether it
was visually suppressed. The exact agent-browser repro could not be driven because this
burn sandbox intentionally has no running app or browser tool; its back/Open sequence was
re-run at the component seam and passed. Full typecheck passed. The full suite had 12
environmental failures in unrelated server tests (unsafe inherited GIT_PAGER/auth state,
missing temporary repositories, and one process-reaping assertion); the touched test passed.

Left undone

No adjacent creation-flow defects were changed. Drive setup was unchanged because this fix
introduces no service, environment variable, seed, or companion process.

## 10. "A chat is already open." notice fires on plain back-navigation and deletes the New chat card

What was done
The open-chat notice is now driven by the explicit rail New request, not by merely viewing the conversation list while a session is live.
Back-navigation from the live chat clears that request state and restores the ordinary resting workspace.
The notice now renders inside the New chat card instead of replacing it, so Talk it through, its copy, the landing branch menu, and New chat remain in the DOM.
Notice state is cleared after Open, replace, back-navigation, or the live session ending.
Regression coverage walks the live-chat back action and verifies Talk it through is present while the unsolicited notice is absent.
Coverage also verifies the explicit open-session notice coexists with the complete New chat card.

Surprises
The exact browser repro could not be driven because this burn sandbox has no running app or services; its event sequence was re-run in the happy-dom component test and passed.
The prescribed typecheck passed fully.
The full suite had 2,549 passing tests and 12 unrelated server failures caused by injected GIT_PAGER/OAuth state, vanished temporary git fixtures, and process reaping; the touched web tests passed.

Left undone
No server or drive machinery changed because this fix introduces no service, environment variable, seed, or companion process.

## 11. Transcript pane renders every conversation as empty, so Markdown bubbles never appear

What was done
The transcript pane now renders every non-empty server response as conversation bubbles.
Assistant-only content left after launcher-kickoff filtering is no longer mislabeled as an empty conversation.
Assistant prose continues through the shared Markdown renderer, including headings and emphasis.
A component-boundary regression test covers the reported post-kickoff assistant-only transcript.
The exact repro state was re-run at that boundary: the reply rendered as an h2 bubble and the false empty line was absent.

Surprises
The server JSONL reader and transcript endpoint were already returning populated turns correctly.
The defect was a client-side policy that intentionally hid turns whenever no human turn survived kickoff filtering.
The full suite reached 2,551 passing tests but 12 unrelated burn-environment tests failed from removed temp repos,
an injected GIT_PAGER, an inherited OAuth token, and a lingering process group; targeted tests and typecheck were green.

Left undone
No server parsing or transcript storage code changed because its existing public seam already passed populated JSONL cases.
The live app was not booted because burn instructions explicitly prohibit running the app or drive machinery in this sandbox.

## 12. Quick change cannot create a feature — base branch never defaults or selects, Create feature stays disabled

What was done
Quick change now falls back to `main` when runcastle is serving from an internal checkout that is not a selectable creation base.
The existing selectable current-branch behavior remains unchanged, and a detached HEAD still has no guessed default.
Added a DOM regression covering the reported title, first change, Add another, second change, footer arithmetic, enabled Create feature button, and a subsequent branch pick.
Re-ran that repro through the regression: the footer began at `from main`, showed two tickets plus review, Create feature was enabled, and selecting `develop` updated the label.
Committed as 5f1ac93 (`ticket(12): restore quick change base selection`).

Surprises
The shared BranchMenu selection fix from earlier tickets was already present; the remaining blocker was the older default-base derivation deliberately returning empty.
The full test command completed with 12 unrelated environment-sensitive server failures: inherited Claude credentials, forbidden GIT_PAGER, process teardown, and temp-repository disappearance.
Final typecheck passed, and all 327 focused creation-derivation, Quick-form, and BranchMenu tests passed.

Left undone
No server or drive-machinery changes were needed because this change introduces no service, process, seed, or required environment variable.
The unrelated full-suite environment failures were not changed as they are outside this UI ticket.

## 13. Draft Start is permanently disabled — from-branch picker shows warn state despite `main` being available

What was done
Draft and Quick creation now receive Git's detected main line alongside the current checkout.
Creation still prefers a usable current checkout, but falls back to the detected branch when a test drive leaves the checkout on an excluded feature branch.
The draft next-step bar therefore defaults to `from main` and enables Start in the reported case.
If neither branch is usable, the warn picker and disabled Start remain and now show the visible `pick a branch first` hint.
Regression coverage pins the server branch response, base derivation, controlled menu interaction, and draft warning markup.

Surprises
The shared BranchMenu selection handling had already been repaired by an earlier landed ticket; the remaining failure was the caller's intentionally empty default during a feature-branch test drive.
I re-ran the reported interaction contract through the component/derivation tests: `main` is selected by default, selection updates the controlled trigger, and only a genuinely missing base disables Start with an explanation.
The sandbox is explicitly not drive-capable, so the live Quick-to-draft browser flow could not be booted here.
Typecheck passed and all 408 targeted tests passed.
The full suite reached 2,553 passing tests but had 12 unrelated environment failures involving inherited Git/Claude variables, vanished temporary repos, and process cleanup.

Left undone
No drive machinery changed because this fix adds no service, boot variable, seed, or companion process.
The unrelated full-suite environment failures were left outside this ticket.

## 14. Deleting the feature you are viewing strands you on a dead route showing a raw internal id

What was done

Deleting the feature currently being viewed now clears its selection and opens the project workspace immediately after the server confirms deletion.
Clearing a feature selection now also removes its per-project local-storage entry, so reload cannot restore a deleted internal feature id.
Added component-level regression coverage for delete-success navigation and hook-level coverage for reload persistence.
The strict slug-armed delete dialog remained unchanged and its existing test stayed green.

Surprises

The old delete handler attempted to select another feature but did nothing when the deleted feature was the only row, while selection persistence never removed stale ids.
The exact browser Drive repro could not be run because the burn instructions forbid booting the app; its delete-confirm success sequence was re-run at the component seam and navigated to the project workspace without retaining the deleted id.
The full monorepo test command completed with 12 unrelated environment-sensitive failures in burn workspace/process tests; all 37 web test files passed (684 tests), and full typecheck passed.

Left undone

No drive machinery changed because this ticket introduced no service, boot environment variable, seed, or companion process.

## 15. New chat card is off-rhythm — 34px between heading and its copy line, stranding the card

What was done
Reset the New chat card heading and copy margins with Tailwind `m-0` utilities.
The card's existing `flex-col gap-2` now solely determines their separation at 8px.
Added a rendering regression test that guards both margin resets under the app's no-preflight setup.

Surprises
The 34px gap came from native h2 and p margins surviving because Tailwind preflight is intentionally disabled.
The exact browser-console repro could not launch because this burn sandbox explicitly has no app or services.
I re-ran its render-seam equivalent: both elements now have zero margins and an 8px declared gap, so 34px cannot reproduce.
Typecheck and the focused 17-test project workspace file passed.
The full suite had 12 unrelated server failures from vanished temporary git repos, process teardown, and a host OAuth token; the changed web test passed within it.

Left undone
No adjacent workspace styling was changed; this ticket was limited to the cited card rhythm defect.
Drive scripts were not run or changed because this ticket adds no infrastructure.
