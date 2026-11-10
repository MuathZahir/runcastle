# Agents see the tweaks you picked

## Problem

When a lead is unsure of a look, it adds a small Tweaks menu (accent, density,
which layout) to its design page. The human picks values in the Design tab, but
the page runs cross-origin in a frame, so the picks never leave it. On Approve
the lead hears only the design's title and path; when the human types "make
this darker", the lead does not know which state or which tweaks they are
looking at. The only bridge is a readout line the human is meant to copy and
paste, and in practice nobody does. Agents build the wrong look.

## Approach

**For the human.** Nothing new to do. While a design is open, a quiet line
above the composer says what goes with the next message: the design, the state
it shows, and its tweak values. The sent message keeps that line under the
human's words. When they approve, the approval the lead hears names each
design's picked values. The copy-paste readout disappears from new design pages.

**The design page reports (decisions 5, 10, 11).** The design guide asks every
design page, single-state ones included, to post one message to its parent
window on load and on every change of state or tweak:

```ts
// posted with window.parent.postMessage(report, '*')
type DesignReport = {
  type: 'runcastle:design'
  state: string | null                              // the switcher's current state; null for a single-state page
  tweaks?: Record<string, string | number | boolean> // keyed by the label the menu shows; {} = no Tweaks menu
}
```

An empty `tweaks` means the page has no Tweaks menu; a missing `tweaks` means
the page did not say (decision 10). The page keeps its tweak values in its own
browser storage and restores them on load (decision 11). The guide's readout
line goes (decision 3). The guide's Tweaks and switcher sections gain these
rules with a few-line example in plain browser JavaScript, and runcastle's own
design-page starter (`.runcastle/preview/`) gets a switcher helper that reports,
so runcastle's own designs follow the rule.

**The Design tab listens (decision 5).** The design view listens for
`message` events whose `source` is the design frame it shows (the same check
the plan frame's Escape relay uses), validates the report with a zod schema in
core, caps it (at most 12 tweaks, keys and values at most 80 characters; a
report over the cap is trimmed, never dropped), and:

- puts it in a per-feature **design context** store on the web side (a keyed
  pub/sub like the existing composer inbox), holding the open design's id,
  title, path and latest report, or "no report yet";
- sends it to the server (`design.report`, debounced to the trailing edge of
  ~300 ms), which writes it on the design row.

Desktop and phone frames both get the listener. On desktop the store holds the
design the Design tab shows and empties when the panel shows anything else. On
the phone it keeps the design the human last left until they open another view
or leave the feature (decision 8).

**Runcastle keeps the last report (decisions 6, 7).** The `designs` table gains
`report` (JSON, nullable) and `reportedAt`, and `approvedReport` (JSON,
nullable). `design.report({ designId, report })` writes the first two and emits
`design.reported` (no lead wake). `approveDesign` copies `report` into
`approvedReport` at the click. When the last waiting design is approved, the
approval line names each approved design with its `approvedReport` tweaks:

> [runcastle] The human approved the 1 design in the Design tab: “Invoice list”
> (/preview/invoice-list) with tweaks accent = teal, density = compact. Write
> those values into the code, delete its Tweaks menu, and commit it as
> "design: Invoice list".

A design approved with an empty set reads "(no Tweaks menu)"; one with no
report reads "(this design reported no tweak values)". The lead's feature
context shows each design's `report` too, so a lead reading `designs[]` during
quiet approvals sees it. Approvals made in words (`set_design_state`) are
untouched.

**Chat messages carry the open design (decisions 1, 2, 9).** The composer reads
the design context store. `thread.send` gains an optional
`design: { designId, report | null }`, taken from the store at the moment of
sending, not from the server, so a message never races a report in flight. The
server checks the design belongs to the thread's feature, then:

- gives the agent the human's text followed by one line:
  `[runcastle] Open in the Design tab: “Invoice list” (/preview/invoice-list), state “full”. Tweaks: accent = teal, density = compact.`
  with "It has no Tweaks menu." or "This design reported no state or tweak
  values." where those apply (decisions 4, 10);
- records the human's own words as what the human reads, with the design line
  as structured data on the prompt so the transcript draws it as a quiet line
  under the bubble (the prompt's display data, as runcastle prompts already do).

The composer shows the same line, in the same words, while the store holds a
design: `Invoice list · full · accent teal, density compact`, or
`Invoice list · reported nothing`. It cannot be edited or dismissed.

**Reach.** The server and web changes ship with runcastle. The guide change
reaches live sessions only once runcastle is published and reinstalled, and
pages already committed are not migrated: they report nothing and say so.

## Seams

- **The design report schema** (new, core): what a page may post; tested with
  good, partial, oversized and foreign messages.
- **The design-tab listener** (new, web, tier 2 real DOM): a fake frame posting
  reports; observe the store's content, the debounced `design.report` call, and
  that a message from another window is ignored.
- **`design.report` and `approveDesign`** (existing service, extended): observe
  the stored report, the copy at the click, and the approval line text for
  reported, empty, and silent designs, one and several at once.
- **`thread.send` with `design`** (existing router, extended): observe the text
  the agent host receives, the display data the transcript gets, and refusal
  of a design from another feature.
- **The composer line and the sent bubble's line** (web, tier 1 static markup):
  rendered from a given store value and prompt.
- **The design guide** (skill pack text): the readout line gone; the report,
  storage and every-page rules present.

## Out of scope

- Redesigning the Tweaks menu or the state switcher.
- Reworking approval: the Approve button, design states, the quiet-until-last rule.
- Migrating design pages already committed.
- A shared switcher or tweaks component for project design pages (the shipped
  feature decided against one); the helper in runcastle's own `.runcastle/preview/`
  is runcastle's own design pages only.
- Runcastle sending values back into a design page.
- A control to leave the design line off a message.

## Open questions

- The human wants to try it with a real design that has tweaks before merging.
  A drive of runcastle starts from the installed version, so the drive needs the
  branch's server started by hand, and a design page that reports: the review
  worker builds a throwaway one with two tweaks for its run, and the lead can
  show the human one on the drive.
