# Decisions — The rest of the app looks the part

Planned without the human (2026-10-30). Every screen in the brief was rendered
on sample data and read at 1440 wide before deciding, so the list below is what
was still off, not a redesign.

## 1. Fix what the audit found; no screen is redrawn
**Decision:** Each screen keeps its layout and its job. The feature is a short list of gaps against the shipped screens: the raised edge on floating layers, the home's sidebar and its live projects, the first-run rail and its stale words, a few settings rows, the palette's words, and the dialogs' footers. Anything already right is left alone.
**Why:** The brief says to start by checking what is still off and keep the feature as small as that. The foundation landed; the screens already use the shared pieces, and settings, the palette and the dialogs read correctly at a glance.
**Assumed.** Alternative: a fresh layout for settings and the home, with directions to compare.

## 2. The run view is not a screen any more
**Decision:** Nothing in components/run/ changes. Its one component, the lane transcript, now renders only inside an opened ticket on the Tickets panel, which the right-panel feature owns and shipped.
**Why:** The brief says not to swallow the right panel, and there is no run page left to restyle.
**Assumed.** Alternative: restyle the transcript here for its markdown and tool-call lines.

## 3. Picks, not Tweaks menus
**Decision:** Open looks are decided here and listed in the report. No preview carries a Tweaks menu.
**Why:** The human said on 2026-10-30 to complete this feature without waiting for them to check the design, so a menu of choices would wait on nobody.
**Assumed.** Alternative: leave Tweaks on the home and the first-run intro in case they look.

## 4. Every floating layer catches the raised edge
**Decision:** Dialogs, menus, popovers and the palette take the same 1px top highlight the chat's raised surfaces have. It goes in the two elevation tokens in the theme, in both themes, so one change reaches every floating layer, and the chat's raised material reads the token instead of repeating it.
**Why:** The human asked for one material. Today the composer and the dialog above it are two different raised surfaces, told apart only by that edge.
**Assumed.** Alternative: copy the chat's raised class onto Dialog alone, leaving menus without it.
**Challenged:** It restyles menus inside screens the brief says not to swallow and edits the chat's own material, so it should stand as a stated exception. It is one: the look of those menus changes by this one line and nothing else, and the report names it.

## 5. The home's live projects sit first, in the Working bay's card
**Decision:** On the all-projects home, projects with something running or waiting on you sit on top inside the card the sidebar's Working bay and the Conversations page use, waiting before running; the rest follow as today's divided rows. With nothing live the page looks as it does today. A project with no features says "No features yet" instead of "0 features". A row in the card opens its project, as every row on this page does.
**Why:** Conversations already teaches this shape for the same question, what is live across many things, and it uses only facts the page already has. It answers why you came to the home without adding a thing to it.
**Assumed.** Alternative: keep today's order and show live state only inside each row; or a two-column grid of project cards, which reads more like a dashboard but breaks "prefer no card" for a list of a few rows.
**Challenged:** Regrouping and re-sorting is new behaviour the brief rules out, and rows would jump between the card and the list as their state changes, perhaps as you reach for one; keeping today's order and showing state in the row avoids both.

## 6. The home's sidebar matches the project sidebar
**Decision:** The home's sidebar takes the project sidebar's head height and the same halftone behind its head, so moving between the two moves nothing.
**Why:** Its head sits 2px higher today and it has no halftone, so the frame visibly jumps on the one move it promises not to.
**Assumed.** Alternative: leave it; it is a bare sidebar either way.

## 7. First-run stops naming things that were retired
**Decision:** The intro's lead no longer says the app stops at each gate; it says you test-drive the result and decide when it ships, which is the control a new user really keeps. The rail's "AFK burns" and the step's "Run burns unattended?" become unattended workers, in the words Settings already uses, and the explainer follows. Labels only; the steps and what they do stay, and stale words on other screens are left alone.
**Why:** Gates are gone and "burns" left Settings a while ago, so the first screen a new user sees describes an older product. The brief rules out new behaviour, not stale words on a screen it asks to bring up to date.
**Assumed.** Alternative: leave the words for a copy pass, and restyle only.

## 8. First-run sits still and speaks the same material
**Decision:** The rail's current step wears the card, like every selected row. Steps anchor to a fixed height rather than the middle of the window, so the rail stays put between steps. The intro's mark sits in the accent tile the Orchestrator's empty chat uses.
**Why:** A filled selection is the look the foundation retired, the centring shifts the rail each step, and the intro and the empty chat are the same moment: the app's first question to you.
**Assumed.** Alternative: keep the plain mark on the intro, which is calmer but looks like a different app from the first chat.

Checked in a 620px-tall window: a long step scrolls inside the panel rather than clipping.

## 9. Settings keeps its dialog, rail and rows
**Decision:** Settings changes in three places only: a checklist row's detail wraps instead of being cut after a few words, the checklist head loses its icon tile, and the project name at the foot of the rail is no longer in the code font.
**Why:** Those are the only places that read as off. The cut detail hides the one sentence that says what is wrong with the row, the tile is a ground none of the three materials has, and a project name is not code.
**Assumed.** Alternative: lift section headings to 16px, as on pages; rejected because the dialog's title and its one page heading already carry that step.

## 10. The palette keeps its shape and fixes its words
**Decision:** "Project chat" becomes "Orchestrator" with the Orchestrator's own glyph, still found by its old words and now by "orchestrator" too. The theme action reads "Switch to light theme", and no results is the shared empty state rather than a line of text. Its overlay stays its own code, and the style guide records that exception.
**Why:** The rows and sizes already match menus. Moving the palette onto the shared Dialog looks identical and risks the Escape handling it depends on when it sits above Settings.
**Assumed.** Alternative: move it onto Dialog now, as the style guide asks of every overlay.
**Challenged:** Keeping the overlay is right, but without a line in the style guide the next audit reopens the question. Taken: the guide gets that line.

## 11. One footer rule for dialogs
**Decision:** A dialog's footer takes a hairline only when the body above it scrolls: Merge and the directory picker keep it, the Add to backlog form loses it. Merge's conflict line becomes the shared failure note, and the discard question leaves the hover ground for the card.
**Why:** Today the same footer has three spacings, and two pieces hand-copy what a shared piece already draws.
**Assumed.** Alternative: a hairline on every footer.

## 12. Settings and the palette ask for the thin scrollbar
**Decision:** The Settings page and the palette's list state the thin scrollbar, as every other scroller already does. Windows' small native arrows at each end stay.
**Why:** The thin setting does not inherit, so these two drew the wide one. Removing the arrows needs a different scrollbar technique across every scroller in the app, including ones the shipped features own, which is more than this feature's list.
**Assumed.** Alternative: replace the scrollbar for the whole app to lose the arrows.
**Challenged:** The human runs Windows, so the arrows show on every scroller, no later feature will take them on, and decision 4 already touches shipped screens, so it is worth trying a shared rule.

## 13. Forms need nothing more
**Decision:** The app's one form, Add to backlog, keeps its fields, spacing and error state. Only its footer changes, by decision 11. The first-run identity step and the delete dialog's field already read the same.
**Why:** They were rendered and all use the shared field pieces at the comfortable sizes. The brief names forms, so this says they were looked at.
**Assumed.** Alternative: none worth weighing.

## 14. Built here, with no tickets, each screen its own commit
**Decision:** The designs are already written in the real components, so the work left is committing them, updating the test files they touch, adding one test for the home's split, the palette's search word and the two design docs. The lead does that in this checkout. The home and the first-run changes land as separate commits so either can be undone alone, and the report says what changed and why.
**Why:** It is one small pass over files the lead has just read; a worker would pay for a container to repeat it. With no design check, the report and those seams are what the human has to come back to.
**Assumed.** Alternative: a review ticket that walks every screen in a drive.
