# Decisions — One chat layout everywhere

## 1. Chat is a full-area view tab, in every state
**Decision:** The feature top bar carries three view tabs: Overview | Tickets | Chat. With Chat in front, the terminal fills the whole content area under the top bar, like the project session's chat, with a thin strip for session status and End session. It is the same layout in Planning, Building, Review and Shipped. With another tab in front, the chat stays mounted but hidden, so the terminal keeps its scrollback, and the Chat tab shows a live dot. This supersedes `one-chat-per-feature` decision 16, which docked a collapsible inline panel beside the body.
**Why:** The operator prefers the project session's full-area chat and tried this layout in a clickable prototype (`prototypes/chat-tab.html`). One surface makes "take me to the chat" a single move. The five placements it replaces (the right aside, the full-height planning panel with its "chat is in the aside" placeholder, the tickets body's Show/Hide terminal strip, the fixed-height inline panels in Run and Shipped, and Review's "Open" pinning a read-only planning view) are what the operator found confusing.

## 2. No split view, not even in planning
**Decision:** The Chat tab shows only the chat. No decisions rail beside the terminal, in any state, and no toggle to add one. The page body (decisions, tickets, run, review trail) is reached by switching tabs.
**Why:** The operator tried the planning split in the prototype and rejected it. A split brings back the chat being smaller than the room. Reading decisions while chatting is traded for one layout with no variants.

## 3. Leaving the chat is offered, never forced
**Decision:** While a feature's Chat tab is in front, a relevant change elsewhere in that feature raises a notification that carries a button to the tab that shows it (e.g. "Tickets updated · View tickets"). Clicking it switches tabs; ignoring it leaves you in the chat. Nothing automatic ever moves you away from Chat. The only automatic tab switch goes the other way: a button that starts or resumes a session lands you on Chat. On any other tab no such notification is raised, because that page already updates live. These notifications are styled to look good, not as plain text: each is color-coded by the phase hue of what it points to (the existing `--color-phase-*` tokens), using the phase's own icon.
**Why:** The operator wanted the chat to lead out to tickets, runs and so on. Switching tabs automatically would pull them out mid-sentence and would be the same "landed somewhere I didn't choose" confusion this feature exists to remove. Phase color ties each notification to the pipeline stage it belongs to.

## 4. Which changes raise a notification from the chat
**Decision:** While the Chat tab is in front, these changes raise a notification with a button to the tab that shows them:
- the spec is written → "Spec written · View spec" (planning hue, goes to Overview);
- tickets stored, edited or cancelled → "Tickets updated · View tickets" (tickets hue, goes to the Tickets tab);
- a ticket fails mid-run → "Ticket #n failed · View run" (danger, goes to Overview);
- the run finishes → "Run finished · x of y landed · View run" (building hue, danger if the run failed; goes to Overview);
- the review is ready → "Review ready · View review" (review hue, goes to Overview);
- the test drive comes up → "Test drive running · Open" (review hue, goes to Overview).
Nothing else raises one: not each decision locking during planning, not notes, waypoints or worktree housekeeping, and not phase moves the human made (Burn, Merge). Bursts collapse: several changes that point to the same place become one notification. A notification with a button stays until it is acted on or dismissed; it does not expire like today's 6-second plain toasts.
**Why:** These are the moments worth looking up from the conversation for. A notification per locked decision would fire every few minutes during grilling, about the very conversation already on screen. The spec landing is the useful planning signal. A finished run has to still be there when the operator looks up, so action notifications don't expire.

## 5. The Chat tab is for looking; a button is for starting
**Decision:** The top-bar Chat toggle becomes the Chat view tab: same place, same one word, but it switches the view instead of opening an aside. The chat aside (`ChatPanel` in `AsideLayout`) is retired; the details aside stays. Clicking the Chat tab never launches a session: with a live chat it shows it; otherwise it shows the last transcript with "Resume the conversation", or "Start the conversation" if the feature has never had one. The next-step bar's Chat / Start session action keeps `one-chat-per-feature` decision 8 as-is: it starts or resumes the chat and lands on the Chat tab, like every other session-launching button (decision 3).
**Why:** Today opening the toggle can quietly launch a session, which is surprising once it is just a tab. Keeping the launch on explicit buttons makes spawning a process always a deliberate click, and keeps decision 8's constant door intact.

## 6. One ChatView for project and feature chats
**Decision:** A single chat-surface component (working name `ChatView`) renders every chat: the strip (live dot, context line, End session), the full-area terminal, and the ended / never-started state with its Resume / Start button. The project session and every feature use it; each passes only its specifics (context line, the End session action, the launch behind Resume/Start). The tab sets around it stay page-specific (project: Overview | Chat | Drive; feature: Overview | Tickets | Chat), and both keep the chat mounted but hidden behind another tab.
**Why:** The two chats drifted because they share only `TerminalView`. With one component, any visible difference between them is a bug in one place, not two designs diverging.

## 7. One live-session line on Overview, in every state
**Decision:** Whenever a feature's chat is live, Overview shows one line in every state: "● Chat live · lap N · → Open chat · ■ End session". "Open chat" switches to the Chat tab; it no longer pins a read-only planning view (Review's `LiveSessionAlert` route through `sessionHome`/`PinnedBody` for chat sessions goes). Pinning an earlier phase from the stepper is untouched.
**Why:** It lets the operator end a session without entering the chat, and it explains the "End session & …" compound labels (`review-arrival-is-legible` decision 4). Today it exists only in Review, and its Open lands in a pinned planning view, one of the placements this feature removes.

## 8. Feature tabs are addressable, and each feature reopens where you left it
**Decision:** Each feature view tab has its own path: `/p/:id/f/:slug` (Overview), `/p/:id/f/:slug/tickets`, `/p/:id/f/:slug/chat`. Reload keeps the tab, and Back after a session button lands you on Chat returns to the tab you clicked it from. Each feature remembers its last tab in browser storage, per feature. Selecting a feature in the sidebar (or anywhere that opens it without naming a tab) restores that tab. A feature never opened before lands on Overview, or on Chat if its chat is live. A tab switch made by a session-launching button is remembered like any other.
**Why:** The operator moves between several features' chats and must not have to click feature, then Chat, every time. Restoring the last tab per feature makes that one click, and addressable tabs make reload and Back behave.

## 9. The Chat tab hosts whichever feature session is live
**Decision:** The Chat tab shows the feature's live session whatever its kind (`chat`, `waypoint`, `converge`, `drive-fix`), since one terminal per feature means at most one is live. The strip names the kind ("Chat · lap 2", "Waypoint · <title>", "Converge", "Drive fix"). With nothing live, it falls back to the feature's chat transcript with Resume / Start (decision 5). Converge, Work waypoint and Fix drive land on Chat like every other session-launching button. Only the terminal moves: the waypoint map, the drive panel and other body content stay on Overview. The tab stays named "Chat" (`one-chat-per-feature` decision 8).
**Why:** It gives every session kind the one place, including drive-fix, which has no terminal home today, and finishes the list of launching buttons that must land on the chat. Whether waypoints and converge survive at all is parked as a draft feature ("Retire mapped ideation"); if they go, this costs two strip labels.

## 10. Chat notifications form one collapsed deck, never a stack
**Decision:** Chat notifications (decisions 3–4) show as one deck in the corner. Collapsed, only the newest card is readable; up to two older ones peek as edges behind it, with a small "n notifications" hint. Hovering the deck, or focusing into it with the keyboard, fans it out to show the newest four. The deck holds at most four: a fifth pushes the oldest out. A repeat of an event already in the deck (a burst) counts up on that card and moves it to the front instead of adding a card. Each card keeps its phase-hued look (prototype: `prototypes/notifications.html`).
**Why:** The operator doesn't want notifications to become spam or pile up one above another over the chat. A deck costs one card's footprint however much happens, and still keeps the last few moments within reach.

## 11. Drafts get no Chat tab
**Decision:** A draft feature shows no Chat tab, as today, where the Chat door is hidden for drafts. Its Start launches the chat when the project starts a chat on Start, and lands on the Chat tab like every other session-launching button.
**Why:** A draft has no branch or worktree yet, so there is nothing to chat in until it starts. The operator accepted this default without change.

## 12. One lap, nothing deferred
**Decision:** The whole feature is spec'd as lap 1: `ChatView`, the addressable tabs with per-feature memory, landing on Chat from every session button, the Overview live-session line, the notification deck, and retiring the aside and the in-body terminals. The spec has no Later laps scope. If the notifications feel off in use, lap 2 tunes them.
**Why:** The operator is sure: the layout and the notification deck were both tried in clickable prototypes and approved, and no part is uncertain enough to need a trial lap first. All the work is in `apps/web` and can be ticketed and checked piece by piece.
