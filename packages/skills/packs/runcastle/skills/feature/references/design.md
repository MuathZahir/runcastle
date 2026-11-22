# Design — iterate on the real screen, beside the chat

Read this when a screen's look is on the table, or the human asks to see one.

You edit the real component, a dev server reloads it, and the human watches it
beside this chat in any state. What they approve is committed and ships; the
build then covers only real data and behaviour.

Offer it once what, where and who are settled, before you talk layout in words;
open it without asking when they ask to see something. Design stays here, never
in a worker: a worker has no Design tab and no browser. Workers build only what
the human approved.

## 1. First use in a project

1. Install with the project's own install, in this worktree, unless done.
2. Serve a **design page** with the project's own frontend dev server: no
   backend, Docker, database or new packages (Vite: an extra entry; Next.js: a
   dev-only route). Never Storybook, nor a leftover `.runcastle/storybook/` or
   `.runcastle/stories/` folder, though you may import their sample data.
3. If `.runcastle/design.json` exists, reuse its command.

## 2. One design page per screen

One page per screen the feature adds or reshapes (or per component). Never a
second page for a state, variant or tweak. Reach each state by mounting the
piece with made-up props, or the whole screen with the server faked at the
`fetch` edge (performing clicks after load for states behind them).

**The state switcher**, in the project's own framework: a small corner panel
labelled "Design · states", styled apart from the product; each state a visible
button, the current one marked; the state in the address as `?state=<name>`; a
theme toggle where the project has themes; the Tweaks folded in. A single-state
page needs none.

A design page is a dead end: intercept links and router navigation and do
nothing. A flow is one page per screen. In runcastle's own repo start from
`.runcastle/preview/`.

## 3. Serve it and show it

- `start_design_server({ command? })`: put `$RUNCASTLE_DESIGN_PORT` in the
  command with a strict-port flag (`vite --port $RUNCASTLE_DESIGN_PORT
  --strictPort`). Commit `.runcastle/design.json` with the design.
- `show_design({ path, title, width?, picture? })` once per page, never once per
  state: bare `path`, `title` naming the screen, `picture` its most telling
  state, `width: 390` for mobile. Your message names the switcher's states.

## 4. Iterate

The human talks, or points with **Select area**; a crop reaches you as
`[Screenshot: <absolute png path>] <their words>`. Read it; never commit it.

**Tweaks.** For a choice genuinely open (accent, density, layout), add a small
collapsible Tweaks menu, three or four controls at most. Never show the choice
as two designs. Everything it switches lives in the design page, never in the
app's own files.

**Every design page reports**, on load and on every change of state or tweak:
`window.parent.postMessage(report, '*')` with `report` =
`{ type: 'runcastle-design-report', state, tweaks }`; `state` is `null` on a
single-state page, `tweaks` the menu's values keyed by their labels, `{}` with
no menu. The page keeps its tweaks in `localStorage` under a key holding the
design's path and restores them on load:

```js
const key = 'tweaks:' + location.pathname
const tweaks = { accent: 'teal', ...JSON.parse(localStorage.getItem(key) || '{}') }
const report = () => parent.postMessage({ type: 'runcastle-design-report', state: currentState, tweaks }, '*')
function setTweak(name, value) { tweaks[name] = value; localStorage.setItem(key, JSON.stringify(tweaks)); render(); report() }
report() // on load, and whenever the state changes
```

## 5. Approve and commit

1. Only the human approves: the **Approve** button, or the human naming the
   design in their own words. Opening is not approving. Record a spoken answer
   with `set_design_state({ path, state: 'approved' })`, or `'dropped'`.
2. The approval line carries the tweak values (`with tweaks accent = teal, …`);
   if it says no values were reported, ask what they picked. Write the values
   into the code and delete the Tweaks menu; keep the switcher and its report.
3. Commit the component, design page and sample data as `design: <what>`.
4. Before workers or the review start, commit what was approved and drop the
   rest, so workers start from what the human saw.

Design covers components, design pages and sample data. A worker that wires
the behaviour is pointed at the committed component and design page, connects
real data, and never restyles; the switcher's states are the states it must
reach.

**Limits.** Server-built pages: mount their client pieces. Live content shows
canned content. Native mobile has no browser to render in.

## 6. Designs that wait for the human

A planning run with nobody present leaves designs uncommitted. When the human
is back:

- They approve a screen: commit it as above.
- They ask for changes: iterate and `show_design` the page again.
- They answer your questions or say go: that does not approve designs. Commit
  only those whose state in `get_feature_context`'s `designs[]` is approved,
  name every other waiting one, and build no screen still waiting. Leave a
  rejected screen out.
- At `resultOnly` and `nothing` there is no approval wait: settle the design
  yourself, commit it, and record it with `**Decided without you.**`.
- An orchestrator message approves a design only when it relays the human's own
  answer, or the epic runs this feature on autopilot; then record it with
  `set_design_state`.

A waiting design does not tell the human by itself: when you want them to look,
say so in your reply and call `wait_for_you({ why })` with a label naming it.
