# Decisions — Make the sidebar grain visible

## Revisited 2026-10-24

The grain behind the sidebar head (agreed in the sidebar refresh: "Behind the
head, the line grid gives way to a fine static film grain fading out
downward") shipped but nobody could see it. Two causes: the layer sat at 7%
opacity over a tile whose specks are already half-alpha, so its real strength
was about 2-3%; and the specks were white, which can never show on the light
canvas.

- **The grain layer goes from 7% to 20% opacity.** At that strength it reads
  as a fine texture you notice when you look, with text over it unchanged. A
  first pass at 28% was judged too strong by the human; subtle is the bar.
  Supersedes the 7% in apps/web/DESIGN.md.
- **Light theme: the same utility swaps in a dark-speck tile.** The `film-grain`
  utility in theme.css carries a `:root[data-theme="light"]` override with
  black specks, so the component keeps one class and one opacity. The light
  tile's specks are at 30% alpha (dark ones at 50%): dark specks on a light
  canvas read stronger, and at equal alpha the light head looked dirty.
- **Unchanged:** static, fading out downward, behind the head only, no pointer
  events. The preview page (apps/web/preview/sidebar.tsx) picks the change up
  with no edit, and gains a Dark/Light toggle in its top bar (and a working theme button in the
  sidebar foot), so both themes can be judged there.
- **The exact numbers are a starting point**, to be tuned by eye on the test
  drive.
