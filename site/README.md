# site

The runcastle landing page, plus the docs and comparison pages. Static files and
assets, no runtime dependencies.

```
index.html          the landing page                      GENERATED, see below
landing.css         its styles, fonts included            GENERATED
landing.js          its motion: one clock, eight scenes   GENERATED
styles.css          tokens and chrome for docs/ and compare/
content.css         the reading surface for docs/ and compare/, on top of styles.css
install.sh          the one-line install for macOS and Linux; hands over to `runcastle setup`
install.ps1         the same for Windows
_headers            serves both install scripts as plain text
docs/, compare/     article pages; they load styles.css + content.css and no JS
  docs/vps/         the VPS guide: install, service, and the SSH tunnel in
assets/
  og.png            the social card: a capture of the top of the landing page
  favicon.svg       copy of apps/web/public/favicon.svg
  fonts/            Geist + Geist Mono variable subsets (latin), self-hosted
  logos/            Simple Icons brand marks (used by the compare pages)
  screens/          PNG captures for the root README only
  video/            the launch film; no page links to it since the isometric landing
```

## The landing page is generated from its design canvas

The page is designed on a Claude Design canvas ("Runcastle Landing Refresh"),
whose one artboard, `project/Main.dc.html`, is the source of truth.
`scripts/port-landing.mjs` turns that artboard into the three generated files:

```sh
node scripts/port-landing.mjs path/to/Main.dc.html
```

- **`index.html`** is the artboard's markup, pre-rendered in its switched-off
  first frame, so it reads without JS. Every value the scenes change is a
  `data-b-<attr>` template (class lists, a few positions) or a `data-t` text
  slot; clicks are `data-on-click`. Only the `<head>` is hand-written: the port
  keeps whatever sits between the two "page head" comments, so edit titles and
  social tags there.
- **`landing.css`** is the artboard's stylesheet with the self-hosted fonts.
- **`landing.js`** is the artboard's own component code plus a 30-line binder:
  each tick it re-evaluates the component and patches the bound attributes.

Do not hand-edit the generated files: change the canvas and run the port again.
The port is deterministic (running it twice gives identical files), so a diff
after a port is exactly the design change.

### How the page moves

- **The hero and seven bands are isometric CSS scenes.** Cubes are three faces
  (`f-t`, `f-s`, `f-e`) on a fixed orthographic camera; height is the animatable
  `--h` property. Each scene is one method that maps its time `t` to class
  strings; CSS transitions do the motion.
- **One 100 ms clock, one clock per band.** A band is switched off (no grid, no
  spotlight, screens dark, nothing moving) until it is 40% in view. Then its light
  comes up over about 2.5 s and, 1.6 s later, its own loop starts at `t = 0`. An
  `IntersectionObserver` drives this; there are no scroll listeners.
- **Reduced motion** (`prefers-reduced-motion`) shows each scene's still frame
  with the light on.
- **The closing castle** is the logo in 3D. It builds once when the install
  section comes into view.

## Preview locally

Nothing to compile for a preview: any static server shows the page.

```sh
cd site && npx --yes serve -l 4599   # then open http://localhost:4599
```

The docs and comparison pages link their assets from the root (`/styles.css`), so
serve the `site` directory itself rather than opening the files from disk.

## Deploy

Published as a **Cloudflare Pages** project (`runcastle-site`, direct upload) on
the apex, `https://runcastle.dev`. It needs no runtime, so the build command is
empty and the output directory is `site`.

```sh
npx wrangler@4 pages deploy site --project-name=runcastle-site --branch=main
```

The absolute URLs in `<head>` (`canonical`, `og:url`, `og:image`) point at
`https://runcastle.dev/`. Change them if the page is served elsewhere, or the
preview cards will point at the wrong host.

**Release before a site deploy.** `install.sh` and `install.ps1` call
`runcastle setup` on whatever npm serves as `latest`, so a release must reach
npm before a site deploy that changes what they call. See `docs/RELEASE.md`.

### The film and `Range` requests

`assets/video/` still holds the launch film, though no page links to it now. If it
comes back, test it on `runcastle.dev`, not `*.pages.dev`: Pages answers every
`Range` request with `200` and the whole file, so the film cannot seek there.
Only the proxied apex returns `206`.

## `assets/og.png`

The social card is the top 1200x630 of the landing page, captured at 2x. To
refresh it, serve the page and run headless Chrome over it:

```sh
chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=site/assets/og.png http://localhost:4599/
```

The hero is animated, so take the frame from a real-time browser rather than a
virtual-time screenshot: load the page at 1200x630 with a device scale factor of
2, wait about 7 s (three features mid-build), then capture. Keep
`og:image:width` / `og:image:height` in step with the file.

## `assets/screens/` and the root README

Markdown cannot run CSS, so the root README needs real images. The PNGs here are
captures of **the app itself**, not of the page's mockups: the `runcastle-demo`
project (the `shiplog` journal app) booted from a checkout against a throwaway
`RUNCASTLE_DATA_DIR`, in the dark theme, at 1440x900 CSS px and 2x. Some states
were staged in that scratch database (the live burn, the finished review), but
every screen is the real UI, and the project-session conversation is a real
session. Nothing on the landing page uses them.

`assets/readme-banner.png`, the README's header, is the exception: it is the hero of
this page (brand, headline, the six phase blocks) rendered over `build.png` as
the castle wall, at 1280px and 2x.

To refresh them, repeat that: boot a dev server on a scratch data dir holding a
demo project, then capture with headless Chrome. Recapture whenever the app's
look moves; stale screenshots are what this folder exists to avoid.

## House rules

- **Tokens come from the design system.** `landing.css`, `styles.css` and
  `apps/web/src/theme.css` hold the same values; keep them in step.
- **One accent.** Blue, spent on focus, selection, links and "live". Green and red
  are ticket states only (landed, failed). The primary button is never
  accent-filled.
- **Dark only.** The page is theme-locked and no section inverts. The sample app
  shown in the scenes (Ledgerline) is somebody else's product, but it is dark too.
- **One headline and one short line per band**, plus its scene. No eyebrows, no
  paragraphs.
- **Text is drawn on the blocks.** In the scenes, every label is printed flat on a
  face and read from the same side; nothing floats or turns toward the viewer.
- **Mono is for strings you could paste into a terminal**: commands and commits.
- **No scroll listeners.** Lighting is an `IntersectionObserver`, motion is CSS,
  and nothing moves under `prefers-reduced-motion`.
- **The landing page and the article pages share no CSS.** `index.html` loads only
  `landing.css`; `docs/` and `compare/` load `styles.css` + `content.css`.
