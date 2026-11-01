# Decisions

Made without the human in a self-planning run on 2026-10-31. `brief.md` holds what was
already agreed (the rule for active, the fixed order, no cap, runtime titles, the
Orchestrator click); these settle what it left open.

## 1. A row's hold mark takes the age's spot
**Decision:** An Orchestrator thread row that holds features shows a mark at the right, where the age sits, and no age. Every other row keeps its age. No line, no label, no word.
**Why:** The row only fits the title and one short thing, and in an active-only list the age matters least. It is the human's own idea from the brief.
Superseded by: 18.

## 2. The mark counts features in flight or up next
**Decision:** The mark counts the same features that make a thread active: held, and in flight or up next. Held backlog, shipped and archived features are not counted, and a thread holding only those has no mark.
**Why:** One meaning for "holds" in the list: the mark is the reason the thread is there. An orchestrator that cuts five backlog features would otherwise wear a 5 for work nobody started.
**Assumed.** Alternative: count every unshipped feature the thread holds, backlog included.
**Challenged:** The tooltip and menu should list every unshipped feature, or a backlog feature's page says "held by X" while X shows nothing about it.

## 3. Feature names show on hover, and the row's "…" menu opens them
**Decision:** Hovering or focusing a holding row shows a tooltip naming its features. The row's "…" menu (also right-click) lists the same features above Rename, and picking one opens it. The chat itself gains nothing.
**Why:** The tooltip is the quick check the human asked for, and the menu is the same list where a click, a keyboard or a phone can use it. A strip in the thread would be a second new place to look.
**Assumed.** Alternative: a line or button in the chat's header naming the features, with no hover at all.

## 4. A thread active only by holding looks like any idle row
**Decision:** It shows the chat glyph, its title and the mark, with no extra word. The state column stays about the agent.
**Why:** The mark already says why the row is there. A word such as "holding" has no room and repeats it.
**Assumed.** Alternative: a dimmer or differently marked row for threads with nothing happening.

## 5. Runtime titles name Orchestrator threads only
**Decision:** The runtime's generated title may name a briefed thread only when it is an Orchestrator chat. A feature's main chat, side threads, scenario chats and preparation chats keep today's naming.
**Why:** The brief keeps threads under a feature as they are, and a feature lead's generated title summarises runcastle's briefing, not its subject.
**Assumed.** Alternative: let every thread kind use the runtime's title.

## 6. A junk title is spotted by a short list of phrases
**Decision:** A generated title that says "project session", "project skill" or "resume conversation" (any case) is ignored, and the thread falls back to the human's first message. Nothing else is parsed.
**Why:** Those phrases cover all the junk in the 21 real generated titles on this machine (11 of them; the six newest were all good), and they name the session rather than a subject. A list is one line to extend.
**Assumed.** Alternative: match only the exact title "Runcastle project session", which misses "Runcastle project skill" and "Project session invocation".
**Challenged:** Match whole titles instead. Runcastle is built with runcastle, so a real title like "Fixing the project session skill" would be thrown away.

## 7. Existing threads get their new names at once
**Decision:** Orchestrator threads with a log take their generated title as soon as this ships, because the log already holds it. Terminal-era threads keep their names. A human rename still wins. The name is the same wherever a thread is named: sidebar, header, Conversations page, and the holder's name agents see.
**Why:** The titles are on disk, and one name everywhere is how a thread stays recognisable. Terminal-era threads are read-only history, so re-reading their transcripts would cost work for names almost nobody sees.
**Assumed.** Alternative: apply the new naming only to threads started after this ships.

## 8. Codex needs no work of its own
**Decision:** Any runtime's title takes the same path. If Codex sends one it is used, and if not the thread keeps the first message.
**Why:** This machine has no Codex threads to check, and both outcomes are fine. The code path is the runtime-neutral one.
**Assumed.** Alternative: check Codex first and hold the feature on the answer.

## 9. A thread opened from Conversations stays listed only while it is active
**Decision:** Opening an old thread puts it in the list at its started-at place, and leaving it removes it unless the human wrote in it or something else makes it active.
**Why:** It follows from "the thread open now" and needs no extra rule. Writing in it is what brings a thread back for 24 hours.
**Assumed.** Alternative: keep any thread opened in the last 24 hours, not just written in.
**Challenged:** The brief's purpose is coming back to an older thread, and reading one then clicking away is that case. Keeping opened threads for 24 hours costs a stored last-opened time and some extra rows after browsing.

## 10. The Orchestrator's list runs newest started first
**Decision:** Active threads sort by when they started, newest first, as they do today. A new thread enters at the top.
**Why:** The brief keeps today's start-time sort, and the newest thread is usually the one being talked to.
**Assumed.** Alternative: oldest first, so a new thread never pushes the others down.

## 11. "All N conversations" stays, and is all the list shows when nothing is active
**Decision:** The row sits under the active threads whenever any thread is not listed, with N the project's total. With nothing active and the Conversations page open, the card holds only that row. The "+", the fold and the row menus are unchanged. A feature's own thread list keeps its five and "Show N more".
**Why:** It stays the one way to the rest, so the shorter list hides nothing. The fold and menus work per card and per row, so they do not care how long the list is.
**Assumed.** Alternative: hide the row when nothing is active, since the page is already open.
**Challenged:** Always show it. A row that comes and goes is a less dependable way to the page.

## 12. A project with no chats still opens on a new chat
**Decision:** Clicking Orchestrator opens the active thread with the latest activity (anything moving in it, as today, and once: a chat you are reading stays in front), then the Conversations page if chats exist and none is active, and an empty new chat if the project has none. A link or reload naming a chat still opens that chat.
**Why:** The brief's rule needs this one exception: a Conversations page with nothing on it is a dead end, and `the-orchestrator-s-page` decision 14 stands.
**Assumed.** Alternative: the empty Conversations page, whose "New chat" hint is one click further.

## 13. A feature's page names its holder as the first crumb
**Decision:** While a feature is unshipped and a thread holds it, the header's trail starts with that thread: the hub glyph and its name, then the feature, then the thread in front. Clicking it opens that thread. A feature with no holder keeps today's trail.
**Why:** The crumbs already read as "what this sits under", so this needs no new control. It is on the page at all times, one click away, without opening a panel.
**Assumed.** Alternative: a "Held by" row in the Details panel's facts, which is quieter but needs the panel open.
**Challenged:** Keep the crumb after shipping. Going from a shipped feature back to the thread that planned it is the same job.

## 14. "Waiting on the human" means an open question
**Decision:** A thread counts as waiting only in the state the list already shows: the agent has asked something and the question is open. A finished turn does not count.
**Why:** Counting every finished turn would keep nearly every thread listed for ever, and the list would not shrink. A reply to a recent message is covered by the 24-hour rule.
**Assumed.** Alternative: count a finished turn the human has not answered as waiting.

## 15. A thread leaves when its reason goes, with no grace period
**Decision:** When the last held feature ships, and nothing else makes the thread active, it leaves the list. It sits at the top of the Conversations page's day groups, and writing in it brings it back.
**Why:** A grace period would be a second clock beside the 24 hours, for a moment the human is on the feature's page anyway.
**Assumed.** Alternative: keep the thread listed for 24 hours after its last feature ships.

## 16. No way to dismiss a row by hand
**Decision:** The rule alone decides the list. A thread stuck on a wrong status stays listed until "Threads open fast and show the truth" fixes that status.
**Why:** The point of the feature is that the list needs no tending, and wrong statuses are that feature's job, next in line.
**Assumed.** Alternative: a "Hide" item in the row's menu.

## 17. Rows join and leave at once
**Decision:** When a thread becomes active or stops being active the list updates straight away, even under the pointer. The start-time order keeps every other row in the same relative place.
**Why:** It happens rarely, and freezing the list while the pointer is over it is machinery that hides news such as a thread starting to wait.
**Assumed.** Alternative: hold back removals until the pointer leaves the list.

## 18. Orchestrator thread rows show no time, and holders wear their features' rings
**Decision:** No row in the Orchestrator's list shows an age. A thread holding features ends with those features' progress rings: up to three, then "+N". A thread holding none shows nothing after its title. The Conversations page and the threads under a feature keep their times.
**Why:** The human's choice from the Tweaks: a column mixing times and rings doesn't work, and in an active-only list the time says little. The rings show what a thread holds and how far along it is.
Supersedes: 1.
