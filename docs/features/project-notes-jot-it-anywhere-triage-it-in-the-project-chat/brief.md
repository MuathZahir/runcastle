## Why this exists

The human hits small UI/UX annoyances constantly while using runcastle and the apps it manages — weird flows, overflowing text, inconsistent components, odd exceptions. Today there is nowhere to put one of those in the ten seconds it takes to notice it. The capture surfaces that exist are all anchored to something bigger: feature test-notes only exist inside a feature's review lap (`test-drive-improvements`), and the project chat requires opening a conversation. So the drip of small observations is either lost, or re-told from memory weeks later into a lumpy "ux-issues"-style batch feature (see `ux-issues`, `streamlining-user-experience`, `identify-random-issues-throughout-the-system` — each a one-off dump).

The missing piece is a **dumb capture, smart triage** loop: get the observation out of the human's head instantly with zero structure, and do all the thinking later, in the project session, which is the one surface that can consult the portfolio and cut work properly.

## What it is

1. **A project-scoped note store.** Note rows keyed to the project (not to a feature or lap), each with text, an optional image, a created-at, and an open / done / promoted lifecycle — the same lifecycle `test-drive-improvements` gave feature test-notes (DB rows as source of truth, a rendered markdown view is optional). This store is designed to be written by more than one entry point: `project-level-test-drive` (in flight) is the second writer and must be able to drop its drive notes into it.
2. **Quick capture from anywhere.** An affordance present on every screen of the runcastle UI (hotkey and/or titlebar control): one line of text plus a pasted screenshot, submitted in under ten seconds, no dialog beyond that. Plain image paste only — no element picking, no annotation (the annotation player from `video-annotation-for-reviews` is a later borrow if ever wanted).
3. **An inbox the human can see.** Open-note count as a badge on the project chat door; a list to read, edit and delete notes. Notes are never cards in the rail — they are not a third kind of thing beside drafts and features.
4. **The project session opens on the open notes.** When a project chat launches, the open notes are its intake material — the session reads them (or receives them in its briefing; ideation decides the delivery shape, cf. ADR-0009 on how briefings ride the launch), routes each one through its five destinations (new feature, quick change, revisit, another lap, nothing), and marks notes triaged / promoted as it goes. The project session needs a tool for that marking; nothing else gets one.

## What it must NOT swallow

- **No auto-creation of features or tickets from a note.** Creation stays in the project chat (decision confirmed 2026-09-11 in `replace-the-quick-door-with-a-draft-door`: the Quick form died because a form cannot consult the portfolio; a capture box that only records is not that form, and must not become it). Whether a one-click "note → quick change" promote is allowed is an ideation question, and the default answer is no for lap 1.
- **No agent at capture time.** No diagnosis, no enrichment, no screenshot analysis when a note is saved. Diagnosis happens where it already does — in the burner's sandbox once a ticket exists.
- **No drive machinery.** Dev panes, video recording, the annotation viewer, driving a base branch — all of that is `project-level-test-drive`, which consumes this store. This feature does not touch feature test-drives either.
- **No OS-global capture.** The affordance lives inside runcastle's UI; capturing while runcastle is not open is out of scope.

## Already settled / prior art

- `docs/features/test-drive-improvements/decisions.md` — the notes-loop design to lift to project scope (row store, open/done/promoted, promotion template).
- `docs/features/replace-the-quick-door-with-a-draft-door/` — why capture must not create work directly.
- `docs/features/project-session-open-by-asking-orient-lazily/` and ADR-0009 — how a project session launches and receives its briefing; the seeding mechanism has to respect both.
- Naming: call these **notes**, never "findings" — that word already means preparation host-key findings (`record_finding`) and review-agent findings.
- Sequencing: this lands before `project-level-test-drive`, whose brief still carries the note-store and session-seeding design; that brief should be amended in its own revisit to consume this store instead.
