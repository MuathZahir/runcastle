# Threads in the sidebar

## Problem

A feature, and the project chat (the Orchestrator), can each hold several
threads: separate conversations with the agent. Today they are switched with a
dropdown in the chat column's header. With many threads it runs to the bottom of
the screen, it hides which thread waits on you until you open it, and it puts a
second navigation list in a header that should only say where you are. The
human called it "one of the worst designs I've seen".

## Approach

**What the human sees.** The sidebar becomes the one place threads live
(decisions 1–5). While a feature is open, its row in the sidebar unfolds: the
row and its threads share one card (the sidebar's card material, as the Working
bay uses), each thread a one-line row under the feature's two-line row. A
thread row has three columns so the list reads as structured (the human's second
look at the design): a leading glyph (a spinner while it works, the amber dot
while it waits on you, a chat bubble at rest), the title, and how long since it
moved. The list's last row ("Show N more", "All N conversations") keeps the
same columns. The thread in front is filled a shade brighter. The main chat comes first, then the other threads newest started
first, and rows never move because an agent posted. Five rows show; the thread
in front and any working or waiting thread show even past five; "Show N more"
opens the rest in place. A feature with only its main chat shows no list
(decision 2). Opening another feature folds this one.

The Orchestrator card works the same way while the Orchestrator page is open:
its chats list inside its accent card, under a hairline below the card's head,
so they read as the Orchestrator's and not as the features below (the human's
first look at the design). The head's chevron turns down while they show, and
its hover animation stays on the head. Five chats show, and the last row, "All
N conversations", opens the Orchestrator page at rest, where every
conversation is listed (decision 3).

The open row (feature or Orchestrator) carries a "+" ("New thread") beside its
"…": on a feature it starts a side thread, on the Orchestrator a new project
chat, exactly as the switcher's and the Create menu's doors do today
(decision 4). Each thread row has its own "…" menu, also on right-click:
Rename…, Export as Markdown, and on a scenario chat that is still open, its
close (decision 5). The feature row still opens the feature with its main chat
in front (decision 8).

In the content panel's header, the dropdown is gone. The breadcrumb names the
thread after the feature (or "Orchestrator"): "Sidebar refresh › Why does the
bay draw square corners?", plain text that opens nothing (decision 6).

**The approved look.** The design lives in the real components, with a preview
page beside them (`/preview/sidebar-threads.html`): `SidebarThreadRow`,
`SidebarThreadList` and the pure `visibleThreads` (which rows a list shows)
are new in the sidebar's parts module; `SidebarFeatureRow` takes the open
feature's list (`threads`) and a "+" (`onNewThread`); `OrchestratorCard` takes a
"+" too. Two looks were left to the human's eye on the preview page and are
recorded in the plan: the open feature as one card or as a tree line, and
whether the "+" waits for hover or stays on the open row; and after the
human's second look, the thread row's style. Building writes the
chosen values into these components and removes the preview's Tweaks menu.

**How it is wired.**

- *The page publishes its threads; the sidebar draws them.* Only the open
  page's threads are ever shown (decision 1), and the open page already owns
  them: the feature page's chat column (`useFeatureChatColumn`) and the
  Orchestrator page each hold the thread list, the thread in front, and how to
  pick one, start one, rename, export and close an errand. A small shell-level
  channel (a React context provided by the project shell, which renders both the
  sidebar and the page) carries that from the page to the sidebar: the scope
  (which feature, or the project), the threads, the thread in front, `pick`,
  `newThread`, and the actions for a given thread. The sidebar reads it for the
  open feature's row and for the Orchestrator card. No new queries: the sidebar
  draws the list the page already fetched.
- *Order.* `thread.list` rows (core's `ThreadEntry`) gain `createdAt`, when the
  thread was started (the session row already stores it). The web orders the
  sidebar's lists: the main chat first, then newest started. The server's own
  newest-activity order is left alone, since the Orchestrator page's
  conversation list still reads it.
- *The switcher's menu moves.* The rename dialog and the export download move
  from the switcher into the thread row's menu, driven by the existing
  `useThreadMenu` for any thread, not only the one in front. The scenario
  chat's close becomes a menu action rather than a menu item component.
- *Removed.* `ThreadSwitcher` and both places that render it (the feature page
  header and the Orchestrator page header). The header's thread name becomes a
  second breadcrumb.
- *Picking from the sidebar* is the page's own `pick`, so the address keeps the
  thread in front as it does today (`?thread=`), and a reload lands on it.

DESIGN.md's sidebar notes gain the nested thread list: one-line rows inside the
open feature's card, five then more, the "+" on the open row.

## Seams

- **`visibleThreads(threads, current, cap)`** (new, pure): which rows a list
  shows and how many are hidden. Test the cap, the thread in front past the
  cap, working and waiting threads past the cap.
- **The sidebar's thread order** (new, pure, beside it): main first, then
  newest started; stable when `updatedAt` changes.
- **`SidebarThreadList` / `SidebarFeatureRow` / `OrchestratorCard` rendered
  over resolved values** (existing tier-1 rendered-chrome seam, apps/web/STYLE.md):
  the list appears only with two or more threads, "Show N more" opens in place,
  "All N conversations" calls `more`, a thread row's menu holds Rename, Export
  and a scenario chat's close, the "+" calls `onNewThread`.
- **The feature page and the Orchestrator page through the fake tRPC**
  (existing page tests): no thread dropdown in the header, the header's
  breadcrumb names the thread in front, picking a thread in the sidebar brings
  it to the front and into the address, "+" opens a new side thread or project
  chat.
- **`thread.list`** (existing): rows carry `createdAt`.

## Out of scope

- The rest of the chat header and the chat's look: "The chat looks the part".
- The Orchestrator page's own conversation list: "The Orchestrator's page"
  (it may shrink now that threads live in the sidebar).
- The shared style and building blocks: "The whole app matches the sidebar".
  Both features touch the sidebar's parts module; whichever merges second
  reconciles.
- Archiving or hiding threads (decision 9).
- Listing threads in the command palette for a closed sidebar (decision 7).

## Open questions

- The looks on the preview page: thread rows as an icon column, divided by
  hairlines, or two lines; one card or tree line for the open feature; the "+"
  on hover or always on the open row. The plan builds "icon column", "one card"
  and "on hover" unless the human picks otherwise.
