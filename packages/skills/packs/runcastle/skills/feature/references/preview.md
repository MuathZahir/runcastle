# The plan page — optional, never a gate

Read this when a drawn plan page would help the human, or to redraw one after
the feature's decisions change.

A plan page (`preview.html`) is a picture of how the feature will work. Nothing
waits for it: the human approves by answering your questions, and designs by
their own approval. Draw one only when it helps: a large feature, several
screens or flows, or a question that is easier shown than told. A small feature
gets none; your few-line playback is enough.

## Show it

1. Draw it from `./preview-starter.html` and run the self-check below.
2. Show it with `show_file({ path })`: it posts a card the human opens in the
   file viewer. Put any question after the call.
3. When the feature's decisions change, redraw it in the same move and show it again.

## The file

- **Exactly one file**, `docs/features/<slug>/preview.html`. Several screens or
  flows are sections of it. Throwaway explorations may go under
  `docs/features/<slug>/prototypes/`; they are never shown.
- **Copy the starter** with `cp`, find its slots with `grep -n 'FILL:'` on the
  copy, and fill each by editing; never read the starter whole. Do not restyle
  its fixed parts.
- **The slots**, each a `<!-- FILL:<name> -->` line above what to replace:
  - `title`: the feature title in `<title>`.
  - `what`: the `<h1>`, a one- or two-sentence lede, `[slug]` in the meta line.
  - `show`: the show, in place of the comment below it.
  - `screen`: the example screen block; copy and rename it per screen, or delete it.
  - `D`: one entry per decision, in order: `['Title', 'Why, in a sentence']`, or
    `['Title', 'Why', 'assumed']` for one marked `**Assumed.**`.
  - `C`: check first, a plan made with nobody present only, at most five:
    `[decisionNumber, 'Alternative', 'Why unsure', 'tag'?]`; else `[]`.
  - `later` / `not-this`: one `<li><i class="dot"></i>…</li>` per item left out.
  - `hood`: the technical shape.

## Five parts, in order

1. **What this is.** One or two sentences.
2. **The show.** Whatever explains how the feature will work, in no fixed form:
   screens, clickable skeletons, flows, before and after, scenarios. It ends
   with **who builds what**: each worker by label, one-line purpose and kind
   ("with you" or "on its own"), your own part, and the review at the end.
3. **What was decided.** Every decision in the feature file by number and title,
   the reason on demand. Pin a decision's number where the show shows it:
   `<a class="pin" data-d="3">3</a>`. A plan made with nobody present opens with
   the Check first group and marks its assumed decisions; one made with the
   human has neither.
4. **What is left out.** Out of scope, and under **Later** what was parked.
5. **Under the hood.** The technical shape, collapsed by default.

A short sentence beside a picture, never paragraphs, detail behind a click. The
page and its diagrams use the starter's runcastle tokens; a mocked screen uses
the styling of the project it belongs to, inside the framed `.screen` panel.

## Screen blocks

Each screen in the show sits between two markers, `<name>` in kebab case and
unique in the file:

```html
<!-- screen:<name> -->
<div class="screen"> … </div>
<!-- /screen:<name> -->
```

A worker that builds the screen reads only those lines, so put everything the
screen needs there and nothing else.

## Designed screens

A screen designed in design mode (`./design.md`) is not mocked again. Its block
holds a designed-screen entry with no button and no mock markup: the title you
gave `show_design`, one line on what is real and what is sample data, the states
its switcher holds, and the committed component file and design page path.

```html
<!-- screen:invoice-list -->
<div class="designed">
  <h3>Invoice list</h3>
  <p>Layout and states are real components; the rows are sample data.</p>
  <p>States: empty · loading · full · error.</p>
  <p class="mono">src/components/InvoiceList.tsx · design page /preview/invoice-list</p>
</div>
<!-- /screen:invoice-list -->
```

Hand mocks remain for screens nobody designed, server-built pages and native
mobile.

## Inline only

Styles, scripts and images are inline; the file makes no network request: no
`<link>`, no `@import`, no external `src` or `url(`, images as `data:` URIs or
inline SVG. The app shows it in a sandboxed frame that refuses every fetch,
external image, font, form post and popup. In-page links scroll by script, as
the starter's do.

There is no minimum size: about a minute's read for a small feature, a few
minutes for a large one.

## Self-check, before the human looks

- Every decision appears in **What was decided**, by number and title, in order.
- With nobody present: at most five in Check first, each with alternative and
  why unsure, and every `**Assumed.**` decision shows as assumed. With the
  human: `C` is empty and nothing is marked.
- Every pin points at the decision that spot shows.
- The five parts are in order; **Under the hood** is closed.
- The show ends with who builds what, the review included unless declined.
- Every designed screen is a designed-screen entry, not a redrawn mock.
- The file is fully inline.
