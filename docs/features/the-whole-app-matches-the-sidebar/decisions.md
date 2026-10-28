# Decisions — The whole app matches the sidebar

Planned without the human (2026-10-28). Every decision below is assumed until
the human confirms it on the plan preview.

## 1. The sidebar's material becomes the app's general rules
**Decision:** What the sidebar refresh made sidebar-only becomes the design guide's general rules (apps/web/DESIGN.md and STYLE.md): the card (a faint fill with a hairline edge), see-through hover and selection, 14px row text and roomier rows. The guide's rules are amended, not only its examples; the sidebar keeps only what is truly its own (the Orchestrator's accent wash, the travelling light on the Working bay, the count well).
**Why:** The brief asks for one look everywhere. Leaving the guide's general rules as they are would keep telling every later screen feature to draw the old look.
**Assumed.** Alternative: keep the sidebar's material as a sidebar exception and change only the guide's examples.

## 2. Hover and selection are see-through shades, and selected is the card
**Decision:** Hover and pressed states everywhere are a see-through shade of the text colour over whatever sits behind (about 3.5% in dark, 4% in light), not a solid lighter block. A selected row, list row or tab wears the card: a fainter fill with a hairline edge, exactly as a selected sidebar row does.
**Why:** The human found the solid light blocks heavy when they redesigned the sidebar; the same blocks are what make the rest of the app look different from it now.
**Assumed.** Alternative: keep solid selection blocks outside the sidebar and only soften hover.
**Challenged:** Page-level tabs may need a stronger marker (an underline or weight) than the card, or the current tab is hard to spot; apply the card to rows and toggles only. Kept: in the building-blocks preview the selected tab reads clearly, since it is the one tab with an edge and full-strength text.

## 3. Rows and menus read at 14px; controls stay at 13px
**Decision:** The type scale gains one step, 14px on a 20px line, for every row: list rows, nav rows, menu items, select options and searchable-list rows, as the sidebar's row titles are. Buttons, inputs, labels and captions keep today's sizes.
**Why:** The sidebar's comfort comes mostly from its 14px titles. Raising every piece of text would also enlarge buttons, labels and dense tables, which reads as zoomed in rather than calmer.
**Assumed.** Alternative: raise the whole interface's default text from 13px to 14px.

## 4. Comfortable sizes: taller controls, rows and menus
**Decision:** Default buttons and inputs go from 28px to 32px tall and large ones from 32px to 36px; one-line nav rows from 32px to 36px; list rows from 40px to 44px; menu rows from 30px to 32px; dialogs get more padding. Every size is a theme token, so it can be tuned in one place.
**Why:** "A little more spaced out and comfortable" is the human's own description of the sidebar. These steps match its rhythm without making the content panel look oversized.
**Assumed.** Alternative: keep today's sizes and change only the material and the text (the preview's "compact" density shows this).
**Challenged:** Keep buttons and inputs at 28px (30 at most) and make only rows, menus and dialogs roomier: the sidebar's comfort is in its rows, and taller buttons reach every dense toolbar before its screen feature redoes it. Kept: buttons beside 14px rows look undersized at 28px, and dense places keep the 24px small size (decision 10). The preview's density switch shows both.

## 5. Every dropdown stops at about ten rows and scrolls
**Decision:** Every menu, value picker and searchable list stops growing at 360px (about ten rows) and scrolls inside itself with a thin scrollbar, however much screen is left below it. It still shrinks further when the screen is short. Because the cap is in the shared building blocks, the scenarios dropdown and every other dropdown get it at once.
**Why:** Today a menu may grow to the bottom of the screen, which is what the human saw with many threads or scenarios. A fixed cap keeps a long list short and the cut-off row shows there is more.
**Assumed.** Alternative: cap at a share of the screen's height (for example half), so tall screens show more rows.

## 6. The grain behind the sidebar head is removed
**Decision:** The film grain behind the sidebar head is removed, and with it its theme utility. The preview's Tweaks menu can put it back at 6% ("faint") or at today's 20% so the human can compare.
**Why:** The human called it a weird "white green effect". The Orchestrator card's grid already gives the head its character, and a calm app needs no texture. Removing it is simpler than tuning it a third time.
**Assumed.** Alternative: keep a much fainter grain, around 6%.
**Challenged:** Delete the grain's theme utility only after the human has picked, since a faint grain needs it. Kept: the preview carries its own copy of the grain for the comparison, so nothing in the app has to wait on the choice; if the human picks faint, the utility comes back at 6%.

## 7. This feature changes the shared pieces only; screens pick up what those give
**Decision:** The work is the theme tokens, the shared building blocks, the sidebar's own recipe moved onto the shared tokens, and the design guide. A screen changes only where it hand-copies the old look in a way that would now clash. Each screen's own layout is left to its feature: the chat, the feature's right panel, test drive, the Orchestrator's page, and the rest.
**Why:** The brief says the shared change happens here once, and five screen features follow on top of it. Restyling screens here would swallow their work.
**Assumed.** Alternative: also sweep every screen's hand-made styling here, so the follow-on features only rearrange layouts.

## 8. Menus keep their raised panel; what changes is inside it
**Decision:** A menu, picker or popover keeps today's panel: the raised background, 10px corners, a hairline edge and one soft shadow. What changes is inside: 32px rows at 14px with a little more side padding, the see-through hover, the height cap and the thin scrollbar.
**Why:** The panel already matches the sidebar's card radius and edge. What made the dropdowns look badly designed was their height and their cramped rows.
**Assumed.** Alternative: a new panel look (a larger radius, a flatter shadow, a tinted fill).

## 9. Colours, fonts, backgrounds and corner sizes stay
**Decision:** The accent and status colours, the fonts, the page and panel backgrounds and the two corner sizes (6px for controls and for rows inside a card, 10px for cards, rows on their own, menus and dialogs) stay as they are. Rows on their own move from 6px to 10px corners, as the sidebar's do.
**Why:** The sidebar was built on these same colours, fonts and corners, so matching it needs none of them changed. Saying so keeps the screen features that follow from drifting.
**Assumed.** Alternative: retune the backgrounds or the corner sizes as part of the new look.

## 10. Dense places keep the small size
**Decision:** The small control size stays at 24px and the inline picker look stays as it is, for dense toolbars, table cells and row actions. A screen that looks crowded at the new default sizes uses the small size there; its screen feature decides where.
**Why:** The new default sizes suit pages and dialogs, but a table of tickets or a toolbar would grow taller than it needs to before its own screen feature lands.
**Assumed.** Alternative: a separate compact density for whole screens.

## 11. Selected stays told by its edge, also under the pointer
**Decision:** A selected row or tab keeps its card look when hovered; hover never darkens it. Selected is told apart from hover by its hairline edge and its full-strength text, in both themes, as in the sidebar today.
**Why:** In the light theme the hover shade is about as strong as the card's fill, so the edge has to carry the difference. The sidebar already works this way and the human approved it.
**Assumed.** Alternative: make the selected fill clearly stronger than hover as well.

