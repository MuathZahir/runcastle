# Decisions — ux-issues

## 1. One feature, one lap, all six issues
**Decision:** Keep all six UX complaints in this single feature and spec it whole (one lap): lap UX, review-diff UX, create-feature UX, test-drive notes / "to ticket" UX, conflict-button timing, project-chat prominence.
**Why:** Each item is small; splitting into six features is ceremony. They share one theme — the pipeline's state isn't legible in the UI — so one polish lap is the right container. Confirmed by the human.

## 2. Feature creation is chat-first
**Decision:** Feature birth moves into the project chat. The NEW FEATURE form overlay (title + one-liner + Advanced) is demoted — the primary "new feature" path opens the project conversation, which understands the intent and creates the feature.
**Why:** The form "looks very bad" and pushes brief-writing onto the human; the project session exists precisely to turn raw intent into well-briefed features. Confirmed by the human against a screenshot of the current form.

## 3. Project chat is an advisor, not a griller
**Decision:** When told a feature idea, the project chat must look at existing features (shipped and in-progress), read their summaries/docs, give recommendations, ask clarifying questions, and suggest how to split the work effectively — then create the feature(s). It must NOT do the ideation grilling; that stays in the feature's own grill session.
**Why:** The human wants intake to be genuinely portfolio-aware ("if I tell it a feature I want, it should look at previous features… before creating"), with the deep design interrogation deferred to the per-feature session.

## 4. Quick change must support multiple tickets
**Decision:** The Quick door is kept but reworked: it must allow creating multiple tickets (not one prose blob → one ticket), with a better UI.
**Why:** Human: "The 'Quick' button is also not very useful. I should be able to create multiple tickets."

## 5. Project chat becomes a full conversation list
**Decision:** The project workspace becomes a conversation list: "New chat" is the default, prominent action; past conversations are listed (auto-titled from the first message, dated) and resuming one is an explicit click, never the default. One conversation live at a time (launcher's one-terminal rule stays); ended chats keep their transcript viewable and any past chat can be reopened and continued.
**Why:** Today opening the chat silently resumes the single per-project session — "clunky and annoying," no way to have multiple chats and go back to them. A start-fresh-only button wouldn't give "go back to them."

## 6. Lap is the organizing spine of feature history
**Decision:** Tickets ledger and test-drive notes panel group entries under "Lap N" headers (current lap expanded, prior laps collapsed). A lap banner appears in the feature workspace from lap 2 onward (which lap, what kicked it off, what landed before). The activity feed renders `lap.started` as a visible divider. Lap 1 stays quiet — no iteration ceremony on a feature that merges first try.
**Why:** `lap` is already stamped on every ticket, note, session, and event; the UI just renders everything flat. Grouping puts "what was done this lap" where the user already looks, instead of adding a new view nobody visits.

## 7. Review must surface planned later laps — and flip its primary
**Decision:** When spec.md has a non-empty `## Later laps` section, the review phase changes shape: (a) a "Planned next lap" card shows the deferred scope verbatim next to what this lap delivered; (b) the next-step bar primary flips to "Start lap N+1", demoting Ship & merge to secondary; (c) the merge dialog warns "spec still lists deferred scope: …" as the last catch.
**Why:** The real failure story: the human finished burning, reached review, and shipped via the main button because nothing on the review page knew a lap 2 was planned. The main button is the thing that steered wrong, so the main button must change — while keeping "lap 1 is enough" one click away, since that call is the human's.

## 8. Review page leads with a prose "What landed this lap" summary
**Decision:** The review agent writes a human-readable prose summary of what the lap delivered, as part of its pass; ReviewBody renders it at the top of the summary card. Not a changed-files list, not hunks. Fallback when no summary exists: render the per-ticket burner digests, clearly marked as the agents' own accounts.
**Why:** The human wants "a summary of what this feature did," more readable than the build page's per-ticket changes. The review agent runs last, has spec + all ticket digests, and is the only agent that actually saw the result working — so its summary beats any server-side synthesis.

## 9. A review always runs — code review always, drive when applicable
**Decision:** Every lap's ticket batch includes a review ticket. The code review ALWAYS runs — a runcastle version of Matt Pocock's review skill (the implementing agent must read the original from github.com/mattpocock/skills and base the runcastle skill on it), vendored into packages/skills. The app test-drive runs additionally when the change is drivable. "No review happened" stops being a silent state.
**Why:** Today the review ticket is optional and its absence is invisible on the review card (only the merge dialog mentions it). The human wants review to be a constant of the pipeline: code review unconditionally, driving on top when there is something to run.

## 10. Resolve-conflict affordance is never hidden
**Decision:** The resolve buttons (next-step bar + ConflictCard) always show while a conflict stands. When a session is live, the button reads "End session & resolve" and performs the compound action in one click: gracefully end the live session, then launch the resolve session with the conflict kickoff. An explanatory line ("one terminal per feature — your live session will be closed") keeps it honest.
**Why:** Today both affordances are hidden whenever any session is launching/live (one-terminal rule), which reads as the button randomly not existing until the chat ends. Never hide the affordance; make it explain and perform the dance instead.

## 11. Notes are a findings inbox; triage happens in one place
**Decision:** The notes panel becomes a pure findings inbox — during a drive you only type observations. Per-note "→ ticket" is removed. Triage moves to a single "Address notes" action in the next-step bar offering the fork explicitly: quick fixes → batch-promote selected notes to fix tickets; needs rethinking → start the lap session seeded with all open notes. The panel gets visual polish and the lap grouping from decision 6.
**Why:** Per-note mechanical promotion made the human do ticket triage one click at a time, and it competed confusingly with the Iterate path (two roads into tickets, no guidance on which). One explicit fork at the bar answers "promote or iterate?" at the moment it matters. Confirmed: "that's exactly it."

## 12. Two rail doors, redefined by how much thinking you want
**Decision:** The rail head keeps its two buttons, redefined. "New" opens a fresh project chat directly — the intake door for anything deserving a conversation. "Quick" opens one compact overlay for "I already know what this is," with two modes: Quick change (title + multi-ticket list, births at implementation) and Park a draft (title + optional one-liner, no branch, no session). The NEW FEATURE overlay is retired; branch choice moves to when a feature is actually started.
**Why:** Both Quick modes are skip-the-conversation paths, so they share a door; no third button. Each button's meaning gets sharper: New = talk, Quick = type and go.
