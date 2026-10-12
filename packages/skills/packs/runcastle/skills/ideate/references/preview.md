# The plan preview — the page the human looks at

Load this when the decisions are locked and the preview step (§3 of the ideate
skill) arrives, or when a decision edit at planning means the preview has to be
redrawn. Otherwise it costs this conversation nothing.

The preview is the one page the human reads the feature by. They confirm the
plan by looking at it, and when tired it is the only thing they read before
Burn. Draw it for that reader.

## The file

- **Exactly one file, `preview.html`, at the root of the feature's docs dir**:
  `docs/features/<slug>/preview.html`. Several screens or flows are sections of
  that one page, never more files.
- **Start from `./preview-starter.html`.** Copy it to that path and fill it in.
  It carries runcastle's theme tokens for both themes and the styles and markup
  for the fixed parts; do not restyle them.
- **Throwaway explorations** may go under `docs/features/<slug>/prototypes/`.
  They are never shown; the app shows only `preview.html`.

## Five parts, in this order

1. **What this is.** One or two sentences.
2. **The show.** Whatever explains how the feature will work. **It is free, with
   no template**: screens, clickable prototypes, skeletons, flows, before and
   after, scenarios. Choose the form that explains *this* feature — work with no
   screen gets flows, use cases, before and after, or a clickable skeleton.
3. **What was decided.** Every decision in `decisions.md` by its number and
   title, with the reason available on demand (the starter's `D` list builds
   this). Where a decision is visible in the show, pin its number on that spot:
   `<a class="pin" data-d="3">3</a>`.
   **A self-planned feature** (§1a of the ideate skill) opens this part with a
   **Check first** group of at most five decisions, the ones the planner picked.
   Each entry shows the decision's number and title, its alternative, and why it
   is uncertain (the starter's `C` list builds this). The remaining decisions
   follow in the list, each showing that it was assumed (a third element on its
   `D` entry). **A grilled feature has neither**: no group and no assumed marks.
4. **What is left out.** Out of scope, and anything deferred to a later lap.
5. **Under the hood.** The technical shape for a reader who wants it,
   **collapsed by default**, drawn where it can be.

## Visual first

**A short sentence beside a picture, never paragraphs, detail behind a click.**
If a part reads as prose, draw it instead: a flow, a before and after, a
toggled state, a list of dots.

## The theme rule

- **The page and every diagram and flow are runcastle-themed**, through the
  starter's tokens, in light or dark to match the app.
- **A mocked screen uses the styling of the project it belongs to**, inside the
  framed `.screen` panel. A prototype of another product's UI can only be judged
  in that product's look.

## Screen blocks

Each screen in the show is a **screen block**: the lines between two markers,

```html
<!-- screen:<name> -->
<div class="screen"> … </div>
<!-- /screen:<name> -->
```

with `<name>` in kebab case and unique in the file. A ticket that builds that
screen names the block, and its burn agent reads only those lines — so put
everything the screen needs to be understood between the markers, and nothing
else. Delete the starter's `example-name` block if the show has no screen.

## Inline only

**Styles, scripts and images are inline. The file makes no network request** —
no `<link>`, no `@import`, no external `src` or `url(`; images are `data:` URIs
or inline SVG. This is enforced, not a preference: the app renders the preview
in a sandboxed frame that runs scripts and refuses every fetch, external image
and font, form post and popup. Anything hosted elsewhere simply does not load.
In-page links scroll by script (the starter does this), because hash navigation
is unreliable inside that frame.

## Sizing

**There is no minimum.** A small feature's show can be a single picture and the
other parts a line each. Reading target, as guidance and not a limit: **about a
minute for a small feature, a few minutes for a large one.**

## Self-check, before you tell the human to look

- Every decision in `decisions.md` appears in **What was decided**, by its number
  and its title, in order — none missing, none renumbered.
- For a self-planned feature, the **Check first** group holds at most five
  decisions, each with its alternative and why it is uncertain, and every
  decision carrying an `**Assumed.**` line in `decisions.md` shows as assumed.
  For a grilled feature, `C` is empty and no decision is marked.
- Every pin points at the decision the spot actually shows.
- The five parts are in order; **Under the hood** is closed.
- The file is still fully inline.
