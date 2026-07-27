# Improve map workflow UI/UX + Make markdown render correctly

## Problem

When a feature is too big for one session it gets *mapped*, and the mapped
ideation screen is where the human then lives. Today that screen fights them
three separate ways.

**Everything is stacked in one scroll column.** The map document renders first,
the waypoints — the thing the human actually came for — sit below it, and the
terminal sits below *those*. Reaching the terminal means scrolling past
everything else, and even then it is short: its height is a hardcoded guess
(`100dvh` minus a constant, with a second constant subtracted whenever a map or
doc is present) rather than a measurement, so content above genuinely pushes the
terminal off-screen.

**No document renders as markdown.** Doc peek prints the file inside a `<pre>`,
the map's prose sections print as raw text, and ticket goal/context print as
plain divs. Every heading, list, table, link and backtick the agents write shows
up as literal syntax. This is not specific to the map — it is every
agent-authored prose surface in the tool.

**Finishing a waypoint takes two clicks in two places.** Resolving a waypoint
only flips waypoint machinery; it never touches the session, so the finished
Claude process sits there live. Because only one terminal is allowed per
feature, the next waypoint's Work button is refused until the human hunts down
End session in the terminal strip and clicks it first. The same friction hits
the very first handoff: after the initial grill charts the map, that grill
session is still live and must be manually closed before waypoint one can start.

## Approach

From the human's side, mapped ideation becomes an IDE rather than a document.
The waypoints sit in a rail on the left, permanently visible, with the terminal
filling everything to the right of them at full height. Finishing a waypoint and
starting the next one is one click. Every document reads as formatted prose.

**Layout.** The ideation/spec body stops being a vertical scroll column and
becomes a horizontal split whose two panes scroll independently. On a mapped
feature the left pane is the map rail; on an unmapped one there is no rail and
the terminal simply takes the whole body. Critically the terminal pane *flexes*
to fill its share instead of computing a height from viewport arithmetic — the
existing height constants and the extra "there is a map above" subtraction both
go away. The rail is a fixed width with a manual collapse to a narrow stub
showing the frontier count; the collapse flag persists in the workspace store
next to the existing inspector-collapse flag, keyed globally rather than
per-project. There is no drag-to-resize and no viewport-driven auto-collapse —
with four columns now possible (features rail, map rail, terminal, inspector)
the human collapses what they do not want, and the tool never re-opens what they
closed.

**The rail.** Waypoints come first, grouped by status — frontier, claimed,
blocked, then a collapsed resolved/dropped tail — and the map's prose sections
sit below them behind a disclosure that is closed by default. Each waypoint is
an expandable card rather than a flat row, because a flat row cannot survive the
rail's width and because the waypoint's *question* — the single most important
field, and the thing that session exists to answer — is currently rendered
nowhere in the product at all. Expanding a card reveals that question, plus the
resolution summary on resolved cards, the blocker names on blocked ones, and the
"surfaced by" lineage. Frontier cards start expanded since they are what the
human is choosing between; everything else starts collapsed.

**Convergence moves up.** The next-step bar already narrates "Converge the map"
while the actual button sits at the bottom of the body — the bar exists to be
the one guided action, so it takes ownership. Converge becomes its primary
action once the all-waypoints-terminal gate is satisfied, the
override-with-reason input becomes an inline expansion of the bar when it is
not, and the remaining-fog warning becomes the bar's description line. The
in-body converge section is deleted, as is the scroll-to-terminal action, which
is meaningless once the terminal is always visible.

**Handoff.** Work on a frontier waypoint becomes responsible for the whole
handoff, server-side and atomically, rather than the client firing an end and
then a start as two racing mutations. It gains an opt-in flag for ending a live
session. Without the flag, the server ends any live session it can *prove* is
finished — a waypoint session whose own waypoint has already gone terminal, or a
non-waypoint session on a feature that has since been mapped — and then proceeds
through the unchanged one-terminal-per-feature check. A session that is still
mid-work is refused exactly as today; the client then re-issues *with* the flag,
but only after the human confirms in an affordance rendered inline on the
waypoint card that names the blocking session. That confirm is allowed to
abandon a different waypoint mid-work: the session-end hook already releases an
unresolved claim back to the frontier, so nothing is lost. Research waypoints
are untouched throughout — they are runs, not sessions, and run in parallel.

**The done state.** A waypoint session can find its own waypoint after
resolution because resolving clears the claim but leaves the last-session
pointer intact. The terminal strip uses that to render one of three states:
resolved with a non-empty frontier offers a "work next" button targeting the
lowest-sequence frontier waypoint (charting order being the closest thing to
authored intent, with the full frontier one glance away in the rail); resolved
with an empty frontier but research still in flight says so and offers nothing,
because there is nothing to click; resolved with everything terminal says the
map is complete and points at the next-step bar rather than duplicating
Converge. None of these are modal or blocking — the agent may resolve while the
human still has things to say, so the done state is a strip label plus at most
one button and the terminal underneath stays fully usable.

**Markdown.** One shared component renders every agent-authored prose surface:
doc peek, the rail's map sections, the waypoint question and summary, and ticket
goal and context. It is built on the standard React markdown renderer with the
GitHub-flavored extension, since agents write GFM — tables, task lists,
strikethrough. Raw HTML passthrough stays disabled: these docs are
agent-authored rather than hostile, but enabling it buys nothing here. There is
no syntax highlighter — a styled code block in the existing mono face is enough
for prose documents with occasional snippets, and a highlighter is a large
bundle cost for that. The map's four-section split is retained as-is because it
still feeds the fog warning; only each section's *body* changes from text to
rendered markdown.

**A note on testability.** This repo has no DOM test environment — the web tests
are explicitly pure derivations. Rather than introduce one, the logic this
feature adds lives in pure functions in the web lib module (grouping, done-state
derivation, next-step derivation) with the components kept thin over them. That
keeps everything below testable at the existing seams.

## Seams

- **`workWaypoint`** *(existing)* — the server entry the Work button calls,
  already covered by a test harness with a real app context and git repo. Lets
  you observe the entire handoff: which live sessions are ended and which are
  refused, whether the refusal is the gate error, the resulting session or run,
  the waypoint's resulting claim state, and the emitted events. The new
  end-live flag is a parameter here, so every case in the handoff decision is
  observable at this one seam.
- **`nextStep`** *(existing)* — the pure next-step-bar derivation in the web lib
  module, already under test. Lets you observe that a mapped feature yields
  Converge as its primary action when the gate is satisfied, the override
  affordance when it is not, the fog text in its description, and no
  scroll-to-terminal action.
- **`sessionDoneState`** *(new, in the existing web lib module)* — a pure
  derivation from the feature payload plus a session to a discriminated union.
  Lets you observe the three done cases and the not-yet-done case, including
  which waypoint is chosen as "next", without rendering anything.
- **`waypointGroups`** *(new, same module)* — a pure derivation from the
  waypoints and the server-supplied frontier to the rail's rendered groups.
  Lets you observe group membership and ordering, which cards start expanded,
  the resolved blocker names, and the lineage labels.
- **`parseMapSections`** *(existing, currently private)* — promoted out of the
  body component so both the rail and the fog warning read one implementation.
  Lets you observe the section split independently of any component.
- **The markdown component** *(new)* — has **no unit seam**, and this is
  deliberate rather than an oversight: with no DOM environment its output cannot
  be asserted, and its behavior is almost entirely the upstream renderer's. Only
  its *policy* is assertable — GFM enabled, raw HTML disabled, no highlighter —
  so that is exported as a plain configuration value and checked. Visual
  correctness is verified against the committed prototype.

## Out of scope

- The tickets and review phase bodies. Their terminals keep the existing height
  arithmetic; they carry real content below the session where scrolling is
  legitimate, and no complaint was raised about them.
- The agent transcript view and the terminal emulator itself. Only the terminal
  pane's *height behavior* changes; nothing about the terminal changes.
- Syntax highlighting inside code blocks.
- Drag-to-resize on the rail, and any viewport-driven responsive behavior.
- Introducing a DOM test environment. The feature is shaped to avoid needing
  one; adding it is a separate decision about repo-wide testing convention.
- Any change to how research waypoints are worked or how runs behave.

## Open questions

- **A keyboard shortcut for "work next waypoint"** was raised and deliberately
  deferred — the mouse path is being fixed first, and the shortcut only makes
  sense once the button's placement has settled in real use.
- **The measured bundle cost of the markdown dependency.** The decision to take
  it is locked, but the actual gzipped cost has not been measured; worth a
  sanity check during implementation, and a reason to revisit only if it is
  wildly out of line with expectations.
- **Whether the tickets and review bodies eventually get the same flex
  treatment.** Explicitly out of scope here, but the height-arithmetic pattern
  they still use is the same one this feature is removing from ideation, so it
  is a known inconsistency being accepted for now.
- **Rail behavior at the spec phase** is settled as "stays visible, showing the
  resolved tail as context for the converge session", but it was a judgment call
  rather than a grilled decision — worth confirming once it can be used.
