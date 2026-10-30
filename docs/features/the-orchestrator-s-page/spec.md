# The Orchestrator

The feature's folder keeps its first name, "The Orchestrator's page". What it
ships is the removal of that page.

## Problem

Clicking a feature opens its chat. Clicking the Orchestrator opens an overview
page instead: a title, two door rows, a drive setup disclosure and a list of
chats. Everything on it already lives somewhere else, and it looks out of place
beside the rest of the app. It is one click between you and the chat you came
for.

## Approach

**The Orchestrator is its chat.** The sidebar's card opens the project chat
with the most recent activity, chosen once on arrival (decisions 10, 11, 13). A
link or reload naming a chat opens that chat. Scenario chats are never picked. A
project with no chats opens on a new, empty chat that writes nothing until its
first message (decision 14). The overview is gone.

An empty Orchestrator chat shows the hub in its enlarged accent tile, "What are
we building?" and one line on what the chat does (decision 20).

**The header** reads "Orchestrator › chat title" (decision 18). On its right,
always: Test drive with the shared scenario picker on its caret, Prepare drive
with no command set, Back to the drive while this project's drive runs, or
nothing on a born-empty project; then the panel toggle with the open notes count
(decisions 16, 21).

**The panel** holds Notes and opens only when asked: from the toggle, the note
capture's View, or a drive stopping onto Notes (decision 15). The drive is the
page, as it is for a feature.

**The landing branch** is a menu under the composer while a chat is empty, plain
text after that, and a row in Settings as before (decision 17).

**The Conversations page** opens from the sidebar's "All N conversations", at
`/p/<project>/conversations` (decision 12). It holds a title, a filter and every
chat: Active first (waiting on you, then working), then Today, Yesterday, This
week, This month, Earlier, by last activity (decisions 6, 7). A row opens its
chat. Back returns to the list; a reload stays on it. Picking any thread, or
starting a new one, leaves the page. The drive page and the Notes panel open over
it and leave it where it was.

It reads as a ledger (decision 19). From a content width of 1000px the dates hang
in a sticky rail left of the column, with a hairline across each group; narrower,
they sit over their rows. Active chats sit in the Working bay's material, lit
while an agent works. A line under the title counts the conversations, those
waiting and those working. The filter marks its match. The sidebar's halftone
sits behind the head.

**Shape.** The look lives in the real components, with a preview page beside
them (`/preview/orchestrator.html`; samples `latest`, `conversations`, `new`).

- The project workspace loses its resting state. What is in front is a chat, an
  unstarted chat, or the Conversations page; the drive page sits over any of them.
- `conversations` is a new location kind in the address scheme, beside `chat`.
  The shell's workspace state gains a flag with it, under the project selection.
- New pieces: `ConversationsPage`, with the pure `conversationGroup(thread, now)`,
  and `ProjectDriveButton`.
- `ThreadColumn` and `ChatThread` gain `empty`, which replaces the plain "New
  thread". `ThreadColumn` gains `startMeta`, the line under the composer while
  nothing has been said. `ProjectChat` gains the unstarted form, as a feature's main
  chat has.
- Deleted: `NewChatCard`, `TestDriveCard`, `ActionRow`, `ConversationList`.
  Their still-true test assertions move to the new pieces.
- DESIGN.md's paragraph on the project page, and the sidebar's note on "All N
  conversations", are rewritten.

## Seams

- **`ProjectWorkspace` over fakes** (existing): opens the newest project chat;
  skips scenario chats; does not jump when another chat posts; opens a chat the
  address names; with no chats, shows an empty chat and writes nothing until the
  first message; the panel stays closed on arrival with open notes waiting.
- **`routes`** (existing, pure): `conversations` formats and parses;
  `locationFor` names it.
- **`ConversationsPage`** (new, rendered alone with a fixed `now`): group order,
  Active ordering, the counts line, the filter narrowing every group and marking
  its match, the no-match state.
- **`conversationGroup`** (new, pure): each group's boundaries, and a working chat
  from last month landing in Active.
- **The header's drive door** (`ProjectDriveButton`, through `ProjectWorkspace`):
  each drive state.
- **`ThreadColumn`** (existing): `startMeta` and `empty` show while the chat is
  empty and give way once it is not.

## Out of scope

- The chat column's own look ("The chat looks the part", shipped).
- The project drive screen ("Test drive looks the part").
- The shared theme and building blocks.
- Archiving, pinning or renaming chats from the Conversations page.
- A command palette entry for Conversations.

## Open questions

None.
