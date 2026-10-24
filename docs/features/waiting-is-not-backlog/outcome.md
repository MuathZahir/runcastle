# Outcome — Waiting is not backlog

Separate "not now" (backlog) from "yes, as soon as X ships" (waiting): a waiting feature shows on its own in the sidebar and starts by itself when its last dependency ships, so nothing that was wanted gets forgotten in the backlog.

- Shipped: 2026-10-24
- Laps run: 1

## What shipped

13 commits · 40 files

### Lap 1
- 5 tickets landed: #1 The up-next mark: storage, rules and the human's switch; #2 A waiting feature starts by itself when its last dependency ships; #3 Agents can make a feature up next, and read the difference; #4 Sidebar: an Up next group and honest backlog chips; #5 Feature page: Start when ready, Move to backlog, and what a merge will start
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: df5104abfcf4fbbdd35c64f5cd2d29f2f71e4c75
- Landed since: 0
- Outcome: done

- **Project context's index legend still explains the retired `[draft, waiting]` mark, not up next / blocked / stuck** — fixed
- **Stuck feature's bar reads "Didn't start by itself. nothing left to wait on…" with a lowercase sentence start** — fixed
- **Drive pass: all six criteria hold in the running app** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 4. Sidebar: an Up next group and honest backlog chips

# Ticket 4 — Sidebar: an Up next group and honest backlog chips

**What was done.** `apps/web/src/lib/feature-ui/sidebar.ts` now classifies every draft with core's `unstartedState`. There is a new TriageKey, `upNext` ("Up next"), ordered after inProgress and before drafts. A `stuck` feature triages to `needsYou`, and `needsMe` gives it `{ kind: 'attention', label: upNextProblem ?? stuckReason(deps) }`. Every other draft still returns null from `needsMe`.

The row chips now read:
- Up next: `After <slug>` / `After N`.
- Backlog: `Blocked by <slug>` / `Blocked by N`, `Ready to start`, `In the backlog`.

The Backlog sorts ready-to-start first, then plain backlog, then blocked. `sortForSidebar` ranks needs-me, then active, then Up next, then the backlog, then shipped. `LANDING_LANES` is unchanged.

`dependencies.ts` gained `upNextHint(deps)`, the hover text: "starts by itself when x ships" (or "when these ship: a, b"), plus " — won't start until you start b" when `backlogDependencies` is non-empty. `isWaiting` got a `@deprecated` note and was not removed.

`Sidebar.tsx` renders an "Up next" `Shelf` (IconClock) before Backlog, open by default. To allow that I added a `defaultOpen` prop to `Shelf` in `SidebarParts.tsx`. Also in `SidebarParts.tsx`:
- A stuck draft's state words read "Won't start by itself". Before this it would have said "Run failed", because the stuck kind is 'attention'.
- A draft row's tooltip now includes the chip's hover sentence.

No new RowChipKind was needed. The row draws no chip colour per kind.

**Surprises.** `apps/web/test/fixtures.ts` `listItem` hard-coded `upNext: false` / `upNextProblem: null` and ignored overrides, so I fixed it to honour them. The stuck needs-me uses kind 'attention', so the row shows a red dot. That fits a failed auto-start, but it is louder than needed for "nothing left to wait on".

**Left undone.** The feature page / next-step bar (parallel ticket) still uses `isWaiting` and `waitingReason` ("Waits on …"). The `tickets-and-review-are-tools-not-phases` branch had not merged into my base, so I built against the current lanes. Drive machinery needed no changes: this is web-only, with no new service, env var or seed. Typecheck passed, and the full suite passed: 373 files, 5224 tests.

#### 5. Feature page: Start when ready, Move to backlog, and what a merge will start

# Ticket 5 — Feature page: Start when ready, Move to backlog, what a merge will start

**What was done.** `resolveDraft` (apps/web/src/lib/feature-ui/next-step/draft.ts) now branches on core's `unstartedState`:
- **blocked** keeps the disabled Start and Plan it yourself and adds **Start when ready** (`markUpNext`). Its caption ("starts by itself when <x> ships; it can't be undone") is both the button's hint and the bar's `note`, because the bar only shows captions under buttons that are disabled.
- **upNext** has the kicker `UP NEXT`, the title "Starts by itself when … ship(s)" or "Won't start until you start <b>" (from `backlogDependencies`), and **Move to backlog** (`moveToBacklog`).
- **stuck** is an alert bar titled "Didn't start by itself". Its description is `upNextProblem ?? stuckReason`. It has the usual Start and Plan it yourself, gated exactly as before, so an archived dependency still disables them with "archived — remove it to start". It also has Move to backlog.
- **readyToStart** and **backlog** are unchanged.

I added both new kinds to `ACTION_KINDS` and gave them icons (clock, inbox). Workspace dispatches them to `feature.setUpNext` and adds the mutation to the busy state. `BlocksLine` now renders two read-only lines, "Starts when this ships:" and "Blocks:". Each up-next dependent gets "(also waits on z)", looked up in the project feature list. Workspace now also fetches that list when the feature has an up-next dependent, not only for drafts. `BlocksLine` gained a `featureId` prop and an optional `features` prop.

**Deviation.** The ticket put the "don't preselect a base" rule at NextStepBar ~232. I put it in Workspace instead, because that is where the default base is computed (`effectiveDraftBase`). With no default the picker shows as unpicked and Start says "pick a branch first".

**Surprises.**
- The mixed-branches case is detected by matching the server's skipped-autostart text ("merged into different branches") in a new `upNextBasesDiffer`. No structured field reaches the web, so if the wording in `services/up-next.ts` changes, this check breaks without any error.
- The shared test fixture `listItem` ignored overrides of `upNext` and `upNextProblem`. I fixed that in apps/web/test/fixtures.ts.

**Left undone.** Nothing was needed in the sidebar, the server or the drive machinery: no new service, env var or seed. A structured `bases` field on `upNextProblem` would let the web drop the string match, but that is server work.
