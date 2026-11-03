# Designs and the plan get their own place

## Problem

A feature's plan and its designs are hard to find and easy to miss. The plan
opens in a panel only while the agent is opening it, and leaves nothing in the
chat. A design can be reached only through an "Open in design" button inside the
agent-written plan page, and only if the agent remembered to add one; the Design
tab exists only while a design server runs, so the next morning it is gone.
Nothing says a plan or a design is waiting to be looked at. "Preview" means two
different things. And the yes to round 1 commits every waiting design, even ones
the human never opened.

## Approach

**For the human.** The plan and each design arrive in the chat as cards, in the
Review Package's family. The plan card says what the feature is in a line and how
big the plan is; a design card shows a picture of the design, its title, its
width, and whether it waits for the human. A click opens the Plan tab, or that
design in the Design tab. The Design tab is always there on an active feature, and
its home is the list of every design, waiting ones first. Opening a design shows it
live with "All designs", arrows to the previous and next design, and **Approve**; the list itself approves nothing.
A dot on the header's panel toggle and on the Plan and Design tabs says something
there is new to the human. "Design to approve" now shows whenever a design waits,
and its button opens the list. Merge names any design still waiting. On the phone
the same cards show in the chat and open the phone's Design screen.

**The design record (new, server).** A per-feature record of designs, one entry
per design-server page: title, page path, optional width, optional picture (a copy
kept by runcastle, like a shown file), state (`waiting | approved | dropped`), who
approved it (`human` by the button, `lead` when the lead marked a spoken yes),
when it was last shown, and when the human last opened it. Showing a design again
updates its entry, sets it back to `waiting` and makes it new again (decision 18).
The plan has the same two facts on the feature: when it was last shown and when the
human last opened it. Lives in the database (a new table plus two feature columns,
with a migration), so the desktop and the phone agree. Every write emits an event.

The wire shape the web designs were drawn against (from
`apps/web/src/lib/feature-ui/designs.ts`, design-time; it moves into
`@runcastle/core` as the wire type):

```ts
type DesignState = 'waiting' | 'approved' | 'dropped'
interface DesignEntry {
  id: string; title: string; path: string; width?: number; picture?: string
  state: DesignState; isNew: boolean; shownAt: number
}
```

**Agent tools (MCP, feature chat sessions).**
- `show_design({ path, title, width?, picture? })` records or updates the design
  and appends a `design_shown` thread event. From an attended chat it also opens
  the Design view on that design; from a headless run it opens nothing
  (decision 15). `picture` is a file path the tool copies, with the same reach as
  `show_file`.
- `show_plan()` appends a `plan_shown` thread event, stamps the plan's shown time
  and, from an attended chat, opens the Plan view. Refused when the feature has no
  plan (no preview, decisions or spec).
- `set_design_state({ path, state: 'approved' | 'dropped' })` records a yes or a
  rejection the human gave in words (decisions 8, 20).
- `show_panel` keeps `work`, `details` and `drive` and loses `plan` and `design`
  (decision 3); asked for either, it refuses and names the new tool.
- Tool descriptions say "design page", never "preview page" (decision 13).

**Thread events and the fold (core).** Two new thread events, `plan_shown` and
`design_shown { designId }`, fold into two new thread items placed as a review
package is (the turn's work above, its final words below): a plan card, and a group
of design cards (consecutive `design_shown` events in a turn fold into one group).
The fold also marks a card older when a later card for the same design, or a later
plan card, follows it (decision 19).

**Human actions (tRPC).** `design.list({ featureId })`, `design.approve({ designId })`
(the human's click: records `approved` by `human`, emits, and delivers a runcastle
line to the lead's main chat through the lead-delivery path, "You approved the
design “<title>”", which wakes it to commit), `design.seen({ designId })` (opening a
design) and `plan.seen({ featureId })` (opening the Plan tab or card). The existing
design-server routes stay; opening a design starts the server at its path as today.

**The need (core, `feature-need`).** A new fact, how many designs wait, feeds the
"design" need: it applies while any design waits and the lead is idle, as well as
when the lead waits with the "design" kind. Its precedence is unchanged; it stays a
need only the human can answer (never held by the orchestrator).

**The lead's view.** `get_feature_context` gains `designs[]`: title, path, state,
who approved it, and whether the human opened it since it was last shown. The
lead's rules (skills): commit a design when it is approved, by the button or by the
human's own words; at the yes to round 1, commit only approved designs, and name
every other waiting design and ask before dispatching (decision 9).

**Web (desktop).** The thread renders the plan card and design cards (the
components `PlanCard`, `DesignCard`/`DesignCards`, from the committed designs). The
panel always offers Design on an active, non-shipped feature (decision 6); its body
is `DesignList` (home), or `DesignBar` over the existing live Design view for the
open design. `DesignList`'s empty state offers "Open the design server" when a
command is recorded and no design is (decision 7). `PanelToggle` gets `dot`, and
`FeaturePanel` gets `fresh` (both already added by the design). The "Design to
approve" button opens the list. The merge dialog lists waiting designs. Removed:
the plan frame's open-design message (`PREVIEW_OPEN_DESIGN_MESSAGE`,
`openDesignPath`) and the code answering it, and the rule that keeps Design offered
only while the server runs or the view is requested.

**The plan card's counts** come from the server: decisions are the `## n.` headings of decisions.md, "to check first" is the numbers on its `Check first:` line (a self-planning convention the skills add; absent, the card leaves it out), tickets are the implementation tickets (none: "built by the agent"), designs the record's count.

**Designs from another machine (decision 23).** The desktop Design view, its pop-out, the design cards and the plan's "Open in design" buttons load a design through the design pass-through (`serverPort + 2`, the phone's `/__runcastle/open/<featureId>?path=…` entry) on the page's own host and protocol, never the design server's own localhost URL. The web learns the pass-through port from the server. When the port cannot be reached from the page (a quick probe before the frame loads), the frame shows a line naming the port to forward instead of a browser error. The phone keeps its own path and gains nothing here.

**Phone.** The phone's chat renders the same cards. A design card opens the phone's
Design screen at that design with Approve; the phone's "Design to approve" opens
the oldest waiting design (decision 22).

**Skills.** The feature skill's design, preview, planning-alone and starter files:
call `show_plan` where they called `show_panel({ view: 'plan' })`; call
`show_design` for every design shown (a headless run passes the screenshot it took
as `picture`); the designed-screen entry in a plan carries no button (decision 14);
approval follows decisions 8 and 9; "design page" replaces "preview page".

## Seams

- **MCP tool calls** (existing seam, new tools): `show_design`, `show_plan`,
  `set_design_state`, `show_panel`, observed through the design record, the thread
  log and emitted events. Tested as the server tests its other tools.
- **The thread fold** (existing, `foldThread` in core): events in, thread items
  out — the card items, their grouping and the older marks.
- **`featureNeed`** (existing, pure): facts in, the need out — the design need from
  the record.
- **tRPC `design.*` and `plan.seen`** (existing router, new procedures): the
  human's approve and seen, observed through `design.list` and the lead's delivered
  line.
- **`get_feature_context`** (existing): the lead's `designs[]`.
- **The design page `apps/web/preview/designs.html`** (new, uncommitted until
  approved): the cards, the list, an open design and both empty states on sample
  data — the look the web wiring must keep.

## Out of scope

- A design list screen on the phone (decision 16).
- Runcastle taking its own pictures of designs (decision 4).
- A Drop button (decision 20).
- Designs on shipped features (decision 6).
- Renaming `preview.html` or the projects' preview folders (decision 13).
- The general waiting words, header buttons and pings (built by "You always know
  what's waiting"), Review Package internals, and app-wide renames ("Ready to
  publish").

## Open questions

- How long an older feature's unrecorded designs need the "Open the design server"
  fallback before it can be removed (decision 7).
