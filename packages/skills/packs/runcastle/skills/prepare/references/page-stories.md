# Page stories

A **page story** shows one state of one place in the app, rendered whole: shell, navigation and body, at that place's address, with fake data. The map reads these and nothing else. Component stories are review evidence only and never reach the map.

Runcastle's own files are the worked example: `.runcastle/storybook/app-at.tsx` (`<AppAt path>`), `.runcastle/storybook/shell-fakes.ts` (`shellFakes`, `withShell`), the silent `EventSource` in `.runcastle/storybook/preview.tsx`, and the stories `.runcastle/stories/pages/1-onboarding/Onboarding.stories.tsx` and `.runcastle/stories/pages/4-feature/3-review/Review.stories.tsx`. Read them before writing your first.

## Files and folder order

- A page story lives under `.runcastle/stories/pages/`. That path alone makes it a page story; runcastle tells the two kinds apart by the `importPath` in the build's `index.json`.
- Folders carry navigation-order numbers: `pages/1-onboarding/`, `pages/2-project-chooser/`, `pages/4-feature/3-review/`. Number them in the order a person moves through the app. The map orders places by these paths, comparing numbers as numbers.
- The numbers live in folders only. Never put them in a title.

## Naming: place, state, step, variant

- **The title is the place**, written the way you navigate to it: `Onboarding`, `Project chooser`, `Feature/Review`. At most two levels show; deeper segments fold into the state name.
- **Each exported story is one state** of that place: `Empty`, `Many projects`, `Findings open`.
- A leading number makes a **step** in a flow: `1 Welcome`, `2 Git identity`. States sort by step, then file order; unnumbered states come after.
- A **variant** shares its step's number and adds ` · <variant>`: `3 Coding agents · None installed`. Variants sit with their step and never pose as extra steps.
- Reuse an existing place's spelling (`get_feature_context`'s `mapGroups` / `stories.pages`), so a scenario folder of the same name joins it.

## Render the real app at an address

- Render the app's real root, under the same providers its entry point stacks. Never a shell with a chosen body, and no "start here" prop added to the app for the catalogue.
- Set the address first: the router's memory mode if it has one, otherwise `history.replaceState` on the browser URL before mount. Clear browser storage so every story starts empty. A small shared helper does this (`<AppAt path>`).
- The page code runs unchanged.

## Fake data at the edge only

- Answer every request the shell and the page make at the network edge, as the project's fake API does. Never mock the app's own modules.
- Put the shell's defaults (the one project, doctor and update checks, counts) in one shared module; a story spreads them and overrides only what makes its state differ. A request nobody faked should fail loudly (NOT_FOUND), which is how a missing fake shows itself.
- A story answers a mutation only if it names it; refuse the rest.
- **Canned live content:** a silent event stream that opens and never sends; terminals replaying recorded text; a placeholder where a live drive frame would be. Nothing in a page story runs for real.

## States with no address

Wizard steps, dialogs, settings, a command palette and forms have no URL. Reach them with a `play` step that clicks and types as a user would, then **asserts a landmark of the target state is on screen**. A failed step must show the error frame, never the starting screen under another state's name. Never set the app's internal state to get there.

## Walk the navigation

To map an app, find its navigation: the router (or its equivalent: a route enum, a screen list) plus overlays opened from elsewhere. Every route is a place; every distinct thing worth seeing on it is a state; every overlay is a state of the place it opens over. Split the work by area, one ticket per area, and number the folders as you go. Check each story by reading the stories typecheck and the catalogue build's `index.json`, which must list every state you wrote.
