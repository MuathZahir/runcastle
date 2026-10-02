# site

The runcastle landing page, plus the docs and comparison pages that share its
chrome. Static files and assets, no build step and no runtime dependencies.

```
index.html          the landing page: markup and copy
styles.css          tokens, shared chrome (nav, footer, buttons), landing page sections
main.js             pipeline walkthrough, clipboard, the film dialog
content.css         the reading surface for docs/ and compare/, on top of styles.css
docs/, compare/     article pages; they load styles.css + content.css and no JS
assets/
  rc-ui.css         the design system's component styles, for the product mockups
  og.png            the social card: a capture of the top of the landing page
  favicon.svg       copy of apps/web/public/favicon.svg
  fonts/            Geist + Geist Mono variable subsets (latin), self-hosted
  logos/            Simple Icons brand marks for the "runs on" strip
  screens/          PNG captures for the root README only
  video/            the launch film, its poster frame, its caption track
```

## Where the design comes from

The page is a port of a design canvas, and follows the **Runcastle Design System**
(https://claude.ai/artifact/JK4Nbts5BetjWU6bJsWPkn), the same system the app is
built on. The tokens at the top of `styles.css` are that system's values, which
`apps/web/src/theme.css` also holds (there with Tailwind's `--color-` prefix). If
a token changes in the app, change it here too.

One sentence per section and a visual that carries the argument: that is the
shape of every band on the page. A new section that is a heading over paragraphs
is the wrong shape.

## The hero is a castle

Six phase-coloured blocks stand as battlements on top of the app frame, echoing
the logo and showing the pipeline in one glance. The frame under them is a mockup
of the workspace, not a capture.

The launch film used to stand here. It is now behind the hero's second button,
which opens it in a `<dialog>` (see below).

## The product mockups are real UI

Every piece of runcastle shown on the page is **live markup built from the design
system's own primitives**, not a screenshot. `assets/rc-ui.css` is the system's
`components/bundle.css` with its document rules removed, so a mockup is those
class names (`.rc-row`, `.rc-nav`, `.rc-stepper`, `.rc-btn`, `.rc-props`, ...)
written out as static HTML: the markup each component would have rendered.

This is why: screenshots go soft when scaled, truncate at narrow widths, and go
stale the moment the UI moves. Live DOM stays sharp at any size, reflows like the
page around it, and the content is ours to choose.

Rules that keep them honest:

- **Mockups are `inert` + `aria-hidden`.** They are illustrations, so they stay
  out of the tab order and out of the accessibility tree, and each is paired with
  an `.sr-only` description (or with visible copy that says the same thing).
- **No interactive elements inside one.** Buttons and tabs are `<span>`s wearing
  the component's classes. Nothing in a mockup does anything, so nothing in it
  should claim to.
- **Do not restyle a mockup by editing `rc-ui.css`.** Refresh that file from the
  design system; put the layout between primitives in `styles.css` (the `.mk-*`
  rules, and each section's own).
- **`minmax(0, 1fr)`, not `1fr`.** A bare `1fr` keeps an auto minimum, so a track
  refuses to shrink below its content and pushes the mockup, and the page, wider
  than a phone.
- **No invented product behaviour.** A mockup may only show a state the app can
  actually reach. The demo content (feature names, tickets, the app under test in
  the review player) is invented; the screens are not.

### Icons

One SVG sprite at the top of `index.html`: the `i-` symbols are the design
system's icons, the `p-` symbols are the phase progress glyphs. Reference them
with `<svg class="rc-icon"><use href="#i-cube" /></svg>`; size comes from CSS
(16px, or `.is-14` / `.is-18`).

A phase glyph takes its hue from `--ph`, which the `.ph-*` classes set on the
glyph or on anything around it. The shipped glyph cuts its tick in `--tick`,
which defaults to `--surface`; a container on a different ground sets it (the
sidebar, the pipeline tiles and the hero blocks all do).

## The pipeline walkthrough

`#pipeline` is six buttons and six panels. Pressing a tile shows its panel and
fills the bars up to it. Two things are load-bearing:

- **It works without JS.** The panels are only hidden under `.js`, a class the
  inline script in `<head>` puts on `<html>` before first paint. Without it all
  six panels stack, in order, and the page still reads.
- **The default is in the markup.** Build is the panel shown on load, so the
  `is-shown`, `is-reached` and `aria-pressed` state for stage 3 is written into
  `index.html`. Change the default there, not in `main.js`.

## The film

```
assets/video/
  runcastle-demo-1440.mp4      2560x1440, 60fps, H.264 + AAC, 11.5 MB
  runcastle-demo-poster.webp   the 0:52 "six sandboxes" frame, 2560px, 59 KB
  runcastle-demo.en.vtt        voiceover captions
```

"Watch the film" in the hero is a plain link to the mp4, which is what someone
with no JS gets. `main.js` opens it in a modal `<dialog>` instead: a `<video>`
with native controls, `preload="none"` and a poster, so nothing is fetched until
the dialog is opened. Closing the dialog pauses it.

The film was cut for the previous look of the page (violet accent, Claude Code
only). It is still the film; it no longer matches the page around it.

**To re-cut it** from a new master (the 4K one, always: the 1080p export is
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
attributes on the `<video>` in step with the encode: they are what gives the
dialog its full height before a byte is fetched.

**The captions are timed off the audio, not the storyboard.** The cues in the
`.vtt` come from `silencedetect` run over the mixed track, so they follow the
read.

```sh
ffmpeg -i "$FILM/runcastle-launch-4k60.mp4" -af silencedetect=noise=-45dB:d=0.45 -f null -
```

## Preview locally

Nothing to compile. Any static server shows the page; one that honours `Range`
requests is needed for the film's scrubber to seek. `python -m http.server`
answers every range with a `200` and the whole file, so for the film use
something that returns `206`:

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

Before a deploy, recount the two numbers in the proof strip. The commands are in
a comment above that section in `index.html`.

### The film is only seekable on the apex, never on `*.pages.dev`

**Cloudflare Pages answers every `Range` request with `200` and the whole asset.**
Its own docs give this away in passing, noting that an asset is cacheable only
when "the request does not have an `Authorization` or `Range` header". Uncached,
nothing serves a `206`, so on a `*.pages.dev` URL the film cannot seek at all:
every `currentTime =` assignment dumps the playhead back to the start.

On a **proxied** hostname in the zone it is correct: `206 Partial Content`,
cached, every seek lands. It is Cloudflare's CDN, not the Pages asset server,
that implements `Range`, and `*.pages.dev` does not go through it.

So:

- **Test the film on `runcastle.dev`**, or on a proxied hostname pointed at the
  Pages project.
- **A `_headers` file does not fix it.** Pages ignores `Cache-Control` there for
  its own assets. Tried, measured, removed.
- If the film ever has to be served off a `pages.dev` URL for real, the fix is R2
  behind a custom domain, which does `Range` natively.

Check with `curl` before believing anything:

```sh
curl -sD - -o /dev/null -r 5000000-5000100 https://runcastle.dev/assets/video/runcastle-demo-1440.mp4 | head -3
# want: HTTP/1.1 206 Partial Content + a content-range header
```

## `assets/og.png`

The social card is the top 1200x630 of the landing page, captured at 2x. To
refresh it, serve the page and run headless Chrome over it:

```sh
chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=site/assets/og.png http://localhost:4599/
```

`--virtual-time-budget` lets the hero's entrance finish before the frame is
taken. Keep `og:image:width` / `og:image:height` in step with the file.

## `assets/screens/` and the root README

Markdown cannot run CSS, so the root README needs real images. The PNGs here are
captures of the mockups on the **previous** landing page, in its violet look.
Nothing on this page uses them any more, and the mockups they were taken from are
gone, so they cannot be refreshed in place: recapture from the current mockups
(or from the app) when the root README is next updated.

## House rules

- **Tokens come from the design system.** `styles.css` and
  `apps/web/src/theme.css` hold the same values; keep them in step.
- **One accent.** Blue, spent on focus, selection, links, "live" and the review
  phase. The primary button is inverted neutral, never accent-filled. The phase
  palette is lifecycle state and stays on phase markers, the hero blocks and the
  one orange sliver in `#why`.
- **Dark only.** The page is theme-locked and no section inverts. The one light
  surface is the app under test inside the review player.
- **Facts are text, not boxes.** No outlined pills, no uppercase tracked labels,
  no eyebrows above headings. Sentence case everywhere.
- **Mono is for strings you could paste into a terminal**: branches, paths,
  commands. Nothing else.
- **No scroll listeners.** `main.js` is click handlers only. The one entrance
  animation (4px rise, 190ms) is CSS, and nothing moves under
  `prefers-reduced-motion`.
- **Five class names are shared with the article pages**: `nav*`, `footer*`,
  `brand`, `lp-btn*`, `wrap`. Renaming one means editing all nine pages under
  `docs/` and `compare/`.
