# Outcome — UX Issues

- Lap UX is bad, user doesn't know there's another lap, what was done this lap, etc.. - Review UX is bad, doesn't show changes - Create feature UX is bad. One line text input - Test drive notes looks bad, bad UX, "to ticket" system is weird (related to lap ux) - Resolve conflict buttons only appear when I end chat session - The project-scoped chat is not very prominent, doesn't feel important

- Shipped: 2026-08-18
- Lap: 1

## 1. Project chat becomes a conversation list

# Ticket 1 — Project chat becomes a conversation list

## What was done

`talkToProject` now takes `{ projectId, fresh?, resumeSessionId? }` and defaults to a FRESH
conversation; `resumeSessionId` is a runcastle **session row** id (what the list hands back), whose
`ccSessionId` becomes the launcher's `--resume`, falling back to fresh plus a
`session.resume_unavailable` event when the row never reached Claude Code. `fresh` overrules a row
id so the New chat button can never resume. The one-live-project-session guard is untouched.

Two new project-router queries: `conversations` (every project session row, newest first, with
title, date, status, `resumable`) and `conversationTranscript` (simplified `{role, text}` turns,
tool traffic stripped, empty for a missing file). Transcript parsing lives in
`services/transcripts.ts`, the list and title derivation in `services/conversations.ts`.

The web workspace leads with a prominent New chat card, lists past conversations by name and date
(Transcript / Reopen per row), and renders a read-only chat-bubble pane for any of them; live, it is
the terminal it was, with the strip now naming the conversation. The palette gained a dedicated
project-chat row, and `'talk'`/`'ask'` were removed from Preparation's search terms.

Deviations from the ticket's approach, both small:

- The ticket said to add only a nullable `title` column, but its own contract asks each conversation
  for a `createdAt` — and `sessions` carried **no timestamp at all** (readers order by the implicit
  `rowid`; the code says so in three comments). So the migration adds `title` *and* a nullable
  `created_at`. Nullable rather than defaulted: rows that predate it have no creation time anyone
  can recover, and a backfilled default is a fabricated date shown to a human as fact.
- Title derivation skips the launcher's injected kickoff line before taking the first user message.
  Taken literally, "first user message" titles *every* project conversation "Proceed with your task:
  invoke the /runcastle:project skill…", which fails the criterion in spirit. It reuses the existing
  `promptMatchesKickoff` comparison.

## Surprises

- **`packages/server/test/dev-pane.test.ts > kills the child process tree` fails, and is not mine.**
  It is not in the ticket's stated baseline, so I checked it out at the base commit (`2d6a9f4`) in a
  scratch `git worktree` and ran it there: it fails identically with none of my code present. It
  asserts that a PTY's process group is reaped 400ms after a kill — an OS-reaping assumption this
  sandbox does not honour. Final suite: **1791 passed, 1 failed (that one), 3 skipped**; typecheck
  clean across core, server, web, design-system and scripts.
- Resuming produces a **new session row** pointing at the same Claude Code conversation, so the list
  is per-launch, not per-conversation: reopening a chat three times leaves four rows that may all
  carry the same title. I followed the ticket's contract literally ("all session rows of kind
  'project'") rather than dedupe on `ccSessionId`, because the research notes say `--resume` can
  *fork* to a new id (`SessionStart` source `fork`, CC 2.1.214+), so a dedupe key would be a guess.
  See "Left undone".
- `listProjectConversations` writes (the title cache) inside a query, which brushes against SPEC §12's
  "every mutating service function emits an event". Left eventless on purpose, with the reasoning in
  the docstring: it caches a name the same call already returned, so an event would be one timeline
  entry per row per poll saying nothing happened.
- `project-session.test.ts`'s "resumes its own last conversation on relaunch" asserted the exact
  behaviour this ticket reverses. Removed, with a pointer to its replacement.

## Left undone

- **Conversation identity.** If `--resume` really does keep the session id, the list should group
  rows by `ccSessionId` so a thread reopened five times is one row. Worth settling by watching what
  a real resumed project terminal reports at `SessionStart`, not by reading docs.
- **Resume framing for project chats.** Feature sessions get `RESUME_KICKOFF_PREFIX` ("we are
  picking this up, do not start over") on a resumed launch; `launchProjectSession` and
  `launchPrepareSession` never have, so an explicitly reopened chat is still greeted with "invoke
  /runcastle:project and drive the project session" — an instruction to restart its opening move.
  Now that resuming is a deliberate click, that reads worse than it did. Left alone as another
  ticket's call.
- **`.runcastle/` drive scripts** need no change: the ticket adds a migration and no service, env
  var, seed or process, and `drive-setup.ts` already pins `RUNCASTLE_MIGRATIONS_DIR` at the
  checkout's `packages/server/drizzle` (where `0026_polite_vertigo.sql` landed) with migrations
  running at boot. Checked hermetically, as required — never run: the scripts are TypeScript, not
  shell, so `bash -n` does not apply; I verified instead that every path they name still exists
  (`packages/server/drizzle`, `packages/skills`, `hook-client.ts`, `pty-host.cjs`, the sandcastle
  template) and that the new migration sits in the directory the script points at. No compose file
  is involved.

## 2. Skills pack: advisor intake, always-on code review, mandated review ticket

# Ticket 2 — Skills pack: advisor intake, always-on code review, mandated review ticket

## What was done

Three prompt-contract reworks in `packages/skills`, plus the new skill they depend on. All content — no TypeScript changed anywhere in the diff.

**The project session is now an advisor.** `packs/runcastle/skills/project/SKILL.md` §1 is re-ordered into three named steps: 1a consult the portfolio, 1b advise, 1c create. The consult is written as a requirement, not a suggestion — `get_project_context` for the index and the binding ADRs, `get_work_record({ featureSlug })` for a neighbour's status/ship date/run summaries and its burner digests (the "left undone" line is called out as where the idea in front of you is usually already half-answered), `get_work_record({ seam })` for "who has touched this area", and merged features' `decisions.md` on disk. 1b is recommendations with addresses, clarifying questions restricted to ones that would actually move the cut, and an explicit split suggestion. Ideation-grade grilling is forbidden in the body and again in "Do NOT", with the handoff to `/runcastle:ideate` named. The charter, routing, Q&A and curation sections are untouched.

**A runcastle code-review skill exists.** I fetched the upstream from `github.com/mattpocock/skills` (`skills/engineering/code-review/SKILL.md` plus its `docs/engineering/code-review.md`) and forked it to `packs/runcastle/skills/code-review/SKILL.md`, with the same provenance-header convention the other six forks use. Two axes (Standards + Spec) in parallel sub-agents, never merged or re-ranked, every finding carrying a citation. The runcastle adaptations: the fixed point is not asked for (a feature branch has one by construction — resolve `baseBranch`, else the default branch, three-dot from the merge-base), and the spec source is `docs/features/<slug>/spec.md` + `decisions.md` rather than an issue tracker. I also carried in the anti-recursion guard that upstream's own docs describe as a known open bug (a sub-agent rediscovering the skill and fanning out; one reported run hit fifty-plus agents).

**The review burner always reviews.** `burner/review-ticket.md` is restructured into step 1 code review (unconditional) and step 2 drive (only when the ticket prescribes something to run — the existing drive instructions are kept essentially verbatim for that case). Findings from both steps land as one note per finding via `add_test_note`, with code-review notes required to carry their axis and citation. The digest is redefined as the lap's "What landed this lap" prose summary, with explicit anti-log rules (no headings, no bullets, no tool names, product language not file names, synthesize don't enumerate) because ticket 5 renders it verbatim. "Could not review" narrows to match: a drive that will not start is now a note plus a digest line, not a blocked review, since the code review still delivered.

**The tickets skill mandates the review ticket.** The `<review-ticket>` section's "a feature with genuinely nothing to exercise gets no review ticket" is replaced with an unconditional one-per-batch rule, argued from the fact that every batch produces a diff and a diff is always reviewable. The drive is what varies. I added a sixth self-check item, since the self-check list is where that rule actually gets enforced before emit.

## Surprises

**The burner agent cannot invoke the skill.** This is the big one and it shaped the design. `--plugin-dir` is passed only by the interactive launcher (`launcher.ts`); `buildBurnAgent` gets `--mcp-config` and nothing else, so the review agent running `claude --print` on the host has no `/runcastle:code-review` to call. I inlined the procedure (including the twelve-smell baseline, which the Standards sub-agent needs pasted in full and has no other access to) into the burner prompt, and put a header comment on it saying why and "keep the two in step". This matches the existing grain — `implement-ticket.md` already inlines forked implement/tdd/code-review discipline rather than invoking skills — but it is real duplication between the skill and the burner prompt, and it is the thing most likely to drift.

**The ticket's premise about digests is wrong.** The context says the review agent "holds spec + every implementation ticket's digest". It does not: the rendered prompt is `TICKET_JSON` (this ticket only), `FEATURE_BRIEF`, `DOCS_DIGEST` (spec + decisions), and three paths. Sibling digests are nowhere in it, and `get_feature_context` is not a reliable fallback because a review agent has no session row (`resolveRunCaller`'s comment says so explicitly — it is gated on the run header instead). So I sourced the summary from what the agent demonstrably has: the spec, plus the commit log and diff it has just read for the code review. That coupling turned out to be a feature — running the code review first is exactly what gives it the material — and I made it explicit in step 6.

**A test pins the template's prose.** `review-ticket.test.ts:375` asserts the template contains the literal string `skip the browser and the recording entirely`. My rewording dropped the word "entirely". I restored the exact phrase rather than edit the test, since the sentence reads fine either way and the test is a deliberate contract pin.

**One pre-existing test failure, not mine.** `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned` fails. It spawns a real PTY, backgrounds a `sleep 300`, and asserts the process *group* is reaped after `stopDevPane` — pure OS process-group behaviour, and my entire diff is eight markdown/JSON files under `packages/skills` with zero TypeScript. I confirmed it on a single targeted run of that one file. I could not run it at the baseline commit to prove it there: a scratch worktree has no `node_modules`, and symlinking the repo's did not resolve the workspace packages. Corroborating evidence that this sandbox's environment differs from the one the baseline was recorded in: the stated baseline is 1768 passed / 10 skipped, this box gives 1774 passed / 3 skipped.

Verification: `bun run typecheck` exits 0 (all four packages plus scripts). `env -u GIT_ASKPASS bun run test` is 117/118 files passing, 1774 passed, with only the `dev-pane` failure above.

## Left undone

- **The `agent-browser` PATH probe now fails the wrong thing.** `executeReviewTicket` returns `couldNotReview` when `agent-browser` is missing, *before spawning the agent at all*. Now that the code review is the unconditional part and needs no browser, that probe turns a missing CLI into "no review happened" when a perfectly good code review was available. It should become conditional. Runtime code, so out of scope for this content-only ticket — but it is a real hole in decision 9's guarantee and worth its own slice.
- **Doc comments still describe the project session as a griller**: `packages/core/src/schemas.ts:79` and `packages/server/src/trpc/routers/project.ts:85` both say it "grills a lump of raw intent". Left alone as runtime files outside this ticket's seam; they are stale now.
- **`packages/skills/README.md` still describes `burner/` as just `implement-ticket.md`** in its tree sketch, though four templates live there. I updated the skill counts it got wrong but did not expand that line.
- I did not touch `.runcastle/` — this ticket adds no service, env var, seed or background process, so the standing drive-script instruction has no trigger here. I ran none of the drive scripts (the sandbox is hermetic by design) and made no change that would need them checked.

## 3. Rework the creation doors: New opens chat, Quick gets two modes

# Ticket 3 — Rework the creation doors

## What was done

The rail head's **New** button now opens a fresh project conversation: it calls the
same `selectProject()` + `talk.start()` pair ticket 1 landed (`start` already sends
`fresh: true`), so no server work was needed for it. `NewFeatureForm.tsx` is deleted
along with every route to it — the shell's create branch, the empty workspace's
"New feature" button, and the palette's "Create new feature" row. Its two useful
pieces moved into the Quick overlay as the ticket asked; its Advanced branch-from
picker did **not** have to move, because `bodies/DraftBody.tsx` already carries one
at the point a parked draft is started (the base is read in `Workspace.tsx` and sent
by the next-step bar's Start), which is exactly what acceptance criterion 5 asks for.

`QuickChangeForm.tsx` was renamed to `QuickForm.tsx` and reworked into the two-mode
overlay: a tab pair at the top (styled after the existing Inspector tabs), **Quick
change** = title plus a list of prose textareas with add/remove where Enter starts the
next ticket (shift-Enter is a newline, ⌘/Ctrl-Enter submits), and **Park a draft** =
title plus optional one-liner calling `feature.create` with `draft: true` and no base
branch. The duplicate-title warning sits under the shared title field, so it applies in
both modes rather than only in park mode — one field, one warning. The static "lap 1"
chip is gone.

Server side, `quickChange` takes `tickets: string[]` instead of `prose: string`: it
trims and drops blank rows, stores one ticket per surviving sentence through
`storeTickets`, and titles each ticket from its own first line (cut at a word boundary
past 72 chars) instead of reusing the feature title, which would have named three
tickets identically in the ledger. `brief.md` gives several sentences a numbered
`## Ticket N` section each and keeps the single-ticket shape unchanged. The
`feature.quick_change` event now names every seq it was born with (`data.ticketSeqs`)
and dropped its `ticketId` — with N tickets the event is the card's birth, not any one
ticket's. The `create_feature` MCP tool's single-prose shape is untouched; it sends a
one-element list.

## Surprises

- Acceptance criterion 5 was already satisfied before I started — `DraftBody`'s
  Advanced picker has been the draft's base choice since decision 3/7. Worth knowing
  that the ticket's "move the picker" instruction was already done by an earlier lap.
- `.nf-overlay` is `flex: 1`, not a fixed-position modal: the "overlay" is a workspace
  *view*, so `workspaceView`'s `'create'` value had to stay (it now means Quick only).
  Making it a true floating overlay would be a CSS change the ticket did not ask for.
- One test fails and it is not mine: `packages/server/test/dev-pane.test.ts` >
  "kills the child process tree…" asserts a real PTY process group is reaped within
  400ms. It fails identically on a targeted run, is in a file and subsystem my diff
  never touches, and is a timing/process-reaping fault of this hermetic sandbox. Full
  suite otherwise: 1820 passed, 3 skipped, 1 failed. `bun run typecheck` is clean.
- I could not drive the overlay by eye: the sandbox has no services and the web app
  needs the server on 4512 for every query in the form, so a dev server would render
  an error state rather than the two modes. Verification is typecheck plus the
  widened-contract tests (19 in `quick-change.test.ts`, including multi-ticket storage,
  ordering, blank-row dropping, the numbered brief, and the timeline entry).
- No `.runcastle/` change was needed: this ticket adds no service, env var, seed or
  background process — only a widened tRPC input and web components.

## Left undone

- `docs/SPEC.md:293` and `docs/adr/0001-mapped-ideation.md:84` still name
  `NewFeatureForm` (as the home of a start-mapped toggle that the component did not
  actually have any more). Both are build-era records and out of this ticket's scope,
  but the next agent touching the spec should know those two lines now point at a
  deleted file. The `.design-sync/` app-redesign template also still draws the old
  NEW FEATURE card; it is a design round-trip surface, not code.
- `GRILL_EXPLAINER` in `lib/vocabulary.ts` lost its only consumer with
  `NewFeatureForm`. I left it — it is a tested glossary entry, and the grill session
  itself is very much alive.
- The `.talk-door` CSS rules are now unused (the constant `TALK_IT_THROUGH` is gone).
  Left in place deliberately to keep `styles.css` conflict-free for the sibling ticket
  branches burning in parallel.

## 4. Lap spine: grouped tickets and notes, lap banner, findings-inbox triage

# Ticket 4 — Lap spine: grouped tickets and notes, lap banner, findings-inbox triage

## What was done

Lap became visible history across four surfaces. `groupByLap` and `lapBanner` are
new pure functions in `feature-ui.ts`; a shared `LapSections` atom in `ui.tsx`
renders the groups (current lap a plain section, earlier laps a `<details>`), and
both the tickets ledger and the notes panel now go through it. The activity feed
gained `isLapDivider` plus an explicit `lap.aborted → error` level, and the
Inspector renders `lap.started` as a rule across the feed instead of one more row.
The banner sits under the workspace header from lap 2 on.

Server side: `promoteMany(noteIds)` batch-promotes in one mutation — one
`notes.promoted` event, one `test-notes.md` re-render, every guard before the
first write so a selection with one bad note mints nothing. `promoteNote` stays
for the MCP wire and now shares the same body (`freezeAsTickets`). The web stopped
calling it: the per-note "→ ticket" is gone, and triage moved to one "Address
notes" action in the review bar that opens a fork dialog (checkbox-select →
batch promote, or start the lap session via the existing rethink path).

Two deviations from the ticket's sketch. First, the banner's "what kicked it off"
is a **constant sentence** (`LAP_KICKOFF` in vocabulary.ts) rather than the
`lap.started` event's message: Iterate is the only thing that bumps a lap, so the
reason never varies, and the event message (`rethink — lap 2`) only restated the
lap number already in the tag. What the event supplies instead is *when* —
`lapBanner` returns `startedAt`, and drops it when a later `lap.aborted` took that
lap back. Second, lap headers are suppressed entirely when a feature has only one
lap: rendering "Lap 1" over everything a never-iterated feature owns is exactly
the ceremony decision 6 keeps off it, and it matches the pipeline chip's stance.

## Surprises

- `EventRow` carries no `lap` on the wire (the DB column exists, `rowToEvent`
  drops it). Anything lap-aware in the feed has to derive from event *order* and
  type, not from a stamp. That is why the divider renders the event's own message
  and the banner dates rather than quotes it.
- `groupByLap` needed a fallback nobody asked for: a lap always starts with zero
  tickets and zero notes, so keying "expanded" purely on `feature.lap` collapsed
  every group on screen the instant Iterate landed. It expands the last lap that
  *has* rows instead. Tested.
- `add_test_note`'s MCP description promised the human could promote a finding
  "in one click" — copy this ticket made false. Updated in the same change.
- `bun run test` has ONE failure that is not mine and not in the prompt's
  baseline: `packages/server/test/dev-pane.test.ts > kills the child process tree`
  expects a process group to be reaped and it is not in this sandbox. Confirmed on
  a single targeted run; this ticket touches no launcher, PTY or dev-pane code.
  Everything else is green (typecheck 0 errors; 1798 passed).
- No `.runcastle/` edit was needed — no new service, env var, seed or process; the
  change is UI plus one procedure on an existing router in the same server. I did
  not run the drive scripts (the sandbox is hermetic) and did not modify them.

## Left undone

- `reviewChecks`/`mergeSummary` still count notes flat across all laps. Arguably a
  merge dialog should say "3 open notes **on this lap**", but nothing asked and
  the flat count is not wrong.
- The `notes.promote` (single) tRPC procedure now has no caller in the web app. It
  was deliberately kept for back-compat per the ticket; if the MCP surface never
  grows a promote tool, a later ticket could delete the procedure and keep only
  the service function.
- The review skill's prose still describes notes as individually promotable in a
  couple of places under `packages/skills` — that pack is another ticket's
  territory (decision 9 reworks it wholesale), so I left it.

## 5. Review page: lap summary lead, planned-next-lap steering, always-visible conflict resolve

# Ticket 5 — Review page: lap summary, planned-next-lap steering, always-visible resolve

## What was done

The review surface now leads with prose and knows the plan. `lapAccount()` picks
the review ticket's own `digest` as the lap's "What landed this lap" summary and
falls back to the implementation tickets' digests, rendered under a label that
says plainly they are the burners' own per-ticket accounts, not a lap summary;
`ReviewBody` renders that block at the top of the summary card through the
existing `Markdown` component. `reviewChecks()` no longer omits the review row
when no review ticket ran — it states `no review ran this lap` in amber, which is
what makes decision 9's "a review always runs" visible. A new `deferredScope()`
parses `## Later laps` out of `spec.md` (read over the existing `docs.read`
route, reusing `parseMapSections`); when it is non-empty the review body grows a
Planned-next-lap card quoting the scope verbatim, `nextStep()`'s review branch
flips its primary to `Start lap N+1` with Merge & ship demoted to a secondary,
and `mergeSummary()` adds a warning quoting the scope as the last catch. The
resolve-conflict affordance no longer hides behind a live session: the bar's
primary and the conflict card's button always stand, reading "End session &
resolve" when a terminal is open, and both fire one new `useResolveConflict()`
hook that awaits `feature.endSession` before `feature.launchSession` (the
launcher refuses a second live session, so the order matters) — with the
one-terminal explanation shown as the bar's warning and under the card's button.

Deviations from the ticket's sketch: no server change was needed — `digest` was
already on the stored `Ticket` schema and in `listByFeature`'s row mapping, so
the web already had it. The primary flip reuses the existing Iterate action
rather than minting a second one, so it inherits Iterate's "stop the test drive
first" reason and the next lap keeps a single dispatch; with a session live there
is nothing to launch and the bar behaves exactly as it does today. The `Later
laps` read is gated to the review phase in `Workspace`, since nothing earlier can
use the answer.

## Surprises

- Two existing `nextStep` tests asserted the OLD hidden-resolve behaviour
  (`primary` undefined while live) and one asserted that `reviewChecks` says
  nothing when no review ran. All three encode decisions this ticket reverses, so
  they were rewritten rather than worked around.
- The next-step bar's `desc` is rendered only when the guidance toggle is on, so
  the one-terminal explanation could not live there. It rides the always-rendered
  `warning` slot instead, displacing the unproven-drive caveat while a session is
  live — the same "refusal outranks caveat" precedent already in the file.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in
  this sandbox: `pidAlive(-pgid)` still reports the group alive after the kill.
  It fails standalone, the test and the code it exercises were committed a week
  before this branch, and my diff touches only `apps/web` — this is a container
  process-reaping fault, not the listed baseline and not mine. Everything else is
  green: `bun run typecheck` 0 errors, `bun run test` 1842 passed / 3 skipped /
  that 1 failure.

## Left undone

- `reviewOutcome()` and `lapAccount()` both pick the LAST review ticket across
  every lap rather than the current one, so on lap 3 a lap-1 review ticket is
  still what both read. Consistent with how the file has always worked, and the
  ticket asked for that pick — but "What landed this lap" over cross-lap digests
  is a latent lie once a feature really iterates.
- `specDocPath` matches `endsWith('spec.md')`, copying `mapDocPath` — a stray
  `api-spec.md` in a feature's docs dir would win the `find`.
- The conflict card still offers its live action in the read-only retrospective
  view of a shipped feature (pre-existing; the Planned-next-lap card I added does
  respect `readonly`).
- No `.runcastle/` drive-script change was needed: this ticket adds no service,
  env var, seed or background process. Nothing in that directory was touched, and
  nothing there was run (the sandbox is hermetic, as designed).

## 6. Review the integrated UX lap

# What landed this lap

All five implementation tickets landed, and the integrated branch does what the spec set out to do on every surface I could reach. The pipeline's state is genuinely more legible than it was: laps now show up where you already look, review no longer stays silent about itself, and feature birth has moved out of a form and into a conversation.

I booted the drive on `feature/ux-issues` and drove a browser through a throwaway project created outside your checkout, so nothing was written into your working tree. The walk covered onboarding, the project chat, both creation doors, and one feature carried from quick-change birth through build, review, note triage, an Iterate into lap 2, and back to a lap-2 review page. I also ran the full test suite and the monorepo typecheck, and read the four reworked skill files against the spec. A walkthrough recording sits beside this file.

The project workspace is now a real conversation list — "New chat" is prominent, past chats are dated, and resuming one takes an explicit Reopen click that genuinely brings the same session back. Transcripts are viewable, and a chat that never got started correctly refuses to reopen instead of failing later. Typing "talk" in the palette reaches the chat and no longer lands on Preparation. The Quick door now has two modes and really does mint several tickets at once; the old NEW FEATURE overlay is gone from the codebase entirely. Notes have become an inbox with the per-note "→ ticket" removed and one explicit "Address notes" fork in its place, and the review page leads with a summary block that says "no review ran this lap" out loud rather than omitting the row.

Six findings, none blocking. Two are worth your attention: **quick change births a batch with no review ticket**, so the "a review always runs" invariant has a hole on the very door this lap widened; and **the tickets ledger drops its Lap header whenever every ticket sits on one lap** — which includes a lap-2 feature carrying only stale lap-1 tickets, so the ledger still cannot answer "what was done this lap" while the notes panel beside it can. The rest are smaller: the multi-ticket contract widened on the tRPC door but not on the MCP one the project chat uses; the transcript credits the launcher's kickoff line to "You"; and this review itself ran on the *old* review-ticket prompt, because the burner renders skills from the installed global pack rather than the branch — so the lap's own skills rework could not shape the pass reviewing it.

What I could not verify: a real merge conflict, a real review-agent digest, and the ledger's lap headers with tickets genuinely spanning two laps. For those I read the pure logic instead — the later-laps primary flip and the never-hidden conflict resolve are both thoroughly unit-tested, and their live behaviour matched the tested contract wherever I could see it. Worth knowing: `bun test` in `packages/server` is *not* the suite (that package has no test script; the runner is vitest at the root, and `bun test` reports 21 phantom failures). The real suite is 1839 passed / 2 failed, and both failures are five-second timeouts in git-heavy tests that pass 20/20 when re-run without the dev server competing for the machine. Typecheck is clean across all four packages.

One piece of housekeeping: the drive stopped and released its slot, and your checkout is back on `main` and clean — but its teardown hook failed with EBUSY and left a few empty directories under `~/.runcastle-drive-ux_issues`. The lock is on the project-chat worktree, which I could not name a holder for, so I left it rather than kill unidentified processes. Details are in the notes.

## 7. Quick change appends the review ticket server-side

# Ticket 7 — Quick change appends the review ticket server-side

## What was done

`quickChange()` in `packages/server/src/services/features.ts` now closes its
batch with a `kind: "review"` ticket, built by a new local helper
`quickReviewTicket()`, blocked by every typed ticket. The whole batch — N typed
plus the review — goes through a **single** `storeTickets()` call, because
`blockedBy` names 1-based *batch positions* and those only resolve against
tickets stored together; two calls would have made the edges unresolvable.

The appended ticket's prose carries the contract the tickets skill states for a
hand-written one: the code review of the branch diff is unconditional, the drive
happens only when the diff touches something a human can operate (nobody
prescribed a walkthrough on this path, so the agent is told to judge from the
diff and to say so when there is nothing drivable), and the digest is the lap's
prose summary. Its `acceptanceCriteria` are the code review, then one per
sentence the human typed. `seams` is empty — the review agent edits no code.

The `feature.quick_change` event now names the review ticket apart from the
tally (`"…with 2 tickets (#1, #2) plus a review ticket (#3)…"`), because the
tally is what the human typed and the review is the pipeline's own doing;
`data.ticketSeqs` carries all stored seqs.

The MCP door needed no change: `toolCreateFeature` already calls `quickChange()`
for `ticket: { prose }`, so the invariant holds there by construction — pinned
with a test rather than new code.

One deviation from a strictly server-only ticket: the Quick overlay's branch
footer said "starts at build with 2 tickets" while the ledger would now open
with three, so it gained "+ a review". That is a truthfulness fix my change
caused, not new UI.

Tests: three new cases in `packages/server/test/quick-change.test.ts` (N in →
N+1 out with the review blocked by all N; the same for a one-sentence change;
the prose contract), plus the MCP assertion. Existing cases that counted "all
tickets" were narrowed to a `typedTickets()` helper filtering to
`kind === 'implementation'`, which keeps their original meaning.

## Surprises

- The next-step bar and the ledger needed nothing: `nextStep()` counts
  `tickets.length` kind-blind (so a 2-ticket quick change now reads "Burn 3
  tickets"), and `TicketKindChip` already badges review rows in `TicketsBody`. I
  verified both by reading the derivations rather than adding near-duplicate
  tests to `feature-ui.test.ts`.
- `brief.md` still numbers only the typed sentences (`## Ticket 1..N`); the
  review ticket is not one of the human's sentences, so it is deliberately
  absent there. Its own context tells the agent where the intent lives.
- A docs-less quick change is safe for the review burner:
  `buildDocsDigest([])` degrades to "_No feature docs found_" rather than
  throwing, and `brief.md` exists regardless.

## Verification

`bun run typecheck` — clean. `env -u GIT_ASKPASS bun run test` — 1850 passed, 3
skipped, **1 failed**: `packages/server/test/dev-pane.test.ts` "kills the child
process tree so the port-holder is not orphaned", which asserts a PTY process
group is reaped after a fixed 400ms delay. It fails identically on a targeted
re-run, and nothing in my diff (features service, quick-change/MCP tests, one
JSX string) touches PTY, dev panes, or process teardown — I read it as a
sandbox/environment fault, not a regression. It is not in the prompt's baseline
list, so flagging it explicitly.

No `.runcastle/` change: this ticket adds no service, env var, seed, or process.

## Left undone

- **Decision #9 is still only half-enforced in code.** The other server path
  that births a ticket batch without an agent — batch-promoting test-drive notes
  into fix tickets (`notes` service, lap N+1) — does not append a review ticket.
  This ticket was scoped to the quick door, so I left it; the invariant is now
  code on one of the two agentless doors and prose on the rest.
- The vendored code-review skill asserts "runcastle features always have one
  [a spec]", which is false for exactly the quick-change features this ticket
  now sends to review. Noted in lap 1's review notes already; still true.

## 8. LapSections keys header suppression on the feature's lap, not group count

# Ticket 8 — LapSections keys header suppression on the feature's lap

## What was done

`LapSections` (apps/web/src/ui.tsx) took a new `currentLap` prop — the feature's own
lap — and its short-circuit changed from `groups.length <= 1` to `currentLap <= 1`.
Both call sites already had the value on hand and now pass it: the ledger
(`TicketsBody.tsx`, `full.data.feature.lap`) and the notes inbox
(`ReviewBody.tsx`'s `NotesPanel`, whose `lap` prop was already documented as the
feature's current lap), so the two panels can no longer disagree about whether lap
is worth showing. `groupByLap()` is untouched, as the ticket specified.

One small deviation from the literal fix: the suppressed branch now renders
`groups.flatMap((g) => g.rows)` instead of `groups[0]?.rows ?? []`. A lap-1 feature
cannot have rows on another lap, so the two are equivalent today, but the flatMap
cannot silently drop a group if that assumption ever stops holding — and it is the
honest expression of "render everything flat".

Added `apps/web/test/lap-sections.test.ts` — four cases: lap-1 suppression, the
lap-2-with-one-group case that this ticket is about, the two-group case (asserting
`<details>` for earlier laps vs `<section class="lap-group is-current">` for the
current one), and the empty case.

## Surprises

- `apps/web` genuinely had no component-level tests, and the repo has no jsdom or
  testing-library — and the root vitest `include` only matches `*.test.ts`, not
  `.tsx`. Rather than add a dependency or widen the glob, the new test renders via
  `react-dom/server`'s `renderToStaticMarkup` with `createElement`, so it stays a
  plain `.ts` file under the existing config. This works with zero new deps and is
  a usable pattern for the other untested components.
- `apps/web/tsconfig.json` has `include: ["src", "vite.config.ts"]`, so test files
  are not typechecked at all. The extra `currentLap` prop in my red-phase test run
  therefore raised no type error before the component accepted it — worth knowing
  before trusting typecheck to catch a test-side mistake.
- Full suite: 1851 passed, 1 failed —
  `packages/server/test/dev-pane.test.ts > kills the child process tree`. Not in the
  prompt's baseline, so I checked it rather than assuming: it fails identically at
  `HEAD~1` in a scratch `git worktree`, before my change. My diff is `apps/web`-only
  and nothing in `packages/server` imports it. It is a process-group reaping
  assertion that this container's PID semantics don't satisfy — an environment
  failure, not a regression. `bun run typecheck` is clean.

## Left undone

- The two call sites now pass the feature lap twice (`groupByLap(rows, lap)` plus
  `currentLap={lap}`). `LapSections` could take `rows` + `currentLap` and call
  `groupByLap` itself, deleting that duplication. I took the smaller reading, since
  the ticket names `groupByLap` as unchanged and the current split keeps the pure
  function separately testable — but it is the obvious next tidy.
- No `.runcastle/` drive-script change: this ticket adds no service, env var, seed,
  or process, so none of the triggers fire. Nothing in the scripts was run (the
  sandbox is hermetic) or needed reading.
- Still uncovered by component tests: `ConflictCard`, `DraftBody`, `ReviewBody` —
  the lap-1 review's observation stands for everything except `LapSections`.

## 9. MCP create_feature learns the multi-ticket quick change

# Ticket 9 — MCP create_feature learns the multi-ticket quick change

## What was done

The MCP `create_feature` tool's quick-change parameter changed from
`ticket: { prose }` to `tickets: string[]` — the same shape the tRPC door already
took (`z.array(z.string()).min(1)`), as the ticket asked. The old single-prose
shape was replaced rather than kept alongside: the ticket says "instead of", and
two spellings of one contract is exactly the divergence this ticket exists to
close. The tool description now describes the multi-ticket contract and warns
explicitly that calling it once per ticket yields a feature per ticket — the
failure mode the lap-1 review found. Three prompt/doc surfaces that named the
parameter were renamed with it: the project skill's tool list and its routing
destination 2 (which now shows a two-string example and the one-call-per-change
rule), plus the project session's system prompt in
`packages/server/src/launcher/artifacts.ts`, which lists the same signature.

Acceptance criterion 4 — both doors through one service function — needed no code:
`toolCreateFeature` already called `features.quickChange()`, and ticket 7's
review-ticket append therefore already applied to the MCP door. The only thing
wrong was the arity of what it passed in. The existing MCP quick-change test now
creates a feature with three proses and asserts one feature, four tickets
(three typed plus the appended review ticket blocked by `[1, 2, 3]`).

## Surprises

The service layer was already fully multi-ticket, so this was a door widening and
not a plumbing job — most of the diff is prose. Worth noting for whoever reads the
lap-1 finding: `quickBrief()` renders a multi-prose brief as `## Ticket N`
sections rather than one blob, so the tool description's singular "brief.md is
the prose" had quietly become wrong too; that was the self-review fix.

One test fails on the full suite and is NOT mine and NOT in the stated baseline:
`packages/server/test/dev-pane.test.ts > kills the child process tree so the
port-holder is not orphaned`, asserting `pidAlive(-pgid)` is false. I confirmed it
on a single targeted run in isolation — it fails there too, so it is not load
flake — and my diff touches no file within reach of it (MCP schema, a system
prompt string, a skill markdown, one test). It reads as process-group reaping
semantics in this container. Everything else: typecheck clean across all four
packages plus scripts; 1857 passed, 3 skipped.

## Left undone

`.runcastle/` needed no edit — this ticket adds no service, env var, seed, or
process — so I ran none of the drive-script checks; there was nothing to check.

Two adjacent things I deliberately left. First, the ticket's context notes that
spec.md's Seams list names only the tRPC router for this widening, so nothing in
the spec documents the MCP door's shape; I did not amend spec.md, which is the
lap's record of intent, not of contract. Second, the shipped
`feature-grouping-forking-and-referencing` docs still describe this tool storing
"the single ticket in the same call" — historical build-era records of a merged
feature, so I left them as written rather than rewriting history.

## 10. Transcript stops attributing the launcher kickoff to "You"

# Ticket 10 — the transcript stops attributing the launcher kickoff to "You"

## What was done

Filtered the kickoff server-side, on the transcript read path, exactly as the ticket
asked. `packages/server/src/services/conversations.ts` gained one small internal
helper, `withoutKickoff(turns, kind)`, which drops every `user` turn that
`promptMatchesKickoff` recognises as the launcher's line; `conversationTranscript()`
now runs the transcript through it (using the session row's own `kind`, so the helper
is not hard-wired to project chats), and `deriveTitle()` was rewritten on top of the
same helper — same behaviour, one matcher instead of two loops. Every occurrence is
filtered, not just the first turn, which covers the re-sent kickoff a reopened
conversation carries: the resume framing is a prefix around the same line, and
`promptMatchesKickoff` compares on the line's own opening, so it matches anyway.
Three tests at the tRPC seam cover it (kickoff first turn, a mid-transcript resumed
kickoff, and a kickoff-only conversation). The client change is one branch.

## Deviation

AC4 asked that a kickoff-only transcript render "the existing honest empty-ish
state". I did not reuse the existing empty state verbatim, because its copy says
"no transcript for this conversation — ... cleared or was never written", which
would be a false statement about a conversation whose transcript is right there.
Instead `ConversationTranscript` renders a second `DimLine` with accurate copy
("nothing was said in this conversation — it opened and closed before you typed
anything") when no human turn survives the filter. Same primitive, same idiom,
honest sentence. The consequence is that Claude's opening reply is hidden in that
one case; it is kept in every conversation the human actually took part in — I
would not drop real assistant content at the server, since the transcript is the
only durable record of what was said.

## Surprises

- Nothing about the kickoff match needed changing for resumed conversations. The
  40-character prefix comparison that exists to survive TUI re-flow happens to make
  the resume framing transparent for free.
- `bun run test` has one failure that is not in the ticket's baseline:
  `packages/server/test/dev-pane.test.ts:183` ("expected true to be false" —
  `pidAlive(-pgid)` after a process-group kill). It fails identically on a single
  targeted run in isolation, and my diff touches only `conversations.ts`, its test,
  and one web component — nothing near PTYs or process groups. I read it as a
  sandbox process-reaping difference, not mine. Everything else: 1850 passed,
  3 skipped; typecheck clean across core, server, web, design-system and scripts.

## Left undone

- `apps/web` still has no component-level tests, so the new "nothing was said"
  branch is verified by reading, not by a test. The server-side filter — the part
  that could drift — is the part under test.
- Kickoff *overrides* (`setKickoffOverride`, the lap and conflict briefings) live in
  an in-memory map and are not durable, so a transcript of an overridden session
  would still show its briefing as a user turn. Project conversations never take an
  override, so this ticket is unaffected; a future ticket that wants transcripts for
  feature sessions would need the override persisted on the session row.
- `.runcastle/` drive scripts needed no change: this ticket adds no service, env var,
  seed or background process. I ran no drive scripts (the sandbox is hermetic) and
  made no edits to them.

## 11. lapAccount scopes its review digest to the current lap

# Ticket 11 — lapAccount scopes its review digest to the current lap

## What was done

`lapAccount()` in `apps/web/src/lib/feature-ui.ts` took a second argument, the lap
being accounted for, and now filters the ticket batch to that lap before it picks
anything. `DigestTicketFigure` gained an optional `lap`. `ReviewBody` passes
`feature.lap`. Passing no lap accounts every ticket handed in, unchanged — that is
what keeps the existing tests at `feature-ui.test.ts:1718-1771` untouched and green,
and it is the honest reading of a batch whose figures carry no lap stamp.

One deviation from the ticket's framing: the ticket names only the review pick, but
I scoped the per-ticket fallback too. A "What landed this lap" block listing lap 1's
burner digests under a lap-2 heading is the same cross-lap lie in a different font,
and scoping only half of it would have made the fallback the new leak. Consequence:
in the acceptance scenario (lap-1 review done, lap-2 tickets pending) the function
returns `null`, so the card renders no account block and the summary row's explicit
"no review ran this lap" state stands alone — which is the second branch AC2 allows.

Four new tests in a nested `describe` pin the cross-lap cases: the previous lap's
review never speaks for this one, the fallback is this lap's burners only, this lap's
own review leads once it has run, and lap 1 is exactly as it was.

## Surprises

- **The row above the block still lies across laps.** `reviewOutcome()`
  (`feature-ui.ts:819`) picks the last review ticket across the whole batch, exactly
  as `lapAccount` used to. In the AC4 scenario the summary row therefore reports
  lap 1's review as "ran · N findings" while the block below it correctly says
  nothing. The two are now scoped differently, which is a smaller inconsistency than
  the one the ticket removed but is real. Left alone — the ticket's ACs name only
  `lapAccount`, and `reviewOutcome`/`NO_REVIEW_ROW` are a decision about what the
  no-review row means, not a mechanical filter. See "Left undone".
- **`bun run test` is not fully green in this sandbox.**
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned` fails deterministically (3/3 runs, isolated and in the
  suite): `pidAlive(-pgid)` is still true after `stopDevPane`, i.e. the process group
  is not reaped here. It is not in the prompt's baseline list, but it is a POSIX
  process-group assertion in a server test and my diff is three apps/web presentation
  files — they cannot touch it. Everything else: 1855 passed, 3 skipped, 120 files.
  `bun run typecheck` is clean.
- `apps/web/tsconfig.json` includes only `src` and `vite.config.ts`, so the web test
  files are never typechecked — vitest transpiles them. Type errors in
  `apps/web/test/*` are invisible to `bun run typecheck`.

## Left undone

- **Scope `reviewOutcome()` (and `reviewWalkthroughUrl()`) to the lap the same way.**
  Both carry the same "last one in the batch" pick and the same doc comment saying
  lap 1 emits one review per feature. `reviewWalkthroughUrl` reads review *artifacts*,
  which carry no lap on the wire that I could see, so that one needs a wire change
  rather than a filter. Doing them properly means deciding what the summary row says
  on a lap whose review has not run — most likely `NO_REVIEW_ROW`, which would make
  decision #9's "no review happened stops being a silent state" true per-lap instead
  of per-feature. That is a ticket, not a drive-by.
- `.runcastle/` drive scripts untouched and unread beyond confirming no trigger
  applies: this ticket adds no service, env var, seed, or process. I ran none of the
  offline script checks because nothing in the diff reaches them.

## 12. Review the integrated fix batch

# What landed this lap

This batch closed the four findings the lap-1 review left open, plus one latent
cross-lap bug, and all five hold together on the integrated branch.

**A review always runs — on the door that had no agent to make it.** The quick
change path had no session emitting tickets, so decision #9's mandate had nothing
to enforce it there; `quickChange()` now closes every batch with a `kind:"review"`
ticket blocked by all the typed ones. Both quick doors go through that one
function, because the second fix widened the MCP `create_feature` tool from a
single prose blob to `tickets: string[]` — so the project chat, which this feature
made the primary way to create anything, can finally do the multi-ticket quick
change the same feature added, in one call instead of one feature per ticket.

**Lap became legible where it was still lying.** The tickets ledger suppressed its
lap headers whenever only one lap had rows, so a lap-2 feature carrying nothing but
lap-1 leftovers rendered flat under a banner reading LAP 2. Suppression now keys on
the feature's own lap — which is what "keep lap 1 quiet" actually meant — and the
ledger and the notes panel can no longer disagree, since both pass the same lap.
`LapSections` got its first unit tests in the process.

**Two smaller truths.** The conversation transcript stopped attributing the
launcher's kickoff line to "You", filtered server-side so the title and the
transcript can never disagree about who spoke first; and `lapAccount()` stopped
answering "What landed this lap" with a previous lap's summary.

## What the review found

Four findings, none of which undo a fix; full detail in `test-notes.md`. Two are
worth acting on. The first is this batch's own fixes disagreeing: `lapAccount` is
now lap-scoped but `reviewChecks`/`reviewOutcome` on the same card are not, so from
lap 2 on the review row vouches for an earlier lap's review while the block that
would say what it found renders nothing at all — and "no review ran this lap", the
row decision #9 exists to make loud, can never fire again once any lap has reviewed.
The walkthrough player and the merge dialog's last catch share the blindness. The
second is a blast radius: making the review ticket unconditional means every quick
change now inherits `executeReviewTicket`'s hard `agent-browser` PATH check, which
fails the ticket *before* rendering the prompt — so the code review that "always
runs" does not, and the failed run leaves the feature parked at `implementation`
with only a Resume that fails identically.

## Surprises

The seams named `review_drive (integrated branch)`, but the burner sandbox is
hermetic — no app, no browser, no drive slot — so nothing could be driven. Every
acceptance criterion was verified one layer beneath the screen instead: the tRPC
caller, the MCP tool function, the rendered component, the pure helper. That is
weaker evidence than clicking and it is worth knowing which claims rest on it.

The suite is not fully green here: `dev-pane.test.ts`'s process-tree kill fails,
identically alone and under load, and the batch touches no dev-pane file — this
container does not reap process groups the way the test needs. Typecheck is clean;
everything else passes (1861).

Also surprising: `test-notes.md` is regenerated from the note rows, and there is no
server in the sandbox to call `add_note`, so the notes were written into the doc by
hand and a later note mutation will overwrite them. This digest is their durable copy.

## Left undone

Nothing was fixed — this is a review ticket and the findings are the deliverable.
Deliberately not chased: whether the appended review ticket's pointer to `brief.md`
resolves on the feature branch at review time; the `create_feature` schema still
requiring an `oneLiner` the quick path discards; and whether the reworked skills are
rendered from this branch or the installed global pack, which the last lap flagged
and this sandbox still cannot test.
