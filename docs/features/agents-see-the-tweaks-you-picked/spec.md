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

**For the human.** Nothing new to do and nothing new on screen. When they
approve, the approval the lead hears names each approved design's picked tweak
values. The copy-paste readout disappears from new design pages. Chat messages
are unchanged: the values go to the agent only on Approve (decision 12).

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
browser storage, under a key that includes the design's path so two designs on
one design server never overwrite each other's values, and restores them on
load (decision 11). The guide's readout
line goes (decision 3). The guide's Tweaks and switcher sections gain these
rules with a few-line example in plain browser JavaScript, and runcastle's own
design-page starter (`.runcastle/preview/`) gets a switcher helper that reports,
so runcastle's own designs follow the rule.

**The Design tab listens (decision 5).** The design view, desktop and phone,
listens for `message` events whose `source` is the design frame it shows (the
same check the plan frame's Escape relay uses), validates the report with a zod
schema in core, caps it (at most 12 tweaks, keys and values at most 80
characters; a report over the cap is trimmed, never dropped), and sends it to
the server (`design.report`, debounced to the trailing edge of ~300 ms), which
writes it on the design row.

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

**Reach.** The server and web changes ship with runcastle. The guide change
reaches live sessions only once runcastle is published and reinstalled, and
pages already committed are not migrated: they report nothing and say so.

## Seams

- **The design report schema** (new, core): what a page may post; tested with
  good, partial, oversized and foreign messages.
- **The design-tab listener** (new, web, tier 2 real DOM): a fake frame posting
  reports; observe the debounced `design.report` call, and that a message from
  another window is ignored.
- **`design.report` and `approveDesign`** (existing service, extended): observe
  the stored report, the copy at the click, and the approval line text for
  reported, empty, and silent designs, one and several at once.
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
- Tweak values in chat messages, or a button to send them (decision 12).

## Open questions

- The human wants to try it with a real design that has tweaks before merging.
  A drive of runcastle starts from the installed version, so the drive needs the
  branch's server started by hand, and a design page that reports: the review
  worker builds a throwaway one with two tweaks for its run, and the lead can
  show the human one on the drive: tweak it, approve it, and read the line the
  lead receives.
