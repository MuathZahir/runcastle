# Test drive improvements

## Problem

The test drive is where the human actually learns things — clicking through the app on the feature branch — but runcastle gives them nowhere to put what they learn. Findings live in their head (or a scratch file outside the system) until they either re-tell them to an Iterate session by hand or forget them. The lap machinery already *expects* better: the next lap's session is instructed to read `docs/features/<slug>/test-notes.md`, but nothing in the product writes that file. The loop drive → findings → next lap is designed (ADR-0010 §4/§6) and half-wired; this feature closes it.

## Approach

While a feature is in review — before, during, or after an active drive — the review screen offers a notes box. Each note the human types lands in a checklist right there on the review body. A note can be checked off (**done** — handled or dismissed, toggleable), edited or deleted while **open**, or promoted to a ticket in one click. Promotion mechanically assembles a `pending` fix ticket on the current lap — title derived from the note, goal = the note verbatim, context carrying provenance ("found during lap N test drive") plus pointers to the feature's `spec.md` and `decisions.md`, acceptance criteria = "the noted behavior no longer reproduces" — and freezes the note with a link to its ticket. The existing Burn-from-review path picks such tickets up unchanged; no new phase mechanics. When the human clicks Merge & ship, the merge confirmation gains one informational line — "N open notes" — when any exist; nothing blocks.

Shape:

- **Notes are DB rows; `test-notes.md` is a rendered view.** A new drizzle table in core holds notes: id, feature, lap (stamped from the feature's lap at capture), text, status (`open` | `done` | `promoted`), linked ticket id for promoted notes, timestamps. Wire types (zod) live in core beside the other schemas. On every mutation the server regenerates `docs/features/<slug>/test-notes.md` in the feature's talk worktree from the full row set — idempotent render, never parse-back — grouped under `## Lap N` headings (all laps, current last), each note a markdown checkbox (`- [ ]` open, `- [x]` done), promoted notes annotated with their ticket. This is exactly the file and section format the lap-session kickoff and revisit skill already read; the reader side needs no change.
- **A notes service in the server** owns capture, edit, delete, toggle, promote — each mutation emits an event (per the events convention) and triggers the file re-render. Promotion composes the ticket through the existing tickets service so seq/lap/status semantics stay in one place, then flips the note to `promoted` with the ticket link. Edit/delete/promote reject on non-`open` notes (promoted is frozen; done must be untoggled first for edit — done→open→edit).
- **tRPC procedures on the feature router** expose the service to the web app (the names `feature.testNote` / `feature.promoteNote` from the build-era SPEC are the precedent; exact procedure split follows the router's current conventions). The UI polls as it does everywhere else — live checklist state falls out of the existing polling.
- **Review body UI**: capture box + checklist rendered with the DrivePane on the review screen, available for the whole review phase regardless of drive state. Checklist rows carry the toggle, edit, delete, and "→ ticket" affordances; promoted rows show their ticket. The merge-confirmation summary builder adds the open-notes line.

## Seams

1. **Notes service (new, server)** — the primary seam. Capture/edit/delete/toggle/promote against an `AppCtx` with a real temp data dir, observing: row state, emitted events, the regenerated `test-notes.md` on disk, and (for promote) the ticket row created through the tickets service. The server test suite already tests services at exactly this seam.
2. **Tickets service (existing)** — promotion is observed as an ordinary pending ticket on the current lap; the existing Burn-from-review behavior over pending tickets is already covered and must hold unchanged for promoted ones.
3. **`test-notes.md` file contract (new, but reader exists)** — the rendered file as read by the lap-session kickoff: `## Lap N` sections, checkbox lines, ticket annotations. Testable by rendering from known rows and asserting the exact markdown; this is the compatibility surface with the revisit skill.
4. **tRPC feature router (existing)** — thin pass-through to the service; covered by the service seam plus router wiring convention.
5. **Merge-confirmation summary (existing, web)** — the "what lands" summary derivation gains the open-notes line; observed where its existing derivations are observed.

## Out of scope

- Any embedded browser / preview iframe; "Open app ↗" stays as-is.
- The lap-trail visual.
- Agent-drafted (thick) promotion — the template is deliberately mechanical.
- Drive-machinery robustness: `{{port}}` drive-env variable, drive state surviving server restart or page reload, `driveSetupCommand` timeout ceiling, Rethink guard rails. Separate feature if wanted.
- Any change to the lap-session reader side (`sessions.ts` kickoff, revisit skill) — the file render conforms to what they already expect.

## Open questions

None unresolved. Consciously parked for later laps or separate features: lap trail, agent-drafted promotion, drive robustness items (see Out of scope).

## Later laps

- Lap trail visual on the review screen.
- Agent-drafted promotion for notes that need thick tickets.
- (Separate feature candidate) drive robustness: `{{port}}`, restart survival, setup-command timeout, Rethink guard.
