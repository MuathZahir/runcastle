# Outcome — emit_tickets accepts large batches without timing out

Fix the ~10KB emit_tickets payload timeout so sessions emit fully-enriched tickets in one call, killing the placeholder-then-update_ticket pattern at the source.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

9 commits · 10 files

### Lap 1
- 3 tickets landed: #1 Reproduce the large-batch /mcp stall over real TCP and fix it, failing-first; #2 Countermand the placeholder pattern in the tickets skill and fatten the smoke batch; #4 Handler workaround is missing the required upstream-issue pointer
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 4acd4b7713584a054da7d5e19a38eb63acaf4d4f
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 8c4379d795bdb6b6b39030a05e39ebf097c47713
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Reproduce the large-batch /mcp stall over real TCP and fix it, failing-first

# Ticket 1 — large-batch `/mcp` repro and fix

## What was done

Built a real-socket test seam for `/mcp` and swept it hard for the reported
large-batch stall. Because vitest here runs under **node** (no `Bun` global — see
`test/helpers/db.ts`), the ticket's suggested in-test `Bun.serve` is impossible;
instead `packages/server/test/fixtures/mcp-tcp-server.ts` is a spawned **bun**
child that boots `buildApp(ctx)` on an ephemeral port with the production
`idleTimeout`, over a real `bun:sqlite` file, and prints its port + seeded ids.
The node-side test drives it over TCP. That pairing is arguably better than
in-process anyway: Claude Code's `type: "http"` MCP client *is* node/undici.

**The stall did not reproduce.** Sizes 1KB→654KB, `Content-Length` and chunked
transfer-encoding, raw-socket writes at 512B/1400B/64KB segments with inter-segment
gaps, `Expect: 100-continue`, concurrent SSE streams, a saturated server event
loop, and the real `@modelcontextprotocol/sdk` client — all returned 200 with every
ticket stored, in 12–60ms. The full sweep and the residual gap (the incident host
is Windows; this sandbox is linux) are recorded in the test's header comment.

So the fix took the locked decision's branch (b): a handler-level change in
`src/mcp/server.ts`. The handler used to await a db round trip and synchronously
assemble a whole `McpServer` *before* `@hono/mcp` got round to reading the body;
it now drains the body first and passes it via the documented
`handleRequest(ctx, parsedBody)`. Hono caches the body, so the transport's own read
comes from cache — no double read, and the 400/406/415 paths are unchanged
(verified over the wire). A body that never finishes arriving now logs
`[mcp] request body read failed after N declared bytes: …` instead of leaving
`@hono/mcp`'s json-response promise unsettled in silence.

Two tests: the 256KB guard (hard 5s `AbortSignal.timeout`, read back through
`listByFeature` for intact contexts and resolved `blockedBy`), and a truncated-body
test for the log line. Both were checked to fail when their subject is removed —
the 256KB one fails as `TimeoutError`, the log one fails *silently*, which is the
incident's exact signature. `resolveBun` moved to `test/helpers/bun.ts` (two tests
now spawn a bun child).

## Surprises

- **Vitest runs under node, not bun**, so nothing in `packages/server/test/` can
  touch `Bun.serve` or `bun:sqlite` directly. Any future test of a Bun-runtime
  behaviour needs the spawned-child shape used here (`dev-pane-stop-bun.test.ts`
  set the precedent).
- **`packages/server/tsconfig.json` has `include: ["src"]`** — test files are not
  typechecked by `bun run typecheck` at all. Type errors in tests only surface as
  runtime failures.
- **The stated baseline is stale.** The prompt says "118 files, 1768 passed"; the
  suite is actually 235 files / 3403 tests. And it is not fully green:
  `dev-pane.test.ts > kills the child process tree so the port-holder is not
  orphaned` fails. I confirmed in a scratch worktree at `0174687` (pre-work) that it
  fails identically there — a container process-group-reaping artefact, not mine.
  Everything else passed, including both new tests.
- `@hono/mcp` 0.3.2 exists but only adds `onsessiondisconnected`; nothing in it or
  the MCP SDK indicts large bodies, so no dependency bump was justifiable.
- The fixture's db uses DELETE journal mode, not production WAL — sql.js on the
  node side cannot read a `-wal` sidecar. Journal mode is orthogonal to the HTTP
  layer under test, but it is a deliberate deviation.

## Left undone

- **The skill countermand** (`packages/skills/packs/runcastle/skills/tickets/SKILL.md`:
  "emit the fully-enriched batch in one call, never placeholder-then-`update_ticket`")
  and the **fat ticket in `scripts/smoke.ts`** are in the feature spec but not in this
  ticket's acceptance criteria — left for whoever owns them.
- **The win32 gap is still open.** If the stall recurs on Windows, the next step is
  the same fixture run natively there; the log line added here is what will finally
  make a mid-body-read death visible.
- `Bun.serve` never answers `Expect: 100-continue`. A client that blocks waiting for
  the interim `100` would hang forever — a latent hazard I noticed while sweeping,
  not the reported bug, and not touched.

#### 2. Countermand the placeholder pattern in the tickets skill and fatten the smoke batch

# Ticket 2 — countermand the placeholder pattern; fatten the smoke batch

## What was done

Two small edits, exactly as specced, both committed on the ticket branch.

`packages/skills/packs/runcastle/skills/tickets/SKILL.md`: extended the existing
"emit the array; do NOT write ticket files" bullet in *3. Self-check, then emit*
with two sentences — emit the whole batch fully enriched in one call (large
payloads are supported now), and never emit placeholder contexts to enrich
afterwards, because a Burn landing mid-enrichment burns agents on the
placeholders. No restructuring; `revisit/SKILL.md` and `converge/SKILL.md` were
not touched, so `update_ticket` keeps its reconciliation uses.

`scripts/smoke.ts` step 6: the second ticket's `context` is now built
programmatically — an 83-char filler sentence repeated 1400 times behind the
original sentence, 116,279 chars (~114KB) — so the batch crosses `/mcp` as one
large call. Title, goal and acceptanceCriteria are unchanged, so the real burn
that follows still does trivial work. The existing assertions (stored === 2, two
ids, seq2 `blockedBy` → `[1]`) are intact, plus a new one that the fat context
came back char-for-char through the `trpc.feature.get` read-back that was
already there; the `record` line now names the context size.

Verified: `bun run typecheck` exit 0; the filler's size checked with a one-line
`bun -e` computation; the six skills-related server tests green. Full suite:
3398 passed, 1 failed — only `dev-pane.test.ts > kills the child process tree`,
which ticket 1 already confirmed fails identically at pre-work `0174687` (a
container process-group-reaping artefact). **The smoke script was not run
end-to-end** — it performs a real host claude burn — and the commit says so.

## Surprises

- The stated baseline in the prompt ("118 files, 1768 passed, fully green") is
  stale in two ways, as ticket 1 also found: the suite is 235 files / 3403
  tests, and `dev-pane.test.ts` fails in this container regardless of the diff.
- The fat context is not free downstream: it lands in the *burner prompt* of the
  smoke's second ticket, so the real cheap burn now carries ~29k tokens of
  filler. The ticket explicitly asked for exactly this shape (only the context
  balloons), so I kept it — but I sized the filler at the bottom of the
  requested 100–200KB band to keep that cost as small as the criterion allows.
- Nothing in the repo reads the skill packs' *content* under test — the
  skills-related tests only check copying and paths — so the skill edit is a
  pure content seam, verified by reading, exactly as the ticket said.

## Left undone

- Drive machinery (`.runcastle/drive-setup.ts` etc.) was deliberately not
  touched: this ticket adds no service, no boot-time env var, no seed and no
  extra process, so none of the standing triggers fire. I confirmed that by
  inspection of the diff rather than by running the scripts (the sandbox has no
  services).
- Stale operator/agent memory notes about the old ~10KB `emit_tickets`
  workaround live outside the repo (decision 4 flags them for deletion at ship
  time) — nothing here can reach them.
- The win32 gap ticket 1 recorded is still open; unchanged by this ticket.
