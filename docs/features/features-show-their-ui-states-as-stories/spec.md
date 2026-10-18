# Features show their UI states as stories

## Problem

The human wants to *see* what a feature built: the empty, error, loading and "coupon expired" states of the components it changed. Today the only way is a drive, which starts the app (minutes on projects with Docker services), takes the project's one drive slot, and still leaves many states hard to reach. A previous attempt captured screens instead (DOM snapshots, screenshots, masking, determinism gates). It was rejected as overengineered and sank on starting the app twice per round.

## Approach

### What the human sees

- **Once per project, in the prepare session,** the human is offered "show your components in runcastle". With their agreement, prepare installs two dev dependencies, writes runcastle's machinery under `.runcastle/`, builds once on their machine as proof, and commits. The word "Storybook" never appears in runcastle's UI (decision 11).
- **From then on, features ship stories.** Planning gives a ticket that builds a state worth seeing an acceptance criterion to ship its story, exactly as it does for scenarios.
- **At review, the feature page shows a "UI states" section** in the review page's work tier, right after the reviewer's evidence (decision 12). Each story the feature *changed* shows twice, side by side: as it was at the commit the feature branched from, and as it is now. A *new* story shows alone, marked new. Stories that only reach a changed file through other files are counted on one collapsed line ("37 more stories use changed code") and listed on request. Each frame has "open larger", which shows that one story full-size. There is no link to a full catalogue.
- **A failed build** replaces the section's content with "The UI states didn't build" and the build output. The reviewer treats it as a failed gate, so it comes back as a fix ticket (decision 4).
- **Nothing starts the app,** and the drive slot (ADR-0014) is never used.

### The contract: `.runcastle/stories.json`

This file is committed in the project (decision 3). It is tool-neutral, so Widgetbook can slot in later (decision 8). Its presence on a branch is what "this project has stories" means. Shape, from the ideation discussion:

```jsonc
// .runcastle/stories.json
{
  // Builds the static catalogue into {out}. For Storybook it must pass --stats-json,
  // so that {out}/index.json (every story: id, title, name, importPath) and
  // {out}/preview-stats.json (the import list) are written there.
  "build": "<pm-exec> storybook build -c .runcastle/storybook --stats-json -o {out}"
}
```

`{out}` is the only placeholder. Runcastle substitutes a path inside the sandbox workspace. A missing or unparsable file means "no stories", so the build is skipped and the section stays absent. A parsable file whose build fails is a failed build.

### The setup: a step of the prepare session (decision 14)

The prepare skill gains a **UI-states step** and one recipe file in its references. The step is offered for a project with a UI and a supported tool (React, Vue, Svelte, Angular, React Native: anything Storybook supports). It is never offered on a backend-only project, or a Flutter one (decision 8). The recipe, which the prepare skill reads and the `apps/web` ticket follows (decision 2):

1. **Reuse before installing.** If the project already uses Storybook, point `stories.json` at that setup and stop (decision 11).
2. Run Storybook's official setup, aimed at `.runcastle/storybook/` instead of the root `.storybook/`. Story files live in `.runcastle/stories/`, grouped by product name (e.g. `checkout/CouponField.stories.tsx`), which is the same pattern as `.runcastle/scenarios/`.
3. Wrap every story in the app's providers (theme, router, translations, signed-in user) in the config's preview.
4. **Fake data at the edge** (decision 9): intercept network calls with MSW, its worker file served from a static dir under `.runcastle/storybook/`, or seed the app's data cache. Never mock the app's own modules.
5. Ship **one page-level story** that loads data through that faking, and nothing more. Feature work writes the rest.
6. **Typecheck the stories** (decision 10) with a typecheck config under `.runcastle/storybook/` that covers `.runcastle/stories/`. On a prepared project, prepare proposes appending its command to `verifyCommands` and records it with the human's agreement. The project's own `tsconfig` is not touched.
7. Write `.runcastle/stories.json` with `--stats-json` (decision 7).
8. **Evidence:** run the build once on the host into a scratch directory, confirm `index.json` and `preview-stats.json` exist, and that the page story is listed.
9. Show the human the files, then commit.

The only files outside `.runcastle/` that it touches are the dev dependencies (Storybook, MSW) in the project's package manifest and lockfile. **Prepare's edit guard widens by exactly those two files** for a prepare session. The prepare brief's server-probed host facts gain one more: whether `.runcastle/stories.json` exists in the checkout. When it does not, "UI states" is on the agenda as an open item. It is not a settings key, much like the sandbox Dockerfile step. A project whose keys are all established still opens prepare for it, instead of the confirmation-only mode. In prepare's conversation the offer is phrased as showing the project's components in runcastle. It names only the dependencies it is about to install.

### Building the catalogue: beside the gates, every review pass (decision 4)

Every review pass already runs the branch gates in a burn-style sandbox at the branch tip, before the review agent starts. The catalogue build joins that step:

- **The feature's build:** in the gate sandbox at the same commit, after the verify commands, run `stories.json`'s `build` with `{out}` set to a directory inside the sandbox workspace. The directory is excluded from git the way burn worktrees are excluded, never via the project's `.gitignore`. It runs even when the project has no verify commands, and is skipped when the branch has no `stories.json`. Nothing copies files out of a sandbox today. The output directory is bind-mounted from the data dir into the sandbox (a host path directly for `noSandbox`), so the build writes straight to the host. That is how lap 1 built it.
- **The base build:** at the feature's branch point (the merge base of the feature tip and its recorded base branch). It only runs if `stories.json` exists at that commit and no cached build exists for it. It uses a second sandbox pinned at that commit, set up the same way. It is cached by commit (decision 6) and shared by every feature with that branch point.
- **The record:** a stories-build record is stored on the review ticket next to its gate record (decision 18: lap 2 adds the column and migration, numbered after main's latest). In outline: `none` (no `stories.json` on the branch), `built` (with commit, base commit and whether the base build exists), `failed` (with exit code and log), or `couldnt_run` (with reason and log). It has the same honest-failure shape as the gate run. The record is rendered into the review and verification prompts with the gate record. The prompts tell the reviewer that a failed UI-states build is a failed gate. A base-build failure is not a gate failure: the section shows changed stories without their "before", with one line saying the base didn't build.
- **Time limits** follow the gate commands' own.

### Matching the feature's stories (decision 7)

A pure function, in core and IO-free, takes:
- the feature's changed files (`git diff --name-only <branch point>...<tip>`, the three-dot form the scenarios listing already uses);
- the feature build's `index.json` and `preview-stats.json`;
- the base build's `index.json`, when present.

It builds the reverse import graph from the stats file. For each story entry, it finds the shortest distance from any changed file to the story's `importPath`:
- **distance 0** (the story file itself changed) or **1** (the story file imports a changed file directly): **changed**;
- **2 or more:** **also affected**;
- **unreachable:** not this feature's.

A changed or affected story whose id is absent from the base index is **new** instead. Story entries of type `docs` are ignored. The result is computed once, when the build is copied out, and written as runcastle's own manifest beside the build. It holds the commit, base commit, lap, review pass, status, log reference and the classified story list. Readers never re-parse the stats file.

### Keeping and serving (decisions 5 and 13)

- The data dir holds **one feature build per feature,** replaced on every pass by writing to a fresh directory and swapping it in. A failed pass replaces it too: the manifest records the failure and its log, and no stale build is shown (decision 5). The feature build is **deleted when the feature merges** or is deleted.
- **Base builds are kept by commit,** and swept at merge and delete time once no unmerged feature's manifest points at them.
- **A second listener on port 4514,** opened by the same server process (a new config port beside 4512 and 4513), serves only these directories. It is read-only and static, with the same traversal guard and MIME table as the web app's static mount. It has no API, no tRPC and no hooks. Frames use Storybook's single-story URL (`iframe.html?id=<storyId>&viewMode=story`) under the feature's or the base commit's directory. Because it is a different origin from runcastle, story code can't call runcastle's API.
- **A tRPC query returns the section model for a feature:** its manifest, with frame URLs built for the browser, or nothing. Since every pass emits an event, the section refreshes like the rest of the page.

### The section in `apps/web`

A new section component renders the section model:
- changed stories as base/feature frame pairs (or the feature frame alone, with "base didn't build" when the base build failed);
- new stories alone with a "New" badge;
- the collapsed "also affected" line and its list;
- the failure state with the log;
- an "open larger" overlay per story.

It sits in `ReviewBody`'s work tier after the evidence stage. Between reviews (planning and building after a review pass) it shows the last build, labelled "Built at the last review" with its commit. It never speaks of laps, which main retired for rounds. It's absent when the model is empty and after merge. Frames lazy-load and have a fixed default height, since the content is cross-origin and can't be auto-sized, and "open larger" is the escape hatch. Copy says "UI states" and "stories". It never says "Storybook" or "catalogue". It follows `apps/web/STYLE.md` and `DESIGN.md`.

### Planning (decision 11 and 14)

- `get_feature_context` gains a `stories` block, `{ setUp }`, true when `.runcastle/stories.json` exists on the feature's base branch. It mirrors the existing `scenarios` block.
- The tickets skill gains a **ship-a-story** block mirroring ship-a-scenario. When `setUp` is true, it asks of each ticket whether it builds a UI state worth seeing. If so, the criterion is "Ship `.runcastle/stories/<group>/<Component>.stories.<ext>` showing <state>, with data faked at the edge". Copy changes and settings toggles get none, a backend-only project is never asked, and a story is never required. When `setUp` is false and a feature's states are worth seeing, the closing message says once that Prepare can set up UI states. **Planning never cards a setup ticket.** The revisit skill defers to the same rule, as it does for scenarios.

### Runcastle's own dashboard (decision 2)

One ticket sets up `apps/web` by following the recipe above. It is a burn, so it cannot record settings. Instead it wires the stories typecheck into the repo's existing typecheck command, and the recipe says so: on other projects, prepare records it as a verify command. It ships stories for a handful of hard-to-reach dashboard states, for example a feature blocked on a gate, a burn with a failed ticket, and review with open findings. Those are mostly sections that already take their data as props, reusing the `apps/web` tests' sample data where it exists (decision 10). It also ships one page-level story that loads data through the edge faking, with the live event stream kept from connecting. `apps/web/STYLE.md` gains a short "Stories" section. The existing two test tiers are untouched, and no Storybook test addon is added.

### Lap 2: complete it, then drive it (decisions 15–19)

Lap 1 burned clean but was only ever checked in Gates mode. No story has been seen rendering, and the section can't appear on a real review page until the branch is published and reinstalled. Lap 2 completes everything that is left, and its review is a Drive:

- **Merge main first** (decision 16). Merge main into the feature branch and resolve the five conflicts (`RunBody.tsx`, `lib/live.ts`, `edit-guard.ts`, `routers/feature.ts`, revisit `SKILL.md`) in main's rounds vocabulary. Drop the `NothingVerifiedAlert` story's `lap` arg, and bring any other story whose component main changed in line. Re-run typecheck, the tests and the real stories build on the merged tree.
- **The stories port refuses Windows short names.** A private file requested by its 8.3 alias (`MANIFE~1.JSO`, `BASE-B~1.LOG`) is refused. The check compares the real long name that `realpathSync.native` resolves, and that resolver is injectable, so a Linux test can reproduce the bypass.
- **The record is stored** on the review ticket (decision 18).
- **Prompt tokens fill in one pass** (decision 19). A `{{TOKEN}}` inside an inlined digest stays literal.
- **A "Feature with UI states" scenario** (decision 17), under `.runcastle/scenarios/`.
  - The default variant seeds the driven runcastle (only its own `RUNCASTLE_DATA_DIR`) with this checkout registered as a project and a feature at review on the drive's branch. It then runs the real `runStoriesBuild` and the matcher on the host against this checkout, so the section shows the dashboard stories as New, framed from the drive's own stories port.
  - A comparison variant writes before/after pairs, the collapsed "also affected" line, and a failed build with its log, so the drive can see every state of the section.
  - It never cuts branches or worktrees in the developer's repo, and prints `ENTRY_URL`.

## Seams

- **Story matching** (new, core, pure): changed files plus `index.json` and `preview-stats.json` (plus the base index) in, classified story list out. This is the heart of the feature and is tested with fixture JSON: a story file changed, a direct import changed, a transitive import changed, an unrelated change, a story new against the base, docs entries ignored.
- **The review pass's gate step** (existing seam, `runReviewGates`'s neighbour): given a fake sandbox, as the gate runner is tested today, observe the stories-build record (`none` / `built` / `failed` / `couldnt_run`), the files copied out to the data dir, the base build reused when it is cached, and the manifest written. This is also where the record reaches the review prompt.
- **The data-dir lifecycle** (existing seams in merge and delete): the feature build is gone after merge or delete, and an orphaned base build is swept.
- **The stories port** (new HTTP seam): `GET` under 4514 serves a built file with the right MIME type, refuses traversal, and exposes nothing else (no `/api`).
- **The section model query** (new tRPC procedure in the existing router pattern): a feature's model, or nothing.
- **The section component** (new, tier-1 `renderToStaticMarkup` test): changed pairs, new alone, the collapsed count, the failure with its log, the base-didn't-build line, and absent when empty. Copy never contains "Storybook".
- **`get_feature_context`'s `stories` block** (existing MCP seam): `setUp` follows the base branch's `stories.json`.
- **The prepare session** (existing seams): the edit guard allows the manifest and lockfile for `prepare` only, and the prepare brief lists UI states as open when `stories.json` is absent, even with every key established.
- **Skill content** (`packages/skills`): the prepare UI-states step and its recipe, the tickets ship-a-story block, the review prompts' failed-build wording. Checked by reading, and by the `apps/web` ticket actually following the recipe.
- **The "Feature with UI states" scenario** (new, lap 2): run inside a drive, it leaves a manifest and build under the drive's data dir and prints `ENTRY_URL`. It refuses any data dir that isn't a drive's.
- **End to end, by Drive** (lap 2): the review drives the scenario's feature page and sees the stories render from the drive's stories port. After publish and reinstall, a real review pass of this feature builds `apps/web`'s catalogue, and its page shows the dashboard stories as new.

## Out of scope

- **Browsing every component, and main's catalogue:** *The map of stories and scenarios*.
- **Live editing beside the planning chat (`storybook dev`):** *Design mode*.
- **Widgetbook / Flutter:** the parked draft *Widgetbook stories for Flutter projects*.
- **Keeping builds after merge, or across rounds;** screenshots, pixel diffs, determinism checks.
- **Building during a burn, before review.**
- **Running stories as tests** (a Storybook test addon, a real browser in the test run).
- **A full-catalogue link,** or Storybook's own browsing UI anywhere in runcastle.
- **The review agent touring stories** as part of its evidence. It sees only the build's pass or fail.
- **Changes to drives and the scenario contract.** Lap 2 only adds scenarios under the existing contract.

## Open questions

- Settled in lap 1: Storybook 10.6.2 supports Vite 8 and React 19, and the copy-out is a bind mount.
- **The default frame height** and the "also affected" list cap are left to the UI ticket's judgement against `DESIGN.md`.
