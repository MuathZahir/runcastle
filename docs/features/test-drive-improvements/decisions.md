# Decisions — test-drive-improvements

## 1. No embedded browser
**Decision:** This feature is about notes capture during a test drive, not an in-app browser. "Open app ↗" (user's own browser) stays as-is; no iframe/preview pane.
**Why:** The browser was speculative ("not sure") and technically hostile (CSP/X-Frame-Options, auth cookies, HMR websockets) with unclear payoff over opening the real browser. Notes capture is already designed (ADR-0010 §4/§6), small, and closes a real loop: drive → notes → next lap's agent reads them automatically. If a browser ever earns its place, it's a separate feature.

## 2. Scope: capture + checklist + promotion; lap trail deferred
**Decision:** The feature ships note capture (notes box on the test-drive panel → `test-notes.md` under `## Lap N`), a checklist render of captured notes in the review UI, and one-click promotion of a note to a ticket. The lap-trail visual is explicitly out of scope.
**Why:** Capture without promotion leaves the most common drive outcome — "found three small bugs, fix them" — going through manual re-telling; promotion is cheap once notes are structured data and serves the Fix path directly. The trail is decoration with no loop-closing value.

## 3. DB is the source of truth; test-notes.md is a rendered view
**Decision:** Notes are DB rows (feature, lap, text, status: open / done / promoted, timestamps). The server regenerates `docs/features/<slug>/test-notes.md` from the rows on every change, preserving the `## Lap N` section format the revisit skill already expects to read.
**Why:** Checklist state and promotion are mutations; a markdown ledger would force parse-and-rewrite of prose on every click. Rows match how everything else lives (tickets, events, drizzle/SQLite), the polling UI gets live state for free, and idempotent regeneration keeps the agent-facing file contract intact without making it the ledger.

## 4. Notes capture is available for the whole review phase
**Decision:** The notes box lives on the review body and works any time the feature is in review — before, during, and after an active drive. Each note is stamped with the feature's current lap.
**Why:** Observations don't stop when the dev server does — the "one more thing" note typed right after Stop, or something spotted in the diff, would be lost if capture were gated on a live drive. There is no integrity reason to require a running dev server to record an observation.

## 5. Promotion is a mechanical template, no dialog, no agent
**Decision:** "→ ticket" on a note creates a `pending` ticket on the current lap in one click: title derived from the note, goal = the note verbatim, context = provenance ("found during lap N test drive") plus pointers to the feature's `spec.md`/`decisions.md`, acceptance criteria = "the noted behavior no longer reproduces." The note flips to `promoted` and links to the ticket. The existing Burn-from-review flow (`features.ts` iterating path) picks the ticket up unchanged.
**Why:** Fix tickets are inherently narrow — the note is the spec of the defect. The template satisfies the tickets-are-thick principle by stuffing provenance and doc pointers rather than invoking an agent hop with its latency and cost. Tickets remain editable before Burn, which is the escape hatch for a note that needs fattening; a compose dialog would kill one-click for the common case, and agent-drafting can be added later if thin fix tickets burn badly.

## 6. Note lifecycle: open ⇄ done, promoted is frozen
**Decision:** A captured note starts **open**. Checking it marks it **done** ("handled or dismissed" — a scratch-off with no enforcement), toggleable both ways. **Promoted** is set by the →-ticket click, links the ticket, and freezes the note's text. Open notes are editable and deletable; promoted notes are neither.
**Why:** With several notes in flight during a drive, a checklist with nothing to check loses track of what's been dealt with. Freezing promoted notes keeps the note honest as the record of what the ticket was built from. Edit/delete on open notes keeps `test-notes.md` — the file the next lap's agent reads — free of typos and dead observations.

## 7. Open notes inform, never block, the exits from review
**Decision:** Iterate/Rethink has no note requirement — open notes flowing into `test-notes.md` and the next lap's session is the feature working as intended. Merge & ship adds one informational line to the existing merge-confirmation summary — "N open notes" when any exist — and blocks nothing.
**Why:** The dangerous moment is shipping with logged-but-unhandled findings; a summary line catches that exactly there. A hard block would nag someone who consciously judged their notes shippable, and a minimum-note rule for iteration would be ceremony.

## 8. Notes-only: drive-machinery robustness stays out
**Decision:** The documented drive-machinery sores — no `{{port}}` drive-env variable, drive state lost on server restart / page reload, `driveSetupCommand` client timeout, Rethink beside Start-test-drive with no guard — are all out of scope. This feature is the notes loop and nothing else.
**Why:** Notes capture is one coherent, shippable loop; the robustness items change the drive machinery itself, carry different risks, and restart-survival was already an explicit non-goal once. They deserve their own feature rather than riding along.

## 9. One lap — spec the whole thing
**Decision:** The feature is specced whole: capture + checklist + promotion + merge-summary line in one lap. `## Later laps` carries only the consciously parked items (lap trail, agent-drafted promotion, drive-machinery robustness).
**Why:** The scope is small, was designed once already (ADR-0010), and every decision locked without a wobble — this is the "sure, and small" case. A thin walking skeleton would defer nothing that's actually uncertain.
