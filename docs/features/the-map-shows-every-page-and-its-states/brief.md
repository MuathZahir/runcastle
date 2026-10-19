# Brief

## Why this feature exists

The human, after the map shipped (2026-10-19), pointing at the Map › Burn group showing `Lane / Failed Ticket` and `UnrunnableGates / Missing Runtime`: "it still looks nothing like what I imagined… it's not comprehensive, literally just showing some components. Also, I want it to show pages and states, not individual components. I want to see the structure of my website. So in runcastle, I would want to see the onboarding and all its screens, the project chooser, the project session screen, etc.."

The map did what its spec said. **The spec was wrong in three ways:**
1. **Wrong unit.** `the-map-of-stories-and-scenarios` decision 10 shows "every state of each component". The human wants whole screens.
2. **Code-shaped structure.** Groups come from story folders (`burn`, `feature`, `feature-page`, `map`, `review`, `sidebar`), which are code areas. The human thinks in places they go in the app.
3. **Accidental coverage.** Stories are written only when a feature's planning judges a state worth showing, so main has 11 stories: whatever recent features happened to write. Nothing ever mapped the existing app.

(A first copy of this feature was deleted on 2026-10-19 after Go was pressed before its plan existed. See the quick change *Go waits for a finished plan, and the status line tells the truth*. Plan this one fully and press Go only at "plan ready for Go".)

## How the chain works today (unchanged by this feature)

- **Prepare** sets up Storybook, faking data at the network edge (`.runcastle/storybook/fake-api.ts`), plus one page story (`features-show-their-ui-states-as-stories` decisions 9 and 14).
- **Burn agents** write stories when a ticket asks.
- **Runcastle builds the catalogue** with the command in `.runcastle/stories.json`, beside the gates at every review pass. A failed build is a failed gate (stories decision 4).
- **At merge, the build is promoted to main's catalogue,** or rebuilt in the background (map decision 5).
- **The map reads story names from the build's index,** which is text only, and frames each story.
- **Runcastle never understands the app's code.** Only the agents writing stories do.

## Settled in the project session

1. **The map shows pages and their states, rendered whole:** app shell, sidebar, everything, at that page's address, with fake data. The page code runs unchanged.
   - `.runcastle/stories/feature-page/Review.stories.tsx` already proves this on one page.
   - For runcastle, `AppLocation` in `apps/web/src/lib/routes.ts` already lists every place the app can be.
2. **Component stories leave the map.** They stay where they work: the feature page's "UI states" section at review.
3. **The structure comes from the story names, written to match how you'd navigate the app,** e.g.:
   - `Onboarding/1 Welcome`, `Onboarding/2 Add a project`;
   - `Project chooser/Empty`, `Project chooser/Many projects`;
   - `Project/Session/Waiting for you`;
   - `Feature/Review/Findings open`.

   Numbers order a flow, so onboarding reads as a sequence of screens. Runcastle only reads names; the agent works out the structure from the app's navigation code. This keeps it language-agnostic. It supersedes map decision 10 and changes how groups are named (map decision 4).
4. **A mapping pass makes it comprehensive.** Agents walk the app's navigation and write a page story for every page and every state worth seeing.
   - Navigation here means the router or equivalent; for runcastle, that is `AppLocation` plus overlays such as Settings, ⌘K, onboarding and the draft form.
   - Runcastle is the first project, at roughly 40–80 stories.
   - It runs as ordinary rounds, with tickets split by area.
   - **The first ticket maps onboarding alone,** so the human checks the look and the naming before the rest is written.
5. **The rule that keeps the map complete:**
   - a ticket that adds or changes a page also updates that page's stories, and review checks it;
   - this reverses "never required" for **pages only**; component stories stay optional, by planning's judgement.
6. **Honest limits, accepted:**
   - **Live content shows canned content:** terminals with recorded text, a placeholder for the drive frame, no event stream. The project session screen will look right, but nothing in it runs.
   - **Faking data for whole pages is most of the work:** each page needs fixtures for every query it makes. Reuse `apps/web/test/fixtures` and the existing `fake-api.ts`.

## What this feature must decide in its own session

- **How a page story renders "the app at an address":** the whole `App` at an `AppLocation`, or the shell plus a body. Prefer the real app.
- **How the map draws pages:**
  - a group shows its screens large, in flow order, with its states;
  - framing many whole pages at once costs something, so consider loading frames lazily as they scroll into view.

  The human said the current per-component framing "doesn't look right".
- **What happens to today's 11 stories:** keep them as component stories for the feature page, out of the map, or rewrite them as page states.
- **How the page rule is carried:** in planning's tickets step and the review prompt. Also how review recognises "this diff changed a page": the agent's judgement from the diff, never a parser in runcastle.
- **How other projects get their mapping pass:** prepare's recipe, or the human asking from the map's empty state.

## What this feature must NOT swallow

- **The catalogue build, promotion and the feature page's UI states section.** They are shipped, and stay unchanged except for what this feature needs.
- **Scenarios and drives.** Map decision 8's doors into the drive stay.
- **Design mode** (draft). It will reuse page stories, but it owns its own dock.

## Binding

- **Charter:** starting the app is the expensive step (stories never start it); language-agnostic by construction; minimal docs, with stories as executable things that break loudly.
- **`features-show-their-ui-states-as-stories` decision 9:** data is faked at the edge, never by mocking modules. Decision 11: stories are internal machinery confined to `.runcastle/`.
- **`apps/web/DESIGN.md`.**
