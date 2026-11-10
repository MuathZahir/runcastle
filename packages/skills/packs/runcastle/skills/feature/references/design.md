# Design — iterate on the real screen, beside the chat

Load this when you judge it is a design moment, or the human asks to see how
something looks.

You edit the real component, a dev server hot-reloads it, and the human watches
it beside this chat in any state without test-driving the app. What they approve
is committed and ships; the build then covers only real data, API calls, behaviour.

**Offer it early.** When the feature changes how a screen looks, offer it in your
first reply, before you talk layout in words (the first time takes a few minutes
to install and start). Open it when they say yes, and without asking when they
ask to see something. With no human present, follow `./planning-alone.md`
("Designing alone") and leave the designs waiting (section 8).

Taste work you would iterate on with the human for long goes to a "with you"
worker instead (`./workers.md`). It shows its own preview in its chat, and this
chat stays small.

## 1. First use in a project

1. Install dependencies with the project's own install, in this worktree, unless
   already installed.
2. Serve a **design page** with the project's own frontend dev server: no
   backend, Docker or database, and no new packages (a Vite app: an extra entry;
   Next.js: a dev-only route). **Never use Storybook**, nor a leftover
   `.runcastle/storybook/` or `.runcastle/stories/` folder; you may import their
   sample data or network fakes into your own page.
3. If `.runcastle/design.json` exists, reuse the command it holds.

## 2. One design page per screen, its states inside

**One design page per screen** the feature adds or reshapes (or per component,
when it changes a component, not a screen). **Never a second design for a state,
a variant or a tweak**: every state is reached from a **state switcher** on that
one page, an open choice of look is a Tweak (section 4), and widths and themes are
one design. Two ways to reach each state:

- **Mount the piece directly with made-up props** — quick, for anything small.
- **Mount the whole screen with the server faked** at the `fetch` edge, named
  mutations included; for a state behind clicks, the page performs them after load.

**The switcher**, written in the project's own framework, always the same shape:
a small corner panel labelled "Design · states" and styled apart from the
product; every state a visible button (never a dropdown), the current one
marked; the state in the address as `?state=<name>`; the page stays live; a theme
toggle beside the states where the project has themes; the Tweaks folded into the
panel. A single-state screen needs none. The switcher **reports** its current
state to the Design tab (section 4).

**A design page is a dead end on purpose**: intercept link clicks and router
navigation and do nothing, since other routes have no fakes. A flow is one page
per screen. In runcastle's own repo start from `.runcastle/preview/`; its
`design-report.ts` reports and keeps the tweaks for you.

## 3. Serve it and show it

- `mcp__runcastle__start_design_server({ command? })` runs your command here and
  returns the URL. Put `$RUNCASTLE_DESIGN_PORT` in it with a strict-port flag
  (`vite --port $RUNCASTLE_DESIGN_PORT --strictPort`). The command is recorded in
  `.runcastle/design.json`: **commit that file with the design.**
- `mcp__runcastle__show_design({ path, title, width?, picture? })` records a
  design page (bare `path`, no `?state=`), posts its card and opens the human's
  Design tab. `title` names the screen ("Invoice list"), never a state. Call it
  once per page, never once per state; calling it again puts it back to waiting.
  `picture` is the most telling state; your message names the switcher's states.
  `width: 390` shows mobile, `768` tablet.
- `show_panel` opens `work`, `review`, `details` or `drive`, only while you talk
  about that thing. The plan has `show_plan` (`./preview.md`).

The server stops when this chat ends, the feature ships, or after 30 minutes
unseen; opening the view restarts it.

## 4. Iterate

The human talks, or points with **Select area**; a crop reaches you as
`[Screenshot: <absolute png path>] <their words>`. Read the image; never commit it.

**Tweaks.** For a choice genuinely still open (accent, density, which layout),
add a small collapsible **Tweaks** menu to the design page, three or four controls
at most. **Never show the choice as two designs.** Everything the menu switches
between lives in the design page, never in the app's own files: deleting it
leaves nothing.

**Every design page reports**, single-state ones and pages without Tweaks
included. On load and on every change of state or tweak it posts one message to
the window around it, `window.parent.postMessage(report, '*')`, where `report` is
`{ type: 'runcastle:design', state, tweaks }`: `state` is the switcher's current
state (`null` on a single-state page), `tweaks` the menu's values keyed by the
labels it shows (`{}` when the page has no Tweaks menu). When the human clicks
**Approve**, runcastle hands you the values the page last reported.

**The page remembers its tweaks**: it keeps them in `localStorage` under a key
that includes the design's path, so two designs on one server never overwrite
each other, and restores them on load. A reload then shows the human's picks,
not your defaults. In plain browser JavaScript:

```js
const key = 'tweaks:' + location.pathname
const tweaks = { accent: 'teal', density: 'compact', ...JSON.parse(localStorage.getItem(key) || '{}') }
const report = () => parent.postMessage({ type: 'runcastle:design', state: currentState, tweaks }, '*')
function setTweak(name, value) { tweaks[name] = value; localStorage.setItem(key, JSON.stringify(tweaks)); render(); report() }
report() // on load; call it again whenever the switcher changes state
```

## 5. Approve and commit

1. The chosen tweak values arrive in the approval line (`with tweaks accent =
   teal, …`, or `(no Tweaks menu)`, or `(this design reported no tweak values)`:
   then ask the human what they picked). Write them into the code and **delete the Tweaks
   menu**. **Keep the state switcher** and its report: they are committed with
   the design page.
2. Commit the component, its design page and sample data as `design: <what>`,
   with `.runcastle/design.json` if new or changed.
3. **Never commit unapproved work.** Before you start workers or the review, commit
   what the human approved and drop the rest, so workers start from what they saw.
4. **Only the human approves**: the **Approve** button in the Design tab, or the
   human naming the design in their own words. Opening is not approving, and an
   orchestrator relay never approves unless it carries the human's own words.
5. **Record what you hear**: `set_design_state({ path, state: 'approved' })` for
   an approval in words, `'dropped'` for a rejection (there is no Drop button).
6. **Button approvals are quiet** until the last waiting design is approved:
   then one `[runcastle]` line names them all; commit them. Otherwise read
   `get_feature_context` (`designs[]`: `state`, `approvedBy`, `opened`, `report`).

## 6. Keep to UI

Design covers components, design pages and sample data. A worker that wires the
behaviour is pointed at the committed component and design page and does not
restyle (`./workers.md`); small wiring you do yourself.

## 7. Honest limits

- Server-built pages (Next.js server components, Rails or Django templates):
  mount their client pieces directly.
- Live content shows canned content. Native mobile has no browser to render in.

A stale preview file is repaired when you next open it; states split across
several pages are merged into one page with a switcher.

## 8. Designs that wait for the human

A self-planning run may leave designs uncommitted, waiting for the human. When
they come back:

- **They approve a screen**: commit it as section 5 says.
- **They ask for changes**: iterate (section 4) and `show_design` each changed
  page again. If they ask and leave, make the change, look yourself as
  `./planning-alone.md` says, show it again, and leave it uncommitted.
- **They say yes to the plan**: that yes does **not** approve designs. Commit
  **only** the designs whose `state` is `approved`, saying which; name every other
  waiting design (and which are not even `opened`) and ask before you start work.
  Mark a rejected screen dropped and leave it out of the workers you start.
- **The orchestrator relays a yes to start the work** while designs wait: do not start;
  say the designs wait for the human.

"Design to approve" shows by itself, so you need no `wait_for_you` for it.
`kind: "design"` is only for designs recorded with `show_design`: anything else you show for a yes
(a file, a picture) is an answer.
