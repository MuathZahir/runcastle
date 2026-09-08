# Outcome — Dead "Continue to review" button — the advance action kind is never dispatched

Wire the 'advance' ActionKind in apps/web/src/components/Workspace.tsx. The next-step bar offers 'Continue to review' with kind: 'advance' (apps/web/src/lib/feature-ui/next-step/implementation.ts:95, the terminal-partial-completion exit, decision 11b) and types.ts:7 documents it as feature.advance — but the runAction switch (Workspace.tsx:504-601) has no case 'advance', so the click falls through and does nothing. The server mutation exists: feature.advance in packages/server/src/trpc/routers/feature.ts:160. Add the case, calling a trpc.feature.advance.useMutation wired like the other mutations there (invalidate on success, toast on error). Then add a regression test at whatever tier fits apps/web component tests asserting the dispatcher covers every ActionKind the next-step resolvers can emit — e.g. exhaustiveness via the ActionKind union (a switch with a never-typed default, or a test enumerating the union against the handled cases) — so the next added kind cannot silently die the same way.

- Shipped: 2026-09-08
- Laps run: 1

## What shipped

3 commits · 4 files

### Lap 1
- 1 tickets landed: #1 Wire the 'advance' ActionKind in apps/web/src/components/Workspace.tsx.…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: f8cb4be3658a291051ef9ec75cad0290a01cfba7
- Landed since: 0
- Outcome: done

- **The managed drive has no feature run to exercise Continue to review** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Wire the 'advance' ActionKind in apps/web/src/components/Workspace.tsx.…

# Ticket 1 — the 'advance' action kind is dispatched

## What was done

`Workspace.tsx` now holds a `trpc.feature.advance.useMutation` and a
`case 'advance'` in `runAction`, so the next-step bar's "Continue to review"
(the terminal-partial-completion exit, decision 11b) actually calls
`feature.advance`. The mutation is wired like the other phase-crossing ones in
that component: `invalidate()` plus `onViewPhase(null)` on success, toast on
error, and `advance.isPending` folded into the bar's `busy`. The view snap is
one step beyond the ticket's literal "invalidate on success" — advance moves
implementation → review, and without it a human who had clicked the
implementation step is left pinned on a read-only view of the phase they just
left, which is exactly why `burn`, `converge` and `rethink` all do it.

For the regression guard I did both things the ticket offered as alternatives.
The switch got `default: kind satisfies never`, so an unhandled kind is a
typecheck error that names the kind. And because deleting that one line is a
green diff, `ActionKind` now derives from a new `ACTION_KINDS` const list in
`next-step/types.ts` (same per-member comments, one per array entry), and
`apps/web/test/next-step-dispatch.test.ts` reads that list against the `case`
labels it scrapes out of the `runAction` switch. I verified both guards go red:
removing the case fails typecheck with `Type '"advance"' does not satisfy the
expected type 'never'`, and renaming it fails the test with
`expected [ 'advance' ] to deeply equal []`.

## Surprises

- **The prompt's baseline numbers are stale.** It promised 118 files / 1768
  tests; the suite is 233 files / 3369 tests here.
- **One test fails on this branch and it is not mine.**
  `packages/server/test/dev-pane.test.ts:183` ("the process group must be gone")
  fails both in the full run and on its own targeted run. My diff is three
  `apps/web` files and touches no server code at all — `git diff --stat` against
  the pre-change commit confirms it. It asserts a spawned process group has been
  reaped, which is sandbox process-namespace behaviour. Everything else is green:
  3364 passed, 4 skipped. `bun run typecheck` is clean.
- The test tier question answered itself: nothing in `apps/web/test/` renders
  `Workspace` (it would need a trpc mock the size of the component), so the
  dispatcher is only reachable as source. `test/styles-ratchet.test.ts` is the
  in-repo precedent for a test that reads a source file, so this is tier 1, a
  plain `.ts`, no DOM.

## Left undone

- The scrape is scoped to the slice between `const runAction` and
  `const runMerge` because the phase-body switch lower in the file has `case`
  labels of its own. If someone rewrites the dispatcher as a
  `Record<ActionKind, () => void>` — which would be a genuinely nicer shape and
  exhaustive for free — that test needs rewriting with it. I did not do the
  refactor; it is well beyond this ticket.
- `CommandPalette.tsx` declares a local, unrelated `ActionKind` of its own
  (`'home' | 'openProject' | …`). Two types with one name in the same app is a
  naming collision waiting to confuse someone, but nothing about it is broken.
- Drive machinery: nothing to update. This ticket adds no service, no required
  env var, no seed and no extra process — the only triggers the standing
  instruction lists. I confirmed `.runcastle/drive-setup.ts` and
  `.runcastle/drive-stop.ts` are both present and untouched; I did not run them
  (no services in this sandbox, as instructed).
