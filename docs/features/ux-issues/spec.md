# UX Issues

## Problem

The pipeline works, but its state is not legible in the UI, and the human keeps paying for it:

- **Laps are invisible.** Every ticket, note, session, and event is stamped with a lap number, yet the UI renders everything flat. Worse: a feature specced as a thin lap 1 reaches review, the review page says nothing about the planned lap 2, and the primary button says Ship & merge — so the human ships half a feature by clicking the main button.
- **Review shows nothing about what happened.** The only change signal is a commit count. The human wants to read what the lap actually did, in prose — not changed files, not hunks.
- **Review is optional and silently so.** When no review ticket ran, the review card simply omits the row; nothing says "this lap was never reviewed."
- **Feature creation is a thin form.** The NEW FEATURE overlay (title + one-liner) looks bad and pushes the thinking onto the human, while the project chat — the thing built to do intake — is a buried rail row that silently resumes one endless conversation, with no way to start fresh or return to past chats. Typing "talk" into the command palette lands on Preparation, not the chat.
- **Quick change is one prose blob → one ticket.** Real quick work is often several small tickets.
- **The resolve-conflict buttons vanish** whenever any session is live (one-terminal rule), reappearing only when the chat ends — reading as the button randomly not existing.
- **Test-drive notes triage is weird.** Per-note "→ ticket" mints mechanical tickets one click at a time and competes confusingly with Iterate (which also digests notes into tickets), with no guidance on which path to take.

## Approach

One polish lap across six surfaces, organized by the theme: make the pipeline's state legible and put each decision where the human already looks.

### Feature birth moves into the project chat

The rail head keeps its two doors, redefined by how much thinking the human wants:

- **New** opens a fresh project chat directly. The NEW FEATURE overlay is retired. Branch choice moves to the moment a feature is actually started, not the moment it is named.
- **Quick** opens one compact overlay for "I already know what this is," with two modes: **Quick change** — title plus a multi-ticket list (add/remove prose tickets), birthing the feature at implementation with all of them — and **Park a draft** — title plus optional one-liner, creating a parked draft with no branch and no session. The server's quick-change contract widens from one prose blob to a list of tickets.

The project chat becomes an **advisor, not a griller**: told a feature idea, it consults the portfolio (shipped and in-flight features, their docs, run summaries and ticket digests via the existing project-scoped MCP tools), gives recommendations, asks clarifying questions, and suggests how to split the work — then creates the feature(s), or parks drafts. It never does ideation grilling; that stays in the feature's own grill session. This is a rewrite of the project-session skill content plus the workspace around it.

The project workspace becomes a **conversation list**: "New chat" is the default, prominent action; past conversations are listed, auto-titled from their first message and dated; resuming one is an explicit click, never the default. One conversation live at a time (the launcher's one-terminal rule stands); ended conversations keep a viewable transcript and can be reopened and continued. The command palette gets a real entry for the project chat, so "talk" stops landing on Preparation.

### Lap becomes the organizing spine of feature history

- The tickets ledger and the notes panel group entries under **Lap N headers** — current lap expanded, prior laps collapsed. (The on-disk test-notes doc already has exactly this grouping; the UI catches up.)
- A **lap banner** appears in the feature workspace from lap 2 onward: which lap, what kicked it off (the rethink kickoff already carries this), what landed before. Lap 1 stays quiet — no iteration ceremony on a feature that merges first try.
- The activity feed learns to render the lap-started event as a visible divider.

### Review becomes the page that knows the plan

- **"What landed this lap"** leads the review page: a prose summary written by the review agent as its ticket digest — the one agent that ran last, holds spec plus every implementation digest, and actually saw the result working. The summary rides the existing ticket-digest seam; no new storage. Fallback when absent: the per-ticket burner digests, clearly marked as the agents' own accounts.
- **A review always runs.** Every lap's ticket batch includes a review ticket. The review skill is reworked: a **code review always executes** — a runcastle version of Matt Pocock's review skill (the implementing agent must read the original from github.com/mattpocock/skills and base the runcastle skill on it) — and the app **test-drive runs additionally** when the change is drivable. The ticket-emission skill mandates the review ticket in every batch.
- **Planned next lap.** When spec.md carries a non-empty `## Later laps` section, review changes shape: a card shows the deferred scope verbatim next to what this lap delivered; the next-step bar's primary flips to **Start lap N+1**, demoting Ship & merge to secondary; and the merge dialog warns about the remaining deferred scope as the last catch. The deferred-scope content is exposed to the client through the feature's existing knowledge/doc read path.

### Conflict resolution never hides

The resolve affordances (next-step bar primary and the conflict card button) always show while a conflict stands. When a session is live, the button reads **"End session & resolve"** and performs the compound in one click: gracefully end the live session, then launch the resolve session with the same conflict kickoff. An explanatory line ("one terminal per feature — your live session will be closed") keeps it honest.

### Notes become a findings inbox with one triage point

During a drive the human only types observations. Per-note "→ ticket" is removed. Triage moves to a single **"Address notes"** action in the next-step bar, offering the fork explicitly: **quick fixes** → batch-promote the selected notes into fix tickets; **needs rethinking** → start the lap session seeded with all open notes. The panel gets visual polish plus the lap grouping above.

## Seams

- **`nextStep()` (feature-ui pure function)** — existing. Computes the next-step bar. Observes: primary flip to Start lap N+1 when later-laps scope stands; the always-visible resolve affordance and its live-session "End session & resolve" variant; the "Address notes" action when open notes exist in review.
- **tRPC project router** — existing, contract extended. Observes: conversation list (titles, dates, live/ended), new-chat creation, explicit resume of a chosen past conversation, transcript retrieval for ended ones.
- **tRPC feature router** — existing, contract extended. Observes: quick-change accepting a list of tickets; draft creation without branch; the deferred-scope (`## Later laps`) content reaching the client; the compound end-and-resolve launch.
- **Notes service + router** — existing, extended. Observes: batch promotion of selected notes into fix tickets; the removal of the per-note promote path.
- **Ticket digest** — existing. Observes: the review ticket's digest carrying the "What landed this lap" prose; per-ticket digests as the fallback rendering.
- **Skills pack content** — existing seam (prompt contracts, no runtime code): the project-session skill rewritten as portfolio-aware advisor; the review-ticket skill reworked to always-code-review + drive-when-applicable; the tickets skill mandating a review ticket per batch.
- **Session lifecycle (launcher + hooks)** — existing. Observes: one-live-conversation enforcement across multiple stored conversations; graceful end-then-launch compound; lap-started events rendering as activity dividers.

No new seams. All changes land at existing boundaries with widened contracts.

## Out of scope

- An in-app diff or hunk viewer — review stays a test drive plus prose, not a code-review tool. Changed-files listings likewise rejected.
- An Inspector (details/activity rail) for the project workspace — still a later slice; this lap adds only the conversation list.
- Multiple simultaneously live sessions per feature or per project — the one-terminal rule stands everywhere.
- Any change to gates, phases, or the pipeline model itself — this lap changes rendering and entry points, not the state machine.
- Undo for promoted notes/tickets.

## Open questions

None — all decisions locked in decisions.md (12 entries).
