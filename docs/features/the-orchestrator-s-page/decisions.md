# Decisions — The Orchestrator's page

Decisions 1 to 9 were planned without the human (a headless planning run,
2026-10-29) around a redesigned overview page. The human looked at that design
and rejected the page itself (2026-10-30): it looks bad and everything on it
already lives somewhere else. Decisions 10 onward replace that plan. Each old
decision says what replaced it; 6 and 7 still stand, on the Conversations page.

The human then said yes to the three designed screens and decisions 10 to 20
(2026-10-31).

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
**Superseded by:** 18.

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
**Superseded by:** 11 and 16.

## 3. Drive setup moves to the foot of the page
**Decision:** The "Drive setup" disclosure (the checkout a drive runs, the
identity it runs as and the three commands) stays closed by default and moves
to the bottom of the page, under the conversations.
**Why:** It is read once and then known (DESIGN.md principle 6). Under the
Test drive row it sat between the actions and the list the human came for.
**Superseded by:** 16.

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
**Superseded by:** 15.

## 5. The conversation list stays, as the page's full history
**Decision:** The page keeps its list of every project chat. The sidebar lists
five and its last row, "All N conversations", lands here, so this list is the
complete one. It is titled "Conversations" (the sidebar's word) with the count,
and offers a filter field whenever there are more than five chats.
**Why:** The brief asked to decide the list against what "Threads in the
sidebar" shipped. That feature caps the Orchestrator's sidebar list at five and
sends the rest here; there are about 80 chats in this repo. Removing the list
would strand them.
**Superseded by:** 12.

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

## 7. Chats that are working or waiting sit above the date groups
**Decision:** Any chat waiting for you or working is listed first, in an
"Active" group above Today: waiting ones first, then working ones. The date
groups below hold the rest.
**Why:** Raised by the challenger: by date alone, a chat that has waited on you
since last week sits under "This week", below newer idle chats. The sidebar
already always shows these (threads-in-the-sidebar decision 3); the page should
too.

## 8. A project with no chats yet invites the first one
**Decision:** With no conversations, the page shows its title, facts and buttons,
and under them one quiet empty state ("No conversations yet · Bring a raw
idea and New chat cuts it into features") with no headings, no filter and no
Notes section. A born-empty project (nothing built yet) shows no Test drive,
as today.
**Why:** Raised by the challenger: it is the first thing a new user sees, and
empty headings over nothing read as broken.
**Superseded by:** 14.

## 9. Around a chat, the page is the crumb, the chat and the panel
**Decision:** With a chat in front, nothing of the page at rest shows: the
header row reads "Orchestrator › <chat title>", keeps its Test drive button
while no drive runs, and its panel toggle; the chat column fills the rest (it is
"The chat looks the part"'s). The panel keeps its Notes and drive views; Notes
there is the same list, in the same look, as the page's section.
**Why:** Raised by the challenger: the plan said nothing about what the page
keeps around a chat. Today's layout is already right; what changes is the crumb
(decision 1) and the notes' look.
**Superseded by:** 10 and 18.

## 10. The Orchestrator opens its latest chat, as a feature opens its chat
**Decision:** Clicking the sidebar's Orchestrator card opens a chat straight away, the way a feature opens its chat. There is no page in between.
**Why:** The human, on seeing the redesigned overview: "clicking the orchestrator does like any other feature, just opens the latest chat."

## 11. The overview page goes
**Decision:** The page at rest is removed: the title block, "Talk it through", the Test drive row and the list below them. Nothing replaces it as a landing place.
**Why:** The human: "I don't think this overview page is needed. It looks bad and everything is already there somewhere else."
Supersedes: 2.

## 12. A separate Conversations page holds the full history
**Decision:** "All N conversations" at the foot of the sidebar's list opens a page of its own, at its own address, so Back and reload work. It holds a title, a filter and every chat, and nothing else: no New chat button, no notes, no drive. Rows keep the groups of decisions 6 and 7. The sidebar's row appears only past five chats, as today, so a project with five or fewer never needs this page.
**Why:** The human suggested it ("maybe we just need to create a separate conversations page"). The sidebar stops at five, and about 80 chats would otherwise be out of reach.
Supersedes: 5.

## 13. "Latest" means the chat with the most recent activity
**Decision:** On arrival the Orchestrator opens the project chat with the most recent activity. It picks once: a chat you are reading stays in front while others post. Scenario chats from a drive are never picked. A link or reload that names a chat opens that chat.
**Why:** It matches "where I left off", and it also lands on a chat that has just answered. Picking once keeps the screen from jumping under you.

## 14. A project with no chats opens on a new, empty chat
**Decision:** With no chats the Orchestrator shows an empty chat with the composer ready. It writes nothing until the first message, as a new feature's main chat does.
**Why:** It is the same door as every other time, and it says what a chat is for. A new project gets a composer rather than a page explaining one.
Supersedes: 8.

## 15. Notes stay in the side panel and open only when asked
**Decision:** Notes stay the panel's Notes view, reached from the header's panel toggle, which shows the open count. The panel no longer opens by itself on arrival: it opened beside the overview, and a chat should stay whole until you ask. The note capture's View still opens it, and stopping a drive still lands on it.
**Why:** The human's point that everything already lives elsewhere: the panel, its count and the sidebar card's "N notes" are already there. No new home is needed.
Supersedes: 4.

## 16. Test drive moves wholly into the header; Drive setup goes
**Decision:** The header's Test drive button gains the scenario menu it only had on the overview. It also shows "Prepare drive" while no command is set, so that door is not lost. Disabled, it gives its reason as a tooltip. The "Drive setup" disclosure is removed: the commands are in Settings, and a drive shows its branch once it runs.
**Why:** The header already carries Test drive around every chat; these are the two things only the overview had.
Supersedes: 2, 3.

## 17. The landing branch is chosen under an empty chat's composer
**Decision:** Today's "Lands on main" line under the composer becomes a menu while the chat is empty, the moment the choice applies. Once a message is sent it is plain text again. It stays a row in Settings too.
**Why:** The overview held the only quick way to change it. Under an empty composer it sits beside what it decides, as it did beside New chat.

## 18. The header reads "Orchestrator › chat title"
**Decision:** The header leads with the Orchestrator's mark and name, as a feature's leads with its own, then the chat's title as plain text. On the Conversations page it reads "Orchestrator › Conversations", and Orchestrator there goes back to the chat.
**Why:** It names what you clicked, as a feature's header does. The project's name stays in the sidebar's switcher.
Supersedes: 1, 9.

## 19. The Conversations page reads as a ledger
**Decision:** On a wide panel the dates hang in a rail left of the column and stay in view as their rows scroll by, with a hairline across each group; on a narrow panel they sit over their rows. Active chats sit on top in the Working bay's material, its edge lit while an agent works, with "waiting for you" in amber and "working" shimmering. Under the title, one line counts the conversations, those waiting and those working. The filter marks its match in each title. The halftone behind the sidebar's head sits behind the page's.
**Why:** The human asked for /frontend-design on these screens. The fonts and colours stay, since DESIGN.md sets them for the whole app, so the character comes from the layout and from reusing what the sidebar already moves. It also makes a long history easy to scan.

## 20. An empty Orchestrator chat asks "What are we building?"
**Decision:** An empty Orchestrator chat shows the hub in its accent tile, enlarged, with "What are we building?" and one line on what the chat does, in place of the plain "New thread". Every new Orchestrator chat shows it. A feature's side thread keeps the plain one.
**Why:** The human asked for /frontend-design. With the overview gone, this is the first thing a new project shows.

## 21. The header's drive door follows "Test drive looks the part"
**Decision:** The header's Test drive uses that feature's scenario picker on its caret, not a menu of its own. A drive opens as a full page, and while it runs the header offers "Back to the drive". The panel holds Notes only.
**Why:** "Test drive looks the part" merged first, and made the drive a page and the scenario list one picker. A second list would be a copy.
**Assumed.** Alternative: none; this keeps the two features from drifting.
**Changed by the orchestrator:** its note in the brief (2026-10-30) asked for this. It adjusts decisions 15 and 16 only in how the drive opens.
