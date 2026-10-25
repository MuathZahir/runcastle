# Decisions

## 1. The resume carries the feature state through the session-start hook, not a kickoff
**Decision:** A plain feature-chat resume sends no kickoff. The two facts only the kickoff header carried (rounds run, latest run status) move into the `SessionStart` hook's context, which already fires on resume with the title, status, branch, docs and ticket counts.
**Why:** Nothing the agent needs is lost, and the human sees the conversation exactly as they left it. Lead wakes, relays and self-planning runs keep their kickoffs.

## 2. "Untouched" and "leaving" are decided on the server
**Decision:** An auto-resumed chat is untouched while it has received no prompt of any kind — neither one the human typed nor one runcastle delivered (a lead wake, a relay). It is left once no browser has its terminal attached for about 10 seconds. An untouched chat that is left is ended; any prompt makes it an ordinary live chat that stays up, as today.
**Why:** A chat with no prompt has never started a turn, so ending it can never cut off work. The PTY registry already knows which sockets are attached, so one signal covers navigating to another feature or the project page, closing the tab and reloading. The grace stops a reload or a quick click away and back from churning the process. A client-side "end on navigate" was rejected because it misses a closed tab.

## 3. The project chat gets the same treatment
**Decision:** Opening the project page, or picking an ended conversation in its switcher, resumes the conversation the page is showing. The same untouched-and-left rule closes it. Its resume already sends no kickoff.
**Why:** It is the same chat view with the same Resume button, met as often; two behaviours for one surface would read as a bug. The cost is small because the close rule lives on the server.

## 4. Only features in progress resume on open
**Decision:** A feature resumes its chat on open only while it is in progress. Shipped and archived features keep today's Resume button; drafts have no chat; a feature with no conversation yet keeps "Start the conversation". The project chat always resumes.
**Why:** Opening a shipped feature is usually a glance at its outcome, and resuming it would start a process and likely recreate its removed checkout. One click there is fine for the rare question.

## 5. A resumed chat stays idle until the human speaks
**Decision:** A chat that was mid-task when its terminal died comes back idle. Nothing prompts it on resume; the human's first message carries on, with the per-turn feature state attached. Server-side wakes (a round that finished meanwhile) still reach it the ordinary way.
**Why:** It is what "exactly as you left it" means, and the per-turn hook context plus `get_feature_context` give the agent the current state the moment it is asked anything.

## 6. The transcript stays up while the resume starts
**Decision:** While an automatic resume starts, the at-rest transcript stays on screen and the Resume button gives way to a quiet "Resuming…" line. The terminal replaces the transcript once the session reports live; Claude Code redraws the conversation itself.
**Why:** No blank terminal and no jump: the human keeps reading the same conversation until the live one is there.

## 7. A refused or failed automatic resume falls back quietly
**Decision:** When an automatic resume cannot happen — the transcript is gone, the runtime cannot resume, another terminal holds the feature, or the resume dies on start — the view stays at rest with today's Resume button and the page's existing failed-resume notice, but no toast. An automatic resume never falls through to starting a fresh conversation. It is tried once per visit to a conversation, never in a loop; a live terminal of another kind is shown instead, as today.
**Why:** Opening a page should never surprise the human with an error toast or a brand-new conversation they did not ask for; the button is still there for an explicit try.
