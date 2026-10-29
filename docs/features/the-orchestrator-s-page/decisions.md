# Decisions — The Orchestrator's page

Planned without the human (a headless planning run, 2026-10-29). Every
decision below is the lead's own pick and carries the alternative it was
chosen over; the human confirms or changes them on the plan preview.

"The page at rest" means the Orchestrator page with no chat in front: what the
sidebar's Orchestrator card, its "All N conversations" row and the project
crumb open. "Around a chat" means the same page with a project chat in front.

## 1. The page is called the Orchestrator, as the sidebar calls it
**Decision:** The page's breadcrumb and title say "Orchestrator", with the
Orchestrator mark (the hub glyph the sidebar card wears) in front of the title.
The project's name moves into the line of facts under the title, beside the
branch the chats run on and the branch their work lands on. Around a chat the
crumb reads "Orchestrator › <chat title>".
**Why:** Today the project's name shows three times in one view (the sidebar's
project switcher, the crumb and the page title), while the row the human
clicked to get here says "Orchestrator". Naming the page after the door that
opens it is what makes the page feel like a place.
**Assumed.** Alternative: keep the project's name as crumb and title (what
"Threads in the sidebar" built).
**Challenged:** Every project's page would carry the same title, so nothing
large says which project you are in when you switch; put the project in the
crumb ("runcastle › Orchestrator") instead.

## 2. The two doors become buttons on the title's line
**Decision:** "Talk it through" and "Test drive" stop being two stacked rows
with icon tiles, hints and their own controls. Their buttons move onto the
page title's line, on the right: Test drive (secondary, with its scenario
menu), then the landing branch menu ("landing on main ▾") right beside New chat
(the page's one primary), since it is the choice New chat takes. The drive's
other states keep their place on its button: "Prepare drive" when no command
is set, disabled with its reason as a small caption beneath while another drive
holds the slot, "Return to drive" with a live dot while this project's drive
runs. The rows' explanations go: New chat's tooltip and the empty list say what
a chat does.
**Why:** Two rows of icon tile + title + hint + controls were most of the page
and said what the buttons say. With the buttons on the title's line, the page
below is left to the things that change: notes and conversations. The first
draft put the landing menu in the facts line; the challenger pointed out that a
control in a line of facts reads as a fact and is easy to miss, so it stays
beside the button it argues. A second draft kept a one-sentence next-step row
under the title, as on a draft feature's page; at the page's width the sentence
pushed the buttons onto a line of their own, so it was dropped.
**Assumed.** Alternative: keep the two door rows and only tidy them (shorter
hints, one alignment).

## 3. Drive setup moves to the foot of the page
**Decision:** The "Drive setup" disclosure (the checkout a drive runs, the
identity it runs as and the three commands) stays closed by default and moves
to the bottom of the page, under the conversations.
**Why:** It is read once and then known (DESIGN.md principle 6). Under the
Test drive row it sat between the actions and the list the human came for.
**Assumed.** Alternative: drop it from this page and leave the commands to
Settings and Preparation.

## 4. Notes sit on the page at rest, not in the side panel
**Decision:** While the project has notes, the page at rest shows a "Notes"
section between the title and the conversations: its count of open notes
and the Triage button on the section's heading line, the open notes as rows,
and "N triaged" folded under them. At rest the side panel no longer opens on
Notes by itself, and does not offer Notes (it would repeat the section); it
offers only a running drive. Around a chat, the panel keeps its Notes view as
today, so notes can be read beside the chat. The jot-a-note View link lands on
the section at rest and on the panel's Notes around a chat.
**Why:** The page at rest has a wide empty column and nothing to do in it but
pick a chat; notes are the other thing waiting there. Opening a second column
to show three one-line notes, beside a page that has the room, splits one
screen in two.
**Assumed.** Alternative: keep Notes in the side panel, opened by itself at
rest while open notes wait (today's behaviour), and only restyle it.
**Challenged:** This changes behaviour the threads' move did not make
redundant (the panel stops opening by itself and stops offering Notes at rest),
which the brief rules out; it also gives notes two homes, and the View link
goes to a different place depending on whether a chat is open. Keep notes in
the panel and restyle them, or ask the human.

## 5. The conversation list stays, as the page's full history
**Decision:** The page keeps its list of every project chat. The sidebar lists
five and its last row, "All N conversations", lands here, so this list is the
complete one. It is titled "Conversations" (the sidebar's word) with the count,
and offers a filter field whenever there are more than five chats.
**Why:** The brief asked to decide the list against what "Threads in the
sidebar" shipped. That feature caps the Orchestrator's sidebar list at five and
sends the rest here; there are about 80 chats in this repo. Removing the list
would strand them.
**Assumed.** Alternative: drop the list and let the sidebar's list open in place
to show every chat, as a feature's "Show N more" does.

## 6. Conversations are grouped by when they were last active
**Decision:** The list is split under small headings: Today, Yesterday, This
week, This month, Earlier (empty groups are left out). Each row is one line: a
glyph (spinner working, amber dot waiting, chat bubble at rest), the title, and
on the right "waiting for you", "working" or the age. Every chat is listed; the
"Show N more" button goes, since the headings make a long list easy to scan.
**Why:** At 80 chats, a flat list behind "Show 70 more" is a wall; dates are how
people look for an old chat ("the one from last week"). It orders by last
activity, as today, not by when a chat started as the sidebar does: the sidebar
keeps rows still under the pointer, while this page is where you look for where
you left off.
**Assumed.** Alternative: a flat list, newest first, ten then "Show N more"
(today's).

## 7. Chats that are working or waiting sit above the date groups
**Decision:** Any chat waiting for you or working is listed first, in an
"Active" group above Today: waiting ones first, then working ones. The date
groups below hold the rest.
**Why:** Raised by the challenger: by date alone, a chat that has waited on you
since last week sits under "This week", below newer idle chats. The sidebar
already always shows these (threads-in-the-sidebar decision 3); the page should
too.
**Assumed.** Alternative: no pinned group; waiting chats sit in their date group
with their amber dot.

## 8. A project with no chats yet invites the first one
**Decision:** With no conversations, the page shows its title, facts and buttons,
and under them one quiet empty state ("No conversations yet · Bring a raw
idea and New chat cuts it into features") with no headings, no filter and no
Notes section. A born-empty project (nothing built yet) shows no Test drive,
as today.
**Why:** Raised by the challenger: it is the first thing a new user sees, and
empty headings over nothing read as broken.
**Assumed.** Alternative: a larger centred welcome with New chat as its button.

## 9. Around a chat, the page is the crumb, the chat and the panel
**Decision:** With a chat in front, nothing of the page at rest shows: the
header row reads "Orchestrator › <chat title>", keeps its Test drive button
while no drive runs, and its panel toggle; the chat column fills the rest (it is
"The chat looks the part"'s). The panel keeps its Notes and drive views; Notes
there is the same list, in the same look, as the page's section.
**Why:** Raised by the challenger: the plan said nothing about what the page
keeps around a chat. Today's layout is already right; what changes is the crumb
(decision 1) and the notes' look.
**Assumed.** Alternative: keep the page's buttons in a slim strip above the chat.
