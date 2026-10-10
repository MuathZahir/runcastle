# Plan preview

## Problem

The human learns what a feature will be by answering its grill one question at a time, then skimming the spec and tickets. When tired they accept recommendations without reading them, so by the Burn click nothing has shown them the feature as a whole. They already work around this by hand: several shipped features carry a hand-made HTML prototype that the human reacted to before the spec was written. No skill tells a planning session to make one, and the app cannot show one.

"Features plan themselves" waits on this feature. Once it lands, the preview is the human's only check before Burn, so it has to carry the decisions and not only the pictures.

## Approach

Every planned feature ends its grill with a **preview**: one self-contained HTML page the human looks at. The planning session draws it when the decisions lock, the feature page shows it under the Burn row, and the human confirms by looking or says what is wrong. Spec and tickets are written only after that.

`preview.html` in this feature's docs dir is the worked example of everything below, and its one screen block, `feature-page-planning`, is the visual reference for the page work.

### The preview file

- Exactly one file, `preview.html`, at the root of the feature's docs dir. Styles, scripts and images are inline. It makes no network request.
- Five parts in a fixed order:
  1. **What this is.** One or two sentences.
  2. **The show.** Whatever explains how the feature will work, chosen freely by the session: screens, clickable prototypes, skeletons, flows, before and after, scenarios. No template.
  3. **What was decided.** Every decision in `decisions.md` by its number and title, with the reason available on demand. Where a decision is visible in the show, that spot carries the decision's number.
  4. **What is left out.** Out of scope, and anything deferred to a later lap.
  5. **Under the hood.** The technical shape, collapsed by default, drawn where it can be.
- Visual first throughout: a short sentence beside a picture, never paragraphs, detail behind a click.
- The page is always runcastle-themed, dark by default with light as a peer, selected by a `data-theme` attribute on the root element and falling back to the OS setting when the attribute is absent. A mocked screen inside the show uses the styling of the project it belongs to and sits in a framed panel. Diagrams and flows are runcastle-themed.
- Each screen in the show is a **screen block**: the lines between `<!-- screen:<name> -->` and `<!-- /screen:<name> -->`, with `<name>` in kebab case and unique in the file.
- No minimum size. A small feature's show can be a single picture and the other parts a line each. Reading target: about a minute for a small feature, a few minutes for a large one.

### Skill pack

- **Starter file.** The pack ships a starter HTML file beside the ideate skill. It carries runcastle's tokens for both themes, under the app's own token names, and the styles and markup for the four fixed parts around an empty show. The session copies it and fills it in. It is derived from this feature's `preview.html`. Its colour tokens must equal the app's theme tokens, and a test holds them equal.
- **Ideate skill.** A new step between locking decisions and completing ideation:
  1. When the decisions are locked, write `preview.html` from the starter.
  2. Check it against `decisions.md`: every decision appears by number and title.
  3. Tell the human to look, saying the preview is on the Overview, and wait.
  4. On a correction, edit the decision and redraw the preview in the same move, then ask again.
  5. Only after the human confirms, complete ideation and go on to the spec.

  The preview is what the human confirms shared understanding on. The session never skips it on its own judgement. If the human says to skip it, the session goes straight to the spec and writes no file. The preview rules (the five parts, visual first, the theme rule, screen blocks, inline only, sizing) are a reference file loaded when the step arrives, so the skill's main text stays short.
- **Redraw rule.** While a feature is at planning, a session that edits `decisions.md` updates `preview.html` in the same move. The rule is in the ideate skill and in the revisit skill's ordinary revisit. A lap planned from review does not redraw.
- **Tickets skill.** A ticket that builds a screen shown in the preview names that screen block in its context as the visual reference. The context tells the burn agent to find the two markers and read only the lines between them, and says the block shows the approved look and behaviour and is not the implementation: build with the project's real components, never copy the mock's markup. A ticket with no screen does not mention the preview.
- The preview is not added to the docs digest and is not a canonical agent doc.

### Server

- The docs watcher also raises the docs-changed event for `preview.html`. Every other non-Markdown file is still ignored.
- The feature read gains one field saying whether a preview exists and when it was written:

  ```ts
  /** null when the feature's docs dir has no preview.html */
  preview: { relPath: 'preview.html'; updatedAt?: number } | null
  ```

  The existing `docs` list keeps returning Markdown files only; its consumers assume that.
- The existing doc read returns the file as text. No new route, table, pipeline state or gate.

### Web app

- **Frame document.** A pure function turns the file's text and the app's current theme into the document the frame renders. Immediately after the doctype (adding one when the file has none, so the page never falls into quirks mode) it inserts the content policy and a line that sets `data-theme` on the root element. The policy, from the grill:

  ```
  default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'
  ```

- **Frame.** The document is given to an `iframe` as `srcdoc` with `sandbox="allow-scripts"` and nothing else: no same-origin, no popups, no forms, no top navigation. If the frame ever loads a second document (the preview navigated itself away), the panel renders the preview again.
- **Preview panel.** A section titled "Preview" with the last-written time ("updated 2h ago") and one icon control that opens the same frame full-window in a dialog. The inline frame has a fixed, readable height and scrolls itself. The panel refreshes when the file changes, through the existing event push.
- **Placement.** The panel leads the Overview body at planning, under the next-step row and above the decisions or spec pane (before this lap has tickets) or the ticket ledger (after). It also leads the read-only Planning view. With no preview, both bodies render exactly as they do today: no panel, no placeholder. The preview is not shown on the live Building, Review or Shipped bodies.
- **Chat notice.** While the Chat view is in front, a docs-changed event naming `preview.html` raises a notice of a new kind: title "Preview ready", subtitle `preview.html`, action "View preview", planning hue, target Overview. A redraw counts up on the one card.

## Seams

- **Feature read (`feature.get`), existing, extended.** Observe that `preview` is null without the file, and carries the written time with it.
- **Docs watcher to event feed, existing.** Observe that writing `preview.html` in a watched docs dir emits one docs-changed event naming it, and that other non-Markdown files still emit nothing.
- **Frame document function, new, pure.** Observe the policy and theme line placed directly after the doctype, a doctype added when missing, and the file's own content otherwise untouched.
- **Preview panel markup, new.** Observe the `sandbox` attribute's exact value, the written time, the full-window control, and that nothing renders when `preview` is null. Static markup is enough for all but the dialog.
- **Planning body and read-only Planning view, existing.** Observe the panel leading both when a preview exists, and both unchanged when it does not.
- **Chat notice mapping (`noticeFor`), existing, extended.** Observe the "Preview ready" notice for a docs-changed event naming `preview.html`, and the deck collapsing repeats.
- **Shipped skill text, existing pattern.** Skills are content, so tests read the shipped files and pin the rules: the ideate preview step and its wait, the redraw rule in ideate and revisit, the screen-block rule in tickets, and the starter file's presence, self-containment and token equality with the app theme.

## Out of scope

- Who answers the grill, self-planning, and marking which decisions the agent made for the human. That is "Features plan themselves".
- Commenting on or annotating the preview.
- Running the real app or rendering real components inside the preview.
- Publishing the preview outside the machine.
- Previews for quick changes, which have no planning session.
- Migrating or showing the existing `prototype.html` and `prototypes/*.html` files.
- Any new server-run agent, pipeline state or gate.

## Open questions

- **A frame can still navigate itself.** The content policy blocks fetches, images, fonts and form posts, but no sandbox flag or supported policy directive stops a script from setting its own frame's location. That is one GET the lockdown does not prevent. The frame cannot read the app or any response, the local server's mutations do not accept GET, and the panel restores the preview when the frame loads anything else, so the exposure is small. Closing it fully needs an app-wide frame policy that the test-drive panel's frame would also have to satisfy; decide after lap 1 whether that is worth it.
- **Reading cost of a screen block.** The 2 to 5k token estimate per block is unmeasured. Check it against the first real previews.
- **Geist is not inline.** The preview falls back to the system UI font, since embedding the app's fonts would dominate the file's size. Revisit if previews look off beside the app.

## Later laps

- A staleness warning when the preview is older than the decisions. Build it only if a test drive shows sessions forgetting the redraw rule.
- The preview on the live Building, Review and Shipped pages.
- Redrawing the preview during a lap planned from review.
- Splitting screen blocks out of the file if reading them costs burn agents too much.
