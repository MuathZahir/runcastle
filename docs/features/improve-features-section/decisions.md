# Decisions — Improve Features Section

This feature entered the pipeline as a quick change (one sentence, one ticket,
no grill session), so it had no docs until the revisit below. The original
intent: "the feature section could be a lot richer — currently it just shows
the title of the feature."

## Revisited 2026-08-02

The human brought a concrete reference (Conductor-style sidebar cards) plus two
new asks. Three decisions, locked in conversation:

### 1. Feature rows become two-line cards

The sidebar row (`FeatureRow` in `apps/web/src/components/Sidebar.tsx`) grows
from a single title line to a two-line card, modelled on the reference:

- **Line 1**: bold title, with a status chip on the right — amber "Needs you",
  spinner + "Working", green ✓ for shipped, and a relative last-activity stamp
  ("10m") when nothing more urgent claims the slot.
- **Line 2**: mono slug, ticket progress ("3/5 done" when tickets exist), and
  the existing six-segment mini pipeline map kept at the end of the line.

Almost all of this is free from the existing `feature.list` payload (slug,
phase, `ticketCounts`, `activeRun`). The one server addition: **`lastActivityAt`**
on each list item, derived from the feature's latest event timestamp — the
list has `createdAt` only, and the relative stamp is the most glanceable
"is anything happening" signal in the reference.

### 2. Only the Shipped lane is capped

A flat sidebar limit would fight the triage lanes — "Needs you" and
"Agent working" are exactly what the rail exists to surface and must never be
hidden. The Shipped lane is the only one that grows without bound (12 and
counting), so:

- Shipped shows the newest **5** rows; beyond that, a **"Show all (N)"**
  expander button reveals the rest (collapse again with "Show fewer").
- No sidebar search box. The command palette already filters features by
  slug/title (`CommandPalette.tsx`) — that is the find-by-name path.
- Archived stays behind its existing toggle, unchanged.

### 3. Feature states must be turn-aware (supersedes the documented gap)

The human reports the rail "constantly shows Needs You in the grilling phase
even if the agent is still working." Root cause is a documented known gap
(`apps/web/src/lib/feature-ui.ts` — `needsMe`): `feature.list` omits sessions,
so the grilling dot shows for ANY active ideation feature, live session or not.
This revisit supersedes that accepted limitation — the lanes are the product's
triage claim, and they are currently lying.

Decided fix, in two layers:

- **Live-session presence** on `feature.list`: each item carries the feature's
  live/launching session state, so a feature with a live session never sits in
  "Needs you" merely because of its phase.
- **Turn-awareness**: the server currently receives only `session-start`,
  `user-prompt`, and `session-end` hooks — it cannot distinguish "agent
  mid-turn" from "waiting for your answer". Register the **`Stop` hook**
  (launcher settings artifact + hook client + `/api/hooks` route) and track a
  per-session turn state: `user-prompt` ⇒ agent working, `Stop` ⇒ awaiting
  input. Then: live session + agent mid-turn → **Agent working** lane (spinner
  chip); live session + awaiting input → **Needs you** (that is the honest
  meaning of the lane). The row chip in decision 1 reads from the same state.
