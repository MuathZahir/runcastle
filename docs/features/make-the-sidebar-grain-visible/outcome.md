# Outcome — Make the sidebar grain visible

Make the sidebar's film grain actually visible, in both themes. The sidebar refresh (docs/features/sidebar-refresh-less-clutter-more-character/decisions.md, the line 'Behind the head, the line grid gives way to a fine static film grain fading out downward') agreed a subtle grain behind the sidebar head, and it ships today, but nobody can see it. It is the `SidebarGrain` component in apps/web/src/components/SidebarParts.tsx (a div with `film-grain opacity-[0.07]` and a mask fading to transparent downward, rendered at the top of the sidebar's `<nav>` in Sidebar.tsx) over the `film-grain` utility in apps/web/src/theme.css (an SVG fractal-noise tile whose colour matrix paints WHITE specks at half alpha). Two causes, both confirmed by rendering the tile on its own: (1) too faint — 7% layer opacity times the tile's ~half alpha leaves roughly 2-3% real strength, which reads as a flat colour on the dark canvas (#0a0c11); at about 20% it is barely there, at 40% it is plainly grain. (2) white specks can never show in the light theme (canvas #f4f6f9) at any strength. Fix: raise the dark-theme strength to roughly 25-30% so it reads as a subtle but visible grain; in the light theme (`:root[data-theme="light"]` in theme.css) make the specks dark instead of white, at a similar visible strength — e.g. a second tile or a theme-scoped override of the utility; pick whichever is simplest and matches how theme.css already scopes light values. Keep it static, keep the downward fade, keep it behind the head only, keep pointer-events off. It must stay subtle: texture you notice when you look, never a dirty-screen look, and text over it must read exactly as before. Update the preview page apps/web/preview/sidebar.tsx only if it needs nothing more than picking up the change. Take a screenshot of the sidebar head in both themes for the human to judge; the exact number is expected to be tuned by eye on the test drive.

- Shipped: 2026-10-24
- Laps run: 1

## What shipped

2 commits · 6 files

### Lap 1
- 0 tickets landed
- 1 waived: #1 Make the sidebar's film grain actually visible, in both themes. The…
- 0 failed

## Review record

- No completed review pass

## Notes record

- No human notes
