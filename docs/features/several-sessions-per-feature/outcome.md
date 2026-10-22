# Outcome — Several sessions per feature

A feature can hold more than one conversation: side sessions that fork the main chat, so each starts knowing the feature and what was being discussed.

- Shipped: 2026-10-22
- Laps run: 1

## What shipped

17 commits · 40 files

### Lap 1
- 3 tickets landed: #1 Side sessions exist: the `side` kind, its fresh launch and its one limit; #2 The session switcher in the feature chat header; #3 The fresh start knows what we were doing: the main-chat excerpt, for side sessions and the scenario chat
- 1 waived: #4 The main chat hears what side sessions changed
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: unknown
- Landed since: 0
- Outcome: cancelled

### Lap 1 · review

- Reviewed commit: c8d726472c61430f54bd2872224ff28c66f4eb59
- Landed since: 0
- Outcome: done

- **After /clear, a side session's quote shows the raw /clear command markup as a "Human:" turn** — fixed
- **Drive walk: all eight criteria pass except the quote's /clear markup; Go and round delivery left to the tests** — open
- **Drive quirk: an existing demo feature's main chat can't start in the drive because the real install's worktree holds its branch** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The session switcher in the feature chat header

# Ticket 2 — the session switcher in the feature chat header

**What was done.**
- **Server.** `feature.sessions({ featureId })` (`listFeatureSessions` in `services/conversations.ts`, using a new `featureSessions` query in `launcher/sessions.ts`) returns rows in this order: the main chat (the newest `chat` row, in any state, titled "Main chat"); live side sessions; ended side sessions; and the feature's live `scenario` row ("Scenario chat"). Each row has `id` (the latest row), `kind`, `title`, `status`, `awaitingInput`, `createdAt` and `endedAt`. Side sessions are grouped on `ccSessionId` by the existing `groupByConversation`. A side row the CLI has not picked up yet is not listed. Titles come from `conversationTitle`, which now passes the row's kind to `deriveTitle` (its new optional `kind` defaults to `'project'`). So the side kickoff turn is dropped whole, including any main-chat lines it quotes, and the title is cached on the earliest row.
- **Transcripts.** I added no new procedure. The web reuses `project.conversationTranscript`, which already drops the side kickoff by kind; a test covers it.
- **Main-chat reads.** The server's `liveSessionOf` (sidebar and feature list) and the web's `activeSession` now skip `side` rows. The next-step bar, the status line and the Chat tab's main view keep speaking for the main chat, as ticket 1's digest flagged.
- **Web.** New `components/workspace/SessionSwitcher.tsx` is a self-contained component with no queries, ready for the Design-mode reconcile. It has a menu grouped Main / Side sessions / Ended, an amber `warning` dot on waiting rows and on the button (only when a session other than the one in view waits), a time-ago stamp on ended rows, and a "New side session" button in the header, as in the preview.
- **FeatureChat** keeps the selected id and shows the main chat by default. A live side session shows its terminal and End session. An ended one shows its transcript with **Reopen**. Opening or reopening selects the new row; it shows as "Untitled" until the CLI picks it up and it is listed.
- **Scenario row.** It shows its terminal when picked, because the PTY registry supports several sinks (`pty/registry.ts` `attach`). FeatureChat's main view no longer picks a live scenario row.
- **Live updates.** `feature.sessions` was added to the SSE allowlist in `lib/live.ts`, with no `refetchInterval`, per the ticket.
- **Small changes.** `chatContextLine` now says "Main chat" instead of "Chat", and the meta line "One transcript per feature" became "Plans the feature · the lead after Go".

**Surprises.** `chat-view.test.ts` mocks tRPC by hand, so it needed `feature.sessions` and `openSideSession` stubs. The full suite reported 356 files and 4987 tests passing, far more than the baseline the prompt stated, with 0 failures.

**Left undone.** A reopened side session briefly shows "Untitled" until its new row gets a `ccSessionId`. Nothing links the new row to the old one before then. `usage.ts` still leaves side-session tokens out of the lead's usage. No `.runcastle/` drive change was needed (no new service, env var, seed or process), and I ran none of those scripts.
