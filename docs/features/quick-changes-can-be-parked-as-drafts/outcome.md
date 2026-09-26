# Outcome — Quick changes can be parked as drafts

`create_feature({ title, tickets, draft: true })` silently ignores `draft`. The quick change is started: branch cut, phase planning, ready to Burn. It should be parked. Cause: in packages/server/src/mcp/server.ts (the create_feature handler, ~line 1596), the `tickets` path calls `quickChange(ctx, { projectId, title, tickets, baseBranch })` and never passes `draft`; only the ordinary `createFeature` path honours it. With no baseBranch (correct for a draft), the branch is then cut from whatever the checkout happens to be on. The tool description and the project skill both say every shape can be parked, so the project session had no way to know. Seen 2026-09-25: 'Skeletons for every loading state' was created with tickets + draft: true to wait for another batch to merge, and came out started. Expected: `tickets` + `draft: true` creates a parked draft (status draft, no branch cut, nothing written to the repo) that keeps its ticket proses, including the review ticket every quick change appends. When the human clicks Start, it cuts from the base they pick and lands in the same ready-to-Burn state a started quick change has today, with those tickets. Pipe `draft` through `quickChange` in services/features.ts rather than special-casing the MCP handler, so the overlay door could offer the same option later. If storing tickets on a branchless draft really can't be done cleanly, the fallback is to reject `tickets` + `draft` with a clear InvalidInputError; never ignore it silently. Say in your digest which you did and why. Add tests in packages/server/test/quick-change.test.ts for: draft quick change created parked with its tickets; Start cuts the branch and carries the tickets; non-draft quick change unchanged.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

7 commits · 8 files

### Lap 1
- 3 tickets landed: #1 `create_feature({ title, tickets, draft: true })` silently ignores…; #3 Starting a parked quick change also opens a chat session, which a live quick change never does; #4 Standards: `createFeature` and `quickChange` each keep a copy of the park-or-cut logic, so the next door that learns `draft` means editing both
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: b3ff675dd76e5a64e3707cc30dfcd39c035f146d
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: bba5d87e7578e49d83623f897b5c3efab6d1aed0
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Starting a parked quick change also opens a chat session, which a live quick change never does

## What was done
Start no longer opens a chat session for a parked quick change. `feature.start` returns the started Feature, and `Workspace.tsx`'s onSuccess now launches the grill chat only when `startOpensChat(res)` is true. That is a new pure helper in `apps/web/src/lib/feature-ui/creation.ts`, true when `ticketsReadyLap === null`. The quick-change service stamps `ticketsReadyLap: 1` at birth whether parked or not, so a started parked quick change lands with no session: the same ready-to-Burn state as a quick change started directly. Ordinary drafts keep the chat chain. Unit tests for both cases are in `apps/web/test/feature-ui.test.ts`.

## Repro
I could not re-run the repro literally. There is no app or browser in this sandbox, so I could not click Start in the web app. What I checked instead: the server path (`quickChange` with `draft: true` inserts `ticketsReadyLap: 1`, and `startDraft` returns that row) feeds the predicate, which is tested for both the draft quick-change and ordinary-draft cases. Typecheck is clean.

## Surprises
- The full suite had 2 failures outside this web-only diff. `settings-dialog.test.tsx` timed out at 5s under full-suite load and passes on its own (18/18). `packages/server/test/dev-pane.test.ts` "kills the child process tree" fails even on its own; it looks like the sandbox's process-group handling, and nothing here touches server code.

## Left undone
- The draft next-step text (`apps/web/src/lib/feature-ui/next-step/draft.ts`) still says Start "opens the ideation session" even for a parked quick change. The review flagged it too. It is copy, not behaviour, and outside this ticket's acceptance criterion.
- Drive machinery: no new service, env var, seed or process was added, so no edit was needed and none was checked.
