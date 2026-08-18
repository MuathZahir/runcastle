# Test notes

## Lap 1

- [ ] Quick change births a ticket batch with no review ticket, so "a review always runs" has a hole on the door this lap reworked.

Steps: rail head -> Quick -> Quick change tab -> title "Quick polish batch" + two ticket sentences -> Create tickets.

What happened: the feature is born at implementation with exactly the 2 tickets I typed (ledger reads "TICKETS 0/2 done", next step "Burn 2 tickets"). No review ticket is present. Confirmed in packages/server/src/services/features.ts:339 quickChange() -- it calls storeTickets() with proses.map(...) only; nothing appends a review ticket.

What I expected: decisions.md #9 says "Every lap's ticket batch includes a review ticket... 'No review happened' stops being a silent state", and spec.md repeats "A review always runs." The spec puts the mandate on the ticket-emission skill (packages/skills), which the quick path bypasses entirely -- there is no agent emitting tickets here. So every quick-change feature reaches review having never been code-reviewed.

Mitigating: the explicit no-review state on the review page (also landed this lap) makes the absence loud rather than silent. But the invariant is enforced only in prompt content, not on the quick-change server path.
- [ ] On a lap-2 feature whose tickets are all lap-1 leftovers, the tickets ledger drops the "Lap 1" header and renders them unlabeled -- so the ledger still cannot answer "what was done this lap".

Steps (demo project, feature "Quick polish batch"): quick change with 2 tickets -> override G4 to review -> promote 2 drive notes into fix tickets (4 lap-1 tickets total, all pending) -> Iterate to start lap 2 -> end the lap session -> click the "build" step to view the ledger.

What happened: the ledger renders "#1 #2 #3 #4" flat under "TICKETS 0/4 done", with no lap header at all, while the lap banner directly above reads "LAP 2 ... Lap 1 landed no tickets". Nothing on the ledger says those four tickets belong to the previous lap. Meanwhile the notes panel in the same feature DOES show "LAP 1 / LAP 2" headers, so the two panels disagree about whether lap is worth showing.

Cause (verified): apps/web/src/ui.tsx:107 -- LapSections short-circuits with `if (groups.length <= 1) return <>{children(groups[0]?.rows ?? [])}</>`. groupByLap() is correct and returns exactly one group here; that case is even unit-tested (apps/web/test/feature-ui.test.ts:918, "expands the last lap with rows when the current lap has none yet"). The header suppression is purely LapSections'.

What I expected: decisions.md #6 keeps lap 1 quiet for "a feature that merges first try" -- but this feature is on lap 2, so that rationale does not apply. The suppression keys on "how many laps have rows", not on "is this feature past lap 1", so a lap-2 feature carrying only stale lap-1 tickets reads exactly like a lap-1 feature.

Also worth noting: LapSections has no unit test of its own -- no test file references it. The one-group short-circuit is the untested branch.
- [ ] This review ran on the OLD review-ticket prompt, so the lap's own skills rework did not take effect for it -- the burner renders skills from the installed global pack, not from the feature branch.

What I observed: the prompt I was handed for this ticket has no "Code review -- always, and first" step, no two-axis Standards/Spec review, and it still says the review "failed" if the drive would not start. The reworked packages/skills/burner/review-ticket.md on feature/ux-issues says the opposite (line 9: "A code review -- always"; line 93: a drive that cannot start "no longer sinks the review").

Verified: diffing C:/Users/user/.bun/install/global/node_modules/runcastle/skills/burner/review-ticket.md against packages/skills/burner/review-ticket.md reports DIFFERENT, and the installed file's opening lines match my prompt verbatim. Listing the installed pack's skills dir shows converge, ideate, project, qa, revisit, spec, tickets, waypoint -- the new code-review skill is absent. RUNCASTLE_SKILLS_DIR points at that installed dir.

What I expected: nothing here is necessarily a defect -- skills legitimately ship with the released package. But it means a lap whose whole point is reworking prompt contracts cannot be exercised by those contracts in the same lap, and decision 9's "the code review ALWAYS runs" is not yet true on this machine. Worth knowing before the review page's "no review ran this lap" row is read as a bug rather than as the pack being stale.
- [ ] The quick-change contract widened to a list of tickets only on the tRPC door; the MCP door the project chat uses still takes a single prose blob -- so the chat, which this lap made the *primary* creation path, cannot do the multi-ticket quick change the same lap added.

Verified in code:
- packages/server/src/trpc/routers/feature.ts:60 -- `tickets: z.array(z.string()).min(1)`. Widened. I exercised this live: Quick -> Quick change -> two ticket rows -> "Create tickets" produced a feature born at implementation with tickets #1 and #2.
- packages/server/src/mcp/server.ts:1070 -- `ticket: z.object({ prose: z.string().min(1) }).optional()`. Still exactly one prose ticket, and the tool description at :1056 still reads "creates the feature at the implementation phase with that one ticket".
- packages/skills/packs/runcastle/skills/project/SKILL.md:85 (routing destination 2) documents the same single-ticket shape: `create_feature({ title, oneLiner, ticket: { prose } })`.

What I expected: decisions.md #4 is unqualified -- "Quick change must support multiple tickets... I should be able to create multiple tickets." Decision #2 then moves the primary feature-birth path into the project chat. Together those imply the chat can emit a multi-ticket quick change; today it would have to call create_feature three times to make three tickets, producing three features rather than one feature with three tickets.

Fair caveat: spec.md's Seams list names only "tRPC feature router" for this widening, so the MCP tool arguably sat outside the specced scope. Flagging it as the contradiction between the two doors rather than as an unmet acceptance criterion -- the human should decide whether the chat door needs to catch up.
- [ ] The conversation transcript attributes the launcher's kickoff line to "You", so the human's own transcript opens with a sentence they never typed.

Steps: project workspace (demo-app) -> New chat -> accept Claude Code's folder-trust prompt so the session goes live -> End session -> Transcript on that conversation.

What happened: the transcript's first bubble is labelled "You" and reads "Proceed with your task: invoke the /runcastle:project skill and drive the project session." That is the launcher's kickoff, not anything the human wrote. The only other bubble is Claude's opening.

What I expected: the same line to be hidden, or labelled as the system kickoff. The server already knows it is not the human's -- packages/server/src/services/conversations.ts:51 `deriveTitle()` explicitly skips it, with the comment "every runcastle terminal opens with a kickoff line typed in by the launcher, so taking the literal first would title every project conversation 'Proceed with your task...'". So the two surfaces disagree: the title logic treats the kickoff as not-the-human's, the transcript renders it as the human's.

Cause: apps/web/src/components/ConversationTranscript.tsx:29 maps every `user` turn to "You" with no kickoff filter. `promptMatchesKickoff` already exists server-side and is what the title path uses.

Impact is small but lands exactly where this lap was aiming: the transcript is the thing that makes an ended conversation worth keeping, and it currently misreports who said the first thing in it.
- [ ] SUMMARY -- review of the integrated ux-issues lap. All five implementation tickets landed; nothing was missing outright, so this is a review of a fully-built feature. Six findings, none of them blocking; the lap does what it set out to do on every surface I could reach.

HOW I EXERCISED IT. Booted the drive (feature/ux-issues, per-branch DB, dev server on :26898) and drove a browser through a scratch project I created outside the repo, so nothing was written into the human's checkout. Walked: onboarding -> project chat -> both creation doors -> a quick-change feature through build, review, note triage, Iterate to lap 2, and back to lap-2 review. Also ran the full monorepo test suite and typecheck, and read the four reworked skill files against spec.md/decisions.md. Recording: C:\Users\user\.runcastle\reviews\tkt_Wh0x7SHwp1ym\walkthrough.webm.

VERIFIED LIVE:
- Project chat (AC1): idle workspace is a conversation list with a prominent "New chat" and dated past conversations; New opens a fresh chat; a past chat resumes ONLY on an explicit Reopen click (I resumed one and got the same session id f469a63c back); transcripts render with YOU/CLAUDE turns, and an honest empty state when Claude Code wrote none; Reopen is correctly disabled for a chat that never reached a session id ("this one never got started"). Typing "talk" in the palette now returns exactly one row -- Project chat -- and Preparation is gone from that result. The skill's advisor framing shows up verbatim in a live session ("I'll check it against what's already shipped and in flight before I say anything about it"). No grilling.
- Creation doors (AC2): New goes straight to a fresh chat. The NEW FEATURE overlay is gone from the codebase entirely -- only a historical comment survives in CommandPalette.tsx. Quick is one overlay with two tabs; Quick change takes a title plus an add/remove ticket list, pluralises its CTA, live-updates its "branch ... starts at build with N tickets" footer, and really does birth a feature with N tickets. Park a draft creates no branch (confirmed with git branch in the scratch repo), and Start offers the base picker under Advanced.
- Lap legibility (AC3): the notes panel groups under LAP 1 / LAP 2 headers with prior laps collapsed; per-note "-> ticket" is gone (rows now carry only mark-handled / Edit / Delete); "Address notes" appears in the bar when open notes exist and opens the explicit fork -- QUICK FIXES with checkboxes and "Make N tickets" vs NEEDS RETHINKING with "Start the lap session"; empty selection correctly disables the button. Batch promote turned 2 notes into tickets #3 and #4 in one mutation. The activity feed renders a real "RETHINK -- LAP 2" divider. The lap-2 banner appears with what kicked it off and what lap 1 landed.
- Review page (AC4): the summary block renders with labelled rows, and "no review ran this lap" is explicit rather than an omitted row. With a `## Later laps` section present, the PLANNED NEXT LAP card renders the deferred scope verbatim, and the merge dialog's last-catch warning quotes it back. I opened the merge dialog and cancelled -- nothing was merged.

VERIFIED BY LOGIC/TESTS (not reachable live):
- The next-step primary flip to "Start lap N+1" is thoroughly covered in apps/web/test/feature-ui.test.ts:816-882, including its precedence rules. Live it stayed on "Burn 4 tickets" because pending fix tickets outrank it -- that is the tested, documented contract, not a defect.
- The never-hidden conflict resolve is covered at feature-ui.test.ts:648-682, and both surfaces implement it: the bar (feature-ui.ts:1731) and ConflictCard (ReviewBody.tsx:704), each flipping to "End session & resolve" when live and both showing the shared ONE_TERMINAL_WARNING. I could not stage a real conflict.
- lapAccount() -- the "What landed this lap" digest plus its labelled per-ticket fallback -- is well covered (feature-ui.test.ts:1718-1771). I never saw a real digest render, since no review ticket has run on this branch.

CHECKS. Monorepo typecheck: clean across core, server, web and design-system. Full vitest suite: 1839 passed, 2 failed -- both 5s timeouts in git-heavy tests (feature-create, projects) while the dev server and drive were competing for the machine. Re-run in isolation they pass 20/20, so I read them as load flakes, not regressions. Note that `bun test` in packages/server is NOT the suite: that package has no test script, the runner is vitest at the root, and `bun test` reports 21 phantom failures because Bun's `vi` shim has no setSystemTime.

WHAT I COULD NOT REACH: a real merge conflict; a real review-agent digest; the ledger's lap headers with tickets on two different laps; and any assessment of whether resuming a conversation preserves a long exchange -- mine had nothing said in it. One observation I could not judge: reopening re-sends the launcher kickoff, so the resumed agent re-introduced itself rather than picking up; with an empty conversation I cannot tell whether that is wrong.

SMALLER THINGS, not worth their own tickets: the merge dialog inlines the deferred-scope markdown as a run-on "- a - b" string where the review card renders proper bullets; the lap banner says "Lap 1 landed no tickets" while 4 unburned lap-1 tickets carry forward, which is accurate ("landed" counts done) but says nothing about what did not land; the new code-review skill asserts "runcastle features always have one [a spec]" when quick-change features by design have no spec.md; and apps/web has no component-level tests at all, so LapSections, ConflictCard, DraftBody and ReviewBody are exercised only through their pure helpers.
- [ ] Drive teardown left its scratch tree behind: review_drive stop released the slot but its teardown hook failed with EBUSY, and I could not clear it either.

What happened: `mcp__runcastle__review_drive({ action: "stop" })` returned `{ ok: true, drive: null }` -- so the machine-wide slot IS released and the checkout is correctly back on `main` with a clean tree -- but the response carried a hookFailure: `bun .runcastle/drive-stop.ts` exited 1 with "EBUSY: resource busy or locked, rm 'C:\Users\user\.runcastle-drive-ux_issues'" at .runcastle/drive-stop.ts:51.

What I did to narrow it: re-ran drive-stop.ts with RUNCASTLE_DATA_DIR set (same EBUSY), then deleted subdirectories one at a time. The lock is on exactly one leaf: worktrees/proj_JGiI7ZLq96uX/__project -- the project-chat worktree. The directory is EMPTY (Get-ChildItem -Force returns nothing); only the directory node itself is locked, which on Windows is the signature of a live process holding it as its current directory. Scanning Win32_Process command lines for that path found nothing but my own probe, so I could not name the holder without handle.exe, and I chose not to kill unidentified processes on the machine. Retried the delete three times over ~12s; still locked.

What I expected: teardown to remove the tree, per drive-stop.ts's own "Idempotent: an already-gone tree is a successful teardown" contract.

Impact is low -- what survives is a few empty directories, and the checkout and the drive slot are both fine. But it is worth knowing that a project-chat session started during a drive can outlive the drive's teardown by enough to fail it. Note this is drive/teardown infrastructure rather than the ux-issues surfaces, so it may belong to a different feature; recording it because it happened on this machine during this pass. Also: it is plausible I contributed by starting project chats inside the drive, which a review normally would not do.
