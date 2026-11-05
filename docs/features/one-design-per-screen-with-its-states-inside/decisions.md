# Decisions — One design per screen, with its states inside

Planned without the human on 2026-11-05: every decision below marked
**Assumed.** is the planner's own call, waiting for the human to confirm.

Check first: 2, 4, 5, 6

## 1. One design per screen, its states and variants inside it
**Decision:** A feature agent makes one design per screen it adds or reshapes,
or one per component when the feature changes a component rather than a
screen. Every state of it (empty, loading, error, full, a dialog open, a wizard
step) is reached from a state switcher on that one design page. An open choice
of look stays a Tweak inside the same page. There is never a second design for
a state, a variant or a tweak, so the human approves one thing per screen. A
flow across several screens is still one design per screen.
**Why:** Agreed in triage (brief). Fewer approvals, and the human can still see
every state before approving.

## 2. The switcher lives in the design page, not in runcastle's Design pane
**Decision:** The state switcher is part of the design page the agent writes,
in the project's own framework, served by the project's own dev server.
Runcastle's Design pane (the tab beside the chat that shows a design) does not
change.
**Why:** It works in every project runcastle serves designs for, needs no app
change, and the agents already build pages this way: several of runcastle's own
design pages carry a step or moment switcher today.
**Assumed.** Alternative: the Design pane reads a list of states from the page
and draws the switcher itself, so every project gets the same control.

## 3. Widths and themes are not separate designs
**Decision:** The same page at a phone width and a desktop width is one design;
so are its light and dark themes. The Design pane already lets the human change
the width. A theme toggle, where the project has themes, sits beside the states
on the switcher as its own control, so any state can be checked in either theme
without listing each pair as a state.
A phone layout gets its own design only when it is a different screen (a
different component), not a narrower view of the same one.
**Why:** These are variants in the brief's sense; making them separate designs
is the same doubling the human complained about.
**Assumed.** Alternative: a separate design for the mobile layout of every
screen.

## 4. No shared switcher helper ships
**Decision:** Runcastle ships no ready-made switcher, neither for other
projects nor in its own `.runcastle/preview/` folder (the fakes runcastle's own
design pages are built from). The design guide says what a switcher must do,
and the agent writes a small one in each design page.
**Why:** A helper in `.runcastle/preview/` is React for runcastle's repo only and
helps no other project; a plain-DOM snippet would sit oddly in pages written in
the project's own framework. The switcher is a few dozen lines an agent writes
in minutes, and runcastle's own pages already do.
**Assumed.** Alternative: a `StateBar` component in `.runcastle/preview/` that
runcastle's own design pages share, for one look across them.

## 5. The switcher stays in the committed design page; Tweaks still go
**Decision:** When the human approves a design, the chosen Tweak values move
into the real code and the Tweaks menu is deleted, as today. The state switcher
stays: it is committed with the design page, so anyone who opens the page later,
and the worker that wires the screen, can reach every state.
**Why:** The states are what the design page is for; the tweaks are a choice
that is settled at approval.
**Assumed.** Alternative: strip the switcher too and commit the page at one
default state.

## 6. The rule is taught, not enforced by the server
**Decision:** The change is to the feature skill's text and to the show-design
tool's description: its examples today read "checkout-empty" and "Empty
checkout", teaching a page per state, and it gains one sentence stating the
rule, since that is what the agent reads at the moment it makes a design. The
server keeps recording one
design per page address and does not merge addresses that differ only after a
`?`.
**Why:** Some projects serve every design page from one entry and tell them
apart by query (`/design.html?screen=checkout`); merging those would collapse
different screens into one design. The bug the human hit was an agent ignoring a
written rule, and the fix is a clearer rule with examples that agree with it.
**Assumed.** Alternative: the server treats `page.html?state=a` and
`page.html?state=b` as one design.

## 7. Existing committed design pages are left as they are
**Decision:** Design pages already committed in any project are not migrated.
A page that splits one screen's states across files is brought into line when
an agent next works on that screen.
**Why:** They are approved history and cost nothing standing still; the design
guide already says to repair a stale preview file when you next open it.
**Assumed.** Alternative: a sweep that merges existing per-state pages in
runcastle's own repo.

## 8. Every switcher has the same shape
**Decision:** The design guide fixes how a switcher looks and behaves, so the
human meets the same control on every design in every project: a small panel
pinned to a corner and labelled as a design control, not part of the product;
every state as a visible button with the current one marked (never a
dropdown); the current state kept in the page's address so a reload or a link
opens it; the page still clickable, so the human can walk from one state to the
next for real. The Tweaks menu, when there is one, folds into the same panel.
When the agent shows a design, it names the states the switcher holds.
**Why:** From the challenger. With no shared helper (decision 4), a guide that
left the shape open would give the human a different control on each design;
visible buttons and named states make it hard to approve after seeing only the
first state.
**Assumed.** Alternative: leave the switcher's look to each agent.
