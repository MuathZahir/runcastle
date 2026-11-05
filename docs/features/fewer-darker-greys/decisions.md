# Fewer, darker greys — decisions

Planned without the human on 2026-11-04 (a headless planning run). A decision
the planner made alone carries an **Assumed.** line until the human confirms it.
On 2026-11-05 the human picked the design page's Tweaks ("Darkest, a touch blue.
Two greys"), which settles decisions 1 and 2.

Check first: 4, 6

## 1. Two quiet text greys, clearly apart, plus disabled
**Decision:** Below the main text colour there are exactly two greys: *secondary* (descriptions, quieter rows, labels) and *muted* (metadata, status lines, the tool-call lines, and every icon). Today's third-step grey (`text-tertiary`) and the icon grey become the one muted grey. The two are pushed apart (secondary brighter, muted darker) so each reads as "less important" rather than "a slightly different grey". *Disabled* stays as the decorative fourth step. Both quiet greys keep at least 4.5:1 contrast on every ground, menus included.
**Why:** Today secondary (`#a2a8b9`) and tertiary (`#8a91a5`) are one small step apart, and the icon grey (`#8990a4`) is a third near-twin. The sidebar's quieter rows wear secondary and the tool-call lines wear tertiary, which is exactly the mismatch the human saw. Two greys keep the hierarchy where three levels stack (a title, its description, its status line); the wider gap makes the difference look deliberate.

## 2. Dark grounds: darker, and a touch bluer
**Decision:** In the dark theme, the sidebar ground, the content panel and the floating layers (menus, dialogs) each go about two steps darker and take a little more blue. The lines (panel edges, rules, input borders) move with them, keeping the same distance above the panel so edges are no louder than today. The spacing between grounds stays as it is today, measured in perceived lightness, so the sidebar still reads as the frame, the panel as the page and menus as floating. The main text colour and the primary button stay as they are. The human picked "darkest, a touch blue" on the design page: sidebar `#04060b`, content `#080c13`, menus and dialogs `#0e131e`, lines `#181f2d` and `#293243` (today `#0a0c11`, `#10131a`, `#161a24`, `#222837`, `#333a4d`).
**Why:** The human asked for darker and "a touch more bluish" to feel more premium, and chose the exact strength from four shown live.

## 3. Code and input wells take the sidebar's ground
**Decision:** The sunken ground used by code blocks, the terminal, inputs and attached images (`surface-inset`) stops being its own shade and takes the sidebar's ground colour. The dark theme then has three solid grounds (sidebar, content, floating) instead of four.
**Why:** Today the well (`#0c0e14`) sits between the sidebar (`#0a0c11`) and the content (`#10131a`), barely distinguishable from the sidebar: one more near-twin grey. The light theme already uses the sidebar's ground for its wells, so this makes the two themes match.
**Assumed.** Alternative: keep the well as its own shade, retuned darker with the rest.

## 4. The light theme gets the same two greys, but keeps its grounds
**Decision:** The light theme collapses its text greys the same way (secondary darker, muted covering tertiary and icons, disabled kept). Its grounds and lines do not change: no bluer shift.
**Why:** The human's complaint and the "darker, bluer" ask are about the dark theme. Light's grounds are already a cool off-white (`#f4f6f9`), and a separate feature only just retuned light's colours to pass contrast floors. Light's greys have the same near-twin problem (secondary `#596075`, tertiary `#676e82`), so the ladder fix applies there too.
**Assumed.** Alternative: also cool the light grounds a touch so both themes feel like one family.

## 5. The sweep reaches the greys outside the theme file
**Decision:** Besides the theme's tokens, the feature moves every other place that hard-codes a grey or the dark ground onto the new values: the embedded terminal's own greys (today neutral zinc, off the app's cool slate), the colour the browser and the phone's home-screen app paint before the page loads, the offline page, and the starter that every feature's plan page is drawn from. The favicon and the public website (`site/`) keep their colours.
**Why:** Components already take every grey from the theme's tokens (the only raw colours are the terminal's palette and a walkthrough stroke), so the sweep is small. The places listed are the ones a user sees as part of the app; the favicon is a brand mark and the website is its own product.
**Assumed.** Alternative: also move the public website onto the new greys in this feature.

## 6. The see-through fills drop from four strengths to two
**Decision:** The tints laid over a ground (a hovered row, a selected row or tab, a pressed button, the well behind a message or a subagent's work) come in two strengths instead of four: a faint one for hover and the selected card, a stronger one for pressed and the well. In dark that is 3% and 6% of the text colour (today hover 3.5%, card 2.5%, pressed 6%, well 6%); in light, 3.5% and 7%.
**Why:** The human may also have meant the tool-call blocks' background, not only their words. Hover and the selected card are near twins today (3.5% vs 2.5%), so a hovered row and a selected row read as two slightly different greys. The selected card keeps its hairline edge, so it still differs from a hover.
**Assumed.** Alternative: keep the four strengths as they are and let only the grounds under them change.
