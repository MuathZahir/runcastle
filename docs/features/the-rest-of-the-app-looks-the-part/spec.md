# The rest of the app looks the part

## Problem

The chat, the right panel, test drive, the Orchestrator and the sidebar have all been brought up to the new style. The screens seen least have only had the shared pieces: the all-projects home, settings, first-run setup, the command palette and the dialogs. They already look broadly right, but next to the shipped screens a person still notices the differences: dialogs and menus are a slightly different raised surface from the composer, the home's sidebar jumps when you move to a project, the first-run screens still describe gates and AFK burns, the rail's selection is the look the foundation retired, and a settings row cuts off the sentence that says what is wrong with it.

## Approach

Each screen keeps its layout and its job. This is a short list of gaps, already drawn in the real components on this branch.

**Raised edge.** The two elevation tokens in the theme gain the 1px top highlight, in both themes, so dialogs, menus, popovers, the palette and anything floating catch the same edge as the chat's raised material. That material reads the token rather than repeating it. This is a stated exception to "must not swallow": shipped screens' menus change by this one line and nothing else.

**The home.** Projects with something running or waiting on you sit on top in the card the Working bay and the Conversations page use, waiting before running, its edge lit while something runs. The rest follow as divided rows, or the whole list when nothing is live. "No features yet" replaces "0 features". The home's sidebar takes the project sidebar's head height and halftone; the page takes the halftone Conversations has. Facts and clicks are unchanged.

**First run.** The current step on the rail wears the card. The column hangs from a fixed height, so the rail stays put between steps; a long step scrolls in the panel. The intro's mark sits in the accent tile of the Orchestrator's empty chat, through a small shared tile the Orchestrator's own now uses. The lead drops gates, and "AFK burns" becomes unattended workers on the rail, the step's heading, its explainer and the agents step.

**Settings.** A checklist row's detail wraps instead of truncating, the checklist head loses its tile, the project name at the rail's foot leaves the code font, and the page scroller states the thin scrollbar.

**Palette.** "Project chat" becomes "Orchestrator" with its glyph, the theme action reads "Switch to light theme", no results is the shared empty state, and the list states the thin scrollbar. The Orchestrator row answers to the word "orchestrator" as well as its old words. The overlay stays its own code, and the style guide records that exception.

**Dialogs and forms.** A footer has a hairline only when the body above it scrolls, so Add to backlog loses its own. Merge's conflict line becomes the shared failure note. The discard question sits on the card rather than the hover ground. Fields and form spacing stay.

**What is left to build.** Commit the designs, with the home and first-run as separate commits so either can be undone alone. Update the test files they touch (AFK step, palette rows, first-run wizard, the draft card's rhythm, wizard rail) and add a test for the home's split. Add "orchestrator" to the palette's search words, with its test. Update `DESIGN.md` (the home, the wizard, the elevation's edge) and `STYLE.md` (the palette's exception, `surfaces.ts`'s raised material). No server, schema or API change.

The preview page `apps/web/preview/rest.html` renders every state by `?state=`, reached with real components on sample data.

## Seams

- **The rendered components** (existing): the tier-1 and tier-2 component tests in `apps/web/test`, which observe the markup and steps of the wizard, the palette and the dialogs.
- **`projectStats` on the home** (existing): the facts that decide which projects are live; the new split is observable in `PortfolioHome`'s rendered order.
- **The preview page** (new): `preview/rest.html?state=…&theme=…`, which shows each state on sample data and is held to the project's typecheck.

## Out of scope

- The chat, the right panel, test drive, the Orchestrator's page and the sidebar, beyond the raised edge reaching their menus.
- The run view: its one component, the lane transcript, lives inside an opened ticket on the Tickets panel.
- New behaviour: every click, fact and step stays.
- The native arrows at the ends of Windows scrollbars.
- Moving the palette onto the shared Dialog.
- Stale words on screens outside first-run.

## Open questions

None block the build. The picks most likely to change are the home's live card and the intro's tile; each is a small, separate commit.
