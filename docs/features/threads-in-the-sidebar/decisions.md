# Decisions — Threads in the sidebar

Planned without the human (a headless planning run, 2026-10-28). Every decision
below is the lead's own recommendation, marked **Assumed.** with the main
alternative, until the human confirms or changes it. One independent challenger
read the brief and these decisions; where it disagreed, a **Challenged:** line
gives its reason and the lead's answer stands.

## 1. The open feature shows its threads; the others stay folded
**Decision:** A feature row shows its threads beneath it while that feature is the one open in the content panel, and only then. Opening another feature folds the first and unfolds the new one. The Orchestrator card follows the same rule: its threads show while the Orchestrator (the project chat page) is open. There is no chevron and no fold state to remember, and a folded row looks exactly as it does today (no thread count on it).
**Why:** The sidebar already marks a feature that waits on you with its amber dot, so peeking at another feature's threads without opening it is not a job anyone has asked for. Following selection keeps every row as it is today and the list short: one feature's threads at a time.
**Assumed.** Alternative: a chevron on every feature row, each opening and folding on its own, so several features can show their threads at once.

## 2. A feature with only its main chat shows no thread list
**Decision:** When the open feature has a single thread (its main chat), nothing is nested under it: the row is the chat. The list appears once a second thread exists.
**Why:** A one-item list under a row that already opens that same chat is a row of noise, and most features never get a second thread.
**Assumed.** Alternative: always list the threads of the open feature, even when there is only one.

## 3. Threads keep their place: main chat first, then newest started; five, then more
**Decision:** Under a feature the main chat comes first, then the other threads by when they were started, newest first. Under the Orchestrator, its chats by when they were started, newest first. A row never moves because an agent posted in it. A list shows five rows. The thread in front, and any thread working or waiting on you, always show, even past the five. Under a feature, "Show N more" opens the rest in place. Under the Orchestrator, whose chats run to about 80 in this repo, the last row is "All N conversations" and opens the Orchestrator page's conversation list instead.
**Why:** The dropdown's fault was a list that ran to the bottom of the screen. Ordering by last activity (as the dropdown did) makes rows jump under the pointer while agents post; the challenger raised this and the lead agrees. Features hold up to about 15 threads, so opening the rest in place is fine. The Orchestrator card is pinned above the scrolling list, so 80 rows there would push every feature out of sight, and its page already lists every conversation.
**Assumed.** Alternative: newest activity first, as the dropdown ordered them; and for the Orchestrator, moving its card into the scrolling list so its chats open in place like a feature's.

## 4. "New thread" is a "+" on the open row
**Decision:** The open feature's row and the open Orchestrator card carry a "+" ("New thread") beside their "…". A feature's new thread is a side thread, as the switcher's New thread is today; the Orchestrator's is a new project chat, as the Create menu's New chat already is. Whether the "+" shows only on hover or stays visible on the open row is left to the human's eye (a Tweaks choice in the design).
**Why:** With the header switcher gone its first item has to land somewhere, and the sidebar is where threads now live. It sits on the row rather than at the end of the list because decision 2 means most open features have no list to end.
**Assumed.** Alternative: a "New thread" button in the chat header, beside the thread's name.

## 5. Rename, Export and closing a scenario chat move to the thread row's menu
**Decision:** Each thread row has the "…" on hover and right-click menu every sidebar row has. It holds Rename…, Export as Markdown and, on a scenario chat that is still open, its close action: the rows the switcher's menu held for the thread in front.
**Why:** The sidebar already teaches that a row's actions live in its "…" menu, and the header is to carry no menu of its own.
**Assumed.** Alternative: the thread's name in the header becomes a small menu with those actions.

## 6. The chat header names the thread as plain text
**Decision:** Where the switcher sat, the header shows the thread's title as plain, truncating text after the feature's (or the project's) name. It opens nothing. Everything else in the header stays as it is; "The chat looks the part" owns the rest of the header.
**Why:** The brief: "The chat header just names the thread you are in."
**Assumed.** Alternative: drop the thread's name from the header altogether, since the sidebar highlights it.

## 7. With the sidebar closed, threads switch by opening it again
**Decision:** No second way to switch threads is added. Ctrl/⌘+B, or the topbar's open-sidebar button, brings the sidebar back.
**Why:** The brief makes the sidebar the one place threads live, and the sidebar is one key away.
**Assumed.** Alternative: list threads in the command palette (Ctrl/⌘ K) so they can be jumped to with the sidebar closed.
**Challenged:** The palette is a search box, not a growing list, so it would not bring the dropdown back; it is cheap and scales to the Orchestrator's 80 chats better than any list.

## 8. Clicking a feature row opens its main chat, as today
**Decision:** The feature row keeps opening the feature with its main chat in front. A side thread is reached by its own row, which shows under the feature as soon as it is open.
**Why:** The row's destination stays predictable, and a side thread that waits on you is always listed under the open feature with its amber dot (decision 3), one click further.
**Assumed.** Alternative: the feature row reopens the thread you last had in front in that feature.
**Challenged:** If a side thread is waiting on you, the click should open that thread: the amber dot says the feature needs you, and opening the main chat hides where.

## 9. Threads cannot be archived or hidden in this feature
**Decision:** Every thread stays listed, finished ones included, as the switcher listed them. Archiving or hiding a thread is not part of this feature; if dead threads crowd the lists, it is its own feature.
**Why:** The five-row cap and stable order already keep the lists short, and archiving a thread needs a new server state, which is more than moving the list.
**Assumed.** Alternative: an "Archive" row in the thread's "…" menu that drops it from the list.
