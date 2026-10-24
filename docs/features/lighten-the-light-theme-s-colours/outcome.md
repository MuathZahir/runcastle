# Outcome — Lighten the light theme's colours

In light mode the app's colours look too dark; retune the light palette across the whole app.

- Shipped: 2026-10-24
- Laps run: 1

## What shipped

14 commits · 55 files

### Lap 1
- 3 tickets landed: #1 Coloured words wear their hue's word peer; #2 Word peer tokens, retuned light values and the contrast floor check; #3 Palette preview page: old and new light colours side by side
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: b43918139ebc1460d15483b6692e3a60ff06506f
- Landed since: 0
- Outcome: done

- **Dark mode changed: review-phase notice words now paint #7aaafa instead of today's #4f8ef7** — fixed
- **Palette preview page not reachable in the drive, so its criterion is unverified** — open
- **Light walk clean: no word on a mark hue, no mark lost its hue, on the screens reached** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Coloured words wear their hue's word peer

# Ticket 1 — Coloured words wear their hue's word peer

**What was done.** I moved every word-carrying hue call site in apps/web/src to its `-text` peer (about 40 sites in 29 files): status and warning sentences, error lines and alerts, the branch picker's "missing" trigger, NoteRow's evidence words and "being fixed by" (`text-phase-implementation-text`), and the sidebar's "attention" words. Marks stay on the hue: icons, StatusDot, TONE_TEXT (its callers only colour glyphs), the PhaseIcon map, the timeline milestone discs, the Notice glyphs, and every ring, border and wash. Elements that colour both a glyph and words are split:
- FLOATING_ITEM_DANGER and the `danger`/`danger-ghost` Button variants now use `text-danger-text [&_svg]:text-danger`. The buttons also gained `disabled:[&_svg]:text-text-disabled`, so a disabled button's icon still greys out.
- NoticeDeck's HUE table has a new `word` field. It colours the eyebrow, the ×count and the action label; the chip glyph and the action's arrow keep `text`.
- The FeaturePanes error heading takes the peer, and its IconAlert now carries `text-danger` itself.

The walkthrough's numbered marker now fills with `bg-accent-text`. I added a rule bullet and the peer utilities to DESIGN.md §Colour and reworded the phases bullet ("Never on words" is gone). STYLE.md's token table lists the peers.

**Tests.** I updated the assertions that pin the moved classes (draft-creation, branch-menu, note-row, sidebar-row, run-timeline, ui, floating-primitives). I added `apps/web/test/word-peers.test.tsx`, a happy-dom test covering the notice card, a danger menu item and a field error. Full `bun run typecheck` and `bun run test` both pass (375 files passed, 2 skipped).

**Surprises.**
- Most existing `toContain('text-danger')` assertions still pass, because `text-danger-text` contains `text-danger` as a substring. I tightened only the ones that assert words.
- In run-lanes' "paints a real failure red" test, the red comes from the IconAlert mark, so that assertion stays on the hue.
- In string-render tests, `[&_svg]` is rendered as `&amp;`, so the string-render tests can't match it.

**Left undone.**
- Until ticket 2 adds the tokens to theme.css, the peer utilities generate no CSS, so words fall back to the inherited colour.
- theme.css, lib/terminal.ts and preview/ are untouched.
- I made no drive-machinery change, since this ticket adds no services, env vars or seeds.
- review-drive-denied's `text-warning` assertion targets the Notice glyph, so it stays as it is.

#### 2. Word peer tokens, retuned light values and the contrast floor check

# Ticket 2: word peer tokens, retuned light values, contrast floor check

## What was done
- `apps/web/src/theme.css`: added `-text` word peers to `@theme static` for success, warning, danger and the three literal phase hues, plus reference peers for planning, tickets, building, review (→ `accent-text`) and shipped. Each dark literal peer equals its dark hue, so dark looks the same as before. The light block now sets marks and peers separately, and its header comment explains the split.
- Final light values (today → new):
  - success #1e8e53 → #23955a, with success-text #137745
  - warning #a86a06 → #c06e00, with warning-text #9c5600
  - danger #c42828 → #df5050, with danger-text #c42828
  - accent #2f6fe4 → #3a7ef0, and accent-text #2463d6 → #2361d4
  - ideation #c13d7e → #d4529a, with -text #ba3176
  - spec #0b7f78 → #10928a, with -text #087570
  - implementation #b44f0c → #d4621a, with -text #ac4b0a
  - text-secondary #4c5366 → #596075; text-tertiary #5c6377 → #676e82; icon #6a7185 → #7a8195
- Deviation: most word peers are deeper than the spec's starting points, and accent-text changed slightly. The starting peers cleared 4.5:1 on the surface and the canvas but failed the ticket's 15% hue-wash check (4.6 required), coming in at about 4.1–4.4; #2463d6 came in at 4.598. Every mark was kept at its starting value; each clears 3:1 on surface-selected (≈3.08–3.17).
- New `apps/web/test/theme-contrast.test.ts` checks both floors, the subtle grounds, white on accent-text, the washes, that each mark is lighter than its old value, and that each dark peer equals its hue. Failure messages print the measured ratio. The theme.css parser lives in the shared helper `apps/web/test/theme-tokens.ts`.
- `lib/terminal.ts`: ANSI red, green and yellow now read the danger, success and warning `-text` peers. Blue is chosen per theme through `BLUE_TOKEN`: `accent-text` in light, and `accent` in dark as before. The cursor stays on `accent`. TOKEN_FALLBACK now holds the `-text` names and the new light values, and the hue entries nothing reads any more were dropped. `apps/web/test/terminal-theme.test.ts` checks that the fallbacks give the same theme as theme.css for both themes, with nothing new exported.

## Surprises
- `packages/server/test/preview-skill.test.ts` requires the skill pack's `preview-starter.html` to match theme.css value for value, even though the spec called it out of scope. I updated the hue and grey values in both of its light blocks (the explicit one and the OS-fallback one). It has no `-text` peers, so in the starter, success and warning words on light now sit under 4.5:1.

## Left undone
- The call sites still use the hues for words; that is ticket 1. Until it lands, coloured words in light are lighter than the word floor.
- The starter's peers and its word call sites.
- Drive machinery: no new services, env vars or seeds, so `.runcastle/` was not touched.
- Verify: typecheck is clean, and the full suite has 376 test files passing, 0 failed.

#### 3. Palette preview page: old and new light colours side by side

# Ticket 3 — palette preview page

**What was done.** Added `apps/web/preview/palette.html`, `palette.tsx` and `palette-data.ts`. The page is set up like `sidebar.tsx`: fonts, theme.css, styles.css, `applyStoredTheme`, the silent event source, Tooltip/Toast providers, links that go nowhere, and the same Dark/Light toggle. It has a Show control (Side by side / Today / New) so it also works on a narrow screen. The Today column puts today's light values on as inline custom properties, and only in light. In dark it sets nothing, so both columns must look the same. The New column is just the live theme. Each column has:
- a token grid: 11 tokens (success, warning, danger, accent, three phases, text-secondary, text-tertiary, icon, focus-ring). Each one is drawn as marks (dot, 16px glyph, ring) and as a word sample on surface, canvas, the hovered row and the selected row. The page measures each contrast ratio itself (WCAG luminance) and marks it pass or fail against 4.5 for words and 3.0 for marks.
- a "Words deeper, not lighter" label on success, warning and phase-spec.
- real pieces: 7 `SidebarFeatureRow`s from `sidebar-data`, including the selected row and the failed one; two `NoticeDeck`s (planning and danger), one notice each, so both hues can be read; a `FailureNote`; `StatusDot`/`StatusLabel` in all six tones plus icon labels; and walkthrough markers. The markers copy WalkthroughPlayer's classes, filled `bg-accent` in Today and `bg-accent-text` in New (decision 9).

Word colours go through `var(--color-x-text, var(--color-x))`, so the page works whether or not ticket 2's peers exist.

**Surprises.** A custom property that holds a `var()` is resolved where it is declared (`:root`). So the Today wrapper has to restate every token that references another one: phase-planning, tickets, building, review, shipped, focus-ring and all the `-text` peers. Overriding only the literals would leave the phase hues on the new values. In Today, `phase-review-text` is set to the accent hue (#2f6fe4), because review words wear the hue today. To read colours, the page draws them on a 1px canvas, so a peer written as `color-mix()` or `color(srgb …)` is still measured. In a normal browser this works; happy-dom has no canvas, so there it does nothing.

**Checks.** A temporary tsconfig that included `preview/` showed no errors in my files. It did show two errors that were already there in files that aren't mine: `sidebar-data.ts` is missing `upNext`, and `.runcastle/preview/fake-api.ts` can't find `@tanstack/react-query`. The tsconfig was removed and not committed. Vite served `/preview/palette.html` and compiled the modules, and the `bg-accent-text`, `bg-current` and `border-current` utilities were generated. There is no browser in this sandbox, so I did not check the browser console. Instead, a throwaway happy-dom render (since deleted) mounted the page in light with no console errors and found Today's override and every section. `bunx vitest run apps/web/test` passed (167 files) and `bun run typecheck` was clean. Nothing in the drive setup needed changing.

**Left undone.** No permanent test for the contrast helper. The pre-existing `upNext` type error in `preview/sidebar-data.ts` is not fixed.
