# Outcome — Burn page rebuild button stuck at "resolving" after image clear

EnableAfkCard image row: render a refused imageBuildTarget's `reason` (like the custom probe row's fix text at EnableAfkCard.tsx:493) instead of mapping it to undefined at line 463; distinguish query loading from query error, so the button never shows 'resolving Dockerfile → resolving tag' for a settled answer. Component tests for refused/loading/error states.

- Shipped: 2026-09-19
- Laps run: 1

## What shipped

11 commits · 9 files

### Lap 1
- 3 tickets landed: #1 EnableAfkCard image row: render a refused imageBuildTarget's `reason`…; #2 Keep setup.imageBuildTarget in agreement with the doctor probe:…; #4 Quick changes are born with their tickets marked ready
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 3b834a587997b98a8e222f48f4c5cfb5fd128195
- Landed since: 0
- Outcome: done

- **Quick-change readiness stamp was not directly observable in this walkthrough** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. EnableAfkCard image row: render a refused imageBuildTarget's `reason`…

# Ticket 1 — EnableAfkCard image row

## What was done

`ImageBuildAction` no longer takes an optional `{dockerfile, tag}` that a refused
target was flattened into. It takes `ImageTargetState`, an exported discriminated
union with four cases — `loading`, `error`, `refused`, `ready` — and a private
`imageTargetState(query)` in `EnableAfkCard.tsx` maps the `setup.imageBuildTarget`
query onto it (data wins, then `error`, then loading). A refusal renders its
`reason` in place of the button, styled exactly like the custom-probe row's fix
text; a failed query renders a plain disabled `Rebuild image` plus the error
message in warn text; only a query still out reads `Rebuild image · resolving…`.
For the armed label I dropped the Dockerfile path entirely rather than taking its
basename — the basename is `Dockerfile` for both the stock and the project image,
so it carries no information; the label is now `Rebuild image · <tag>` and the
full path stays in the `title` tooltip, which was already carrying it. Tests:
three new tier-1 `ImageBuildAction` cases (refused / loading / error), one for the
label-vs-tooltip split, and two tier-2 card-level cases that drive the refused and
errored states through the real `ImageRow` wiring — that wiring line was where the
bug actually lived, so it is worth a test of its own. The existing test mock for
`imageBuildTarget` became settable (`server.imageTarget` / `server.imageTargetError`).

## Surprises

- The refused branch has to sit *after* the `probe.status === 'custom'` early
  return, not merge with it: the two answers are resolved separately on the server,
  and the reported bug is precisely the state where the probe does not say `custom`
  while the target still refuses. Ticket 2 is about closing that gap.
- The prompt's baseline figures are stale — the suite is 262 files / 3819 tests
  here, not 118 / 1768.
- One pre-existing failure, not mine: `packages/server/test/dev-pane.test.ts >
  "kills the child process tree so the port-holder is not orphaned"` asserts a
  process group is gone after the kill. It fails identically when run alone, and my
  diff is two `apps/web` files, so it is the container's process reaping rather
  than this change. Everything else is green; `bun run typecheck` is clean.
- Drive machinery needed no edit: this change adds no service, env var, seed or
  process. I did not run `.runcastle/drive-setup.ts` (no services in the sandbox)
  and did not need to read it, since nothing in the diff touches boot.

## Left undone

- `apps/web/test/settings-burns.test.tsx` and `first-run-wizard.test.tsx` still stub
  `imageBuildTarget` as a bare `{data: undefined}` / `query(() => undefined)`, which
  now means "loading" to the card. That is correct for what those files assert, so I
  left them alone.
- The refetch/invalidation half of the reported bug — a cleared `sandboxImage` not
  re-arming the button without a reload — is ticket 2 and untouched here.

#### 2. Keep setup.imageBuildTarget in agreement with the doctor probe:…

# Ticket 2 — keep `setup.imageBuildTarget` in agreement with the doctor probe

## What was done

The only production change is one line in `apps/web/src/lib/live.ts`:
`setup.imageBuildTarget` joined the live-resync allowlist, so every event
signal re-resolves the image a Build/Rebuild click would build. That covers both
triggers the ticket names at once — the machine-wide `sandboxImage` clear
(`clearGlobal` in `services/settings.ts`) and the doctor's decision-8 heal of an
orphaned project column — because the SSE signal carries no event type, so
`resyncAll` fires on any event and the allowlist is the only decision to make.
`setup.doctor` deliberately stays off that list (it shells out to probe the
machine); `imageBuildTarget` reads a project row and one `existsSync`, so it
belongs on it.

Two tests. `apps/web/test/live-resync.test.tsx` drives `useLiveSync` with a
stubbed `EventSource` and a recording `trpc.useUtils` proxy, and asserts one
event frame invalidates `setup.imageBuildTarget` (and nothing under
`setup.doctor`). It was verified red against `HEAD`'s `live.ts` before the fix.
`packages/server/test/image-target-heal.test.ts` walks the server chain through
the real router: an orphaned column makes `setup.imageBuildTarget` answer
`refused`, one `setup.doctor` heals the column and emits `settings.updated`, and
the next read is `kind: 'stock'`.

## Surprises

- **The heal already emits its event.** `clearStored` is wired to
  `releaseProjectImage` (`services/project-image.ts:52`), which emits a
  project-scoped `settings.updated` and therefore already reaches the SSE bus.
  So the ticket's "make the heal emit an event if it does not already" needed no
  code — the missing half was entirely on the web side. The new server test is a
  guard over that wiring rather than a change to it.
- **Constructing a non-vacuous heal scenario took care.** When the stored column
  is this project's own tag (`sandcastle:runcastle-<id>`), `imageBuildTarget`
  returns `stock` both before and after the heal, so the criterion's assertion
  would pass for free. The orphan that actually changes the answer is a column
  naming a *managed-prefix tag that is not this project's* — which is exactly
  what an older runcastle wrote, tagging by project NAME. The test seeds that,
  and asserts the pre-heal `refused` so the transition is real.
- **The heal needs a container runtime.** `sandcastleImageProbe` returns early
  when `presentRuntime` finds none, before it ever looks at the column, so the
  server test has to mock `node:child_process` (every `--version` answers 0) —
  otherwise it would pass or fail depending on whether the machine has Docker.
- **The suite is much bigger than the prompt's baseline claims.** `bun run test`
  runs 264 files / 3816 tests here, not 118 / 1768.
- **One pre-existing failure, not mine.** `packages/server/test/dev-pane.test.ts
  > "kills the child process tree so the port-holder is not orphaned"` fails both
  in the full suite and on a targeted single-file run. It asserts a PTY's process
  group is reaped within 400ms; this container has no init reaper, so it is
  environmental. My whole diff is `live.ts` plus two new test files
  (`git diff --stat 9f269155..HEAD`), none of which dev-pane imports.
  `bun run typecheck` is green.

## Left undone

- **No polling fallback for the target query.** `trpc.setup.imageBuildTarget`
  has no `refetchInterval`, so with the stream down the card still waits for a
  window focus or a remount. Every other interval-less query (`docs.*`, the
  session-branch picker) is in the same position, so this was not singled out.
- **Ticket 1's territory untouched.** `EnableAfkCard.tsx:463` still maps a
  `refused` target to `undefined`, which is what renders "resolving Dockerfile →
  resolving tag" for a settled answer. That is ticket 1's fix; this ticket only
  makes sure the query behind it is fresh.
- **`setup.ts` builds the same `BuildableProject` literal three times** (the
  `imageBuildTarget` route, `buildImageTerminal`, and — in a near-identical
  shape — `projectImageEnv`). Extracting it would be a tidy refactor; it is not
  this ticket's.
- **Drive machinery: no edit needed, and checked rather than run.** The change
  adds no service, no required env var, no seed and no extra process, so none of
  the `.runcastle/` hooks' triggers fire. I did not run `drive-setup`/
  `drive-stop` (no services in this sandbox) and did not need to parse them.
