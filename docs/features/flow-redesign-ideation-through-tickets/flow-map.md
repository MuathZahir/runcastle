# Flow map — ideation through tickets (as-is, walked 2026-09-03)

Walked with agent-browser against the installed app (`localhost:4513`, real data,
read-only — no session was started or ended, no gate overridden, no ticket saved),
cross-checked against the code in `apps/web/src` and `packages/server/src`. Every
state below was either observed on a real feature or read off the resolver that
produces it; where a state was only read, it says so. Screenshots in the session
scratchpad (`01`–`44`).

Real features used: `flow-redesign-ideation-through-tickets` (unmapped ideation,
live), `flow-redesign-build-review-and-ship` (mapped ideation, live, 10 waypoints),
`flow-redesign-project-shell-and-navigation` (build, with an ideation session still
live), demo `kickoff-probe-throwaway` (mapped, stranded at spec), demo
`realtime-team-collaboration` (mapped, tickets, idle), demo `mood-filter` (shipped,
quick-change), demo `entry-tags` (review), `flow-redesign-onboarding-and-project-chooser`
(shipped on lap 2), `feature-grouping-forking-and-referencing` (mapped, shipped),
JanaLearn `enter-a-course-while-it-is-still-generating` (ideation, never started).

## 0. What is fixed before this flow lands

The project-shell flow (`feature/flow-redesign-project-shell-and-navigation`, in
build, lands before this one) already decided things that touch this surface.
They are inputs here, not questions:

- **Gate card goes read-only and the override UI is deleted** (shell decision 6):
  the "Override with reason…" link, the reason form and the "was overridden — Undo"
  row leave the Inspector. Server `overrideGate`/`undoGateOverride` stay. The only
  override left in the UI after that is the *bar's* `Override & converge…` on a
  mapped ideation — which is this flow's.
- **The standing explainer** ("Gates are the human approval points…") is deleted
  and becomes an ⓘ on the "Current gate" caption (decision 5). Gate codes demote
  to dim mono; the card leads with the plain name (decision 9).
- **Copy policy** (decision 9): insider nouns only as established names; every
  sentence readable without them; definitions from `lib/vocabulary.ts` as tooltips.
- **Rhythm** (decision 13): 8px inside a control group, 16 between fields, 24
  between sections, 32 header-to-body. Rail 300px resizable; inspector column
  drops entirely on non-feature views.
- **Real URLs** (decision 1); the read-only phase pin stays out of the URL.
- Explicitly deferred *to this flow* (shell decision 2): next-step-bar wording
  ("Resume grill" etc.) and the map rail's "0 FRONTIER" stub.

## 1. The feature view (`Workspace.tsx`)

Top to bottom, for a non-draft feature:

| Row | What it is | Owner |
|---|---|---|
| Header | phase tag · title · branch button (`Copy branch name`) | shell chrome; behaviour unchanged here |
| Pipeline stepper | six steps `ideation · spec · tickets · build · review · shipped`, `Lap N` chip from lap 2 | this flow owns what the steps *offer* in the first three phases |
| Lap banner (lap ≥ 2 only) | `LAP N` tag · why-line · `started 3d ago · Lap N-1 landed 4 tickets` | this flow |
| Next-step bar **or** read-only banner | one kicker/title/desc + at most one solid action + ghost secondaries; replaced wholesale by `READ-ONLY  You're viewing the X phase.  Back to Y →` when an earlier step is pinned | this flow (ideation/spec/tickets resolvers) |
| Workspace banners | `RESUME FAILED …` (auto-dismiss 8s), `OFFLINE server unreachable — retrying…` | shared |
| Body | `GrillBody` (ideation, spec) · `TicketsBody` (tickets; also build with no run) | this flow |
| Inspector (right) | `Details` (Current gate card, Knowledge doc list) / `Activity` | shell owns the rail; the *gate semantics shown* are ours to reflect |

Stepper: `done` and `current` steps are clickable; `upcoming` steps are disabled
buttons. Clicking a done step pins a read-only view (§7); clicking the current step
unpins. Tooltips: `Shape the idea in a grill session` / `Write it up as a spec` /
`Break the work into atomic tickets` / `Burn the tickets into commits` /
`Test-drive the branch, then merge` / `Merged to the main branch`. Nothing in the
stepper says *what happened* in a done phase (no dates, counts, session, doc).

## 2. Next-step bar — ideation

Resolver `lib/feature-ui/next-step/ideation.ts`. Branch order is **mapped → lap>1 →
live → gate satisfied → resumable → cold**; the first match wins.

| # | State | Kicker / title | Description | Solid action | Ghost | Observed |
|---|---|---|---|---|---|---|
| I-1 | mapped, every waypoint terminal | `MAP` / Converge the map | Every waypoint is resolved — converge to draft the spec and tickets. | **Converge** | — | code |
| I-2 | mapped, waypoints open | `MAP` / Work the frontier | server reason: `10 waypoints not yet terminal (10 open)` or `no waypoints charted yet — chart the map before converging` | **none** | `Override & converge…` → inline `[reason] [Converge anyway] [Cancel]` | ✔ shot 01/03 |
| I-3 | lap ≥ 2, session live | `LAP LIVE` / Lap N in progress | The lap session digests the drive, amends the docs and emits this lap's tickets. | none | — | code |
| I-4 | lap ≥ 2, idle | `NEXT STEP` / Work lap N | Lap N is open — its session amends the docs and emits this lap's tickets, then hands back to Burn. Promoting is refused until it has run. | Resume/Start lap N session | — | code |
| I-5 | session live | `GRILL LIVE` / Grill session in progress | Shape the idea with Claude — it promotes the phase itself when the grilling is done. | none | — | ✔ shot 10 |
| I-6 | idle, `decisions.md` exists | `NEXT STEP` / Shape the idea, or promote it | Decisions are captured — carry on in a grill session, or promote the idea when it feels concrete. | Resume/Start grill session | `Promote to spec` | code |
| I-7 | idle, ended conversation on disk | `NEXT STEP` / Pick the conversation back up | The grill session ended, but its conversation is still on disk — resume it to carry on where you left off. | Resume grill session | — | code |
| I-8 | never started | `NEXT STEP` / Shape the idea with the agent | Launch a grill session to shape the idea before any code is written. | Start grill session | — | ✔ shot 44 |

Extras on I-1/I-2: a `⚑ Fog remains — still not specified: …  You can converge
anyway.` line when `map.md` has a non-empty *Not yet specified* section.

Not in the bar, but in the same column: the **briefing banner** inside the session
panel (`This terminal has not reported ready — answer anything waiting in it…` /
`The opening briefing never reached Claude — this session has not been told what it
is here for.` + `Send briefing`), and `agent hasn't checked in yet` after 30s of
`launching…`.

## 3. Next-step bar — spec

| # | State | Kicker / title | Description | Solid | Ghost | Observed |
|---|---|---|---|---|---|---|
| S-1 | session live | `GRILL LIVE` / Writing the spec | The spec takes shape beside the conversation — the session advances the phase when it's written. | none | — | code |
| S-2 | idle, `spec.md` exists | `NEXT STEP` / Refine the spec, or approve it | The spec is written — reopen the grill to work on it, or approve it to move into tickets. | Resume/Open grill | `Approve spec → tickets` | code |
| S-3 | idle, no spec | `NEXT STEP` / Write the spec | No spec yet — resume the grill conversation to draft it. | Resume/Open grill | — | ✔ shot 20 |

No mapped branch, no lap branch. A mapped feature that arrived here via Converge
gets the same "grill" copy as an unmapped one, while the body below shows the
converge-recovery bar (§5).

## 4. Next-step bar — tickets

| # | State | Kicker / title | Description | Solid | Ghost | Observed |
|---|---|---|---|---|---|---|
| T-1 | ≥1 ticket (live or not) | `NEXT STEP` / Review & burn the tickets | Each ticket is one atomic task the agent will implement. Review them, then burn. | **Burn N tickets** | `Revisit` (only when idle) | ✔ shot 21 |
| T-2 | 0 tickets, live | `WAITING` / Emitting tickets | The session breaks the spec into tickets — they appear here as they land. | none | — | code |
| T-3 | 0 tickets, idle | `WAITING` / Waiting for tickets | No tickets yet — a grill session emits them. Open a session to shape the work. | Resume/Open grill to emit tickets | — | code |

`N` counts **every lap's** tickets; `feature.burn` is lap-scoped (§9 dead end 3).

## 5. Ideation / spec body (`GrillBody`)

### 5a. Unmapped

One pane: the session panel filling the body height (no scrolling — the terminal
measures itself). States of the panel:

| State | What shows |
|---|---|
| no session rows | `EmptyState`: **No session yet** — *Start a session from the bar above — you and the agent shape the idea here before any code is written.* |
| launching / live | strip `ideation` chip · dot + `launching…`/`live` · short id · **End session** (no confirm; tooltip *end this session — recoverable, you can relaunch it*); then the PTY. Overlay states on the PTY: `connecting…`, `disconnected — reconnecting… keystrokes are dropped…`, `session stream ended — relaunch or end the session above`. |
| ended | card: dot · **Session ended** · *The conversation is still on disk — resume it to pick up where you left off.* + **Resume session**; or *Decisions from this conversation were captured to Knowledge.* with no button when there is nothing resumable |

At `spec`, a one-line **doc card** sits above the panel: `Specification  spec.md  View ›`
(opens DocPeek) or, empty, **Spec not written yet** — *continue the session to draft it*.

### 5b. Mapped — the map rail + terminal split

Left rail (~300px, collapsible, persisted globally):

- Header `MAP` + `‹`. Collapsed: a 38px strip with a vertical `2 FRONTIER` stub
  (tooltip *2 waypoints on the frontier — expand the map rail*). With zero frontier
  it reads `0 FRONTIER` (the stub the shell flow deferred to us).
- Groups, each `Label · count`: **Frontier**, **Claimed**, **Blocked**, then a
  collapsed `Resolved / dropped`. Not charted yet: a dashed card **Not charted yet** —
  *the session writes the map as you explore the idea*. Charted but empty: *No
  waypoints yet — they appear here as the map takes shape.*
- **Waypoint card**: line 1 = type badge (`research` / `task` / `grilling` /
  `prototype`; status word instead in the done group) + title + caret. Frontier cards
  open by default; the open body shows the `question` as markdown, `blocked by …`,
  `researching…` (AFK run in flight), `surfaced by …`, and the resolution `summary`
  on done cards. Frontier cards carry a **Work** button (or **Resume** when the
  waypoint has a previous session), `runs AFK` next to research. Blocked/claimed/done
  cards have no action.
- **Refused handoff**: clicking Work while another session is live and mid-work
  raises an inline confirm on the card — *A session is live on **X** and its waypoint
  is still open. End it and work this instead?* → **End & work this** (danger) /
  Cancel. If the live session is provably finished, Work ends it silently and
  launches the new one.
- `Map document` disclosure (closed by default) under the groups, rendering the
  non-empty `map.md` sections (*Destination*, *Notes*, *Not yet specified*, *Out of
  scope*); all empty → *Nothing written yet — the session fills this in as it
  explores the idea.*

Right pane: the same session panel as 5a, plus a **done-state strip** when the live
session's waypoint went terminal: `✓ Resolved — {summary}` + **Work next: {title}**
(lowest-seq frontier), or `✓ Resolved — waiting on N research run(s)`, or `Map
complete — every waypoint is done. Converge from the bar above.`

The rail renders at `spec` too (observed on `kickoff-probe-throwaway`: an empty
"Not charted yet" rail beside a spec body whose whole point is now the spec).

### 5c. Converge-stranded (mapped, at spec, no live session, no tickets)

Body shows, top to bottom (shot 20): the empty map rail · the empty spec doc card ·
`Session ended — Decisions from this conversation were captured to Knowledge.` ·
a separate bar **The converge session ended before tickets were emitted.** →
**Resume converge**. Meanwhile the next-step bar says *Write the spec → Resume grill*
and the gate card offers *Override with reason…*. Three doors, three names.

## 6. Tickets body (`TicketsBody`)

Order: session panel (strip + PTY, or the ended card with **Resume session**) →
`TICKETS  0/10 done · 1 burning` + chips `sandbox · docker` and the implement
model (`gpt-5.6-sol`) → the standing hint *Burning runs each ticket as its own
sandboxed agent, in parallel, committing to the feature branch.* → the ledger.

- Row: caret · `#seq` · title · `review` kind chip (only for review tickets) ·
  `after #2, #5` · model chip (`claude-opus-5[1m] · Claude Code`, only when
  assigned) · status chip (`pending` / `burning` breathing / `done` / `failed` /
  `cancelled`).
- Expanded row: **Edit ticket** (pending/failed only, not while pinned) · GOAL ·
  CONTEXT · ACCEPTANCE (dash list) · SEAMS (chips) · COMMITS (*no commits yet — the
  burn writes them* / clickable short shas) · DIGEST · Error / Cancelled.
- **In-place editor** (shot 23): TITLE input · GOAL · CONTEXT · ACCEPTANCE (one per
  line) textareas · MODEL select (`default (project model)` + per-runtime groups) ·
  **Cancel** / **Save ticket**. Seams are not editable by design. One row at a time.
- **No cancel-ticket affordance anywhere in the web UI** — `ticket.cancel` exists on
  the wire and is used by the agent's MCP tool only.
- Lap grouping: from lap 2, rows sit under `Lap N` headers (earlier laps collapsed);
  lap 1 shows no headers.
- Empty: **No tickets yet** — *A session breaks the spec into atomic, reviewable
  tickets — start one from the bar above.*
- With a live session the terminal sits above the ledger at its fixed
  `100dvh − 420px` guess and the ledger is below the fold (shot 12).

## 7. Gates and overrides (as they are today)

Inspector → Details → **CURRENT GATE**, always describing the feature's *actual*
phase, never the pinned one:

| Gate | Card | Server check |
|---|---|---|
| G1 (unmapped) | `G1 Decisions captured` — *Decisions captured before writing a spec* — blocked: *run the ideation session to capture decisions first* | `decisions.md` exists; from lap 2 also an ideation/revisit/converge session stamped with this lap |
| G1 (mapped) | `G1 Waypoints resolved` — *Every waypoint resolved or dropped before converging* — *10 waypoints not yet terminal (10 open)* | all waypoints resolved/dropped; **not lap-scoped**; fog never checked |
| G2 | `G2 Spec written` — *Spec written before breaking into tickets* — *write the spec (spec.md) before breaking into tickets* | `spec.md` exists (+ the same lap-session rule) |
| G3 | `G3 Tickets approved` — *Tickets approved by a human (the Burn click)* — `Ready to advance` | ≥1 non-cancelled ticket **in this lap**; only Burn or an override crosses it |

Override today: `Override with reason…` → *Overriding G1 moves this feature to
spec.* · reason input · **Apply** / Cancel → toast *gate overridden — moved to spec*
→ card gains *G1 was overridden — this feature skipped ahead to spec.* **Undo —
back to ideation** while it is still the latest transition. (F24 is closed; the
shell flow then deletes this whole UI.)

Second override door, ours: the bar's `Override & converge…` on a mapped ideation —
same gate, different verb, launches the converge session instead of just flipping
phase. After the shell lands it is the *only* override left, and it exists only for
mapped G1; unmapped G1, G2 and G3 will have none.

Who crosses which gate: G1 and G2 are crossed by the **agent** (`complete_phase`)
in the normal flow; the bar's `Promote to spec` / `Approve spec → tickets` are the
human recovery path (ghost only, never while live); G3 is the human's **Burn**.

## 8. Read-only retrospective views (an earlier step pinned)

The bar is replaced by `READ-ONLY  You're viewing the tickets phase.  Back to build →`.
The bodies render exactly as live, minus: the ended card's Resume, the `Edit ticket`
button. Everything else stays interactive:

- The live session (if any) is shown **in every pinned phase** with End session,
  Send briefing, Work next and a typeable PTY (shots 12–14: an implementation-phase
  feature whose ideation session is still live shows that terminal under the
  ideation, spec *and* tickets pins).
- A mapped feature's frontier keeps its **Work / Resume** buttons while pinned.
- The Inspector shows the *current* gate (G4 while looking at tickets; `✓ Shipped —
  no gates left` while looking at a shipped feature's ideation).
- Empty states still say "start a session from the bar above" under a bar that
  is the read-only banner.
- A quick-change feature (`mood-filter`) pinned at spec says *Spec not written yet —
  continue the session to draft it* — a retrospective inviting you to write a spec
  for a shipped feature.
- A shipped lap-2 feature (`flow-redesign-onboarding-and-project-chooser`, shot
  40–42) shows the `LAP 2` banner on every view including the shipped body
  (*Iterate sent this feature back through the pipeline … started 2d ago · Lap 1
  landed 11 tickets*), and its pinned ideation and tickets views show a live
  `revisit` session — a merge-conflict fix-up — with **End session** and a typeable
  terminal, and nothing from lap 1 or lap 2's actual ideation.
- A mapped shipped feature (`feature-grouping-forking-and-referencing`, shot 43)
  pinned at ideation shows the rail with one collapsed `RESOLVED / DROPPED · 8`
  group and a collapsed `MAP DOCUMENT`, beside an ended card — the whole record of
  how the idea was worked is two closed disclosures.
- What a pinned phase *does not* show: when it happened, which session did it, the
  decisions it produced, how many waypoints it took. The docs are in the Inspector's
  Knowledge list, unlinked to the phase.

## 9. Dead ends and contradictions (numbered)

1. **Converge-stranded spec has three competing doors** (§5c): bar `Resume grill`,
   body `Resume converge`, Inspector `Override with reason…`. Only `Resume converge`
   restarts the right session. (Audit F9 — still open.)
2. **Duplicate resume in every idle state**: the bar's `Resume grill session` and
   the ended card's `Resume session` are the same call with two labels, one above the
   other (shots 20, 21).
3. **Lap 2 with tickets**: the bar's `Burn N tickets` counts all laps while the
   server burns only this lap's; with zero lap-2 tickets the solid button is a
   guaranteed `no tickets to burn` refusal. (Audit F4 residue.)
4. **Mapped feature on lap 2** never reaches the lap branch (mapped is tested first),
   and mapped G1 is not lap-scoped — `Converge` is offered on a lap that has done
   nothing. (F4 residue.)
5. **Mapped ideation with open waypoints has no solid action at all** — only a ghost
   `Override & converge…`. The bar's own "one solid action" contract breaks in the
   one state where the human's job (pick a waypoint, in the rail) lives somewhere
   else.
6. **Read-only views are not read-only** (§8): live terminal with End session,
   frontier Work buttons, empty-state copy pointing at a bar that isn't there.
7. **No way to cancel a ticket** from the ledger; edit only.
8. **The rail at spec** shows an empty "Not charted yet" map beside the spec.
9. **Two verbs, one action**: `Promote to spec` vs `Approve spec → tickets` (both
   `advance`); `Revisit` vs `Iterate` (both a revisit session). `Revisit` has no
   description anywhere.
10. **Empty-map stub** `0 FRONTIER` on the collapsed rail (deferred to us by the
    shell flow).
11. **Gate card is phase-blind to the pin** — describes G4 while you look at tickets.
12. **Terminal below the fold at tickets** when a session is live (fixed-height
    guess, ledger under it).
13. **Ended-card copy lies for quick-change features**: "Decisions from this
    conversation were captured to Knowledge" on a feature that never had a grill.

## 10. Jargon, at the point of use

| Term | Where it meets the user here | Glossed? |
|---|---|---|
| grill | bar copy ~10×, stepper tip, tickets T-3 | `GRILL_EXPLAINER` exists but is only used by the (now deleted) New Feature form |
| converge / Converge anyway / Resume converge | I-1, I-2, fog line, done strip, recovery bar | no |
| waypoint, frontier, fog | I-2, gate reason, rail, stub, fog line | no |
| promote / Promote to spec | I-4, I-6, `Promote to spec` | no |
| Revisit | T-1 ghost | no |
| burn / Burn N tickets | T-1, hint line, stepper tip | `BURN_EXPLAINER` as the tickets hint ✔ |
| lap | I-3/I-4, banner, chip | `lapExplainer` tooltip + banner ✔ |
| G1/G2/G3 | gate card, consequence line | demoted by the shell flow |
| briefing | briefing banner | no |

## 11. Prior audit findings — status in the code

| Finding | Status |
|---|---|
| F4 lap-blind next-step | partial — unmapped ideation is lap-aware; mapped ideation, spec and the Burn count are not |
| F9 two resume CTAs in spec | partial — converge-vs-ended collision patched with a `showResume` flag; bar-vs-ended duplication remains everywhere |
| F24 / F17.6 override consequence + undo | closed (and the UI is being deleted by the shell flow) |
| F10.6 Resume in read-only views | partial — session Resume and Edit ticket gated; live strip, PTY and frontier Work are not |
| F10.7 empty map doc stubs | closed |
| F16 jargon | partial — burn, lap, gate glossed; grill, converge, waypoint, frontier, fog, promote, Revisit not |
| F15 create without session | closed (New always parks a draft; Start launches) |

## 12. Code shape and `styles.css` footprint

Files: `components/bodies/GrillBody.tsx` (507 lines: rail, cards, doc card,
converge-resume, all in one file), `bodies/TicketsBody.tsx` (423, ledger + editor),
`SessionPanel.tsx` (352), `workspace/NextStepBar.tsx` (146), `PipelineStepper.tsx`
(42), `LapBannerRow.tsx` (29), `Workspace.tsx` (705, dispatch + action switch + read-only
banner), `lib/feature-ui/next-step/{ideation,spec,tickets}.ts`, `lib/feature-ui/{map,session,gates,laps,pipeline}.ts`.

`styles.css` rules this surface owns: **~990 lines** (lines 839–1736 contiguous —
header rail rule, stepper, next-step bar, read-only banner, lap banner, body/grill
split, map rail, waypoint cards, terminal pane/strip/ended card, doc card, ledger and
editor — plus the gate card block at 2443–2534, which the shell flow will migrate
with the Inspector). ~30% of the 3,337-line sheet. Dead selectors found:
`.spec-doc*`, `.grill-empty`, `.wp-resume`, `.lg-commits`, `.gate-hint`, `.is-skipped`.

Other code smells: `ns.warning` and `ns.fog` are structurally identical fields;
`hasResumable` is kind-blind in one branch and kind-scoped in another; `MAP_SECTIONS`
is duplicated from the server scaffold; two `as SettingsView` casts in TicketsBody.
