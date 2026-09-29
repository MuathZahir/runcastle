# One chat layout everywhere

## Problem

The feature chat has five layouts, and which one you get depends on the state and the page:

- a right-hand aside opened by the top-bar Chat toggle;
- a full-height panel in the planning body, which shows "The chat is in the aside — close it to bring the terminal back here" when the aside is open;
- a header-only strip with Show/Hide terminal in the tickets body;
- a fixed-height inline panel in the run and shipped bodies;
- no terminal at all in Review, just a "Chat session still live" line whose Open pins a read-only planning view.

The project session's chat, the one the operator likes, is a different component again: a full content-area view.

On top of that, no button that starts or resumes a feature session takes you to it. "End session & start lap 2" leaves you on Overview. "End session & resolve" after a merge conflict leaves you hunting for the resolving session. Converge, Work waypoint and Fix drive behave the same way. The operator clicks, and then has to find where the conversation went.

## Approach

**From the operator's side.** Every feature has three view tabs in its top bar: **Overview | Tickets | Chat**. Chat is the conversation filling the whole content area under the top bar, in every state (Planning, Building, Review, Shipped), exactly like the project session's chat. There is no side panel, no split, no collapsed strip and no placeholder.

- **Landing on Chat.** Every button that starts or resumes a feature session lands you on the Chat tab. That covers Start session, Chat, End session & start lap N / Iterate, Stop drive & iterate, End session & resolve (bar, conflict card and merge dialog), Resolve in terminal, Converge, Work waypoint, Fix drive, and a draft's Start when it opens the chat.
- **Clicking the tab itself never starts anything.** It shows the live session, or the last transcript with Resume / Start.
- **Leaving is up to you.** While you are in the chat and something elsewhere in the feature changes (spec written, tickets updated, a ticket failed, the run finished, the review is ready, the test drive is up), a notification offers a button to the tab that shows it. It never moves you on its own.
- **The notification deck.** Notifications collapse into one deck in the corner:
  - Collapsed, it shows the newest card, with older ones peeking behind it.
  - Hovering or focusing fans out the newest four.
  - A repeat of the same event counts up on its card instead of adding one.
- **One click between features.** Each feature remembers which tab you left it on, so moving between several features' chats is one click each.
- **Reload and Back.** Each tab has its own URL, so reload and Back keep your place.

**The shape of it.**

- **`ChatView`, one component for every chat surface (new; decision 6).** It renders:
  - the strip: live dot, a context line naming the session kind, and End session;
  - the full-area terminal (`TerminalView`, unchanged);
  - the ended / never-started state with Resume or Start.

  The project session's chat (today's `LiveChat` inside `ProjectWorkspace`) and the feature Chat tab both render it. Each page passes only its specifics:
  - the context line ("Chat · lap 2", "Waypoint · <title>", "Converge", "Drive fix", or the project's own line);
  - what End session does;
  - which launch Resume / Start runs.

  Any visible difference between the two chats is a bug in `ChatView`.
- **The feature Chat tab hosts whichever feature session is live, whatever its kind (decision 9).** The kinds are chat, waypoint, converge and drive-fix; one terminal per feature means at most one is live. With nothing live it falls back to the feature's chat transcript. The chat stays mounted while another tab is in front, hidden, so xterm keeps its buffer and the pty keeps one grid size. This is the pattern `ProjectWorkspace` already uses. The Chat tab shows a live dot while a session is live.
- **Retired.** The chat aside (`ChatPanel` inside `AsideLayout`) is retired, along with every in-body terminal:
  - the planning body's session panel and its "chat is in the aside" placeholder;
  - the tickets body's Show/Hide terminal strip and its sessionStorage memory;
  - the inline panels in the run and shipped bodies;
  - the `bodySessions` / `chatDocked` split that existed to keep one pty from rendering twice;
  - the global `runcastle.chatpanel.open` localStorage flag.

  The details aside stays. The top-bar Chat toggle becomes the Chat tab, in the same place with the same word. The next-step bar keeps its constant Chat door (`one-chat-per-feature` decision 8); only where it lands changes.
- **Overview's live-session line (decision 7).** Whenever a feature session is live, Overview shows one line in every state: "● <kind> live · lap N · → Open chat · ■ End session". It replaces Review's `LiveSessionAlert`:
  - Open switches to the Chat tab and no longer pins a planning view; the chat's route into `sessionHome` / `PinnedBody` goes.
  - Pinning an earlier phase from the stepper is untouched.
  - The "End session & …" compound labels (`review-arrival-is-legible` decision 4) are unchanged.
- **Addressable tabs with per-feature memory (decision 8).** The route table grows an optional tab on the feature location:

  | Tab | Path |
  |---|---|
  | Overview | `/p/:id/f/:slug` |
  | Tickets | `/p/:id/f/:slug/tickets` |
  | Chat | `/p/:id/f/:slug/chat` |

  `pathFor`, `parsePath` and `locationFor` round-trip it, and the history sync pushes an entry per tab switch.
  - **Per-feature memory.** Each feature's last tab is remembered in browser storage, keyed per feature. Opening a feature without naming a tab (sidebar, portfolio, any link that only says "this feature") restores its remembered tab.
  - **First visit.** A feature never opened before lands on Overview, or on Chat if it has a live session.
  - **Tab switches by session buttons** are remembered like any other.
  - **Drafts** show no Chat tab (decision 11).
- **Landing on Chat is one navigation, not per-button code.** Launching a feature session and bringing its Chat tab forward is a single client-side operation that every launch path calls on success. It sits beside the existing launch hooks (`launchSession`, `useResolveConflict`, `converge`, `workWaypoint`, `fixDrive`, the iterate/triage chain). A launch path that forgets to land is a bug the tests catch, not a per-button design choice. `one-chat-per-feature` decision 12 still holds: launching on a live chat returns the live session, and landing simply brings it forward.
- **Chat notifications (decisions 3, 4, 10).**
  - **The mapping.** A pure mapping from a feature event to a notice (or none). The mapping below is the complete list; anything else maps to none, including every decision locking, notes, waypoints, worktree housekeeping, and Burn/Merge. Each notice has:
    - a kind (the collapse key);
    - a hue: a phase token or danger;
    - the phase icon;
    - an eyebrow label, a title and a subtitle;
    - an action label;
    - the target tab.

    | Event | Notice | Hue | Target tab |
    |---|---|---|---|
    | Spec written (a `docs.changed` naming `spec.md`) | "Spec written" / "View spec" | planning | Overview |
    | Tickets stored, edited or cancelled | "Tickets updated" / "View tickets" | tickets | Tickets |
    | A ticket failed mid-run | "Ticket #n failed" / "View run" | danger | Overview |
    | The run finished: "x of y landed"; "…with failures" when any failed | "Run finished" / "View run" | building (danger if any failed) | Overview |
    | The lap's review pass finished | "Review ready" / "View review" | review | Overview |
    | The test drive came up | "Test drive running" / "Open" | review | Overview |

  - **The deck.** A pure reducer that holds at most four notices, newest first:
    - pushing a kind already present bumps its count, refreshes its subtitle and moves it to the front;
    - a fifth push drops the oldest;
    - dismiss and act remove one.
  - **When notices are raised.** Only while that feature's Chat tab is in front. On other tabs the page already updates live.
  - **What feeds them.** The live SSE stream (`lib/live.ts`) already delivers `{ featureId, eventId }` signals. Notices come from the feature's events newer than the moment the Chat tab came to front; nothing replays on mount.
  - **Rendering.** The deck is anchored bottom-right over the Chat tab.
    - Collapsed: the newest card is readable, up to two edges peek, and an "n notifications" hint shows.
    - Hover or keyboard focus fans out all of them (at most four).
    - Cards do not expire; they leave only by View (which switches tabs) or ✕.
    - Styling follows `prototypes/notifications.html`: a neutral raised card, with the phase hue on the icon chip, the eyebrow, the action button and a faint corner glow. It reads well in both themes, uses the `--color-phase-*` / danger tokens, and gives the fan-out and entry motion a reduced-motion fallback.
  - **Ordinary toasts.** Plain toasts (`lib/toast.tsx`) keep working as they do today for errors and confirmations. The deck is a separate surface, not a restyle of every toast.

This supersedes `one-chat-per-feature` decision 16 (the docked, collapsible inline chat panel) and the Review-only live-session alert from `review-arrival-is-legible`. Styling follows `apps/web/STYLE.md`: primitives and tokens, no new rules in `styles.css`. The prototypes `prototypes/chat-tab.html` and `prototypes/notifications.html` are the approved look.

## Seams

- **Route table (existing, extended): `pathFor` / `parsePath` / `locationFor`.** Observe that feature paths with and without a tab round-trip, that an unknown tab segment parses as null, and that a location without a tab resolves to the remembered or default tab. Tier 1 unit tests.
- **Tab memory (new, pure): "which tab should this feature open on".** Inputs: the stored tab for the feature, whether it has a live session, whether it is a draft. Output: overview, tickets or chat. Observe a first visit (Overview, or Chat if live), restore after a switch, drafts never getting chat, and storage that throws or is empty.
- **Land-on-chat operation (new, one hook).** Observe that each launch path calls it on success: start, chat, iterate / start lap, stop drive & iterate, every resolve entry, resolve in terminal, converge, work waypoint, fix drive, and draft start with chat. Also observe that it selects the feature's Chat tab and records it in tab memory. Tier 2, or a tier 1 test over the hook's callers, whichever the existing mutation tests make natural.
- **`ChatView` (new component).** Observe the rendered strip per session kind, the live terminal versus the ended / never-started state with the right Resume / Start button, and that the project chat and the feature Chat tab both render through it. Tier 1 static markup.
- **Feature workspace (existing).** Observe:
  - three tabs, and no Chat tab on a draft;
  - no chat aside;
  - no terminal in any phase body (planning, tickets, run, shipped);
  - the Chat tab's live dot;
  - Overview's single live-session line in every state, with "Open chat" selecting the Chat tab rather than pinning a phase.
- **Event → notice mapping (new, pure).** Observe every event in the table above mapping to its notice, hue and target, and every other event mapping to none. Tier 1 unit test.
- **Notice deck reducer (new, pure).** Observe the cap of four, burst collapse (count up, subtitle refresh, move to front), dismiss, act, and oldest-out order. Tier 1 unit test.
- **Notice deck component (new).** Observe that a notice is raised only while the Chat tab is in front; collapsed versus fanned out on hover and focus; that View switches to the target tab and removes the card; that ✕ removes it; and that nothing expires. Tier 2 (happy-dom), since hover, focus and events are what it is about.

## Out of scope

- Session and transcript semantics: one chat per feature, one transcript, resume rules (`one-chat-per-feature`).
- Process lifecycle and teardown (`session-process-trees-die-with-their-session-on-windows`).
- The review trail's content and the merge-conflict card's state and staleness.
- The next-step bar's action set per state. Only where each action's session lands changes.
- Whether mapped ideation (waypoints, converge) survives. That is parked as the draft feature "Retire mapped ideation (waypoints and converge)"; until then those sessions ride the Chat tab like any other.
- Restyling ordinary toasts, and notifications outside a feature's Chat tab (sidebar badges, browser notifications, the project chat).
- Setup and preparation terminals (Enable AFK, first-run runtimes, preparation, test-drive dev pane).

## Open questions

- **Which event marks "review ready".** It is the lap's review pass finishing, not `review.agentic-minted`, which fires when the pass is created. The implementing ticket confirms the exact event (the review ticket's run finishing, or the review evidence landing) from the server code and maps that one.

## Later laps

None. The feature is one lap (decision 12). If the notifications feel noisy or quiet in use, lap 2 tunes the mapping and the deck.
