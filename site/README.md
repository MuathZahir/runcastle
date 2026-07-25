# site

The runcastle landing page. Static files plus assets, no build step for the page
itself and no runtime dependencies.

```
index.html          markup and copy
styles.css          page styles, on tokens copied from apps/web/src/styles.css
main.js             reveals, sticky stage, mock fitting, hero film, clipboard
build-app-css.mjs   generates assets/app-ui.css from the product stylesheet
assets/
  app-ui.css        GENERATED. the app's CSS, scoped under .rc-app
  banner.png        the README hero, rendered from the same tokens
  favicon.svg       copy of apps/web/public/favicon.svg
  fonts/            Inter + JetBrains Mono variable subsets (latin), self-hosted
  logos/            Simple Icons brand marks for the "runs on" strip
  screens/          PNG captures of the mocks below, for the root README only
  video/            the launch film, its poster frame, its caption track
```

## The hero is the launch film

The hero frame is the 90-second launch film, cut from the same tokens as the page,
in place of the still workspace shot that used to sit there.

```
assets/video/
  runcastle-demo-1440.mp4      2560x1440, 60fps, H.264 + AAC, 11.5 MB
  runcastle-demo-poster.webp   the 0:52 "six sandboxes" frame, 2560px, 59 KB
  runcastle-demo.en.vtt        voiceover captions
```

**Why 1440p.** The frame is `--wrap` minus both gutters, so it renders at 1164 CSS
px — 2328 device px on a 2x display, which 2560 covers and 1920 does not. It costs
almost nothing to go up: the film is flat dark UI on a still background, so it
compresses far better than camera footage. Measured against the 4K master, 1440p
CRF 23 scores SSIM 0.9989 at 11.5 MB, where CRF 20 bought 0.9990 for 13.2 MB. 4K
would be paying for pixels no display in the frame can show.

`aq-mode=3` is not decoration. Almost every frame is near-black with a violet
wash across it, which is the exact case H.264 bands in, and mode 3 is the one that
spends its bits on dark flats.

**Two modes, one file.** The markup is a plain `<video>` with `controls`, a poster
and `preload="none"` — the narrated cut on request, which is what someone with no
JS gets and what a phone, a metered connection or `prefers-reduced-motion` also
gets. On a desktop `main.js` upgrades it: muted, controls dropped, playing only
while the frame is on screen, with a corner button that trades the loop for the
voiceover. Both paths end at the same frame, so one `ended` handler closes the
ambient loop and drops a finished narrated cut back into it.

The ambient loop starts at **9.4s**, not at zero. The film opens on five seconds
of brand hold and then a card repeating the page's own `h1`, which is the right
way to open a film and the wrong way to open a hero. The button plays it whole.

**The captions are timed off the audio, not the storyboard.** `VO-SCRIPT.md` ships
scene boundaries and says outright that they are a guide; the cues in the `.vtt`
come from `silencedetect` run over the mixed track, so they follow the read.

```sh
ffmpeg -i "$FILM/runcastle-launch-4k60.mp4" -af silencedetect=noise=-45dB:d=0.45 -f null -
```

**To re-cut it** from a new master (the 4K one, always — the 1080p export is
already compressed and re-encoding it twice shows):

```sh
ffmpeg -i "$FILM/runcastle-launch-4k60.mp4" \
  -vf "scale=2560:1440:flags=lanczos" \
  -c:v libx264 -profile:v high -level 5.1 -preset slow -crf 23 \
  -x264-params "aq-mode=3:aq-strength=0.9" \
  -pix_fmt yuv420p -g 120 -c:a aac -b:a 128k -ac 1 \
  -movflags +faststart \
  site/assets/video/runcastle-demo-1440.mp4

ffmpeg -ss 52 -i "$FILM/runcastle-launch-4k60.mp4" -frames:v 1 \
  -vf "scale=2560:1440:flags=lanczos" \
  -c:v libwebp -quality 80 -compression_level 6 \
  site/assets/video/runcastle-demo-poster.webp
```

`+faststart` is load-bearing: without it the moov atom sits at the end of the file
and nothing plays until the whole 11.5 MB has arrived. Keep the `width`/`height`
attributes on the `<video>` in step with the encode — they are what reserves the
frame's height before a byte is fetched, and the film is the tallest thing on the
page to reflow.

## The product mockups are real UI

Below the hero, every piece of runcastle shown on this page is the **product's own
components as live markup**, not a screenshot. `assets/app-ui.css` is `apps/web/src/styles.css`
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

### The end-to-end walkthrough

The `#pipeline` section is the page's centrepiece: one feature walked through all
six phases. Reading down the six `.step` buttons drives the sticky stage, and each
`.stage-panel` is a slice of the workspace — the phase stepper, sometimes the
next-step bar, and that phase's real body (terminal, spec doc, ticket list, run
lanes, review cards, shipped card).

Four things about it are load-bearing:

- **`.walk-app` has a `min-height` in logical units**, set to the tallest panel.
  All six panels share one grid cell, so the cell is as tall as the tallest; the
  floor makes every frame fill it instead of leaving short ones floating in it.
  It is dropped below 900px, where the panels stack and each is its own block.
- **`.run-stream-panel` is re-heighted.** The product sizes it against `100dvh`,
  which means nothing inside a mock that lays out at a fixed logical size.
- **The stepper wraps** (`flex-wrap`) only at phone width. A stepper with the last
  two phases cut off is the one thing this section cannot show.
- **One-shot entry animations are disabled** on these panels (`.peek`,
  `.nextstep`, `.stream-line`). They are written for a view that arrives once;
  here the panels cross-fade every time someone scrolls past. The running-lane
  pulse stays, because that is state rather than entry.

### Rules that are easy to get wrong

- **Container queries, not media queries.** A mock's width has nothing to do with
  the viewport. `.rc-app` is a named container (`rcapp`) and the rules that drop
  the sidebar and inspector key off *its* width. Keyed to the viewport, a 1600px
  mock on a phone collapses its rails while still being 1600px wide, and the
  workspace lands in the 252px sidebar track.
- **Container queries do not add specificity.** Rules inside `@container` still
  need the `.rc-app` prefix to beat `.rc-app .shell-body` from the product sheet.
- **Collapse rules key off `.shell-body > .sidebar`, not `.sidebar`.** A mock may
  show one rail on its own — the feature board is just `.sidebar` — and such a
  panel is narrow by nature. Keyed on the bare class it matches its own width and
  hides itself.
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

Nothing to compile, but the server has to honour `Range` requests or the hero film
cannot seek — which means the ambient loop never reaches its in-point and the
player cannot scrub. `python -m http.server` answers every range with a `200` and
the whole file, so use something that returns `206`:

```sh
cd site && npx --yes serve -l 4599   # then open http://localhost:4599
```

Every real host for this directory (GitHub Pages, Cloudflare, Vercel, Netlify)
range-serves by default, so this is a local-preview concern only. If a film that
refuses to seek shows up in testing, check for `Accept-Ranges` before touching
`main.js`.

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

### The film is only seekable on the apex, never on `*.pages.dev`

Worth knowing before anyone files a bug against `main.js`. **Cloudflare Pages
answers every `Range` request with `200` and the whole asset** — its own docs give
this away in passing, noting that an asset is cacheable only when "the request does
not have an `Authorization` or `Range` header". Uncached, nothing serves a `206`.

The consequence is not subtle. On a `*.pages.dev` URL the film cannot seek **at
all**, even fully buffered: every `currentTime =` assignment dumps the playhead
back to the start, which kills both the scrubber and the loop-in point.

On a **proxied** hostname in the zone it is correct — `206 Partial Content`,
cached, every seek lands. It is Cloudflare's CDN, not the Pages asset server, that
implements `Range`, and `*.pages.dev` does not go through it.

So:

- **Test the film on `runcastle.dev`**, or on a proxied hostname pointed at the
  Pages project. A `*.pages.dev` preview will show you a broken player and a hero
  that restarts on the brand open every loop.
- **A `_headers` file does not fix it.** Pages ignores `Cache-Control` there for
  its own assets — the response comes back `max-age=0, must-revalidate` regardless,
  so the object never becomes cacheable. Tried, measured, removed.
- If the film ever has to be served off a `pages.dev` URL for real, the fix is R2
  behind a custom domain, which does `Range` natively. It was not needed here.

Check with `curl` before believing anything:

```sh
curl -sD - -o /dev/null -r 5000000-5000100 https://runcastle.dev/assets/video/runcastle-demo-1440.mp4 | head -3
# want: HTTP/1.1 206 Partial Content + a content-range header
```

## `assets/screens/` and the root README

Markdown cannot run CSS, so the root README needs real images. Those PNGs are
**captures of the mockups on this page**, not of the app, which is why they are
well framed and carry no project names or account details.

One of them is now orphaned: `mock-shell.png` was a capture of the whole-shell
mock that stood in the hero, and the hero is the film. The file is still correct
and still the `og:image`, but there is no longer an instance on the page to
recapture it from. The rules and the `[data-mock='shell']` sizing it needs are
still in `styles.css` — put the frame back on a scratch page to refresh it.

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
