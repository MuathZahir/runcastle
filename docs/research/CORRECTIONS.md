# Corrections

Format-detail corrections where an implementation had to diverge from the prose
in `docs/SPEC.md` because a *pinned contract* (core zod/drizzle schema) or a
research note said otherwise. Per `CLAUDE.md`, the pinned contract / research
note wins; this file records why.

## C1 — ticket `blockedBy` resolves to global seq, not id (A1)

- **Where:** SPEC §3 — `storeTickets(featureId, TicketInput[]) [assign seq,
  resolve blockedBy seq→id]`.
- **Conflict:** the phrase "seq→id" implies storing resolved ticket **ids**
  (`string[]`), but the pinned core schema types `Ticket.blockedBy` (and the
  drizzle `tickets.blocked_by` column) as `number[]` — see
  `packages/core/src/schemas.ts` and `db-schema.ts`. The wire type is law.
- **Resolution (implemented in `packages/server/src/services/tickets.ts`):**
  `TicketInput.blockedBy` values are treated as **1-based positions within the
  emitted batch** (the only reference an emitter has, since `TicketInput` carries
  no seq field). `storeTickets` assigns each ticket a **global** `seq`
  (`max(existing seq) + 1`, then +1 per ticket in array order) and rewrites each
  `blockedBy` position to the referenced ticket's assigned **global seq**,
  stored as `number[]`. An out-of-range or self-referencing position throws
  `InvalidInputError`.
- **Impact:** the ticket-burner (B3) topo-sorts by `seq` using `blockedBy` as a
  list of global `seq` numbers — no id lookup needed.

## C2 — launcher/hooks/MCP format + wiring notes (B1)

- **Where:** SPEC §5.2 (settings hooks) + §5/§6 (hooks route + MCP server).
- **Settings hook timeouts:** SPEC §5.2 says "timeout 10" for every hook, but
  `CC-INTEGRATION-NOTES.md §2` documents that `UserPromptSubmit` blocks model
  processing and has a **30s** hard budget. Implemented (per B1's brief): the
  `UserPromptSubmit` hook uses **timeout 5**, `SessionStart`/`SessionEnd` use 10.
  `UserPromptSubmit`/`SessionEnd` carry **no `matcher`** (unsupported for those
  events per the notes); `SessionStart` matches `startup`.
- **`additionalContext` nesting:** both `session-start` and `user-prompt` hook
  responses nest `additionalContext` inside `hookSpecificOutput` (verified shape,
  CC-INTEGRATION-NOTES §3) — not top-level.
- **`mcp.json` headers:** the `runcastle` http server entry carries
  `headers: { "X-Runcastle-Session": "<sessionId>" }` — the verified http-type
  format supports `headers` (CC-INTEGRATION-NOTES §4), so this is the primary MCP
  session-identity mechanism (fallback = most-recent-live-session).
- **Sub-app context wiring (architecture note, not a spec conflict):**
  `index.ts#buildApp` (A1) mounts `hooksApp` (`/api/hooks`) and `mcpApp` (`/mcp`)
  as bare Hono apps with NO DI context (unlike tRPC's `createContext`). B1 owns
  neither `index.ts` nor a shared holder location, so `launcher/runtime.ts` holds
  the `AppCtx`: tests inject it via `setRuntimeCtx`; boot falls back to lazily
  opening a second WAL connection to `~/.runcastle/runcastle.db` (coherent across
  connections under WAL). A future integrator can collapse this to one handle by
  calling `setRuntimeCtx({ db, config })` inside `buildApp`.

## C3 — G3 is the human Burn gate; `complete_phase`/`advance` must not cross it

- **Where:** SPEC §4 (`feature.advance`), §6 (tools 2 + 4). The original prose had
  `complete_phase` run "the gate check server-side and advance… (same code path as
  `feature.advance`)". Applied literally, an ideation session's
  `complete_phase({ phase: 'tickets' })` advanced the feature straight into
  `implementation`.
- **Conflict:** `CONTEXT.md` decision #9 (the two-click covenant) makes G3 —
  `tickets → implementation` — a **human approval gate**: the human skims the
  ticket review card and clicks **Burn**. Only `feature.burn` (the Burn click) may
  cross G3. Letting `complete_phase` (an agent tool) or a plain `feature.advance`
  cross it violates the covenant and strands the feature past the gate with no run
  (`feature.burn` then rejects it, since it requires phase `tickets`). CONTEXT.md
  is the higher law; the SPEC prose is corrected to match.
- **Resolution:**
  - `services/features.ts#advance` throws a `GateError` when the gate to cross is
    G3 ("click Burn to approve and burn the tickets"). G3's precondition check
    (`tickets-approved`: ≥1 ticket) is unchanged, so the UI still shows G3 as
    *satisfiable* — it's simply crossed by Burn, not by Advance.
  - `mcp/server.ts#toolCompletePhase` short-circuits when `nextGate` is G3:
    it records `phase.complete_requested` + `tickets.awaiting_burn` and returns
    `{ ok: true, nextPhase: 'implementation', waitingOn: 'human burn' }` **without**
    advancing. All non-G3 gates keep the advance-on-satisfied behavior.
  - `overrideGate` is unchanged — it may still cross G3 explicitly (recorded
    reason), which is its purpose.
- **Also (one mutation → one event):** `emit_tickets` used to emit a `tickets.emitted`
  note *in addition to* `storeTickets`'s `tickets.stored`, double-logging one
  action. The tool's extra emit is dropped; `tickets.stored` is the single event.
