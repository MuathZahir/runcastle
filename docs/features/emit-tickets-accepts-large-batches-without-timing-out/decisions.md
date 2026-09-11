# Decisions — emit_tickets accepts large batches without timing out

## 1. One lap, spec the whole thing
**Decision:** Sure-and-small: the full scope (repro → root-cause → fix/workaround → regression test → skill update) is specced whole and expected to merge on lap 1. No map.
**Why:** The scope is a single transport bug with a well-fenced brief (gating, orphan-sweeping, and ticket-schema redesign are all explicitly out). The only uncertainty — root cause possibly being upstream in Bun or the Claude Code client — is an implementation finding, and a server-side workaround (e.g. pre-buffering the request body) exists either way, so a thin lap 1 buys nothing.

## 2. Acceptance bar: a 256KB batch in one call
**Decision:** The gate is a 256KB `emit_tickets` batch succeeding in one call, completing in seconds (well under the MCP client's tool timeout).
**Why:** Real fully-enriched batches top out around 30–40KB (8–12 tickets at 1–3KB each); 256KB gives ~10× headroom without chasing pathological sizes, and is large enough to trip any packet-boundary body-read stall. The latency bar is honest because `storeTickets` is a synchronous SQLite write — slowness at that size means the transport is still sick.

## 3. Repro first; fix at the indicted layer, in this repo
**Decision:** Reproduce the stall with a raw HTTP client at increasing payload sizes to pin the layer (Bun body handling vs `@hono/mcp` transport vs the Claude Code client), then fix there — preference order: (a) a dependency bump (Bun minimum / `@hono/mcp` / MCP SDK) when a fixed release exists and the repro confirms it, (b) otherwise a handler-level workaround (e.g. pre-reading the body before handing it to the transport), documented with a pointer to the upstream issue. "File upstream and wait" is never the deliverable.
**Why:** The root cause is genuinely unestablished (no in-process test has ever reproduced it — only real sessions over the wire), so guessing a fix wastes the lap. The 256KB gate must pass on the stack as shipped, which forces the fix into this repo regardless of where the bug truly lives.

## 4. Kill the placeholder pattern via skill guidance, not server policing
**Decision:** Add one explicit line to the tickets skill (`packages/skills/packs/runcastle/skills/tickets/SKILL.md`): emit the fully-enriched batch in one `emit_tickets` call; never emit placeholder contexts to enrich later via `update_ticket`. `update_ticket` stays untouched for its legitimate uses (revisit/converge reconciliation). No server-side rejection of placeholder-looking contexts. (Stale operator/agent memory notes about the 10KB workaround get deleted at ship time — outside the repo.)
**Why:** The skill never instructed the placeholder pattern — it is learned agent behavior working around the transport bug, so it needs an explicit countermand where ticket-writing behavior is defined. Heuristic server-side policing would false-positive on legitimately terse tickets and edges into the ticket-schema territory the brief fences off.

## 5. Regression test over a real socket, written failing-first
**Decision:** A real-socket regression test: boot `Bun.serve` on an ephemeral port with the real app (production wiring incl. `idleTimeout`), POST a ~256KB `emit_tickets` batch to `/mcp` over actual TCP with a hard client timeout of a few seconds, assert the tickets stored. The repro step writes it in failing form against the current stack before the fix lands; if the stall turns out to need the Claude Code client's exact framing, the test mimics it as closely as a plain HTTP client can and the residual gap is noted. Plus a belt-and-braces bump to `scripts/smoke.ts` (one fat ticket in the existing batch).
**Why:** Every existing test mounts the app in-process (`app.fetch`), bypassing the network layer where the bug almost certainly lives — which is exactly why no test has ever reproduced it. Failing-first proves the fix rather than making it coincidental.

## 6. No batch-size cap; visibility only where it is nearly free
**Decision:** No explicit `emit_tickets` batch-size limit or error for oversized batches. If the fix lands in our handler (the workaround path), include a server-side log line when an `/mcp` request fails mid-body-read; do not build dedicated stall-detection instrumentation as its own deliverable.
**Why:** A cap is speculative machinery for a size no real batch reaches, and a sound root-cause fix has no cliff at 256KB — that is just where testing stops. The silent-failure pain justifies a nearly-free log line, not new machinery the brief fences off.
