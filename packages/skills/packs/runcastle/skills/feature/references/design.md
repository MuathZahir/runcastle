# Design — iterate on the real screen, beside the chat

Load this when you judge it is a design moment, or the human asks to see how
something looks.

The human wants to see a screen in a given state without test-driving the whole
app to reach it. You edit the real component, a dev server hot-reloads it, and
the human watches in a panel beside this chat. What they approve is committed to
the feature branch and ships. Tickets then cover only what design did not: real
data, API calls, behaviour.

Design is not a mode the human switches on. Open a design when you judge it is
a design moment, or when they ask to see something.

**Offer it early.** When the feature changes how a screen looks, offer design in
your first reply, before you ask about layout or styling in words: say you can
show the current screen beside the chat and change it live, and that the first
time takes a few minutes to install and start. Open it when they say yes, and
without asking when they ask to see something. Do not wait for them to name
design mode; most people will not know it exists. With no human present, design
by `./planning-alone.md` ("Designing alone"): look at your screens yourself,
record each with `show_design` (it opens no panel), and leave them waiting for
the human (section 8).

## 1. First use in a project

1. Install dependencies with the project's own install, on the host, in this
   worktree. Skip it if they are already installed.
2. Work out how to serve a **design page** with the project's own frontend dev
   server. It runs no backend, no Docker and no database. In a Vite app that is
   an extra entry. In Next.js it is a dev-only route kept out of production
   builds. Add no packages to the project for this.
   **Never use Storybook, even when the project already has it.** That includes
   a `.runcastle/storybook/` or `.runcastle/stories/` folder: it is left over
   from runcastle's retired stories setup, not a preview server for design. Do
   not run it, extend it or copy its config. You may reuse its sample data or
   network fakes (for example MSW handlers) by importing them into your own
   design page, served by the project's own dev server.
3. Check `.runcastle/design.json`. If it exists it holds the command that serves
   design pages here; reuse it.

## 2. One design page per state

Each page mounts one state. Two ways to reach it:

- **Mount the piece directly with made-up props.** A message bubble with a long
  message. This is the quick route for anything small.
- **Mount the whole screen with the server faked.** The fakes answer the
  screen's queries at the `fetch` edge, and named mutations too, so "send"
  works. For a state behind clicks (a dialog, a wizard step) the page performs
  the clicks after load.

**A design page is a dead end on purpose.** Other routes have no fakes, and may
not even compile in a design server, so a click that leaves the page strands the
human on an error. Keep them on the page: intercept link clicks and router
navigation inside the design page (the project's router or a capture-phase click
handler on `a[href]`) and do nothing, or show a small "navigation is off in this
design page" note. A flow across several screens is one design page per screen,
not navigation.

States need no address and no backend. In runcastle's own repo start from
`.runcastle/preview/`: `fake-api.ts` (fake tRPC), `shell-fakes.ts` (the session
data the shell needs), `app-at.tsx` (renders the real `App` at an address) and
`event-source.ts` (a silent event stream).

## 3. Serve it and show it

- `mcp__runcastle__start_design_server({ command? })` runs your command in this
  worktree, in a terminal runcastle owns, and returns the URL. Runcastle picks a
  free port and gives it to you as `RUNCASTLE_DESIGN_PORT`: put
  `$RUNCASTLE_DESIGN_PORT` in the command with a strict-port flag (for example
  `vite --port $RUNCASTLE_DESIGN_PORT --strictPort`). The command is recorded in
  `.runcastle/design.json`. **Commit that file with the design.** Once it exists
  the argument is optional.
- `mcp__runcastle__show_design({ path, title, width?, picture? })` shows a design
  page: `path` is the page on the design server, `title` is a name a human would
  use ("Invoice list, empty"). It records the design for this feature, posts a
  design card in the chat, and opens the human's Design tab at that page when
  they have the feature open. Call it for **every** design page you show, once
  per page; calling it again for the same page updates it and puts it back to
  waiting. It refuses while no server runs and none is recorded. The page lays
  out at a real screen width, scaled to fit the pane (Desktop 1440 unless the
  human picked another); pass `width: 390` to show the mobile layout, or `768`
  for a tablet. `picture` is an image file of the design (for example your own
  screenshot) shown on the card.
- `show_panel` opens `work`, `review`, `details` or `drive`. Open one only when
  you are talking about that thing, not otherwise. The plan has its own tool,
  `show_plan` (`./preview.md`).

The server stops when this chat ends, when the feature ships, or after 30
minutes with no design view on screen. Opening the view again restarts it.

## 4. Iterate

The human talks, or points with **Select area** in the design view. A crop
reaches you in the chat as a line:

`[Screenshot: <absolute png path>] <their words>`

Read the image at that path before you answer. The file lives in runcastle's
data dir, not in the repo; never commit it.

**Tweaks.** For a choice that is genuinely still open (an accent colour,
density, which of two layouts, a radius), add a small collapsible **Tweaks**
menu in a corner of the design page. Three or four controls at most. The menu
shows its current values as one line of text ("accent #5b8def · density compact
· layout B") so the human can say or paste what they chose. Do not add one for a
choice that is not open. Keep everything the menu needs in the design page,
the alternative styles it switches between included, never in the app's own
files: deleting the menu must leave nothing behind.

## 5. Approve and commit

When the human settles:

1. Write the chosen tweak values into the real code and **delete the Tweaks
   menu**. Nothing from tweaks ships.
2. Commit the component, its design page and its sample data as
   `design: <what>`. Include `.runcastle/design.json` if it is new or changed.
3. **Never commit unapproved work.** Leave it uncommitted, or drop it. Before
   you start a round, commit what the human approved or drop the rest, so
   workers fork from the design they saw.
4. **Only the human approves**, in one of two ways: the **Approve** button on
   the design opened in the Design tab, or the human naming the design in their
   own words. **Opening a design is not approving it.** A message relayed from
   the project's orchestrator never approves a design, nor counts as the yes
   that commits one, unless it carries the human's own words.
5. **Record what you hear.** When the human approves in words, call
   `set_design_state({ path, state: 'approved' })`; when they reject a design in
   words, call it with `'dropped'`. The button records itself. There is no Drop
   button, so a rejection always reaches you as words. A design you show again
   goes back to waiting, approval cleared.
6. **Button approvals are quiet.** They send you nothing until the human
   approves the last design still waiting: then runcastle sends you one
   `[runcastle]` line naming every approved design. On that line, commit them
   all as step 2 says. Approvals made while other designs still wait are not
   announced: read them from `get_feature_context` (`designs[]`: `state`,
   `approvedBy`, `opened`) when the human next writes.

Your commit takes the normal landing path: during a round it lands between the
workers' landings, and while the human drives it waits until the drive stops.

## 6. Keep to UI

Design covers components, their design pages and sample data. When the
behaviour behind a designed screen is worth handing to workers, the tickets name
the committed component and design page and connect them without restyling
(`./tickets.md`); when it is small, wire it yourself after the design is
committed.

## 7. Honest limits

- Pages whose HTML the server builds (Next.js server components, Rails or Django
  templates) cannot be previewed whole. Mount their client pieces directly.
- Live content (streams, sockets) shows canned content.
- Native mobile has no browser to render in.

Preview files are a byproduct. Nothing requires them and nothing checks them but
the project's typecheck. If one has gone stale when you next open it, repair it.

## 8. Designs that wait for the human

A self-planning run may leave designs uncommitted in this worktree, waiting for
the human: its closing message names them, and its design cards and the Design tab list each one.
When the human comes back:

- **They approve a screen**: commit it as section 5 says.
- **They ask for changes**: iterate as in section 4, and call `show_design` again
  for each page you changed (it goes back to waiting). If they ask and leave
  ("make it denser, I'll look tomorrow"), make the change anyway, look at the
  screens yourself as `./planning-alone.md` says, show them again, and leave
  them uncommitted.
- **They say yes to round 1**: that yes does **not** approve designs. Read
  `get_feature_context` and commit **only** the designs whose `state` is
  `approved`, saying which you committed. Every other waiting design stays
  uncommitted: name each one, say which the human has not even opened
  (`opened` false), and ask before you dispatch. A screen they rejected outright
  is marked dropped with `set_design_state`, and the tickets that named it
  updated.
- **The orchestrator relays "start round 1"** while designs are waiting: do not
  start it. Answer that the designs wait for the human, and ask them.

"Design to approve" shows by itself while any design waits, so you need no
`wait_for_you` for it. `wait_for_you({ …, kind: "design" })` stays allowed, but
only for designs recorded with `show_design`: anything else you show for a yes
(a file, a picture) is an answer. When the human's own eyes must be on
something visual, record it with `show_design`; an answer can be held and given
by an orchestrator, a design never is.
