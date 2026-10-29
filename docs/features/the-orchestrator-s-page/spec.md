# The Orchestrator's page

## Problem

The Orchestrator's page (what the sidebar's Orchestrator card opens) still
looks like the app before the sidebar was redone. Its name is the project's,
shown three times in one view, while the door you clicked says "Orchestrator".
Most of the page is two stacked door rows ("Talk it through", "Test drive"),
each an icon tile, a title, a hint and controls, followed by a "Drive setup"
disclosure, before the list of chats you came for. That list is a flat page of
ten behind "Show N more", although since "Threads in the sidebar" it is the
only place the project's full chat history lives (about 80 chats in this repo).
Notes, the other thing waiting here, sit in a second column that opens by
itself beside a mostly empty page.

## Approach

**The page at rest** (no chat in front) reads top to bottom:

- **Title line.** The Orchestrator mark (the hub glyph in the small accent tile
  the sidebar card wears) and "Orchestrator" (decision 1). On the right, the
  page's buttons (decision 2): Test drive as a split button with its scenario
  menu, the landing branch menu ("landing on main ▾"), and New chat, the one
  primary. The drive's other states replace the Test drive button: Prepare
  drive (no command set), disabled with a caption hung beneath the buttons
  (another drive holds the slot), Return to drive with a live dot (this
  project's drive runs), nothing (a born-empty project). A gone landing branch
  disables New chat with its caption in the same place.
- **Facts line** under the title: the project's name and the branch project
  chats run on.
- **Notes** (decision 4), only while the project has had a note: the heading
  "Notes", "N open" beside it, the Triage button on its right; the open notes
  newest first, five then "Show N more"; "N triaged" folded beneath. A note row
  is the same row the panel and the drive's rail use. In a list with no
  pictures, the dot takes a glyph's column instead of a thumbnail's, so the
  text lines up with the conversations below.
- **Conversations** (decisions 5–7): the heading "Conversations" with the
  count, and a filter field once there are more than five. Rows sit under small
  group headings with counts: Active (waiting on you first, then working), then
  Today, Yesterday, This week (the last seven days), This month (the last
  thirty), Earlier, each by last activity, newest first; empty groups are left
  out. A row is a glyph, the title and the state or age. Every chat is listed;
  there is no "Show N more". A filter that matches nothing says so.
- **Drive setup** (decision 3) at the foot, behind a hairline, closed: the
  checkout, the identity and the three commands, as before.
- **Empty** (decision 8): with no chats, an empty state ("No conversations yet
  · Bring a raw idea and New chat cuts it into features") replaces the list;
  no headings and no filter.

**Around a chat** (decision 9) nothing of the page at rest shows. The header
reads "Orchestrator › <chat title>" with the Orchestrator glyph; it keeps its
Test drive button while no drive runs and its panel toggle. The panel keeps its
Notes view, in the same look as the page's section but without the section
heading (the panel's own header names it).

**The panel's behaviour moves with the notes** (decision 4). At rest the panel
offers only a running drive: it no longer opens on Notes by itself and does
not list Notes among its views. Around a chat it offers Notes as today. The
note capture's View lands on the page's Notes section at rest (scrolled into
view) and on the panel's Notes around a chat. Stopping a project drive at rest
closes the panel, since the notes it would have shown are on the page; around
a chat it switches the panel to Notes as today.

**Shape.** The approved look lives in the real components, with a preview page
beside them (`/preview/orchestrator.html`, samples: busy project, a few chats
and no notes, drive slot taken, new project):

- The project workspace's resting page composes the title, facts and the new
  doors piece (`OrchestratorDoors`: the drive's states, the landing menu and New
  chat as one group, with its caption), the notes section, the conversation
  list and the new drive setup piece (`DriveSetup`, the disclosure lifted out of
  the old Test drive card).
- `NotesCard` gains a section form for the page (its heading line, the
  five-row cap); the panel's form is unchanged but shares the rows.
- `NoteDot` gains a narrow form for a list with no pictures.
- `ConversationList` groups by the pure `conversationGroup(thread, now)`.
- The old door rows (`NewChatCard`, `TestDriveCard`, `ActionRow`) have no use
  left and are deleted with their tests; their still-true assertions (New chat
  is the one primary; it is disabled while the landing branch is gone; the
  drive's states) move to the doors piece's tests.
- DESIGN.md's paragraph on the project page is rewritten to say what it now
  holds.

## Seams

- **The project workspace at rest** (existing; `project-rest` and
  `project-live` component tests render it over fakes): the title and crumb say
  Orchestrator; the buttons on the title line per drive state; the notes
  section present only with notes; the panel neither opens on Notes nor offers
  it at rest, and offers it around a chat; View and drive stop land where the
  approach says.
- **`OrchestratorDoors`** (new, rendered alone): each drive state's button and
  caption; New chat the one primary; New chat disabled with its caption while
  the landing branch is gone.
- **`ConversationList`** (existing, rendered alone with a fixed `now`): the
  groups, their order and counts, Active ordering waiting before working, the
  filter appearing past five and narrowing every group, the empty and
  no-match states, no "Show more".
- **`conversationGroup`** (new, pure): the boundaries of each group, including
  a working chat from last month landing in Active.
- **`NotesCard` in its section form** (existing component): heading with the
  open count and Triage, five rows then "Show N more", triaged folded.

## Out of scope

- The chat column itself ("The chat looks the part").
- The project drive screen and its notes rail ("Test drive looks the part").
- The shared theme and building blocks (the foundation's).
- The sidebar's Orchestrator card and its thread list ("Threads in the
  sidebar", shipped).
- Archiving, pinning or renaming chats from this page; any new note action.

## Open questions

- The two looks left open on the preview page's Tweaks menu: the accent tile
  beside the title or a plain title, and the conversations grouped by date or
  flat. Defaults are the tile and grouped; the human's pick is written into the
  code and the menu deleted before the round.
