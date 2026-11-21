# Setting scenarios up

Read this when your feature has a slow-to-reach state and
`get_feature_context`'s `scenarios.setUp` is false. You set the project's
scenarios up once, the same way the human's ＋ New scenario chat does, so every
later drive of this project starts at a state instead of redoing signup.

Check the base branch right before you start: another feature may have merged
a setup since you planned. If `.runcastle/scenarios/` is there, reuse it.

## In order

1. **Login route, only if the app has sign-in.** Being signed in lives partly in
   the browser, which a scenario cannot write. So the app carries one drive-only
   route, e.g. `/__drive/login?token=…&to=…`: present only when a `RUNCASTLE_*`
   variable is set and never in production; it checks a one-time token the
   scenario minted, signs in through the app's own sign-in code, and redirects
   to `to`.
2. **Typecheck.** Make the project's typecheck (or equivalent) cover
   `.runcastle/scenarios/`; dot-folders are often excluded. A scenario must
   break loudly when the app changes.
3. **The fixtures ladder** under `.runcastle/scenarios/_fixtures/`. Each rung is
   a function that calls the rung below and adds one step: `signedUpUser()` →
   `onboardedUser()` → `userWithPlan()`. Each returns what the next needs (ids,
   the one-time login token). When the app authenticates its API with tokens,
   a rung mints one so API scenarios can print `TOKEN=`.
4. **The runner.** Record the command that runs one scenario file with
   `set_scenario_runner({ command })`; it contains `{file}` (`bun {file}`,
   `bin/rails runner {file}`).
5. **The base scenario**, kept for good: a freshly signed-up user who finished
   onboarding, landing on the app's first real screen (e.g.
   `accounts/new-user-onboarded.ts`). A few lines over the onboarded rung.
6. **This feature's own scenarios**, each a few lines over the deepest rung it
   needs.

Commit, then prove each on `feature_drive` as `./feature-file.md` says.

## Keeping it fixable

- A scenario calls the deepest rung it needs, adds only its own bit and prints
  `ENTRY_URL=`. When signup or a migration changes, one rung is fixed and every
  scenario above it works again.
- A state later scenarios will share becomes a new rung, never setup code
  copied between scenarios.
- A scenario built from a copy of drive data stays off the ladder; it leaves
  with the feature anyway.

## The contract

- A file at `.runcastle/scenarios/<group>/<name>.<ext>`: the folder is the
  group, the file name the display name. Files and folders starting with `_`
  are shared code, never listed.
- Real app code: it imports the app's own models and factories.
- Every run gets a fresh `RUNCASTLE_SCENARIO_RUN`; make every entity unique with
  it (`buyer_<run>`), never reset the database. It reaches the drive's database
  only through the values `drive.env` carries.
- It prints `ENTRY_URL=<url>` (last wins; relative resolves against the app
  URL) and may print `TOKEN=<value>`. Exit 0 with an `ENTRY_URL` within two
  minutes is success.
- An API call is a sibling `.http` file (`METHOD path`, headers, blank line,
  body), with `{{token}}` and `{{run}}` filled in.
