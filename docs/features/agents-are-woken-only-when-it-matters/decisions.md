# Decisions — Agents are woken only when it matters

Planned without the human (a headless planning run, 2026-11-06). Every decision
below is the lead's recommendation, accepted so the plan could be finished; each
names the alternative it was chosen over.

Check first: 6, 11, 16

## 1. One wake rule, decided in one place, for both levels
**Decision:** Every message runcastle sends to an agent on its parent's behalf is classed as either **wake** (a handback, or a real question the agent must answer) or **hold** (anything else). One shared function makes that call for both links that exist today: runcastle news to the orchestrator thread that holds a feature, and runcastle's messages to a feature's lead. It is written so workers can adopt it later without a second rule.
**Why:** The brief asks for one rule at both levels. Two separate lists would drift, and workers will need the same call.
**Assumed.** Alternative: change the orchestrator notifier only and leave lead messages as they are.

## 2. A held message is shown in the chat and rides the next prompt
**Decision:** A held message never starts or queues a turn. It is logged in the chat at once (the human sees it where it would have been) and is added to the agent's next prompt, whoever sends that prompt: the human's next message, or the next wake. It is kept on disk, so a server restart does not lose it. This uses the thread host's existing hold (the same one that keeps a new chat's briefing for the human's first message).
**Why:** Held news is not lost and costs no turn. The hold mechanism already exists and already survives restarts.
**Assumed.** Alternative: drop held lines outright and let the agent read state when it next needs it.

## 3. Which orchestrator news lines wake, and which hold
**Decision:** These **wake** the orchestrator thread that holds the feature: the lead waits for the human; the lead declared ready to test; a round failed; a merge conflicted (not one the orchestrator's own merge already reported); a test drive failed to start; the human merged the feature (shipped); a backlog feature started by itself, or could not start; runcastle could not wake a lead; a self-planning run ended (finished or not) while nothing waits on the human. These **hold**: the human is talking to a chat / its chat went quiet; the human started or stopped a test drive; the human had a feature plan itself; a self-planning run ended while the feature already waits on the human; a round finished; a round was cut off by a restart; a review or verification pass finished or failed; another thread took the feature.
**Why:** The wake list is the brief's "must still hear and can act on" list plus failures nobody else will raise. Every held line either has a later wake that covers it (a finished round leads to the lead's ready or wait line; a cut-off round wakes the lead, which raises a wait if needed) or asks nothing of the orchestrator. On the analysed fortnight the held kinds were 133 of 308 news wakes and ~32M context tokens, before counting the 151 "noted" replies.
**Assumed.** Alternative: also wake on "another thread took it", a surprise the orchestrator might want to tell the human about.
**Challenged:** "could not wake its lead" was first a hold; the challenger pointed out that the lead's later ready or wait line, which covers the held round lines, never comes when the lead cannot be woken, so holding it stalls a feature silently. Accepted: it wakes.

## 4. Lines that already only reach a running thread keep that gate
**Decision:** Lines about what the human did (talking to a chat, a drive started or stopped, plan-it-yourself) still go only to a holder whose process is running, as today, and now hold instead of starting a turn.
**Why:** A closed thread is doing nothing those lines could change; held, they still tell a live one before its next step. No reason to widen them.
**Assumed.** Alternative: hold them for closed threads too, so a reopened thread reads the full history.

## 5. "Finished planning" holds when a wait already went out; the gathering window stays short
**Decision:** A self-planning run's end, finished or not, holds when the feature is already waiting on the human (that wait line already woke the orchestrator for it), and wakes otherwise. The 300 ms window that gathers lines into one prompt stays as it is.
**Why:** Every one of the 28 "finished planning" wakes came within three minutes of a "waits for you" line for the same feature. Holding it removes that pair, and the duplicate message to a lead that followed, without delaying any real wake by widening the window.
**Assumed.** Alternative: widen the window to about a minute so paired lines go out together.
**Challenged:** a finished run first held always; the challenger noted a plan that ends without a wait would then never wake the orchestrator, which is the one meant to start the work. Accepted: the same conditional rule for both endings, which saves the same 28 wakes.

## 6. Background sub-agent wakes are handled in the orchestrator's guidance
**Decision:** The project session's skill tells the orchestrator to do boot-time and other short reads in the foreground (parallel calls in one message), and to start a background sub-agent only for long independent work, so several reads return as one turn and not one wake each.
**Why:** The wake on a finished background sub-agent is the agent runtime's own; runcastle does not deliver it and cannot hold it. The brief measured 49 such wakes (24M), mostly five boot-time reads waking the thread five times.
**Assumed.** Alternative: have runcastle turn off background sub-agents for orchestrator threads through the runtime's settings.

## 7. News never restarts an oversized orchestrator chat
**Decision:** When a wake is about to go to a holder thread whose conversation is past the resume cap (the existing 1 MB transcript / re-entry limit that already stops the human reopening it), runcastle opens a fresh orchestrator thread instead. The fresh thread takes over every feature the old one held, receives any lines the old one still held plus the wake itself, and is briefed that it continues from the old thread. The old thread is not restarted. The check runs whenever a wake goes out, not only when the human opens a chat, so a long-running thread that keeps being woken is also cut over at its next wake once it has stopped.
**Why:** Today news restarts oversized chats through a path that skips the cap: none of 20 orchestrator sessions ever compacted, and contexts reached 190–352k. Opening a fresh thread keeps the orchestrator carrying features on its own judgement, which waiting for the human would stall.
**Assumed.** Alternative: hold the wake until the human next opens the orchestrator chat, whose own cap then starts the fresh thread.
**Challenged:** the challenger would ask the human first, since threads appearing on their own change the human's thread list and which thread is "the orchestrator", and would weigh compacting the old chat (the runtime summarising it in place) instead of a new thread. The answer stands: runcastle's resume cap already chose fresh over compacted ("the docs are the artifact"), and decisions 14 and 15 cover what the human sees.

## 8. Held lines move with the features when a chat is cut over
**Decision:** Whenever a fresh orchestrator thread takes over from a capped one, whether a wake or the human opened it, lines the old thread was still holding move to the new one with its features.
**Why:** Otherwise held news would sit on a thread nobody will prompt again, which breaks "held news is not lost".
**Assumed.** Alternative: leave held lines on the old thread; the fresh one reads state from the features anyway.

## 9. A runcastle-started turn that hits the usage limit is re-sent at reset
**Decision:** When a turn runcastle started (news to the orchestrator, or a message to a lead) ends because the provider's usage limit is hit, runcastle holds that turn's message again and wakes the thread once when the usage window resets, using the reset time the runtime already reports. If the reset time is unknown, the message stays held for the next prompt. If the re-sent turn hits the limit again, it waits for the next reset the same way, so it is tried at most once per usage window. A human's own message that hits the limit is left alone.
**Why:** Five orchestrator turns ended "You've hit your 5-hour limit" and their news was never acted on until the human typed "Continue all work". Holding alone would not help, since nothing prompts the thread after the limit.
**Assumed.** Alternative: hold only, and let the human's next message carry it.

## 10. What reaches a feature's lead
**Decision:** A lead is woken by: the human's messages (including the orchestrator's messages and relays, and Resume after a provider halt), a round coming back, and the human approving the last waiting design (it answers the lead's design wait and asks it to commit them). The notice that the human pressed Stop reaches a lead whose turn is running at the end of that turn, as today, and holds for an idle lead: it rides the human's next message.
**Why:** The round's return is the handback; human and orchestrator messages are the questions. An idle lead has nothing to stop, and the server already refuses a dispatch after Stop, so waking it only to acknowledge is a wasted turn. A busy lead may still be editing and committing, and must hear Stop before its next step.

## 11. The round's return message is the whole handback
**Decision:** The message a returning round wakes its lead with keeps its ticket list, gate result and findings, and its closing line tells the lead it holds everything about the round: read a ticket's digest with `get_ticket` only where it needs the detail (a failed ticket, a finding to fix), with no `get_feature_context` call to see the round again. The lead's round guidance says the same.
**Why:** Leads fetched the tickets again after reading them in the wake. Saying so is cheaper than slimming the message, and slimming runcastle's tool results is `tools-and-skills-say-less`'s job.
**Assumed.** Alternative: shorten the wake to counts and a pointer, and let the lead fetch.

## 12. Held news looks held in the chat
**Decision:** A news block that was held reads "For its next turn" beside its time, in the same quiet text, so the human knows the orchestrator was not woken and why no reply follows. Nothing else in the chat changes.
**Why:** Without the label a news block with no reply after it looks like the orchestrator ignored it.
**Assumed.** Alternative: no visual change; held and waking news look the same.

## 13. A newer line about what the human is doing replaces the older one
**Decision:** While lines are held, a newer line about the human's activity on a feature replaces the held one it answers: "its chat went quiet" replaces "the human is talking to its chat", and "stopped the test drive" replaces "started a test drive". Every other held line is kept, in order. There is no size limit on held lines.
**Why:** A thread closed for a day would otherwise read a stale "busy" line followed by its own correction; the brief shows out-of-date news costing turns. The other lines are one short line each and each still true, so a limit buys nothing.
**Assumed.** Alternative: keep every held line as it arrived.

## 14. No agent or human can ask for extra wakes
**Decision:** The wake list in decision 3 is fixed. There is no tool for an orchestrator, and no setting for the human, to ask to be woken by a held kind (for example "wake me when this round finishes").
**Why:** Every held kind is covered by a later wake, and a per-feature switch is machinery nobody has asked for. It can be added later if a real need shows.
**Assumed.** Alternative: a tool the orchestrator calls to be woken by one held kind on one feature.

## 15. A cut-over is visible, and the old thread points to the new one
**Decision:** When a wake opens a fresh orchestrator thread (decision 7), the old thread shows a closing line saying the conversation grew too large and was continued in the new thread, by name, and the fresh thread appears in the thread list as any new chat does. Opening or typing into the old thread afterwards goes to the thread that continued it, not to another fresh one. A cut-over only happens while the old thread's process is stopped, so it never takes features from under a conversation the human is having.
**Why:** The human should never find their features moved without a trace, and two fresh threads for one cut-over would split the holds.
**Assumed.** Alternative: start another fresh thread whenever the old one is opened, as the resume cap does today.

## 16. An oversized orchestrator chat is compacted in place, not handed over
**Supersedes:** 7, 8, 15.
**Decision:** An orchestrator thread is never replaced by a fresh one because it grew large. It gets the same automatic compaction that `lead-chats-stay-small` builds for feature leads, reusing that mechanism, with no second one: compacted in place by the agent host's existing compact path when its context is over the same threshold, at the same quiet moments (before an idle stop, and before a turn after a long gap, which covers a news wake restarting a stopped thread), plus the same mid-turn ceiling. Its keep-instructions and the project skill tell it, after any compaction, to re-read its record (`get_project_context` and the briefs of the features it holds, which carry each cut's working agreement) before acting, not to trust the summary. The thread keeps its holds and its held lines, so nothing moves. The 1 MB resume cap no longer starts a fresh orchestrator chat when the human opens one. A hand-over to a fresh chat comes back only if resuming a transcript over 1 MB proves unworkable even after compaction, and the report must say why.
**Why:** New orchestrator chats appearing by themselves would confuse the human, and the problem the analysis found is context size, which compaction fixes while keeping the thread and its holds.
**Assumed.** Alternative: the hand-over to a fresh chat of decisions 7, 8 and 15.
**Changed by the orchestrator:** it asked for compaction in place, reusing `lead-chats-stay-small`'s mechanism, with a fresh chat only as a fallback that must be explained.

## 17. The orchestrator compaction is built last, on the sibling's code
**Decision:** The wake/hold work (decisions 1–6, 9–14) is built first, on its own. The orchestrator compaction (decision 16) is built after `lead-chats-stay-small` has merged to main: this branch takes main, and the lead extends that feature's compaction triggers to orchestrator threads. If it has not merged by then, the lead tells the orchestrator and waits rather than building a copy.
**Why:** The sibling has its plan but no code yet; building compaction here too would make the second mechanism the orchestrator ruled out.
**Assumed.** Alternative: build a minimal orchestrator-only compaction now and fold it into the sibling's later.

## 18. A conflict from the human's own merge is held
**Supersedes:** the "a merge conflicted" entry of 3.
**Decision:** A merge conflict line now holds instead of waking. So does the new "merge conflict resolved" line.
**Why:** `drives-never-touch-real-conversations` (merged to main) made the conflict line reach the orchestrator only for a merge the human pressed, with the human holding the Resolve button and the orchestrator told to leave it to them. A line that asks nothing of the orchestrator is news by decision 1. The orchestrator's own `merge_feature` still returns its conflict directly.
**Assumed.** Alternative: keep waking on it, so the orchestrator can tell the human about a conflict they already see.

## 19. Re-scoped: agents talk by tool call, not by runcastle's news lines
**Supersedes:** 3, 4, 5, 13, 14, 18 (the news-line wake/hold table), and leaves 1, 2, 6, 9–12 and 16–17 open for the grill.
**Decision:** runcastle no longer decides which of its news lines reach the orchestrator. A lead tells the orchestrator by calling a tool when it judges the orchestrator needs to know, with the same tool and rules as the worker handback `interactive-workers` is settling, one level up. Machine events with no agent behind them (a server restart, the usage limit, a dying container, a merge conflict, a failed round) go only to the agent that owns the work, which decides whether to tell its parent. Parts already built that fit this may survive (the restart notice to a cut-off chat, re-sending what the usage limit stopped, Stop reaching a busy lead), but none of them counts as decided until the grill with the human, which follows `interactive-workers`' handback. Nothing new is built and nothing is declared ready before then.
**Why:** The human, after watching the orchestrator pinged about fifteen times during another feature's grill: "I feel like we shouldn't make pinging mechanical. I feel like these things should be tool calls to communicate between each other."

## 20. The lead's tool is the only way the orchestrator hears from a feature
**Decision:** runcastle sends the orchestrator no automatic line when a lead waits for the human (`wait_for_you`) or declares ready (`declare_ready`). Those still ping the human and show "needs you" as before. The lead tells the orchestrator by calling its handback tool when the orchestrator should act ("ready to merge", "I need a decision the human hasn't given"); its skill says when.
**Why:** One deliberate channel, as the human asked, and no hearing the same thing twice. A lead that forgets the tool still leaves the human pinged, so nothing stalls unseen.

## 21. A lead hands back with `hand_back({ summary })`; runcastle adds a state line
**Decision:** A lead gets the same `hand_back({ summary })` a worker has. The summary says what is done, what is left and what the lead needs, including anything the human told it directly. runcastle adds one line of the feature's state (ready to test or not, whether it waits on the human and why, the latest round) and shows it as a handback card in the holding orchestrator's chat, waking it once. The orchestrator answers by replying (`send_to_feature`), merging, or doing nothing. With no orchestrator holding the feature, the tool is refused and says so.
**Why:** One handback idea at every level, as the re-scope asks; the state line keeps the summary short and saves the orchestrator a fetch.

## 22. When a lead hands back
**Decision:** While an orchestrator holds the feature, a lead hands back in three cases: the work is ready (declared ready to test, or the human said it is good to merge); it finished something the orchestrator asked it for; or it is blocked on something the orchestrator can settle (a decision the cut's working agreement covers, a clash with a sibling feature, a dependency). It does not hand back for a question only the human can answer (taste, designs, a plan's yes): that stays the human's ping in its chat.
**Why:** The orchestrator hears only what it can act on, the same rule at both levels. The cost accepted: in an autonomous cut the orchestrator does not know a lead waits on the human, so the feature waits until the human opens it.

## 23. The orchestrator gets three machine events, all about its own work
**Decision:** Besides leads' handbacks, the orchestrator hears only of work it owns itself, and each wakes it: a drive it started failed to start; a backlog feature it holds started by itself or could not start; a lead it messaged could not be woken. Nothing else reaches it: rounds, reviews and planning runs belong to the lead (which hands back when the orchestrator should know); the human's own acts (talking to a chat, drives, merges and their conflicts) are the human's; and another chat taking a feature tells it nothing, since there is nothing left for it to do (any later attempt to act on that feature is refused with the new holder's name).
**Why:** Machine events go only to the agent that owns the work (the re-scope). The human struck "another chat took it": "What would it do if its ownership ends."
**Consequence:** Nothing is held for the orchestrator any more, so the "For its next turn" label (12) and the replacing of held activity lines (13) have nothing left to serve and go with the news-line table.

## 24. A chat a restart cuts off mid-turn is woken once to carry on
**Decision:** Once the server is back after a restart, each lead or orchestrator chat that was cut off mid-turn gets one runcastle message ("a server restart cut off your turn; carry on where you were") that wakes it. A lead whose round was cut off is skipped (its round message already goes), as are side chats and workers (a worker's lead hears when it fails). A chat cut off while waiting on the human's answer to a permission or question is woken too, and asks again.
**Why:** Those agents were working and nobody asked them to stop; on 11-06 three leads sat idle after a restart until the orchestrator noticed. The notice goes only to the chat that owns the cut-off work (the re-scope). Cost accepted: one turn per cut-off chat at every restart, deliberate ones included; a feature's Stop still stops its lead.

## 25. Carrying on after the usage limit is a setting, off by default, suggested where the limit stops a chat
**Supersedes:** 9.
**Decision:** One install-wide setting on Settings' General page, "Carry on when the usage limit resets", off by default. On: every chat the limit stopped is woken once at the reset the runtime reports, turns the human's own messages started included, with runcastle's messages held during the limit riding that wake. Off: nothing wakes at the reset; runcastle's messages are still held during the limit and ride the human's next message to that chat. Whenever the limit stops a chat, that chat shows one quiet line: with the setting off, "The usage limit stopped this turn. Runcastle can carry on by itself when the limit resets.", its "carry on by itself" opening the setting; with it on, "Runcastle carries on at <time>." An unknown reset time wakes nothing.
**Why:** The human: some would feel this uses up their weekly limit, so it is their choice; the line in the stopped chat is where they learn the setting exists.
