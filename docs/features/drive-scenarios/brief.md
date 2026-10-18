# Brief

## Why this feature exists

The human, 2026-10-17: a test drive "just lands where I have to create an account, add products, etc.. before I can even test what I wanted to test." Every drive starts from a blank app, and the human builds the situation the feature is about by hand. Review agents improvise the same setup on every drive. Runcastle's own `driveInstructions` spend a paragraph on "open the feature at the step your change touches… if the state doesn't exist, create it", which is a hand-written scenario.

This is the first feature of a larger direction settled in the project session (2026-10-17): **the app's structure is its observable behaviour (screens and calls), captured, never described.** Scenarios are its foundation. Reliable captures, round effects, the map and mobile captures are parked drafts that build on this one. The clickable prototype of the whole direction is the human's private artifact https://claude.ai/artifact/Cm8LdNz97tiZiweJ9qzoLf (UI not final; it shows the concepts).

## Settled in the project session

1. **A scenario is a command in the project's repo, plus a name and a group.**
   - It is real app code: it imports the app's own models and factories and lives in the app, e.g. `scenarios/checkout/expired-coupon.ts`.
   - When the data model changes, it breaks in the typecheck or on the next drive, never silently.
   - Shared fixtures ("a buyer", "3 products") are reused, so each new scenario is a few lines.
   - The group is a product name such as Checkout or Auth, taken from where the file sits. It is the only thing left of the earlier "areas" idea, which was rejected: code-glob areas, area docs and "work that touched X" answered no question the human asks.
2. **Runcastle only runs a command and reads what it prints.** This keeps it language-agnostic, with no per-language parsing anywhere.
   - The command runs inside the drive, with the `RUNCASTLE_*` identity and the drive's isolated database (the existing drive contract, see the `prepare` skill).
   - It writes back `ENTRY_URL=…`, and optionally a token, the same way `drive-setup` writes `drive.env`.
3. **Login is a drive-only route in the app,** such as `/__drive/login?token=…`. Runcastle cannot put cookies into the human's browser.
   - The route exists only when the drive environment is set, and never in production.
   - The scenario mints a one-time token and returns the entry URL through that route, so the human lands already signed in.
   - The agent writes this route into the app once, through `prepare` or the first New scenario chat.
4. **Entities are unique per run** (`buyer_7f3a`), so several scenarios can run in one drive without a reset. The existing database reset stays.
5. **Test drive gets a scenario picker,** in this order:
   1. the feature's own scenarios, the first of them selected by default;
   2. the other scenarios;
   3. Blank app.
   A project-level drive of `main` offers every scenario.
6. **Scenarios must be visible as a concept.** The human asked for this explicitly.
   - A **＋ New scenario** button in the drive opens a chat: "describe the state you want to land in". The agent writes the scenario, **runs it against the drive you are in**, and lands you there, proven on first use.
   - The first time the human picks Blank app, show one line: "Setting this up by hand every time? Make it a scenario."
7. **Features ship a scenario only when the agent judges the state hard to reach.** It is never required. A copy change or a settings toggle needs none.
8. **API scenarios:** a scenario plus one request. A Swagger-like **Try it** runs the request against the drive, already authenticated with the scenario's token. Only the calls scenarios exercise are listed, not every endpoint. In scope, but it may be a later lap if the web path fills lap 1.
9. **Review agents replay scenarios** instead of improvising setup, so their drive matches the human's.

## What this feature must decide in its own session

- **Where a scenario written during a feature's test drive lands.** It usually belongs on the feature branch, because it uses that feature's new models, but the drive has that branch checked out. During a drive of `main`, it lands like other project work.
- **How scenarios are discovered:** a convention directory, an entry in the project config, or both. Also how a scenario declares its group and display name.
- **How `prepare` adds the login route and base fixtures to an existing project,** and runcastle's own scenarios for dogfooding (runcastle drives runcastle-demo; see the project's drive instructions).
- **How review drives receive and use scenarios.**

## What this feature must NOT swallow

- **Captures, before/after comparison and determinism.** The parked draft "Reliable captures of screens and calls" owns them.
- **The map in the sidebar and the group and entry pages.** The draft "The map" owns them. This feature shows scenarios only where a drive starts.
- **Mobile deep links.** The draft "Mobile captures" owns them.
- **Drive slot rules.** ADR-0014 binds and is not reopened.

## Already settled elsewhere, still binding

- ADR-0014: one drive slot per project.
- The drive contract in the `prepare` skill: identity through `RUNCASTLE_*`, never derived from git.
- ADR-0009: a briefing rides the launch.
- Project direction: individual developers first. Runcastle's own code only does paths, git and text; anything needing code understanding goes to an agent.
