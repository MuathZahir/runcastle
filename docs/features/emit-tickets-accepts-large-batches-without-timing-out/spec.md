# emit_tickets accepts large batches without timing out

## Problem

A tickets session that emits a fully-enriched batch — real contexts, goals, acceptance criteria — hits a silent stall whenever the `emit_tickets` payload passes roughly 10KB: the call hangs until the MCP client's tool timeout gives up, with nothing in the server logs. Sessions learned to work around it by emitting placeholder contexts ("Context follows via update_ticket.") and enriching each ticket afterwards, one `update_ticket` at a time. That workaround opened most of the burn race window in the drive-instructions incident: a Burn click between the placeholder emit and the last enrichment burns agents on placeholder contexts. The burn-readiness gating shipped separately and is needed regardless; this feature removes the transport root cause so the workaround has no reason to exist.

## Approach

Same tickets, one bigger call. The user-visible outcome: a tickets session emits its whole enriched batch in a single `emit_tickets` call and it completes in seconds; the placeholder-then-enrich pattern is explicitly countermanded in the tickets skill.

The work is repro-driven, because the root cause is genuinely unestablished — no in-process test has ever reproduced the stall; only real Claude Code sessions over the wire have. The tool handler itself is cheap (a synchronous SQLite store plus one event emit), so nothing application-side scales with payload size; the suspects are the network/transport layer: Bun's request-body handling under `Bun.serve`, the `@hono/mcp` Streamable-HTTP transport (stateless, JSON-response mode, fresh per request), or the Claude Code client's request framing.

1. **Reproduce.** Drive the real MCP endpoint over actual TCP (not in-process `app.fetch`) with a raw HTTP client at increasing payload sizes to find the stall threshold and pin the layer. If a plain client cannot trip it, mimic the Claude Code client's framing (chunking, headers, connection reuse) as closely as possible and note any residual gap.
2. **Fix at the indicted layer, in this repo.** Preference order: (a) a dependency bump — Bun minimum version, `@hono/mcp`, or MCP SDK — when a fixed release exists and the repro confirms it; (b) otherwise a handler-level workaround, e.g. pre-reading the request body before handing it to the transport, documented with a pointer to the upstream issue. "File upstream and wait" is never the deliverable: the acceptance bar must pass on the stack as shipped. If the fix lands in our handler, include a server-side log line when an MCP request fails mid-body-read — nearly free, and it ends the silence; no dedicated stall-detection instrumentation beyond that.
3. **Prove it.** The regression test from the repro step, written failing-first against the current stack, flips green with the fix (see Seams).
4. **Countermand the workaround.** One explicit line in the tickets skill: emit the fully-enriched batch in one `emit_tickets` call; never emit placeholder contexts to enrich later via `update_ticket`. `update_ticket` itself is untouched — it keeps its legitimate reconciliation uses.

Acceptance bar (decision 2): a 256KB `emit_tickets` batch succeeds in one call, completing in seconds — well under the MCP client's tool timeout. Real enriched batches top out around 30–40KB, so this is ~10× headroom, and large enough to trip any packet-boundary body-read stall. No batch-size cap or oversized-batch error is added: a sound fix has no cliff at 256KB — that is just where testing stops.

## Seams

- **`POST /mcp` over a real TCP socket** (existing seam, newly tested at this altitude): the Streamable-HTTP MCP endpoint of the production-wired server, booted on an ephemeral port with real listener settings (including the idle timeout). This is the seam the bug lives at and the primary regression seam: a ~256KB `emit_tickets` tool call sent over actual TCP with a hard client timeout of a few seconds must return the stored tickets. Written failing-first before the fix. Every existing MCP test mounts the app in-process and bypasses exactly the layer under test — those tests stay, but they cannot carry this feature.
- **The ticket store, read back through the existing feature query** (existing): after the large emit, the tickets are actually in the db with their full contexts intact and `blockedBy` resolved — proving the payload survived end-to-end, not just that the call returned.
- **The pipeline smoke script** (existing): the existing emit step carries one deliberately fat ticket, as a belt-and-braces layer over the full real burn path.
- **The tickets skill text** (existing content seam): carries the one-call instruction; verified by reading, no new test tier.

## Out of scope

- The burn-readiness gating (shipped separately in burn-waits-for-the-tickets-session-to-close-out) — untouched.
- Orphan-sweeping / retry machinery — untouched.
- Any ticket schema redesign — same tickets, one bigger call.
- `update_ticket` behavior — it keeps its legitimate uses (revisit/converge reconciliation).
- Server-side rejection of placeholder-looking contexts — heuristic policing, fenced off.
- An `emit_tickets` batch-size cap or oversized-batch error — speculative machinery.
- Dedicated stall-detection instrumentation — only the nearly-free mid-body-read log line, and only if the fix lands in our handler.

## Open questions

- Which layer the repro indicts — Bun, `@hono/mcp`, or the Claude Code client's framing — and therefore whether the fix is a dependency bump or a handler-level workaround. Deliberately left to the implementation: the preference order and the in-repo constraint are decided (decision 3); the branch taken is a finding.
- Whether a plain HTTP client can reproduce the stall at all. If only the Claude Code client's exact framing trips it, the regression test mimics that framing as closely as possible and the residual gap is recorded in the test.
