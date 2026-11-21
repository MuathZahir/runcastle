# Decisions — Runcastle says when nothing is running

Planned with nobody present, on autopilot (epic: Runcastle Rethink), 2026-11-21. The epic said yes to the plan as drawn the same day ("Yes, build it … Each one is your pick"), settling 2–9; the human can overturn any of them.

## 1. One alert, from runcastle, to the human
**Decision:** "Runcastle states facts itself, not through an agent. A status comes from what is actually running. One alert goes to you, not to an agent: 'features are open, nothing is running, and nothing is waiting on you'."
**Why:** The human agreed this rule with "Agreed", and the cut with "Alright, you can start". In the 36-hour run, work sat dead for 7.7 hours and 6 of the human's 10 messages were "is it stuck?".

## 2. Only started features count as open; drafts never do
**Decision:** An open feature is one that has started and is not merged or archived. Drafts never count, including an "up next" draft that waits on another feature's merge. When that other feature is stuck, the alert already names it.
**Why:** A draft has no chat and nothing that could run, so its silence is normal. The brief left this open.
**Decided by autopilot.** Alternative weighed: count an "up next" draft whose dependency is stuck, and name it in the alert.

## 3. Anything in "Needs you" holds the alert back
**Decision:** "Nothing is waiting on you" means the project has nothing in "Needs you": no question from a lead, worker or epic, no feature saying it is ready, no usage-limit wait. While anything there stands, the alert does not fire, however old it is.
**Why:** It is the human's agreed rule read literally, and the human already got a ping for that item; once they come back, they see the rest of the project too.
**Decided by autopilot.** Alternative weighed: a "Needs you" item older than a day stops holding the alert back, so an old forgotten question cannot silence it for good.

## 4. A feature that is your move never raises the alert
**Decision:** An idle feature does not count toward the alert when its next move is the human's: they pressed Stop on it, or its last turn answered their own message and it has no worker left mid-assignment. It does not hold the alert back for other features either. A feature whose last turn runcastle started (a worker's handback, a wake after the usage limit, a message from the epic) and that ended with no question does count.
**Why:** The brief says a feature the human simply has not come back to must not raise the alert. Without this, every chat with a lead would raise it ten minutes after the human walked away. A worker left mid-assignment is the opposite case: the 7.7-hour stall began in a turn the human started.
**Decided by autopilot.** Alternative weighed: only "Needs you" counts as the human's move, so any idle feature can raise the alert.

## 5. Ten quiet minutes before the alert
**Decision:** The alert fires once the project has had nothing running for 10 minutes in a row, with every other condition still true at that moment.
**Why:** The normal gap between two turns (a handback waking a lead, a queued worker starting) is seconds, and a server restart resumes chats within a few minutes. Ten minutes stays clear of both and is small next to the hours lost today. The brief left this open.
**Decided by autopilot.** Alternative weighed: 30 minutes, the audit's default, for fewer false alarms at the cost of a later alert.

## 6. One alert per stop
**Decision:** The alert stands until work runs again in the project or the human writes in the chat it sits in. After that, a new stop can raise a new alert. A usage-limit retry that hits the limit again does not count as work running again, so a long limit raises one alert, not one every few minutes.
**Why:** The brief asks for one alert per stop, not a repeat every few minutes, and the limit's retries every 5 minutes would otherwise reset it again and again.
**Decided by autopilot.** Alternative weighed: also clear the alert when the human only opens the chat, without writing.

## 7. The alert is a "needs you" on the project's orchestrator chat
**Decision:** Runcastle puts the alert on the project's orchestrator chat as a "needs you" of its own, the same way it already shows "Usage limit reached". It goes on the epic that runs the stopped features, or the project's newest orchestrator chat when no epic runs them. It then shows where every "needs you" shows: the Needs you list, the phone notification, the tab title and the project's dot. Tapping it opens that chat, where the human can tell the epic what to do. The agent there is not woken. No screen is added or reshaped.
**Why:** The brief places the alert in the "needs you" list and the phone notification runcastle already sends. Every such item today belongs to a chat. The orchestrator chat is the project's own place, and it is where the human would reply.
**Decided by autopilot.** Alternative weighed: a new project-wide row in the Needs you list and a banner across the top of the app, tied to no chat; this needs new screens.

## 8. The alert says why, feature by feature
**Decision:** One line, for example "Nothing is running: 2 features stopped. Search: held for the usage limit until 14:05. Header: a worker stopped mid-assignment." The reasons runcastle can give are: held for the usage limit until a time; a worker stopped mid-assignment, which becomes "a worker stalled" once the "Stalled" status lands on main; ready and waiting on a merge; and, when runcastle knows nothing more, "stopped after its last turn". The chat shows the same line in full; the phone shows as much of it as fits.
**Why:** The brief asks the alert to say why when runcastle knows, and names these reasons.
**Decided by autopilot.** Alternative weighed: a short line on the phone ("Nothing is running in <project>") with the reasons only in the chat.

## 9. On for everyone, with no setting
**Decision:** The alert is always on, in every project. Phones get it only if the human already turned on phone notifications.
**Why:** The brief says every runcastle user gets it, and it fires only when work has really stopped. A switch can come later if it ever proves noisy.
**Decided by autopilot.** Alternative weighed: a switch in Settings → General, on by default.
