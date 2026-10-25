# Outcome — Opening a feature shows its chat as you left it

Opening a feature whose chat has ended resumes it at once, with no Resume click and no message sent on its own: you see the conversation exactly where you left it.

- Shipped: 2026-10-25

## What shipped

7 commits · 29 files

- 1 tickets landed: #1 Chat: opening a feature or the project resumes its chat as you left it
- 0 waived
- 0 failed

## Review record

### Ticket 2 · review

- Reviewed commit: dd20370c885d587fb14059d3d12e7a5d19194a4c
- Landed since: 0
- Outcome: done

- **A resumed chat shows "Agent working" forever while it sits idle** — fixed
- **Coming back to a feature whose untouched chat was closed while you were away shows the Resume button, not an auto-resume** — fixed
- **The leave timer's close shows on the timeline as "session ended by user"** — open
- **Three edge cases were not driven: archived feature, "Start the conversation", and another kind of live terminal** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Chat: opening a feature or the project resumes its chat as you left it

# Ticket 1 — Opening a feature or the project resumes its chat as you left it

## What was done
- **No kickoff on a plain chat resume.** `launchSession` (launcher.ts) now sends no kickoff for a `kind: 'chat'` launch that resumes and has no `purpose` and no explicit `kickoffLine` (`quietResume`). Purpose launches, the historical `start-lap` purpose, explicit briefings and fresh chats keep their briefings. Two old tests that expected a header on a plain resume were changed to the new contract (lap-kickoff, session-lifecycle).
- **SessionStart context** (hooks.ts `sessionStartContext`) gained the line `rounds run: N; latest run: <status|none>`.
- **Auto resume.** The spec routes `auto` through `launchSession`, but I built it as two separate launcher functions, `autoResumeChat` and `autoResumeProjectChat`. The routers call them when `auto: true` (`feature.launchSession`, `project.talkToProject`). They return `LaunchSessionResult | { autoSkipped: string }`. Keeping them separate left `LaunchSessionResult.sessionId` a required string for the 80+ existing callers. Every refusal is checked before anything is created: not active, headless run up, another terminal (`assertSpawnable`), Codex, runtime not ready, no resumable conversation, transcript gone, project session live, project row with no cc id, past the re-entry cap. A live chat comes back as `{ sessionId }` with nothing written to it. An auto call that also carries a purpose, kickoffLine, fresh and so on throws GateError. `launchProjectSession` now also returns `resumed`.
- **Untouched-leave rule.** New `launcher/untouched.ts`, with a `markAutoResumed` / `forgetUntouched` / `setUntouchedLeaveGrace` API. The PTY registry gained `onSinksChanged` listeners. Any `user-prompt` hook calls `forgetUntouched`, and so does `handlePtyExit`. When the 10 s grace runs out with no terminal attached, the session is ended through `endSession`.
- **Web.** New `lib/use-auto-resume.ts` holds `useAutoResumeOnce`, `featureAutoResumeTarget` and `useFeatureAutoResume`. Each is quiet: it has its own `onError` and never lands on the chat. `useProjectTalk` gained `autoResume` and `autoResuming`. `ChatView` gained `autoResuming`: the transcript and a "Resuming…" line stay up until the session is `live`. The terminal is mounted but hidden in the meantime, so its WebSocket is already attached and the leave timer cannot end a resume that is slow to start. Once the project page's resumed session is live, it switches to it.

## Surprises / judgement calls
- The ticket says to refuse Codex. Codex rows can in fact resume (`resume <thread>`), so the refusal only follows the ticket and the spec; it is not a technical limit.
- Once-per-visit is keyed by the conversation's Claude Code id, not the row id. A conversation that was live during the visit never resumes by itself, so an End the human clicks stays ended. The cost: if the server restarts while the page stays open, the chat sits at rest until the human navigates away and back.
- `land-on-chat.test.tsx` greps every `launchSession` site for `useLandOnChat`. It now lists `use-auto-resume.ts` as the one intended exemption.
- Project pages only show a conversation at rest when one is picked (Reopen / View in the list, or the switcher). Opening the page with nothing live shows the resting list, so nothing resumes on plain open.

## Left undone
- The manual Resume and New-chat paths are unchanged.
- No drive-machinery change was needed: no new service, env var, seed or process. `.runcastle/` scripts were not run.

Verification: `bun run typecheck` reported 0 errors; `env -u GIT_ASKPASS bun run test` had 367 files pass, 2 skipped, 0 failed.
