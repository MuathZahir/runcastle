# Outcome — Home page loading gate hangs forever when the doctor query fails

Resilience bug observed alongside the 1.3.2 doctor ENOENT: when the setup-doctor tRPC query throws (500), the home page's loading gate waits on BOTH the project-list query and the doctor query, so it never leaves 'loading projects…' even though the project list resolved fine — and the browser refetches the failing doctor query in a tight loop. Find the home/portfolio page in apps/web that gates rendering on the doctor query alongside the project list. Fix two things: (1) the gate must not block the project list on a failed doctor query — render the projects and surface the doctor failure as a non-blocking banner/toast (the doctor is diagnostics, not a prerequisite for listing projects); (2) stop the tight refetch loop — give the doctor query sane retry/backoff (TanStack Query retry with backoff or retry: false plus manual re-run) instead of hammering a deterministically failing endpoint. Regression test at whatever tier fits apps/web component tests: with the doctor query rejecting, the project list still renders and the failure is shown non-blockingly.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

2 commits · 10 files

### Lap 1
- 1 tickets landed: #1 Resilience bug observed alongside the 1.3.2 doctor ENOENT: when the…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 0152df6d2f65d764609b7b9dedb1117067599d65
- Landed since: 0
- Outcome: done

- **The drive environment could not reproduce an actual setup-doctor failure** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Resilience bug observed alongside the 1.3.2 doctor ENOENT: when the…

# Digest — ticket 1: the home page's loading gate and the failing setup doctor

## What was done

The home/portfolio gate is `Shell.tsx` plus the hook behind it,
`apps/web/src/lib/use-project-nav.ts`, which observes two queries: `project.list`
and `setup.doctor`. Three changes there.

The landing rule no longer reads a *failed* doctor as evidence about the host. It
used to compute `setupComplete(doctor.data?.results ?? [])`, so a doctor that
threw came out as "not set up" and the shell landed on the first-run wizard — the
project list was fetched, resolved, and never shown. It now only consults a report
that actually arrived (`doctor.data ? setupComplete(...) : true`); a doctor that
failed leaves onboarding undecided and the app lands by the ordinary rule (URL,
then stored nav, then project count).

The doctor query got `retry: false` and `retryOnMount: false` at that call site.
The global default in `main.tsx` is already `retry: false`, so the automatic
re-firing that was left was `retryOnMount` — every remount of an observer
re-requesting an endpoint that fails deterministically. There is one manual re-run
instead, on the banner.

The failure is surfaced by a new `apps/web/src/components/SetupCheckBanner.tsx`,
rendered as a frame row next to `UpdateBanner` in `Shell.tsx` — same shape as that
banner, so it pushes content down rather than covering it. The hook exposes
`doctorError` and `recheckDoctor` on `ProjectNavApi` for it.

Regression test: `apps/web/test/doctor-failure.test.tsx`, tier 2 (happy-dom,
`@testing-library/react`) since it renders the whole `Shell`. With `setup.doctor`
returning an error it asserts the project cards render, "loading projects…" is
gone, the banner names the failure without being a dialog, that the query is given
`retry: false` / `retryOnMount: false`, and that "Re-run checks" is the only thing
that refetches. Verified red against the old landing rule (3 of 4 cases fail)
before restoring the fix.

## Surprises

- The headline symptom in the brief — the gate stuck on "loading projects…" — is
  not what the current code does on its own. `isLoading` in TanStack Query v5 goes
  false the moment a query settles, error included, and the global default is
  already `retry: false`, so a single failed doctor releases the gate. What it did
  instead was worse and quieter: it landed the user in the first-run wizard. A
  gate that genuinely hangs needs retries in flight (`isLoading` stays true across
  a retry sequence), which is exactly why the brief pairs "don't block" with
  "don't retry" — both are now true, so the hang is unreachable either way.
- `ProjectNavApi` is built as an object literal in five test files
  (`portfolio-home`, `chrome-bars`, `command-palette`, `command-palette-rows`,
  `project-switcher`), so adding two fields to the interface meant touching all
  five. Worth knowing before adding a sixth.
- `packages/server/test/dev-pane.test.ts` → "kills the child process tree so the
  port-holder is not orphaned" fails in this sandbox, deterministically (3/3
  targeted runs). It asserts a real process group is reaped after `stopDevPane`;
  it is unrelated to this diff, which touches only `apps/web`. Note also that the
  baseline quoted in the ticket ("118 files, 1768 passed") no longer matches the
  suite, which is 225 files / 3286 tests — the rest are green.

## Left undone

- `EnableAfkCard.tsx` and `first-run/FirstRunWizard.tsx` observe the same
  `setup.doctor` query with only `refetchOnWindowFocus: false`, so their retry
  policy still differs from the shell's. Making it one policy for the query rather
  than three per-observer opinions would be the tidier end state; it is outside
  this ticket and both of those surfaces already have their own Retry affordance.
- A doctor that fails with *no* projects open now lands on the plain
  open-a-project screen instead of the wizard. That is the ordinary rule doing its
  job and is walkable, but it is a behaviour change nobody has looked at on screen.
- Drive machinery: nothing to update. This ticket adds no service, no required env
  var, no seed and no extra process — it is three files under `apps/web`. I did not
  run `.runcastle/drive-setup.ts` (no services in this sandbox) and did not need to
  edit it.
