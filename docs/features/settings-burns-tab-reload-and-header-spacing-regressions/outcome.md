# Outcome — Settings Burns tab reload and header spacing regressions

Clicking the "Burns" tab in the settings panel triggers a full page navigation/reload instead of switching the tab, so the tab is unreachable. Likely an <a href> without preventDefault or a routing bug in the settings panel (apps/web/src/components/settings/). Fix it so the tab switches in place like the others; check the other settings tabs for the same pattern.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

8 commits · 12 files

### Lap 1
- 3 tickets landed: #1 Clicking the "Burns" tab in the settings panel triggers a full page…; #2 Feature header alignment regressions (apps/web feature header +…; #3 The Quick change / Park a draft dialog has uneven vertical rhythm: the…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: ce51040b5d4a114d5bd03e971964ec6b07938f09
- Landed since: 0
- Outcome: done

- **Shipped-state header could not be exercised in the isolated drive data** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Clicking the "Burns" tab in the settings panel triggers a full page…

# Ticket 1 — Settings "Burns" tab

## What was done

I went looking for the `<a href>` or the routing bug the ticket suspected, and
there is neither. The settings rail is four `<button type="button">` elements
over one `useState`; `apps/web` contains no `<form>` element at all, no
`window.location` write outside a copy-link helper and a `pathname` read, and no
`React.lazy`/dynamic import that could fail to load a chunk. I rendered the
dialog with a full doctor report and a burn-cache status and clicked Burns from
General: it switches in place and throws nothing.

What I *did* find on that page is the one control-level defect of the shape the
ticket describes — a control performing the browser's own default action instead
of only the app's. The shared `Button` primitive in `apps/web/src/ui.tsx` never
stated `type`, and HTML's missing-value default for `<button>` is **submit**. So
every `Button` in the app was a submit button, and the Burns page is where they
cluster: Build/Rebuild image, Run claude setup-token, Save & verify, Sign in,
Clear — five, all from `EnableAfkCard`. `Button` now defaults to
`type="button"`, and a caller that wants a submit still passes one.

Three guards, at three altitudes: the rail reaches every page from every other
in place (tier 2, `settings-dialog.test.tsx`); the Burns page leaves no control
to a browser default (tier 2, `settings-burns.test.tsx`); and the primitive
itself is a plain button (tier 1, `ui.test.ts`, beside the test that already
asserted an explicit `type` still wins). The middle one was verified red before
the fix — it reported `Rebuild image`, `Run claude setup-token`, `Save & verify`.
`STYLE.md`'s `Button` catalogue row now states the default.

## Surprises

**I could not reproduce a full page reload, and I do not believe this fix fully
explains one.** A `type="submit"` button with no form owner does nothing on
activation, and there is no form in this app — so the untyped buttons are a real
latent defect but not, on their own, a navigation. Whoever picks this up should
know what I ruled out so they do not re-walk it: no anchors or forms in the
settings tree (asserted by walking the rendered DOM); no `location`
assignment anywhere in `apps/web`; no render or effect crash on Burns with real
data; `resyncAll` in `lib/live.ts` only *invalidates*, never removes, so no query
returns to `pending`; and `isLoading` in query-core 5.101.2 is
`isPending && isFetching`, so `EnableAfkCard`'s refetch-on-mount of `setup.doctor`
cannot re-trigger `Shell`'s `nav.loading` gate.

The two mechanisms I could not rule out are both outside `apps/web` and outside
this ticket, and both would look exactly like a reload:

- `Shell.tsx:31` blanks the **entire app** to "loading projects…" whenever
  `nav.loading || nav.projects === undefined`, unmounting `ProjectShell` and
  every dialog with it. It needs `project.list` or `setup.doctor` to return to
  `pending`, which I could not make happen — but it is a very large blast radius
  for a gate that is only meant to cover the first load.
- `scripts/dev.ts` tears down **Vite as well** when the server child exits, and
  Burns is the only settings page that calls `setup.doctor` and
  `system.burnCache.status`, both of which shell out to Docker. A server crash
  there would take the web dev server with it, and Vite's HMR client reloads the
  page when the dev server comes back.

Also worth knowing: the pre-existing-failure baseline in the burn prompt is
stale. It says 118 files / 1768 tests; this repo runs **224 files / 3274 tests**.

## Left undone

`packages/server/test/dev-pane.test.ts` > "kills the child process tree so the
port-holder is not orphaned" fails in this sandbox, before and after my change —
it asserts a process group is reaped after a kill, which is container-dependent.
My diff touches zero server files (`apps/web` only), so it cannot be mine. Every
other test passes: 3269 passed, 1 failed, 4 skipped. `bun run typecheck` is clean.

Not done, deliberately: the two mechanisms above. Narrowing `Shell`'s loading
gate so a settled app cannot blank itself is the one I would look at first if the
reload is reported again — but it is a change to the app root, not to the
settings panel, and this ticket did not ask for it.

Drive machinery: nothing to update. This change adds no service, no required env
var, no seed and no process — it is one attribute on a React primitive plus
tests. I checked that both scripts the drive commands name (`.runcastle/drive-setup.ts`,
`.runcastle/drive-stop.ts`) are present; I did not run them, since this sandbox
has no app or services to run them against.

#### 3. The Quick change / Park a draft dialog has uneven vertical rhythm: the…

# Ticket 3 — quick overlay vertical rhythm

## What was done

The Quick change / Park a draft card is two components — `apps/web/src/components/quick/QuickChangeMode.tsx` and `ParkDraftMode.tsx` — that share the same three-part shape (intro, field stack, footer under a divider). Both had the same two spacing faults and both got the same fix.

The field stack opened on `mt-6` (24px) but repeated `gap-4` (16px) between its fields, so the Title label sat visibly further from the intro paragraph than any later field sat from the one above it; the stack now opens on `mt-4`, the same step it repeats. The footer took `mt-6` above its divider but only `pt-4` below, so the branch line and the Cancel/Create buttons crowded the rule they hang from; it is now `pt-6`, equal room either side. Both values are Tailwind's default 4px scale, which is the theme scale STYLE.md pins (there are no custom spacing tokens, and adding one needs a decision).

Four new tests went into the existing `apps/web/test/quick-form.test.tsx`, two per mode. They read the spacing *steps* off the class lists and compare them to each other — `mt` against `gap` on the field stack, `pt` against `mt` on the footer — rather than asserting the literal 4 and 6. "Even" is a relation, so that is what is pinned; a future retune of the card can change both numbers without touching the tests, while reintroducing either gap reopens the regression.

## Surprises

- The verify baseline in the brief is stale in two ways. The counts are wrong (it says 118 files / 1768 tests; the suite is now 224 files / 3275 tests), and it promises fully green — but `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned` fails, asserting that a killed process group is gone when `kill -0 -pgid` still finds it. I confirmed it on a single targeted run of that one file: it fails there identically, with nothing of mine in the tree it touches. It looks like a container fault (no subreaper to reap the group), not a code fault. Everything else is green and `bun run typecheck` is 0 errors.
- `FormOverlay` has exactly one consumer, `QuickForm`, so the two mode components really are the only surface this ticket reaches — no other dialog inherits the rhythm and no other dialog was affected.
- Nothing here needed the drive machinery: the change adds no service, no required env var, no seed and no process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched and were not run (correctly — this sandbox has no app to boot).

## Left undone

The two mode components duplicate their whole frame, not just these numbers: the `mt-2 flex flex-col gap-2` intro block, the field stack and the footer row are written out twice, so any future change to the card's shape has to be made in both files and can silently drift. Extracting that frame — a small `QuickCard`-style wrapper taking heading, blurb, fields and footer — would be a real cleanup, but it is a restructure this ticket did not ask for, so I left it. I also left the intro block's own `mt-2` under the tab strip alone; the human did not flag it, and at 8px it is tight but reads as a deliberate pairing of the heading with its tabs.
