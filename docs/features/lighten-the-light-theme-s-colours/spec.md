# Lighten the light theme's colours

## Problem

In light mode the app's colours look too dark. The amber "waiting" dot reads
brown, the red "Run failed" and the phase hues read deep, and the accent is
heavy against the pale canvas. The human noticed it in the sidebar, but every
screen shares the same palette, so it is everywhere.

The cause is structural. Each coloured hue (success, warning, danger, the
accent, the phase hues) is one token that paints both marks — dots, glyphs,
icons, rings — and short words. Words need 4.5:1 contrast, so the light values
were set deep enough for words, and the marks inherit that depth. Several are
already at or under the word floor (success ≈4.2:1 and warning ≈4.4:1 on white,
lower on the canvas), so the tokens cannot simply be lightened.

## Approach

**What the human sees.** In light mode, every coloured mark gets lighter and
cleaner: status dots, phase glyphs, alert and check icons, the focus ring,
invalid-field borders, and the tinted washes and chips made from a hue. Coloured
words stay readable at the contrast the app holds today, so they move little.
Success and warning words get a shade deeper, because they fail the floor today,
and warning words lean orange instead of brown. The secondary and tertiary text
greys and the default icon grey lift one step. The canvas, surfaces, borders,
primary text and the near-black primary button are unchanged. The dark theme is
pixel-for-pixel unchanged.

**Two contrast floors** (decision 2). Words painted in a colour hold 4.5:1
against the white surface, the canvas and any tint or chip they sit on. Non-text
marks hold 3:1 against the surface, the canvas, the hovered row ground and the
selected row ground. The selected ground (`surface-selected`, the darkest light
ground) is what limits how light a mark can go.

**The token split** (decisions 3, 4, 9). Every coloured hue gains a word peer,
following the pattern the accent already uses (`accent` for marks,
`accent-text` for words):

- `success-text`, `warning-text`, `danger-text` beside the status hues;
- `phase-ideation-text`, `phase-spec-text`, `phase-implementation-text` beside
  the three literal phase hues;
- the referenced phases get peers by reference too: `phase-planning-text` →
  spec's, `phase-tickets-text` → warning's, `phase-building-text` →
  implementation's, `phase-review-text` → `accent-text`, `phase-shipped-text` →
  success's. `phase-draft` stays as it is (it is `text-disabled`, decorative).

In the dark theme each peer equals its hue's current dark value, so dark does
not change. In light, the peer carries the word value and the hue itself is
retuned for marks. Whether a peer is written as a literal or as a mix of its
hue is the builder's choice; what is fixed is that it clears its floor.

Every call site that paints **words** in a hue moves to the peer — status
sentences, error lines, alert text, the chat notice eyebrow and action labels,
warning chips, "being fixed by" notes and the like. Call sites that paint
**marks** stay on the hue. A **solid hue fill that carries words or numbers**
(the walkthrough player's numbered markers, white on accent) takes the peer as
its fill, so the words on it keep 4.5:1; a fill with no words (a status dot)
stays on the hue. Where one class colours both an icon and its label (a status
line component, a menu item tone), the label takes the peer and the icon keeps
the hue, using whatever split the component already allows (an `[&_svg]`
override, or separate classes on the icon and the text).

**Retuned light values** (decisions 1, 5, 8). Starting points, from the
planning conversation; the floor check below has the final say, and the
builder may move a value to clear a floor or to look right by eye, keeping its
hue family:

| Token | Today | Mark (hue) | Word peer |
|---|---|---|---|
| success | #1e8e53 | ≈#23955a | ≈#17804a |
| warning | #a86a06 | ≈#c06e00 | ≈#a35a00 |
| danger | #c42828 | ≈#df5050 | #c42828 |
| accent | #2f6fe4 / text #2463d6 | ≈#3a7ef0 | #2463d6 |
| phase-ideation | #c13d7e | ≈#d4529a | #c13d7e |
| phase-spec | #0b7f78 | ≈#10928a | ≈#0a7a73 |
| phase-implementation | #b44f0c | ≈#d4621a | #b44f0c |
| text-secondary | #4c5366 | ≈#596075 | — |
| text-tertiary | #5c6377 | ≈#676e82 (must still clear 4.5:1 on canvas) | — |
| icon | #6a7185 | ≈#7a8195 (3:1 on every ground) | — |

Marks aim just above 3:1 on `surface-selected`; peers aim just above 4.5:1 on
the canvas. Each hue is chosen for high saturation in its family, so it reads
cleaner and not only lighter. `danger-subtle` and `accent-subtle` stay; the
peer must clear 4.5:1 on them where words sit on them (error banners).

**The terminal** (decision 6). The embedded terminal keeps its own copy of a
few theme tokens for xterm, with fallback values restated for when no
stylesheet is loaded. Its light fallbacks take the new values. Its ANSI red,
green, yellow and blue — program output, so words — read the word peers
(`danger-text`, `success-text`, `warning-text`, `accent-text`) instead of the
hues; the cursor stays on the accent hue. Dark renders exactly as today (dark
blue keeps today's dark accent value). The rest of the ANSI palette is
unchanged.

**The contrast check** (decision 7). A test reads the light block of the theme
file — the same way the existing reduced-motion and native-reset tests read
it — resolves `var()` references, and asserts both floors: every word peer and
the text greys at 4.5:1 against the surface and canvas, and every mark hue,
the icon grey and the focus ring at 3:1 against the surface, canvas, hover and
selected grounds. It also asserts the dark theme has every peer defined and
that each dark peer equals its hue, so dark cannot drift. A static test
cannot tell whether a `text-warning` class paints a word or an icon, so a
word slipping back onto a hue is caught by review and the palette page, not
by this check.

**The palette page** (decision 7). A new preview page beside the sidebar
preview, served the same way (a Vite entry under the web app's `preview/`
folder), with a Dark/Light toggle and an Old/New toggle (or side-by-side
columns) for the light values. It shows every light colour token as words and
as marks on each ground it sits on, with its measured contrast, and real
components rendered with both palettes: the sidebar, a chat notice card, an
error banner, a status-dot row and a walkthrough marker. Words that got deeper
under decision 5 are labelled. The old values are the today column of the
table above, held in the page itself.

**Docs.** The colour section of the web app's design document gains the rule:
marks wear the hue, words wear its `-text` peer, solid fills that carry words
wear the peer; and lists the new utilities. The styling guide's token list
follows.

## Seams

- **The theme file's light and dark blocks** (existing). The contrast check
  reads it and observes every floor and the dark-peer equality. This is the
  one seam the whole retune is tested at.
- **The Tailwind utilities generated from the new tokens** (new tokens on the
  existing `@theme static` seam). `text-warning-text` and friends exist and
  resolve to `var(--color-warning-text)`; observable by rendering a component
  in the existing happy-dom component tier and reading its class list.
- **Components that colour words** (existing). A component test on the status
  line, the chat notice card and an error alert can observe that the word
  carries a `-text` utility and the icon the hue utility.
- **The terminal theme mirror** (existing module). A unit test observes that
  its light copy equals the theme file's light values for the mirrored tokens.
- **The palette preview page** (new). Observed by eye in a test drive: open it,
  toggle Light, compare Old and New.

## Out of scope

- The dark theme's values (only new peer tokens are added to it, equal to
  today's hues).
- The grounds (canvas, surfaces, inset), borders, primary text and the primary
  button. Because the canvas does not change, the sidebar grain settled in
  make-the-sidebar-grain-visible (20%, dark specks at 30% alpha) needs no
  re-check.
- The terminal's ANSI colour palette.
- The plan-preview starter's own copy of the tokens (it lives in the runcastle
  skill pack, not in this app's source).

## Open questions

- None blocking. The four decisions flagged to check first (the word floor,
  the token split, which colours are meant, and success/warning words going a
  shade deeper) may be overturned when the human reviews; the palette page is
  where that judgement happens, and each would be a value or token change, not
  a redesign.
