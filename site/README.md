# site

The runcastle landing page. Static files plus assets, no build step for the page
itself and no runtime dependencies.

```
index.html          markup and copy
styles.css          page styles, on tokens copied from apps/web/src/styles.css
main.js             reveals, sticky stage, mock fitting, clipboard
build-app-css.mjs   generates assets/app-ui.css from the product stylesheet
assets/
  app-ui.css        GENERATED. the app's CSS, scoped under .rc-app
  banner.png        the README hero, rendered from the same tokens
  favicon.svg       copy of apps/web/public/favicon.svg
  fonts/            Inter + JetBrains Mono variable subsets (latin), self-hosted
  logos/            Simple Icons brand marks for the "runs on" strip
  screens/          PNG captures of the mocks below, for the root README only
```

## The product mockups are real UI

Every piece of runcastle shown on this page is the **product's own components as
live markup**, not a screenshot. `assets/app-ui.css` is `apps/web/src/styles.css`
with every rule scoped under `.rc-app`, so a mockup is that wrapper plus the app's
real class names (`.titlebar`, `.pipeline`, `.ledger-row`, `.gate-card`, ...).

This is why: screenshots were soft when scaled, truncated titles at narrow widths,
and went stale the moment the UI moved. Live DOM stays sharp at any size, and the
content is ours to choose.

### How a mockup is sized

A mockup lays out at a **fixed logical size** and is then scaled to fit its
column:

```html
<div class="rc-frame" data-mock="shell">
  <div class="rc-app" inert aria-hidden="true">…</div>
</div>
```

- `--rc-w` / `--rc-h` are the logical size, set per `data-mock` in `styles.css`.
  Giving the app the room it was designed for is what stops titles truncating.
- `--rc-s` is the scale. `main.js` computes it per frame with a ResizeObserver;
  the CSS value is the no-JS fallback. It never exceeds 1.
- `.is-autoheight` makes the frame's height follow its content instead of `--rc-h`.
  The shell mock does **not** use it, because `.shell` is a `height: 100%` grid and
  needs a real height to pin its status bar.

### Rules that are easy to get wrong

- **Container queries, not media queries.** A mock's width has nothing to do with
  the viewport. `.rc-app` is a named container (`rcapp`) and the rules that drop
  the sidebar and inspector key off *its* width. Keyed to the viewport, a 1600px
  mock on a phone collapses its rails while still being 1600px wide, and the
  workspace lands in the 252px sidebar track.
- **Container queries do not add specificity.** Rules inside `@container` still
  need the `.rc-app` prefix to beat `.rc-app .shell-body` from the product sheet.
- **`minmax(0, 1fr)`, not `1fr`.** A bare `1fr` keeps an auto minimum, so a track
  refuses to shrink below its content and pushes the mock (and the page) wider.
- **Mocks are `inert` + `aria-hidden`.** They are illustrations, so they stay out
  of the tab order, and each is paired with an `.sr-only` description.
- **Five class names collide** between the page and the product: `shell`, `btn`,
  `btn-ghost`, `mono`, `wordmark`. The page's versions are prefixed (`.wrap`,
  `.lp-btn`, `.lp-mono`, `.lp-wordmark`) so the product's always win inside a mock.
  Keep it that way, and never rename a `.rc-app` selector by find-and-replace.

### After changing app styles

```sh
node site/build-app-css.mjs
```

The generated file carries a do-not-edit banner. Change `apps/web/src/styles.css`
and regenerate; never patch `app-ui.css` by hand.

## Preview locally

Nothing to compile, so any static server works:

```sh
cd site && python -m http.server 4599   # then open http://localhost:4599
```

## Deploy

Publish this directory as the site root. It needs no runtime, so GitHub Pages,
Cloudflare Pages, Vercel, or Netlify all work with the build command left empty
and the output directory set to `site`.

The absolute URLs in `<head>` (`canonical`, `og:url`, `og:image`) point at
`https://runcastle.dev/`. Change them if the page is served elsewhere, or the
preview cards will point at the wrong host.

## `assets/screens/` and the root README

Markdown cannot run CSS, so the root README needs real images. Those PNGs are
**captures of the mockups on this page**, not of the app, which is why they are
well framed and carry no project names or account details.

To refresh one: serve the page, then screenshot the frame's bounding box at 2x.
Note that the showcase panels are stacked in a single grid cell and cross-faded,
so scroll the section into view and let it settle **before** activating the panel
you want. The scroll observer will otherwise override the choice.

## House rules

- **Tokens come from the app.** Change `apps/web/src/styles.css` first.
- **One accent.** Violet `#7c6cf6`. The phase palette (`--ph-*`) is semantic
  lifecycle state and stays confined to phase markers.
- **Dark only.** The product is a dark IDE surface, so the page is theme-locked.
  No section inverts.
- **No scroll listeners.** Motion is IntersectionObserver and ResizeObserver only,
  and everything collapses under `prefers-reduced-motion`.
- **No invented product behaviour.** A mockup may only show a state the app can
  actually reach.
