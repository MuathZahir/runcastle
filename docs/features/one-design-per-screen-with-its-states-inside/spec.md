# One design per screen, with its states inside

## Problem
When a feature agent designs a screen, the human approves each design one by
one. Today the design guide tells agents to make one design page per state, so a
screen with an empty, a loading and a full state arrives as three designs, and
an agent that was unsure about a tweak sent the same screen twice, with and
without it. The human approves the same screen several times, and nothing in
the rules says how many designs a screen should be.

## Approach
From the human's side: each screen (or component) a feature designs arrives as
**one design card**. Opening it shows the screen with a small, clearly marked
panel in a corner: one button per state, the current one marked, a theme toggle
where the project has themes, and the Tweaks for any open choice of look. The
human clicks through the states, picks the tweaks, and approves once. Later, the
committed design page still carries the state buttons, so anyone can reopen any
state; the Tweaks are gone, their chosen values written into the real code.

The change is almost all text in the feature skill pack, plus the show-design
tool's description in the server:

- **The design guide** (the feature skill's `design.md`). Section 2 becomes
  "One design page per screen, its states inside": what counts as one design
  (decision 1: a screen, or a component when the feature changes a component
  rather than a screen; a component used on several screens is one design for
  the component, plus a screen design only where a screen's layout changes
  around it); how states are reached (made-up props or faked server per state,
  a state behind clicks reached by performing the clicks); the switcher's fixed
  shape (decision 8); widths and themes are not designs (decision 3). Section 3
  replaces the per-state example title ("Invoice list, empty") with a screen
  title, says `show_design` takes the bare page address (never one per state),
  that its picture shows the most telling state, and that the agent names the
  states when it shows a design. Section 4 says outright that an open choice is
  a Tweak inside the one page, never a second design, and that the Tweaks fold
  into the switcher's panel. Section 5 says the switcher is committed with the
  page and the Tweaks are not (decision 5). Section 8 notes that a change to any
  state re-shows the whole design, which puts it back to waiting.
- **The planning-alone guide** (`planning-alone.md`, for runs with no human
  present). "one design page per state" becomes one per screen with a switcher;
  "check every design page" becomes check every state of every design page;
  "at most two open choices per screen" stays.
- **The plan guide** (`preview.md`). A designed-screen entry also lists the
  states its switcher holds, so the plan says what the human will find.
- **The tickets guide** (`tickets.md`). A ticket that wires a designed screen
  points at its states on the switcher as the states its wiring must reach.
- **The show-design tool's description** in the MCP server (decision 6). The
  examples become a screen (`/preview/checkout.html`, "Checkout"), and the
  description gains one sentence: one design per screen, its states on a
  switcher inside the page, never a design per state or variant. No server
  behaviour changes.

The switcher's shape, as the guide pins it (decision 8):

- a small panel pinned to a corner, labelled as a design control ("Design ·
  states"), styled apart from the product so it is never judged as UI;
- every state as a visible button with a plain name, the current one marked;
  never a dropdown;
- the current state in the page's address as `?state=<name>`, so a reload, a
  link or the agent's own screenshot lands on it; the design is still shown
  with `show_design` at the bare page address;
- the page stays live: the switcher jumps to a state, and the human can still
  click through the screen from there;
- a theme toggle beside the states where the project has themes, not a state;
- the Tweaks, when there are any, as a collapsible part of the same panel, with
  its one-line readout of the current values.

No helper ships (decision 4): the agent writes this panel in the design page,
in the project's own framework. Runcastle's own design pages are left as they
are (decision 7).

The rule reaches live sessions only once runcastle is published and reinstalled:
running sessions read the globally installed skill pack, not this repo.

## Seams
- **The feature skill pack's text** (existing): read by every feature agent.
  Observed by reading the changed guides; the skill pack's own tests, if any
  check its references, must stay green.
- **The show-design tool's description** (existing): observed in the server's
  MCP tool registration; the server's typecheck and tests stay green.

## Out of scope
- Any change to runcastle's Design pane, its Approve button, or how designs are
  recorded, committed or wired into tickets beyond the wording above.
- Merging design addresses on the server (decision 6).
- A shared switcher component (decision 4).
- Migrating design pages already committed (decision 7).
- Publishing and reinstalling runcastle so live sessions get the new rule.
- The website work running in parallel.

## Open questions
None.
