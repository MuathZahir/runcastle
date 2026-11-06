# Decisions — Agents are woken only when it matters

Planned without the human (a headless planning run, 2026-11-06). Every decision
below is the lead's recommendation, accepted so the plan could be finished; each
names the alternative it was chosen over.

Check first: 3, 7, 9, 12

## 1. One wake rule, decided in one place, for both levels
**Decision:** Every message runcastle sends to an agent on its parent's behalf is classed as either **wake** (a handback, or a real question the agent must answer) or **hold** (anything else). One shared function makes that call for both links that exist today: runcastle news to the orchestrator thread that holds a feature, and runcastle's messages to a feature's lead. It is written so workers can adopt it later without a second rule.
**Why:** The brief asks for one rule at both levels. Two separate lists would drift, and workers will need the same call.
**Assumed.** Alternative: change the orchestrator notifier only and leave lead messages as they are.

## 2. A held message is shown in the chat and rides the next prompt
**Decision:** A held message never starts or queues a turn. It is logged in the chat at once (the human sees it where it would have been) and is added to the agent's next prompt, whoever sends that prompt: the human's next message, or the next wake. It is kept on disk, so a server restart does not lose it. This uses the thread host's existing hold (the same one that keeps a new chat's briefing for the human's first message).
**Why:** Held news is not lost and costs no turn. The hold mechanism already exists and already survives restarts.
**Assumed.** Alternative: drop held lines outright and let the agent read state when it next needs it.

## 3. Which orchestrator news lines wake, and which hold
**Decision:** These **wake** the orchestrator thread that holds the feature: the lead waits for the human; the lead declared ready to test; a round failed; a merge conflicted (not one the orchestrator's own merge already reported); a test drive failed to start; the human merged the feature (shipped); a backlog feature started by itself, or could not start; a self-planning run stopped before its plan was complete while nothing waits on the human. These **hold**: the human is talking to a chat / its chat went quiet; the human started or stopped a test drive; the human had a feature plan itself; a self-planning run finished; a round finished; a round was cut off by a restart; a review or verification pass finished or failed; another thread took the feature; runcastle could not wake a lead.
**Why:** The wake list is the brief's "must still hear and can act on" list plus failures nobody else will raise. Every held line either has a later wake that covers it (a finished round leads to the lead's ready or wait line; a cut-off round wakes the lead, which raises a wait if needed) or asks nothing of the orchestrator. On the analysed fortnight the held kinds were 133 of 308 news wakes and ~32M context tokens, before counting the 151 "noted" replies.
**Assumed.** Alternative: keep "another thread took it" and "could not wake its lead" as wakes, since both are surprises the orchestrator might want to tell the human about.

## 4. Lines that already only reach a running thread keep that gate
**Decision:** Lines about what the human did (talking to a chat, a drive started or stopped, plan-it-yourself) still go only to a holder whose process is running, as today, and now hold instead of starting a turn.
**Why:** A closed thread is doing nothing those lines could change; held, they still tell a live one before its next step. No reason to widen them.
**Assumed.** Alternative: hold them for closed threads too, so a reopened thread reads the full history.

## 5. "Finished planning" holds; the gathering window stays short
**Decision:** A self-planning run that finished holds, always. A run that stopped incomplete wakes only when the feature is not already waiting on the human (that wait line already woke the orchestrator for it). The 300 ms window that gathers lines into one prompt stays as it is.
**Why:** Every one of the 28 "finished planning" wakes came within three minutes of a "waits for you" line for the same feature. Holding it removes that pair, and the duplicate message to a lead that followed, without delaying any real wake by widening the window.
**Assumed.** Alternative: widen the window to about a minute so paired lines go out together.

## 6. Background sub-agent wakes are handled in the orchestrator's guidance
**Decision:** The project session's skill tells the orchestrator to do boot-time and other short reads in the foreground (parallel calls in one message), and to start a background sub-agent only for long independent work, so several reads return as one turn and not one wake each.
**Why:** The wake on a finished background sub-agent is the agent runtime's own; runcastle does not deliver it and cannot hold it. The brief measured 49 such wakes (24M), mostly five boot-time reads waking the thread five times.
**Assumed.** Alternative: have runcastle turn off background sub-agents for orchestrator threads through the runtime's settings.

## 7. News never restarts an oversized orchestrator chat
**Decision:** When a wake is about to go to a holder thread whose conversation is past the resume cap (the existing 1 MB transcript / re-entry limit that already stops the human reopening it), runcastle opens a fresh orchestrator thread instead. The fresh thread takes over every feature the old one held, receives any lines the old one still held plus the wake itself, and is briefed that it continues from the old thread. The old thread is not restarted. The check runs whenever a wake goes out, not only when the human opens a chat, so a long-running thread that keeps being woken is also cut over at its next wake once it has stopped.
**Why:** Today news restarts oversized chats through a path that skips the cap: none of 20 orchestrator sessions ever compacted, and contexts reached 190–352k. Opening a fresh thread keeps the orchestrator carrying features on its own judgement, which waiting for the human would stall.
**Assumed.** Alternative: hold the wake until the human next opens the orchestrator chat, whose own cap then starts the fresh thread.

## 8. Held lines move with the features when a chat is cut over
**Decision:** Whenever a fresh orchestrator thread takes over from a capped one, whether a wake or the human opened it, lines the old thread was still holding move to the new one with its features.
**Why:** Otherwise held news would sit on a thread nobody will prompt again, which breaks "held news is not lost".
**Assumed.** Alternative: leave held lines on the old thread; the fresh one reads state from the features anyway.

## 9. A runcastle-started turn that hits the usage limit is re-sent at reset
**Decision:** When a turn runcastle started (news to the orchestrator, or a message to a lead) ends because the provider's usage limit is hit, runcastle holds that turn's message again and wakes the thread once when the usage window resets, using the reset time the runtime already reports. If the reset time is unknown, the message stays held for the next prompt. A human's own message that hits the limit is left alone.
**Why:** Five orchestrator turns ended "You've hit your 5-hour limit" and their news was never acted on until the human typed "Continue all work". Holding alone would not help, since nothing prompts the thread after the limit.
**Assumed.** Alternative: hold only, and let the human's next message carry it.

## 10. What reaches a feature's lead
**Decision:** A lead is woken by: the human's messages (including the orchestrator's messages and relays, and Resume after a provider halt), a round coming back, and the human approving the last waiting design (it answers the lead's design wait and asks it to commit them). The notice that the human pressed Stop holds: it rides the human's next message.
**Why:** The round's return is the handback; human and orchestrator messages are the questions. Stop asks nothing of the lead, and the server already refuses a dispatch after Stop, so waking an idle lead only to acknowledge it is a wasted turn.
**Assumed.** Alternative: keep waking the lead on Stop so a lead mid-turn hears it at the end of that turn.

## 11. The round's return message is the whole handback
**Decision:** The message a returning round wakes its lead with keeps its ticket list, gate result and findings, and its closing line tells the lead it holds everything about the round: read a ticket's digest with `get_ticket` only where it needs the detail (a failed ticket, a finding to fix), with no `get_feature_context` call to see the round again. The lead's round guidance says the same.
**Why:** Leads fetched the tickets again after reading them in the wake. Saying so is cheaper than slimming the message, and slimming runcastle's tool results is `tools-and-skills-say-less`'s job.
**Assumed.** Alternative: shorten the wake to counts and a pointer, and let the lead fetch.

## 12. Held news looks held in the chat
**Decision:** A news block that was held reads "For its next turn" beside its time, in the same quiet text, so the human knows the orchestrator was not woken and why no reply follows. Nothing else in the chat changes.
**Why:** Without the label a news block with no reply after it looks like the orchestrator ignored it.
**Assumed.** Alternative: no visual change; held and waking news look the same.
