# Decisions — Designs and the plan get their own place

Planned by the lead alone, with no human present (2026-11-02). Every decision
below is the lead's own recommendation, accepted so the plan could be drawn;
each carries the alternative it was chosen over. A separate agent, given only the brief and these decisions, challenged them: decisions 17–22 answer the branches it raised, and a **Challenged** line records where it would have decided otherwise.

Check first: 8, 9, 17, 6, 3

## 1. Each design is recorded by the agent's own act, which also posts its card
**Decision:** A new agent tool, `show_design`, takes a design's page on the design server, a title, an optional screen width and an optional picture. It records the design for the feature (one entry per page, so showing it again updates it) and posts a design card in the chat. That record is the Design tab's list; nothing reads the plan's HTML to find designs.
**Why:** The brief asks for runcastle's own record, and Review Package already works this way: one call, one card, one record. Recording and showing in one act means a design cannot be listed without being shown, or shown without being listed.
**Assumed.** Alternative: runcastle finds designs by itself, by scanning the worktree's design pages.

## 2. The plan gets a card too, posted by its own tool
**Decision:** A new agent tool, `show_plan`, posts a plan card in the chat and opens the Plan tab beside it when the human has the feature open. The skills call it wherever they called `show_panel` on the plan today: when the lead asks for the yes, and after a redraw.
**Why:** `show_panel` leaves nothing in the chat, so a plan shown while the human was away is invisible when they come back. A card stays where they read.
**Assumed.** Alternative: runcastle posts the plan card itself whenever the lead waits with the "plan" kind of wait.

## 3. `show_panel` stops offering the plan and the design views
**Decision:** `show_panel` keeps Tickets, Details and Drive. The plan is shown only by `show_plan` and a design only by `show_design`.
**Why:** Two ways to show the same thing, one leaving a card and one not, is how designs got lost. Removing the second way keeps every showing in the chat.
**Assumed.** Alternative: keep `plan` and `design` on `show_panel` beside the new tools.

## 4. A design card shows its title, its width, a picture when there is one, and whether it waits for you
**Decision:** The design card shows the design's title, the screen width it is laid out at (Desktop, Mobile 390…), a picture of it when the agent passed one, and its state: "Waiting for you", "Approved" or "Dropped". A click opens that design in the Design tab. With no picture, the card is one row like a file card.
**Why:** A picture is what makes a design card recognisable, and a self-planning run already takes one to check its own screens, so it costs nothing to pass. Runcastle taking its own pictures would need a browser on the server for a nice-to-have.
**Assumed.** Alternative: runcastle captures the picture itself from the design server.

## 5. The plan card says what the plan holds
**Decision:** The plan card shows "Plan", the feature's one-line "what this is", and a line of counts: decisions, how many to check first, tickets (or "built by the agent"), designs. A click opens the Plan tab.
**Why:** The counts tell the human how big a read it is before they open it, and "to check first" tells a returning human where to start.
**Assumed.** Alternative: a bare "Plan" card with no counts.
**Challenged:** Decision and "to check first" counts come out of agent-written documents and can be wrong; the challenger would keep only the one-liner and the design count.

## 6. The Design tab is always there, and its home is the list of every design
**Decision:** Every active feature has a Design tab, whether or not a design server runs. It opens on the list of the feature's designs, those waiting for the human first, then the rest, newest first within each; each row with its picture or a placeholder, title, width, state and a "New" mark until the human has opened it. Opening a row shows that design live, as the Design view does today, with "All designs" to go back and arrows to step to the previous or next design; opening one starts the design server when it is down. A shipped feature has no Design tab: its worktree is gone, so its designs cannot be served.
**Why:** The brief agreed the tab is always present and is the list. Stepping between designs from the live view keeps a review of several screens to one place.
**Assumed.** Alternative: the list as a narrow rail beside the live design, always visible.
**Challenged:** "What did we approve for this?" is a real question after merge; the challenger would keep a read-only list of pictures, titles and final states on shipped features.

## 7. With no recorded designs, the tab says so, and offers the old server if there is one
**Decision:** A feature with no recorded design shows "No designs yet" and one line saying the agent's designs appear here. When the feature has a recorded design-server command from before this feature (designs that were never recorded), the empty tab also offers "Open the design server", which opens it at its last page.
**Why:** Features in flight today have designs with no record. The fallback keeps them reachable now that the plan's "Open in design" buttons go (decision 14), without a backfill.
**Assumed.** Alternative: no fallback; such designs are reachable only by asking the agent to show them again.
**Challenged:** The fallback is a stopgap that lingers; leads with unrecorded designs can call `show_design` once to record them.

## 8. Each design gets an Approve button that records the human's own yes
**Decision:** A design waiting for the human shows Approve in the Design tab's live view and on its row. A click records the approval as the human's own act and puts a line in the chat ("You approved the design “Plan card”"), which tells the lead to commit it. Asking for changes stays in the chat. The human may still approve in words; the lead then marks the design approved, or dropped when the human rejects it, with a small tool (`set_design_state`).
**Why:** Runcastle records a click as the human's, so no orchestrator message can stand in for it, which is what the working agreement asks of designs. It also turns "which designs did they approve?" from a reading of the chat into a fact the lead and the orchestrator can look up.
**Assumed.** Alternative: no button; approval stays in the human's words only, and the list's state is whatever the lead marks.
**Challenged:** Approve on a list row lets the human approve a design they never opened; the challenger would offer Approve only in the live view.

## 9. The yes to round 1 no longer approves designs the human never opened
**Decision:** When the human says yes to round 1, the lead commits the designs they approved, and also the waiting designs they opened and did not object to, as they stand. A waiting design they never opened is not committed: the lead names those and asks once more before it dispatches.
**Why:** The brief names this as friction: today one yes commits designs the human may never have seen. "Opened" is recorded anyway for the New marks and the badge (decision 10), so the rule costs no extra machinery.
**Assumed.** Alternative: as today, the yes approves every waiting design as it stands.
**Challenged:** Opening a design is not consent, and the standing rule is that designs need the human's own yes; the challenger would commit only designs approved by the button or in words, and ask about every other one.

## 10. Runcastle records what the human has looked at, on the server
**Decision:** The plan counts as looked at when the human opens the Plan tab or the plan card after its latest `show_plan`; a design counts as looked at when the human opens it in the Design tab after its latest `show_design`. Showing it again makes it new again. The record lives on the server, so the desktop and the phone agree, and `get_feature_context` tells the lead which designs were opened and which approved.
**Why:** The badge and the New marks need it, and decision 9 needs the lead to know it. A browser-only record would show the phone's looks as unseen on the desktop.
**Assumed.** Alternative: remember looks in the browser only.

## 11. A dot marks the plan and designs you have not looked at
**Decision:** A small accent dot sits on the header's panel toggle while the plan or any design is new to the human, and on the Plan and Design tabs themselves. List rows carry "New". No counts.
**Why:** The brief agreed a badge. A dot says "something here is new"; the list says what. A count on a toggle reads like an inbox the human must clear.
**Assumed.** Alternative: a number on the toggle counting the unlooked-at designs and plan.

## 12. "Design to approve" opens the list
**Decision:** The header's button for the "Design to approve" need opens the Design tab's list, which leads with the designs still waiting.
**Why:** The sibling feature ("You always know what's waiting", its decision 15) left this button pointing at the bare design server and handed the list to this feature.
**Assumed.** Alternative: open the oldest waiting design directly.

## 13. Humans read "the Plan" and "Designs"; file names stay
**Decision:** Every word a human reads says "Plan" for the plan page and "design" for a design, never "preview". The agent-facing tool descriptions and skills say "design page" where they said "preview page". The files keep their names (`preview.html`, the project's preview folders), since renaming them would break every feature already planned.
**Why:** The brief asks to stop calling designs previews. The confusion is in the words people read, not in file names they never see.
**Assumed.** Alternative: also rename `preview.html` to `plan.html`, with a fallback that reads the old name.

## 14. The plan's "Open in design" buttons and their message bridge go
**Decision:** A designed screen in the plan is a plain entry naming its design (title, component file, design page), with no button. The plan frame's open-design message, the code that answers it, and the skills' instructions for it are removed. The human reaches designs from their cards and the Design tab.
**Why:** The brief prefers removing that machinery once the list exists; a button that only works when the agent remembered to add it is the problem the feature solves.
**Assumed.** Alternative: keep the buttons, pointed at the list.

## 15. A run with no human present posts cards but opens no panel
**Decision:** From a headless run, `show_plan` and `show_design` post their cards and record their designs, but never open the panel. The self-planning skill tells the run to call them, so the human returns to a chat holding the plan card and one card per design.
**Why:** Nobody is watching a headless run, and a panel that springs open later on stale news would be a surprise. The cards are what the human comes back to.
**Assumed.** Alternative: let the panel open if the human happens to be on the feature.

## 16. On the phone, the cards show and open the design; no phone list
**Decision:** The phone's chat shows the plan and design cards like the desktop's. A design card opens the phone's Design screen on that design, with Approve. The phone gets no separate design list in this feature.
**Why:** The phone reads the same chat, so the cards come nearly free; a list screen is a new phone view for a job the cards already do there.
**Assumed.** Alternative: a design list screen on the phone too.

## 17. "Design to approve" shows while any design waits, from the record
**Decision:** The feature's "Design to approve" need comes from the design record: it shows while any design is "Waiting for you" and the lead is not working, and clears once every design is approved or dropped. The lead's "design" kind of wait still works, but the need no longer depends on the lead remembering it.
**Why:** The brief asked how a waiting design plugs into the sibling feature's waiting states. Reading it from the record makes the header, the sidebar and the pings true by themselves.
**Assumed.** Alternative: keep the need set only by the lead's `wait_for_you` with the "design" kind.

## 18. A design shown again goes back to waiting
**Decision:** When the agent shows a design again after changing it, the design's approval is cleared: it reads "Waiting for you" and "New" again.
**Why:** An approval should cover the version the human saw. Changes after a yes are what a second look is for.
**Assumed.** Alternative: keep the approval, and mark the design "Changed since you approved it".

## 19. A card always opens the current version; older cards say so
**Decision:** Each `show_plan` and `show_design` posts a new card. A card reads its design's state live, so every card for a design agrees on it. An older card than the newest one for the same design (or the plan) carries "Older version" and still opens the current one.
**Why:** After a few rounds of changes the chat holds several cards for one thing; they must not disagree about its state or open a stale page.
**Assumed.** Alternative: only the newest card stays, and older ones fold to a line.

## 20. Rejecting a design is done in words, not by a button
**Decision:** The Design tab has Approve but no Drop button. A human who rejects a design says so in the chat, usually with what to do instead, and the lead marks it dropped.
**Why:** A rejection nearly always carries a reason or a next step, and the chat is where those go. A Drop button would drop the design and leave the lead guessing why.
**Assumed.** Alternative: a Drop button beside Approve.
**Challenged:** Dropping is the same kind of human act as approving; the challenger would add a Drop button and sink dropped designs to the bottom of the list, folded.

## 21. Merge names designs still waiting
**Decision:** When the human merges a feature that still has designs waiting, the merge dialog names them and says they will not ship. Merge stays allowed.
**Why:** Uncommitted designs vanish with the worktree at merge. The human should know before, not find out after; nothing is held, since merge is theirs.
**Assumed.** Alternative: say nothing at merge.

## 22. On the phone, "Design to approve" opens the oldest waiting design
**Decision:** With no design list on the phone (decision 16), the phone's "Design to approve" button opens its Design screen on the oldest design still waiting.
**Why:** The waiting need from decision 17 needs a target on the phone, and the oldest waiting design is the one to look at first.
**Assumed.** Alternative: the phone's button opens the chat, where the cards are.
