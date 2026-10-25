# Brief

## Why this feature exists
The human, 2026-10-24: "One thing I don't really like with how things work right now is having to click 'Resume conversation'. When I click on a feature, I expect the chat to be open immediately." And then: "I don't want the initial message that gets sent when I usually click 'Resume'. When I open the feature, I just want to see the chat as it was when I left it, that's it."

They know "Chat as web components" (a draft) may solve this one day. This feature is the fix for now, inside the terminal model.

## Why the Resume button shows up today
A chat's terminal is a PTY owned by the runcastle server process. Every server restart kills every live PTY (the shutdown handler in `packages/server/src/index.ts`, plus boot reconciliation of stale sessions), and so does reinstalling runcastle, ending a session, or the CLI exiting. After that the chat sits at rest: the read-back transcript over one button, "Resume the conversation" (`ChatAtRest` in `apps/web/src/components/chat/ChatView.tsx`). Restarts happen often while dogfooding, so the human meets this button constantly.

Today a resumed chat also gets a kickoff prompt from runcastle (launcher.ts: `kickoffLine` is set for `kind === 'chat'` even when `resumeSessionId` is set, tagged with `tagRuncastlePrompt`). So every resume spends a model turn and the agent "greets" the human before they say anything.

## What the project session established
- **Open = resume.** Opening a feature whose chat has ended and has a resumable conversation resumes it straight away. No click.
- **No kickoff on any chat resume.** This covers the automatic resume and any other path that resumes a chat. The human sees the conversation exactly as they left it. The agent picks up the feature's current state with the human's first real message, through the per-turn context the UserPromptSubmit hook already adds. The planning session should check that hook really carries enough of what the resume kickoff carried today (the state header from `chatKickoffHeader`/`chatOpening`), and move anything missing there.
- **Untouched auto-resumed chats close when you leave.** Each live chat is a running Claude process. Clicking through six features must not leave six running. An auto-resumed chat the human never typed into ends when they leave that feature. A chat they did type in stays live, as it does today. The UserPromptSubmit hook already tells human prompts apart from runcastle-tagged ones, so "untouched" can be detected.

## What it must NOT swallow
- Keeping terminals alive across server restarts (moving PTYs into a separate long-running process). That is a much bigger piece of plumbing, and the web-components chat may make it unnecessary.
- "Chat as web components" itself: no non-terminal chat UI here.
- Kickoffs of other session kinds (lead wakes, relays, self-planning runs, side sessions). Only the feature chat's resume loses its kickoff. Starting a chat that has no conversation yet keeps its opening briefing.

## Open — for the planning session
- What exactly counts as "untouched", and when "leaving the feature" happens: navigating to another feature, switching tabs, closing the browser tab?
- What happens when the chat was mid-task when the server died. Should a resume with no kickoff leave it idle until the human speaks? Probably yes, but say so.
- Whether the project chat gets the same treatment, or only feature chats. The human spoke about features; the project chat uses the same `ChatView` and a "Resume" too.
- What the at-rest view shows while the resume is starting up: the transcript, then the terminal replacing it once it attaches.
- Whether the resume cap (`resumeCapExceeded`), a transcript that can't be resumed (`resumeGoneReason`) and the one-live-session-per-feature guard still behave when the resume is automatic. A refused auto-resume should probably fall back quietly to today's at-rest view.

## Ordering
"Tickets and review are tools, not phases" has merged, so nothing blocks this. The in-flight features "One orchestrator, no mode" and "Designs wait for you" may touch the launcher's chat kickoff or the feature page. Check for overlap before planning locks.
