# Project notes: jot it anywhere, triage it in the project chat

## Problem

Using runcastle (and the apps it manages), the human constantly notices small things — a flow that feels wrong, text overflowing, a component that doesn't match its neighbours. There is nowhere to put one in the ten seconds it takes to notice it. Feature test-notes only exist inside a feature's review phase; the project chat means opening a conversation. So observations are either lost, or re-told from memory weeks later as a lumpy one-off "ux issues" feature, flattened and missing the context of the moment.

And when observations *are* collected, sorting them is not the hard part. A ten-second note records a symptom, not an intent. Turning a pile of them into the right work needs someone to ask "what did you actually want here?" — with the portfolio in view.

## Approach

### What the human experiences

The look of both surfaces is pinned by the working prototype `prototypes/notes-ui.html` (decisions #15–#17, revisited 2026-09-24 after the lap-1 drive).

**Capture.** On any screen inside a project — project home, a feature workspace, the project chat, preparation — the human presses **⌘/Ctrl+J**, clicks the titlebar's **pencil icon** (icon-only, same size and style as its neighbours, tooltip "Jot a note" with the shortcut), or picks **New note** from the ⌘K palette. A palette-shaped bar opens top-centre, where ⌘K's palette sits, over a light scrim: one large input **with the cursor already in it on every open** (decision #18), a leading pencil glyph, no Save button. A footer strip shows "Paste a screenshot" (a thumbnail chip with × once pasted), "to <project>", and the ↵ / esc hints. **Enter** saves; **Escape** discards. On save the bar becomes one line — "Noted in <project> · N open · View" — the scrim lifts at once, and the bar closes itself after ~1.5s; **View** opens the inbox. The hotkey works even while focus is inside an embedded terminal. There is no capture on the portfolio home (no project to attach to) and no project picker anywhere — the note belongs to the project you are in.

**See the pile.** The rail's pinned project row carries a badge with the open-note count, hidden at zero. The project workspace's resting page gains a **Notes** card between the New chat card and the conversation list. Its header holds the title, the open count, one short subtitle line and the **Triage N** button (violet ghost; New chat keeps the page's one solid accent). Open notes, newest first, are dense one-line rows: small thumbnail (enlarges on click) or a quiet dot, text, relative time; **Edit** (inline), **Dismiss** and **Delete** are icon buttons revealed on hover and on keyboard focus, and Delete turns red only under the pointer. Triaged notes fold into one quiet "N triaged" disclosure whose rows show the outcome line, the feature link when there is one, and a **Reopen** icon. The card is hidden when the project has never had a note. There is no separate page or route.

**Triage.** **Triage N notes** opens a *fresh* project chat briefed to triage the open notes (if a project chat is already live, the same open-it / replace-it choice New chat offers applies). A plain **New chat** still opens by asking, but its system prompt says "This project has N open notes", so the agent can offer triage. The session then runs three movements:

1. **Read and cluster** — it reads every open note and its screenshot, plays back the themes it sees ("9 notes, 4 themes: …"), and the human corrects the grouping.
2. **Grill theme by theme** — ideation-style: one question at a time, always with a recommended answer, consulting the portfolio as intake already does ("`ticket-cards` shipped a density pass in August — regression or a new want?"). Notes may be **dropped**, **merged** into a theme, or **reframed**. A theme is done when its intent is clear enough to route.
3. **Route and carry** — each theme goes to one of the project session's five destinations, and the grilled reasoning lands in what that destination carries: a new feature's **brief**; ticket strings of **the one batched quick change** this triage session creates for every quick-sized theme; or, for a revisit / another lap (which have no tool), a **handoff line** the human pastes into that feature's session. Each note is marked triaged with a one-line outcome. A theme the human wants to leave for later is rewritten, with their OK, to the sharpened version and stays open. Notes the human skips stay open.

The whole loop this enables: drive main (later: `project-level-test-drive`) or just work → jot notes → triage in the project chat → one batched quick change + real features → **Burn** → drive the batch in its ordinary review (problems with the batch are test notes; unrelated things are project notes) → **Merge**.

### Shape

**Store.** A new `project_notes` table, separate from `test_notes` (decisions #4): `id` (its own id prefix, distinct from test-note ids), `projectId`, `text`, `status`, `outcome` (nullable), `featureId` (nullable link), `createdAt`, `updatedAt`. Lifecycle, pinned in ideation (decisions #5):

```
open ──triage(outcome, featureId?)──▶ triaged
open ◀──────────reopen──────────────  triaged   (reopen clears outcome + featureId)
open: editable, deletable, counts toward the badge
triaged: frozen — no edit, no delete; outcome required, non-empty
human Dismiss = triage with outcome "dismissed"
```

A note's screenshot is one PNG on disk under the data dir, `~/.runcastle/project-notes/<noteId>.png`, following the test-note annotation convention exactly: the file's presence is the record (no column), reads stamp a derived `screenshotUrl`, re-upload overwrites (one image per note), the serving route resolves the path from the looked-up row id and never from caller input. Deleting an open note deletes its PNG; triaged notes keep theirs; nothing prunes.

**Service.** One project-notes service owns every mutation — add, edit, delete, triage (several ids, one outcome, optional featureId), reopen, attach screenshot — and every mutation emits a **project-scoped** event (`emitProject`, no featureId) so the SSE stream invalidates the inbox and badge at once. `add` is the single write path every writer uses: the capture popover now, `project-level-test-drive` later. The service enforces the lifecycle (editing, deleting or re-triaging a triaged note is refused with a legible error; triage requires a non-empty outcome; a supplied featureId must belong to the same project).

**tRPC + REST.** A project-notes router for list (by project, open and triaged), open count, add, edit, delete, triage (dismiss), reopen. Screenshot bytes travel over a REST pair beside the existing test-note one: POST raw PNG bytes to attach, GET the PNG to display. Capture with a screenshot is add-then-attach, from the popover.

**MCP tools — project sessions only** (registered/filtered for `kind === 'project'`; every other kind sees none of them; the `requireFeatureId` refusal text naming the project session's own tools is updated to list them):
- `list_project_notes()` — the open notes, oldest first: id, text, createdAt, and, when a screenshot exists, its **absolute host path** plus the ready-made **attachment sentence** naming `.runcastle-attachments/<noteId>.png` (the same sentence shape test-note promotion writes).
- `triage_project_note({ noteIds, outcome, featureId? })` — marks one or several notes triaged in one call.
- `update_project_note({ noteId, text })` — rewrites an open note's text.

**Briefing (ADR-0009).** `launchProjectSession` gains a triage purpose: a launch requested from the Triage button carries an explicit briefing line (invoke `/runcastle:project` and triage the open project notes) in argv, which per ADR-0009 #4 forces a fresh conversation. `renderProjectPrompt` adds one line when the project has open notes — "This project has N open notes" — counted at launch; the tool read is what stays live.

**Burner.** The burner's attachment lookup, which maps a note id named in a ticket's context to its PNG, also resolves project-note ids to the project-notes directory. That is the whole burner change; the attachment sentence remains the entire contract and copying / exclusion / cleanup are untouched. A new feature's brief names a screenshot by absolute path instead — ideation runs on the host and `Read`s it directly.

**Skill.** The project skill (`packages/skills`, runcastle pack, `project`) gains an on-demand reference, `references/triage.md`, carrying the whole procedure: the three movements; when to drop / merge / reframe; that all quick-sized themes of one session go into **one** `create_feature({ tickets })` call; pasting the attachment sentence into ticket strings and absolute paths into briefs; outcome-line format ("→ new feature *X*", "→ batch quick change *Y*", "→ revisit of `slug` (handoff given)", "dropped: <why>"); passing `featureId` when the destination is a feature; handoff lines for revisit / another lap; rewriting deferred themes via `update_project_note`. SKILL.md gets a short **Notes triage** section pointing at it, §0 amended so a triage briefing — or the human accepting the open-notes offer — loads the reference instead of asking the default opening question, and "Your tools" lists the three new tools. §2's "one call per quick change" is widened for triage to "one batched quick change per triage session". Live sessions run the global install, so the skill change reaches real chats only after publish + reinstall.

**UI.** Capture bar + titlebar icon button + ⌘/Ctrl+J listener + palette entry, mounted by the in-project shell (so it is absent on the portfolio home). The hotkey listener must win over the embedded terminal's key handling. Badge on the rail's project row. Notes card on the project workspace, including the Triage button's launch and open/replace handling. Styling follows `apps/web/STYLE.md`.

## Seams

- **Project-notes service** (new) — the primary seam. Observe: rows after add / edit / delete / triage / reopen; lifecycle refusals (frozen triaged notes, empty outcome, cross-project featureId); the PNG written and removed on attach / open-note delete; a project-scoped event per mutation; `screenshotUrl` derived from file presence.
- **Project-notes tRPC router + screenshot REST pair** (new, beside the existing test-note ones) — observe: list/count shapes the UI consumes; bytes round-trip; path resolved from the row id, unknown id → 404.
- **MCP tool surface for project sessions** (existing seam, new tools) — observe: the three tools present for a project session and absent for every other kind; `list_project_notes` payload (absolute path + attachment sentence only when a PNG exists); multi-id triage; update refused on triaged notes.
- **Project launch + prompt render** (existing seams: `launchProjectSession`, `renderProjectPrompt`) — observe: the triage purpose puts its briefing in argv and never resumes; the open-notes line present iff N > 0.
- **Burner attachment lookup** (existing seam) — observe: a ticket context naming a project-note attachment resolves to the project-notes PNG; test-note resolution unchanged; missing file dropped as today.
- **Web components** (existing component-test tiers per STYLE.md) — observe: popover save / discard / paste; hotkey fires with terminal focus; badge count and hiding; Notes card sections, edit / delete / dismiss / reopen; Triage button's open/replace path.
- **Skill content** — no automated seam; verified by reading, and by a real triage chat after reinstall.

## Out of scope

- Any one-click "note → quick change" (or → feature) promotion from the inbox; the inbox only edits, deletes, dismisses and reopens.
- A rendered `notes.md` — the project session reads rows through its tool.
- Any agent, diagnosis or screenshot analysis at capture time.
- OS-global capture; capture on the portfolio home; a project picker.
- Element picking, annotation or video on capture — plain image paste only.
- Drive machinery of any kind — `project-level-test-drive`, whose brief is amended in its own revisit to write through this store's `add`.
- Cleanup / pruning of triaged notes and their PNGs.
- A featureless project-level burn (rejected, decisions #14) and the project fix lane (parked as draft `project-fix-lane`).
- Changes to feature test notes or feature drives.

## Open questions

- None blocking. Whether batched quick changes prove too heavy in practice is the evidence `project-fix-lane` waits on.

## Later laps

None planned — specced whole as one lap (decisions #1).
