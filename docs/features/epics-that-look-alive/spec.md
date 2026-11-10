# Epics that look alive

## Problem

"Orchestrator chats become epics" turned the sidebar into a list of epic cards, and in use it looks dead. Every epic wears the same blue wash, grid and hub icon, whether anything is happening or not, so a list of mostly idle question chats ("Nothing in motion", six times over) reads like a list of busy ones. Starting an epic takes the Create menu and then "New epic", and the empty chat appears at once as a full card. The epic icons are low quality. The project rail is a column of bare initials and the sidebar header is plain text, both visibly less finished than the cards beside them, and the runcastle logo appears nowhere in the app.

## Approach

**What the human sees.** The approved design page (`apps/web/preview/epics-alive.html`, states: mixed, all-idle, new-epic, picker, phone) is the reference for every look below; the build does not restyle it.

- **A dotted "New epic" slot** tops the epic list, on desktop and phone. Clicking it opens an empty epic chat; nothing is saved and no card appears until the first message is sent. "New epic" leaves the Create (pencil) menu and the phone list header.
- **Each epic has a colour and an icon.** Eight dark, muted tones (blue, teal, green, olive, amber, rust, rose, violet), each with a light-theme counterpart, defined as tokens in the theme file. An epic's card wash, grid and icon tile take its colour. Icons come from Lucide, a curated list of about 24 keyed by stable ids, with a neutral chat-bubble default for an epic that has none.
- **Busy epics keep the full card; idle epics are slim tinted rows**: a lightly tinted strip in the epic's colour with its coloured icon, its name, and on the right "3 shipped · 2h" (the shipped part only when above zero; below ~300px of sidebar, only the time). Idle means its chat neither works nor asks and nothing it cut is in motion or up next.
- **Order**: epics needing the human first, then epics in motion, then idle epics, each band newest started first. "Other features" joins the first band when something in it needs the human, otherwise ends the in-motion band.
- **"Colour and icon…"** in an epic's menu opens a small picker (8 swatches, the icon grid). A human pick of the icon is final: the orchestrator never changes it afterwards, as with a human rename.
- **The rail**: neutral real tiles for projects, a clear marker on the open one, the needs-you dot on the tile's corner, a dotted "+" tile; the runcastle logo as a mark at the top with the "All projects" grid button directly below it. Behaviour (order, shortcuts, when the dot shows) is unchanged.
- **The header**: a large project name beside one tidy group of icon buttons.

**Shape.**

- *Storage.* The project-chat session row gains the epic's colour (one of the 8 keys), its icon (an icon id, nullable) and whether the human set the icon. A migration adds them and gives every existing project chat a colour in turn by creation order; icons stay unset.
- *Colour assignment.* When a project chat is first saved, the server gives it the colour least used among the project's currently listed epics (ties broken by the palette's order). It never changes by itself.
- *Wire.* The thread entry the web reads gains `color` and `icon`. The client's `Epic` gains `shipped`, counted from the project's feature list (shipped features whose origin chat is the epic); no new server count is needed if that list already carries shipped features, which it does for the Shipped shelf.
- *Orchestrator.* The `name_epic` MCP tool gains a required `icon`, validated against the curated id list (the list lives in core so the server can validate it and the skill can name it). It sets the icon unless the human has set one; the name keeps its existing rule. The orchestrator skill's naming guidance lists the ids.
- *Human pick.* A new thread mutation sets an epic's colour and/or icon; setting the icon marks it human-set. It emits an event like every mutation, so the list updates at once.
- *Save on first message.* The dotted slot opens the existing "unstarted chat" stand-in; the session row is created when the first message is sent, not on click. `thread.new` is no longer called from a click.

## Seams

- **`orderEpicList` / `epicIsIdle` / `idleEpicFacts` / `epicsFrom`** (existing, web lib): ordering bands, idle test, the slim row's words, the shipped count. Pure, unit-tested.
- **Epic look module** (new, web lib, with the id list from core): colour key → tokens, icon id → Lucide component, default icon. Observable through the components' static markup.
- **`name_epic` MCP tool** (existing): accepts and validates `icon`; refuses to overwrite a human-set icon. Tested at the tool handler like today's epic-name tests.
- **Thread look mutation** (new tRPC procedure on the thread router): sets colour/icon, marks human-set, emits an event. Tested at the router/service.
- **Colour assignment on save** (new, in the project-chat creation service): least-used colour. Tested at the service with several listed epics.
- **Migration** (new): existing chats get colours in turn; tested by migrating a fixture db.
- **Sidebar components** (existing: epic list, rail, header, phone list head): markup tests (tier 1) for the slot, the tinted idle row, the coloured card, the rail top, and "New epic" absent from the Create menu.

## Out of scope

- The Backlog, Shipped and Archived shelves.
- How long an epic stays listed (it still stays a day after it was written in).
- Any icon outside the epics, the New epic slot and the rail's top: no app-wide icon swap.
- Colour per project on the rail.
- An orchestrator pass that picks icons for existing epics.
- Changing the sidebar's width.

## Open questions

None.
