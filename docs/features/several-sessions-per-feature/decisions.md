# Decisions — several-sessions-per-feature

Planned without the human (self-planning run, 2026-10-21), then revisited with the
human the same day. A decision still marked **Assumed** was made without the human;
the rest are the human's.

Terms used throughout:
- **Main chat** — the feature's one `chat` conversation that exists today: it plans,
  becomes the lead after Go, and is resumed by every Chat door.
- **Side session** — a new, extra conversation on the same feature, opened by the
  human next to the main chat.

## Round 1

## 1. One lap: the whole feature except a separate worktree
**Decision:** Lap 1 builds side sessions end to end: opening one as a fork of the main chat, the roles that keep the main chat in charge, the switcher that lists and reopens them, the Codex answer, and the scenario chat forking the main chat. A separate worktree per side session is not built; side sessions share the main chat's worktree (decision 5). If sharing collides in real use, a separate worktree is the next lap, recorded under the spec's `## Later laps`.
**Why:** The human's need is concrete ("ask about something", "do something else", "create the scenario", each knowing what we were doing) and every part of it is small once side sessions share the main chat's place. The one expensive part — a second checkout with its own landing path — is only needed if sharing proves painful, and a test drive will show that.
**Assumed.** Alternative: a thin lap 1 of read-only side sessions, with writing and the scenario fold deferred.

## 2. A side session always forks the main chat
**Decision:** "New side session" forks the main chat's conversation (Claude Code `--resume <main> --fork-session`), so it starts knowing the feature and what was being discussed. The human is not asked to choose between fork and fresh. It starts fresh, with the feature's state header, only when there is nothing to fork: no main chat yet, or its transcript is gone.
**Why:** Forking is exactly the human's ask ("each session should have the context of the feature and what we were doing"), and one action with no choice keeps the door as simple as the Chat door. Claude Code's own auto-compact handles a fork that starts near the context limit, the same stance `one-chat-per-feature` took on long chats.
**Superseded by 14.**

## 3. A side session opens by stating its role and waiting for the human
**Decision:** A forked side session's first message tells it that it is a side session of this feature, forked from the main chat; that it must not carry on the main chat's task; what it may and may not do (decision 4); and to wait for the human's ask. It does not act until the human types.
**Why:** The fork carries the main chat's own instructions ("drive ideation to completion", "dispatch the next round"). Without a reset, a side session would pick up the main chat's job and race it — the one failure that would make forking harmful.
**Assumed.** Alternative: the side session opens with a one-line question the human picked at launch ("ask a question", "do a task").
**Challenged:** A first message is a weak override of an inherited "drive ideation to completion". The role should also be set in what runcastle writes at launch (the appended system prompt and hooks), under a session kind of its own.

## 4. The main chat alone steers; side sessions do everything else
**Decision:** The main chat stays the feature's one steering session. Only it is the lead after Go and receives the lead's messages, and only it may report planning steps (`complete_phase`), emit tickets (`emit_tickets`), or run rounds (`dispatch_round`, `stop_round`, `declare_ready`, `wait_for_you`). A side session may read everything, edit the feature's docs, edit or cancel tickets, resolve findings, and park draft features.
**Why:** Two sessions dispatching rounds or emitting the same ticket batch would fight over the feature's one plan. Everything else is either guarded already at call time (a ticket claimed by a running burn cannot be edited) or is recorded on disk and on the timeline, where the main chat sees it.
**Superseded by 15.**

## 5. Side sessions share the main chat's worktree and write rules
**Decision:** A side session runs in the feature's talk worktree, alongside the main chat, and may write exactly what the main chat may write in the current state (docs-only in planning today; anything after Go). Its commits land the way the main chat's do: straight onto `feature/<slug>` outside a burn, and through the chat's temp branch and the landing queue during one. Its briefing says the directory is shared and to stage only its own files.
**Why:** It needs no new checkout, branch or landing path — the existing burn-time handoff already carries any commit made in that worktree. The risk, two agents editing one directory at once, is the solo developer's own doing and is common practice with coding-agent CLIs. A separate worktree is the next lap if it bites (decision 1).
**Assumed.** Alternative: each side session gets its own worktree and branch, landed into the feature branch through the per-feature landing queue.

## 6. On Codex, a side session starts fresh with the main chat's latest turns
**Decision:** Runcastle has no Codex fork today. On Codex, a side session starts a fresh conversation whose first message carries the feature's state header and a quote of the main chat's last few turns, read from its transcript. If the installed Codex CLI has a real fork command, the build uses it instead; the burn verifies this against the installed CLI rather than guessing.
**Why:** It gives Codex the same promise ("knows what we were doing") with what runcastle already does: read transcripts. Making side sessions Claude-only would split the product by runtime for no good reason.
**Superseded by 14**, which makes this start the only one, on every runtime.

## 7. Side sessions never take the feature's one-terminal slot
**Decision:** The "one terminal per feature" guard keeps meaning the main chat (and the drive-fix session, which shares that slot today). Side sessions neither block nor are blocked by it, there is no cap on how many are live, and one can be opened in all four states and whatever the main chat is doing: live, ended, or running headless (a self-planning run or a lead wake).
**Why:** The point is to talk while the main chat is busy, for instance while the lead runs rounds headless. A cap is mechanism with no observed need at solo scale.
**Assumed.** Alternative: a small cap on live side sessions, for instance three.

## 8. Side sessions are named from their first message and reopened by resuming
**Decision:** A side session is named after the first thing the human types in it (not the main chat's history it inherited), the way project conversations are named today. Ended side sessions stay listed; reopening one resumes its own conversation, it does not fork the main chat again. There is no rename in lap 1.
**Why:** The project conversation list already proved this naming and reopening. Re-forking on reopen would throw away the side conversation the human came back for.
**Assumed.** Alternative: reopening an ended side session forks the current main chat afresh, so it knows the latest state.

## 9. On a feature drive, the scenario chat forks the main chat
**Decision:** The scenario chat (the "New scenario" / "Fix it" chat docked beside a running drive) forks the main chat when the drive is a feature drive, so it knows what the feature is and what was being built. It keeps everything else: its own kind, the drive's checkout, its write rules, its dock beside the drive, and its one-per-drive rule. While it is live it also appears in the feature's session list. A project drive's scenario chat is unchanged: it has no main chat to fork.
**Why:** The human named this case ("or in this case, create the scenario"). Making it a plain side session would move it off the drive's checkout, which is where the app it is writing scenarios against actually runs.
**Superseded by 17.**

## 10. The session switcher lives in the chat's header
**Decision:** The feature's chat area gets a session switcher in its header: the main chat first, then live side sessions, then ended ones, and a "New side session" action. Picking one shows its terminal (live) or its transcript with Reopen (ended). This is the minimal switcher on today's Chat tab; *Design mode* puts its own switcher in the same place, and whichever merges second makes them one.
**Why:** The brief says side sessions join Design mode's switcher; building the same shape here keeps the merge a reconcile rather than a redesign, and does not take over the page layout Design mode owns.
**Assumed.** Alternative: a separate "Side sessions" list in the feature body.

## Round 2

## 11. The main chat hears what side sessions changed
**Decision:** Nothing is merged back into the main chat's conversation, but its next turn is told what changed: the per-turn hook that already injects the feature's state adds one line naming side-session changes since the main chat's last turn (docs files edited, tickets edited or cancelled, findings resolved), with a pointer to `get_feature_context`. A side session's talk itself stays in the side session.
**Why:** Decision 4 lets a side session change the plan the main chat is steering. A lead that dispatches a round over a ticket a side session just cancelled, or redraws a preview from a stale `decisions.md`, is the bug forking invites. One line per turn is cheap and uses a hook that already runs.
**Superseded by 18.**

## Round 3 (from the challenger's unasked branches)

The challenger also asked how side sessions overlap the old Q&A and revisit sessions. They no longer exist: `one-chat-per-feature` folded both into the main chat, so a side session overlaps only the main chat, which decision 4 settles. What happens to live side sessions when a feature is deleted, and who amends the charter, go to the spec as detail.

## 12. A side session waiting on the human shows a dot in the switcher
**Decision:** When a side session finishes a turn or waits on a permission prompt while the human looks elsewhere, its row in the switcher and the switcher itself show a waiting dot. It does not change the feature's status line or the next-step bar, which speak for the main chat.
**Why:** A side session the human forgot is a stalled task with no signal; the session row already carries an "awaiting input" flag to draw from. Keeping it off the status line keeps the feature's headline about the feature, not the side errand.
**Assumed.** Alternative: no signal; the human checks the switcher.

## 13. A side session cannot become the main chat in lap 1
**Decision:** There is no "make this the main chat" action. A side session that found a better direction writes it into the feature's docs; the human can also tell the main chat directly. Promoting a side session to lead is recorded under `## Later laps`.
**Why:** Promotion would move the lead role, its message queue and the planning steps between conversations mid-feature — a new mechanism with no observed need yet.

## Revisited 2026-10-21

The human, on the plan: forking uses too much context; "why can't all the sessions be the same"; then, remembering Go, back to a main chat and side sessions, with the line between them made as thin as Go allows. Decisions 14–18 are the human's.

## 14. A side session starts fresh with the main chat's latest turns
**Decision:** No session forks, on any runtime. A side session's first message carries the feature's current state (the same short header the chat gets), the main chat's last few turns quoted with a cap of about two thousand tokens, and the paths of the main chat's full transcript and `decisions.md` so it can read further back when asked. Claude Code and Codex start the same way. Decision 3 still holds: a side session opens by stating its role and waiting for the human. Supersedes 2, 6, and the fork parts of 1.
**Why:** A fork's cost grows with the main chat and is paid on every turn; the excerpt keeps "what we were doing" at a small fixed cost. One way to start means no runtime-specific path.

## 15. Only the round loop belongs to the main chat
**Decision:** The main chat plans and, after Go, is the lead. It alone runs rounds (`dispatch_round`, `stop_round`, `declare_ready`, `wait_for_you`) and it alone receives Go and the messages a round sends back. A side session may do everything else, including writing the spec, emitting tickets and reporting planning steps (`complete_phase`), editing docs and tickets, resolving findings, and editing code after Go. Supersedes 4.
**Why:** After Go the feature runs a loop on its own — dispatch, wake on the result, dispatch again — and that loop needs exactly one owner, or two sessions would both react to every result. Nothing else does: the server already refuses the collisions that matter (a second round while one runs, editing a ticket a burn has claimed), and the human is trusted not to drive two sessions at the same thing.

## 16. /clear keeps the main chat the main chat
**Decision:** The main-chat role belongs to the session, not to the conversation in it. A `/clear` empties the main chat's memory and runcastle resumes the post-clear conversation from then on; it is still the lead. A side session opened after a clear quotes the turns since the clear.
**Why:** The feature's real state lives in the docs, tickets and rounds, which the main chat can re-read; tying the role to one conversation would make a routine `/clear` silently orphan the lead.

## 17. The scenario chat gets the same fresh start
**Decision:** On a feature drive, the scenario chat's first message carries the same feature state and main-chat excerpt as a side session (decision 14). Everything else about it is unchanged: its own kind, the drive's checkout, its write rules, its dock, one per drive. A project drive's scenario chat is unchanged. Supersedes 9.
**Why:** The human named this case; the excerpt gives it "what we were doing" with no cross-folder resume to get wrong.

## 18. No notice to the main chat about side-session changes
**Decision:** Dropped. Side sessions' changes reach the main chat only through the record (docs, tickets, timeline) and the human. Supersedes 11.
**Why:** The human's stance: people do not drive two sessions at the same thing, and the server refuses the collisions that matter. A notice is mechanism without an observed need; it is parked under `## Later laps`.

## Revisited 2026-10-22 — reconciled with Design mode

Design mode merged to main first; merging main into this branch made the two switchers one, as decision 10 said the second to merge would.

## 19. Side sessions join Design mode's one switcher
**Decision:** The switcher lives in the page's one header row (Design mode's decision 12), not in the chat's own header. It lists the feature chat, the scenario chat while a drive errand is live, live side sessions, then ended ones with their age; a waiting side session's amber dot is on its row and on the switcher. "New side session" and a side session's End session are rows of its menu. The chat that plans and leads keeps Design mode's name, "Feature chat". Clarifies decision 10.
**Why:** Design mode built the column as a list of sessions so side sessions could join it without another layout change. Two switchers on one page is what decision 10 told the second merge to avoid.

## 20. A side session follows the main chat's write rule under Design mode
**Decision:** Design mode lets a human-attended feature chat write code (UI) and install in every phase, planning included. A side session gets exactly that rule, in its edit and install guards and in its system prompt. Applies decision 5 to Design mode's rule, as the spec anticipated.
**Why:** Decision 5: a side session writes exactly what the main chat writes in the current state.
