# Decisions — Improve map workflow UI/UX + Make markdown render correctly

## 1. Mapped ideation is a two-pane split, terminal is the hero
**Decision:** For a mapped feature, the ideation body stops being one vertical
column. `ws-body` splits into two panes: a fixed-width left rail (~300px)
holding the map prose + waypoint groups, scrolling independently, and the
terminal filling the whole remaining width at full height.
**Why:** Today `MapPanel` (map prose → waypoints → converge bar) and
`SessionPanel` stack in one scroll column, so the terminal — the thing the human
actually types into — is always below the fold and clamped to
`calc(100dvh - 380px)`. The waypoints, which are the point of a map, are
something you scroll to find. Splitting horizontally makes both permanently
visible and gives the terminal full height. Rejected: moving the map into the
existing right-hand `Inspector` rail — the Inspector is ambient, collapsible
feature context (activity, docs), whereas waypoints are the *primary*
interaction surface of a mapped feature; burying them there repeats the same
mistake in another direction.

## 2. `Work` implicitly ends a finished session — no explicit "Close session" step
**Decision:** Clicking `Work` on a frontier waypoint ends the live session for
you when that session's work is demonstrably done, then launches the new one —
one click, not two. "Done" means: a waypoint session whose own waypoint is
already `resolved`/`dropped`, or a non-waypoint session (e.g. the ideation grill)
on a feature that has since been mapped. If the live session is still mid-work
(its waypoint is still `claimed`), the spawn is still refused — but the refusal
becomes an inline affordance on the waypoint row naming the blocking session
("a session is live on *X* — end it and work this instead?") with the confirm
right there, instead of today's thrown `GateError` surfacing as a toast. When a
claimed waypoint goes terminal, the session strip flips from "live" to a done
state that names the next frontier waypoint inline.
**Why:** `resolve_waypoint` only flips waypoint machinery; it never touches the
session, so the finished `claude` process sits live and `assertSpawnable`
refuses the next waypoint until the human hunts down `EndSessionButton`. The
two clicks live in two different places on screen for no reason. Rejected:
having `resolve_waypoint` end its own session and auto-launch the next frontier
waypoint — with several waypoints on the frontier the server would be choosing
for the human, and it removes the chance to stop after one.

## 3. One shared `<Markdown>` component, on `react-markdown` + `remark-gfm`
**Decision:** Add a single `<Markdown>` component to `apps/web/src` and route
every agent-authored prose surface through it: `DocPeek` (the spec card and
every doc in the Inspector rail), the map rail's section bodies, and ticket
`goal` / `context` in `TicketsBody`. Built on `react-markdown` + `remark-gfm`
(agents write GFM — tables, task lists, strikethrough). Raw HTML stays
**disabled** (no `rehype-raw`). **No syntax highlighter** — a styled
`<pre><code>` in the existing JetBrains Mono is enough. `parseMapSections`
stays as-is; only each section *body* changes from text to `<Markdown>`.
**Why:** Nothing in the tool renders markdown today — `DocPeek` is a literal
`<pre>` of the file, map sections are raw text in a `<div>`, and ticket prose is
a plain `<div>` full of unrendered backticks. Fixing it in one component fixes
every surface at once and keeps them consistent. Taking the dependency (the
first rendering dep in `apps/web`, which is otherwise just React + tRPC + xterm)
is worth it: the rejected alternative — a ~100-line hand-rolled renderer — would
get markdown wrong in exactly the ways this feature exists to fix. A
highlighter was rejected on bundle weight for prose docs with occasional
snippets.

## 4. Converge moves into the next-step bar; the rail is waypoints-first
**Decision:** Delete the in-body `ConvergeBar` and fold it into the next-step
bar: `Converge` becomes the bar's primary action when G1 is satisfied, the
`Override & converge…` reason input becomes its inline expansion when it is
not, and the remaining-fog warning becomes the bar's `desc`. The `Jump to
grill` action (`openGrill`, a scroll-jump to `#grill-term`) is removed for
mapped features. The left rail then holds exactly two things, top to bottom:
(1) the waypoint groups — frontier, blocked, claimed, then the collapsed
resolved/dropped tail; (2) the map prose's four `## ` sections behind a
disclosure, **collapsed by default**.
**Why:** `feature-ui.ts:501` already narrates "Converge the map" in the
next-step bar while the actual button sits at the bottom of the body — the bar
exists to be the one guided action, so it should own it. `Jump to grill` is
meaningless once the terminal is permanently visible in its own pane. Ordering
the rail waypoints-first follows the human's own complaint: the waypoints are
the point of a map, the prose is orientation you read once.

## 5. The terminal flexes instead of guessing; tickets/review stay out of scope
**Decision:** For the ideation/spec body, `.ws-body` stops being the scroll
container and becomes a flex row whose panes scroll independently. The terminal
pane gets `flex: 1; min-height: 0` and measures its own height instead of the
current `clamp(320px, calc(100dvh - 330px), 1400px)` guess (and the
`.grill.has-context` −50px variant, which is deleted). This applies to both the
mapped variant (rail + terminal) and the unmapped one (a single pane; at `spec`
the one-line spec `doc-card` stays above it). `TicketsBody` and `ReviewBody`
are **explicitly out of scope** — their `100dvh - 420px` guesses stay.
**Why:** The height subtraction is the mechanical cause of the complaint —
`.ws-body` is `overflow-y: auto`, so anything rendered above the terminal really
does push it off-screen, and tuning the constant only moves the problem.
Tickets/review carry real content below the session (the ticket ledger, the
merge/diff UI) where scrolling is legitimate, and no complaint was raised about
them; including them would turn this into a whole-app layout refactor.

## 6. Waypoint rows become expandable cards that finally show `question`
**Decision:** A waypoint row stops being one flat line (`wp-type` + `wp-title` +
`Work` + lineage) and becomes a two-line card: type badge + title on the first
line, the `Work` control on the second. Clicking the card expands it to reveal
the waypoint's `question` prose — plus `summary` on resolved rows, `blockedBy`
names on blocked rows, and the "surfaced by X" lineage. **Frontier waypoints are
expanded by default**; blocked, claimed and resolved/dropped start collapsed.
**Why:** `question` is `notNull` on the `waypoints` table and is the single most
important field — it is literally what that session must answer — yet it is
rendered nowhere in the UI today; the only way to read it is to open the session
and let the agent fetch it via `get_feature_context`. The flat row also cannot
survive a ~300px rail (badge + title + button wrap into mush). The frontier is
what the human is choosing between, so its questions are the ones worth showing
at rest. Rejected: a hover tooltip for `question` — these are multi-sentence
prose questions, unreadable at tooltip length and invisible on touch.

## 7. The map rail is fixed-width, manually collapsible, and persisted
**Decision:** The rail is a fixed ~300px column with a collapse toggle in its
own header; collapsed it becomes a thin strip showing the frontier count, click
to reopen. The flag persists in `useWorkspace` next to `inspectorCollapsed` —
same `localStorage` pattern, a new `runcastle.maprail.collapsed` key, global
rather than per-project (matching `INSPECTOR_KEY`). **No** drag-to-resize and
**no** viewport-driven auto-collapse.
**Why:** A mapped feature now shows four columns (features `Sidebar` → map rail
→ terminal → `Inspector`), and the terminal is the one that must never get
squeezed, so the rail's width is fixed and the human collapses what they don't
want. Drag-resize was rejected as disproportionate — a resize handle,
pointer-capture logic and a persisted pixel width for a rail whose contents are
a fixed-shape list. Responsive auto-collapse was rejected because it fights the
user by re-opening what they collapsed; runcastle is desktop-first and
collapsing the `Inspector` is already one click away.

## 8. The implicit end lives server-side in `workWaypoint`, behind `endLive`
**Decision:** `workWaypoint` gains an `endLive?: boolean` input and owns the
handoff atomically. Without it (the ordinary click) the server ends any live
session it can *prove* is finished — a `waypoint` session whose own waypoint is
now `resolved`/`dropped`, or a non-`waypoint` session on a feature that is now
`mapped` — then proceeds through the unchanged `assertSpawnable`. A live session
still mid-work throws exactly as today; the client re-issues with
`endLive: true` only after the human confirms in the inline affordance.
`endLive: true` **may** abandon a different waypoint that is still mid-work —
the human can drop waypoint A halfway to go work B. Research runs are
untouched (they are `startRun`, not sessions).
**Why:** Doing it client-side as `endSession` then `workWaypoint` is a race —
between the two calls the feature holds nothing, and a failure on the second
leaves a dead session and no replacement. Server-side keeps it one mutation,
applies to any future caller, and preserves `assertSpawnable`'s
one-terminal-per-feature invariant instead of weakening it. Abandoning
mid-work is safe because the `SessionEnd` hook already auto-releases the
claim back to the frontier (`releaseForSession`), so no work is lost.

## 9. The session strip's done state has three cases; "next" is lowest `seq`
**Decision:** The strip finds its own waypoint as
`waypoints.find(w => w.lastSessionId === session.id)` (`resolveWaypoint` clears
`claimedBy` but `lastSessionId` persists) and renders one of three done states:
1. resolved, frontier non-empty → "Resolved ✓ — {summary}" plus a
   `Work next: {title}` button targeting the **lowest-`seq` frontier waypoint**;
2. resolved, frontier empty but waypoints still claimed (research in flight) →
   "Resolved ✓ — waiting on {n} research run(s)", no button;
3. resolved, everything terminal → "Map complete", pointing at the next-step
   bar's `Converge` — no duplicate Converge button in the strip.
The done state is **never** modal or blocking: it is a strip label plus at most
one button, and the terminal underneath stays fully usable until something
actually ends the session.
**Why:** Lowest `seq` is charting order, which is the closest thing to authored
intent, and the full frontier is visible in the rail one click away if the human
wants a different one. Non-blocking matters because the agent may call
`resolve_waypoint` while the human still has things to say to that session —
resolution is a machinery flip, not a conversation ending.

## 10. `prototype.html` is the visual target, committed beside these decisions
**Decision:** The throwaway layout prototype lives at
`docs/features/<slug>/prototype.html` — one self-contained file using the real
`styles.css` tokens, with a state switcher covering mid-work / resolved-next /
map-complete and a rendered-vs-raw markdown toggle. Implementation should match
it; where prototype and prose disagree, **these decisions win** (the prototype's
markdown renderer is a ~40-line stand-in, not `react-markdown`, and its terminal
is fake text rather than xterm).
**Why:** The prototype settled decisions 1/4/6/7 visually in a way prose
argument would not have, so the agents implementing the tickets should have the
same picture rather than reconstructing it. Committing it beside `decisions.md`
means it travels with the feature branch.
