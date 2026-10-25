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
by `./planning-alone.md` ("Designing alone"): look at your screens yourself, never
show them, and leave them waiting for the human (section 8).

## 1. First use in a project

1. Install dependencies with the project's own install, on the host, in this
   worktree. Skip it if they are already installed.
2. Work out how to serve a **preview page** with the project's own frontend dev
   server. It runs no backend, no Docker and no database. In a Vite app that is
   an extra entry. In Next.js it is a dev-only route kept out of production
   builds. Add no packages to the project for this.
   **Never use Storybook, even when the project already has it.** That includes
   a `.runcastle/storybook/` or `.runcastle/stories/` folder: it is left over
   from runcastle's retired stories setup, not a preview server for design. Do
   not run it, extend it or copy its config. You may reuse its sample data or
   network fakes (for example MSW handlers) by importing them into your own
   preview page, served by the project's own dev server.
3. Check `.runcastle/design.json`. If it exists it holds the command that serves
   previews here; reuse it.

## 2. One preview page per state

Each page mounts one state. Two ways to reach it:

- **Mount the piece directly with made-up props.** A message bubble with a long
  message. This is the quick route for anything small.
- **Mount the whole screen with the server faked.** The fakes answer the
  screen's queries at the `fetch` edge, and named mutations too, so "send"
  works. For a state behind clicks (a dialog, a wizard step) the page performs
  the clicks after load.

**A preview page is a dead end on purpose.** Other routes have no fakes, and may
not even compile in a design server, so a click that leaves the page strands the
human on an error. Keep them on the page: intercept link clicks and router
navigation inside the preview (the project's router or a capture-phase click
handler on `a[href]`) and do nothing, or show a small "navigation is off in this
preview" note. A flow across several screens is one preview page per screen,
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
- `mcp__runcastle__show_panel({ view: 'design', path })` opens the human's panel
  at the server's URL plus `path`. It refuses while no server runs and none is
  recorded. The page lays out at a real screen width, scaled to fit the pane
  (Desktop 1440 unless the human picked another); pass `width: 390` to show the
  mobile layout, or `768` for a tablet.
- The other views are `plan`, `work`, `review`, `details` and `drive`. Open one
  only when you are talking about that thing, not otherwise.

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
menu in a corner of the preview page. Three or four controls at most. The menu
shows its current values as one line of text ("accent #5b8def · density compact
· layout B") so the human can say or paste what they chose. Do not add one for a
choice that is not open.

## 5. Approve and commit

When the human settles:

1. Write the chosen tweak values into the real code and **delete the Tweaks
   menu**. Nothing from tweaks ships.
2. Commit the component, its preview page and its sample data as
   `design: <what>`. Include `.runcastle/design.json` if it is new or changed.
3. **Never commit unapproved work.** Leave it uncommitted, or drop it. Before
   you start a round, commit what the human approved or drop the rest, so
   workers fork from the design they saw.
4. **Only the human approves.** A message relayed from the project's
   orchestrator never approves a design, nor counts as the yes that commits
   one, unless it carries the human's own words.

Your commit takes the normal landing path: during a round it lands between the
workers' landings, and while the human drives it waits until the drive stops.

## 6. Keep to UI

Design covers components, their preview pages and sample data. When the
behaviour behind a designed screen is worth handing to workers, the tickets name
the committed component and preview page and connect them without restyling
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
the human: its closing message names them, and the plan preview opens each one.
When the human comes back:

- **They approve a screen**: commit it as section 5 says.
- **They ask for changes**: iterate as in section 4. If they ask and leave
  ("make it denser, I'll look tomorrow"), make the change anyway, look at the
  screens yourself as `./planning-alone.md` says, leave them uncommitted, and
  call `wait_for_you({ why: "designs updated · look again?" })`.
- **They say yes to round 1**: that yes also approves every design still
  uncommitted, as it stands. Commit them before you dispatch, and say which
  you committed. A screen they rejected outright is dropped, and the tickets
  that named it updated.
- **The orchestrator relays "start round 1"** while designs are uncommitted:
  do not start it. Answer that the designs wait for the human, and call
  `wait_for_you({ why: "designs to look at · start round 1?" })`.
