# Decisions — Lighten the light theme's colours

Planned without the human (self-planning run, 2026-10-24). Every decision below
is assumed; the main alternative is named on each.

Facts the decisions rest on (measured from `apps/web/src/theme.css`, WCAG
contrast against white `surface` #ffffff and the light `canvas` #f4f6f9 the
sidebar sits on):

- Each coloured hue is ONE token used for both dots/glyphs and words. For
  example `text-warning` paints the amber dot, the alert glyph and about twenty
  short warning sentences; `text-phase-*` paints the phase glyphs and also the
  chat notice eyebrows and action labels (`NoticeDeck`).
- Those hues already sit at, or under, the 4.5:1 text floor: success #1e8e53
  ≈4.2:1 on white, warning #a86a06 ≈4.4:1, accent #2f6fe4 ≈4.7:1, spec #0b7f78
  ≈4.9:1, ideation #c13d7e ≈5.0:1, implementation #b44f0c ≈5.2:1, danger
  #c42828 ≈5.8:1. On the canvas each is about 8% lower. So a word-sized colour
  cannot get lighter without dropping below 4.5:1; the dark look is the price
  of one token doing two jobs.
- The accent already has the split this feature needs: `accent` for the dot,
  ring and selection, `accent-text` for words.

The challenge pass was run by a separate agent given only the brief and this
file; its disagreements are marked **Challenged:** below.

## 1. What "the colours" means: the hues first, the grey text a step, grounds untouched
**Decision:** The change is to the light theme's coloured hues — success,
warning, danger, the accent, and the phase hues (ideation, spec,
implementation; the other phases follow by reference). The secondary and
tertiary text greys and the default icon grey lift one modest step. The grounds
(canvas, surfaces, inset), the borders, the primary text and the primary
(near-black) button stay as they are.
**Why:** Every example the human gave is a hue (the amber waiting dot, the red
"Run failed", the phase hues, accent text). The grounds are already pale, and
leaving the canvas alone keeps the sidebar grain settled in
make-the-sidebar-grain-visible (20%, dark specks at 30% alpha) without a
re-check. The greys lift a step because "all colours" plausibly includes them,
and they have room: tertiary text is ≈6:1 on white.
**Assumed.** Alternative: retune everything, grounds and borders included (a
whiter canvas, lighter borders), and re-check the grain by eye.
**Challenged:** None of the human's examples was grey, so lifting the greys
widens what they must judge without evidence; and "all colours look too dark"
may point at the near-black text and button instead — the challenger would
leave the greys alone and consider softening the black.

## 2. Two contrast floors: 4.5:1 for words, 3:1 for everything else
**Decision:** Words painted in a colour hold WCAG AA 4.5:1 against every ground
they sit on — white surface, the canvas, and the tinted chip or wash behind them
where there is one. Non-text marks — status dots, glyphs and icons, the focus
ring, a state border such as an invalid field, the phase glyph — hold the WCAG
non-text floor of 3:1 against every ground they appear on: the surface, the
canvas, and the hovered and selected row grounds (a phase glyph in a selected
sidebar row sits on `surface-selected` #e4e8f1, the darkest light ground).
**Why:** This is the accessibility line the app holds today, and WCAG itself
draws it in two places: small words need 4.5:1, a mark you only need to see
needs 3:1. The 3:1 floor is where all the lightening room is.
**Assumed.** Alternative: let short status words drop to 3:1 as well (WCAG's
large-text level), so "Run failed" and the accent links get visibly lighter too,
at the cost of failing AA for 12–13px text.

## 3. Each hue gets a word peer; the hue itself lightens to the 3:1 floor
**Decision:** Every coloured hue gets a `-text` peer for words, the way the
accent already has `accent-text`: `success-text`, `warning-text`,
`danger-text`, `phase-ideation-text`, `phase-spec-text`,
`phase-implementation-text`, and the referenced phases follow (planning →
spec's, tickets → warning's, building → implementation's, review →
accent-text, shipped → success's). Every word painted in a hue moves to its
peer. In light, the hue itself then brightens to sit just above 3:1 on the
canvas; the peer sits just above 4.5:1. Dots, glyphs, icons, rings and the
tinted washes made from the hue get visibly lighter; coloured words stay close
to where they are.
**Why:** With one token per hue, the token cannot lighten at all without
failing words (the facts above). Splitting is the only way to lighten what the
human pointed at while holding decision 2, and it reuses the pattern the accent
already follows rather than inventing one.
**Assumed.** Alternative: keep one token per hue and only shift each to a
cleaner, more saturated colour at the same lightness — no call sites move, but
the hues barely look lighter.
**Challenged:** Six-plus new tokens double the colour set and move every word
call site; the challenger would compare deriving the word colour from the hue
in CSS (mixed toward black) first. This plan keeps the split because the words
and the marks still need different values either way, so the call sites move
regardless; whether the peer is a literal or a mix of its hue is a build
detail the spec leaves open.

## 4. The dark theme does not change
**Decision:** In the dark theme each new `-text` peer equals its hue's current
dark value, so dark renders exactly as today. Only the light block's values
move.
**Why:** The brief rules the dark theme out of scope. The dark hues are already
light, so the peers have nothing to correct there.
**Assumed.** Alternative: give dark its own lighter word peers too, as the
accent has (`#7aaafa` text over `#4f8ef7` hue).

## 5. Status words that fail today get fixed, even if a shade deeper
**Decision:** Success and warning words are under 4.5:1 on the canvas today
(≈3.9:1 and ≈4.0:1). Their light `-text` peers are set to clear 4.5:1, which
makes those words a shade deeper, not lighter. The warning words also move
from brown toward a cleaner amber-orange at that lightness.
**Why:** Decision 2's floor applies to every word, and an amber that holds
4.5:1 reads brown unless its hue leans orange. The visible effect overall is
still lighter, because dots and glyphs are most of the colour on screen.
**Assumed.** Alternative: leave the word values exactly as they are today and
only lighten the hues.

## 6. The terminal follows the tokens; its own text colours stay
**Decision:** The embedded terminal's copy of the theme tokens
(`lib/terminal.ts`, which mirrors a few tokens into xterm) takes the new light
values. Its ANSI text palette (the sixteen colours programs print in) does not
change.
**Why:** The mirror must match the tokens or the terminal disagrees with the
page around it. The ANSI colours are all words on the inset ground, so
decision 2 leaves them no room to lighten.
**Assumed.** Alternative: retune the ANSI light palette as well, to the same
floors.

## 7. One lap, judged on a palette page
**Decision:** This is one lap, sure and small. It ships a palette preview page
beside the existing sidebar preview (`apps/web/preview/`), with a Dark/Light
toggle and old and new light values side by side. It shows every light colour
token as words and as marks on each ground they sit on, and a few real pieces
of the app in both versions: the sidebar, a chat notice card, an error banner
and a row of status dots. Words that got deeper under decision 5 are labelled
as such, so the human sees that choice rather than finding it. A check in the
test suite holds both contrast floors for the light block, so a later value
change cannot slip under them.
**Why:** A palette change is judged by looking, and a grid of swatches cannot
show how the colours feel together; the real pieces can. The floor check turns
decision 2 from a promise into something the build enforces.
**Assumed.** Alternative: no new preview page; judge by test-driving the real
app in light mode only.

## 8. Lighter and cleaner, not only lighter
**Decision:** The new light hues are chosen for high saturation as well as
lightness: each keeps its hue family (pink, teal, amber, orange, blue, green,
red) but moves away from the dull, brownish end. "Too dark" is read as both
"too deep" and "too muddy", and the retune answers both.
**Why:** The human's words were "brownish", "deep" and "heavy". Lightening a
dull colour leaves it dull; a cleaner hue at the 3:1 floor reads both lighter
and brighter. This is also the only lever the words have, since decision 2
holds their lightness.
**Assumed.** Alternative: treat it as lightness only and keep each hue's
current saturation.

## 9. A hue fill that carries words uses the word peer
**Decision:** Where a hue is a solid fill with words or numbers on it (the
walkthrough player's numbered markers are white on a solid accent fill), the
fill takes the hue's `-text` peer, so the words on it keep 4.5:1. A fill that
carries no words (a status dot) uses the lighter hue.
**Why:** The lighter accent would leave white numbers at about 3.3:1, under
decision 2's floor for words. The peer already clears 4.5:1 against white, so
it works in reverse too.
**Assumed.** Alternative: keep those fills on the lighter hue and switch the
words on them to dark text.
