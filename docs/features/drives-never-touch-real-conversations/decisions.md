# Decisions — Drives never touch real conversations

Planned without the human (a self-planning run, 2026-11-06). Every decision is
assumed until the human confirms it.

Check first: 1, 2, 7, 9

## 1. The drive's server detaches its copied database at boot
**Decision:** The drive setup tells the drive's server that its database is a copy (one setting in the drive's environment). On boot, before anything is reconciled or woken, that server cuts the copy loose from the live install: no conversation can be continued, nothing that was running is woken, no drive is recovered, no phone is pinged (decisions 3 to 6). A server without the setting behaves exactly as today. The drive keeps the human's real Claude Code login and config dir.
**Why:** Every leak in the brief comes from the drive's server acting on records it copied: conversation ids it resumed, runs it "recovered", the live drive it took for its own. Cutting those records loose at boot, in the server's own code, sits after the branch's migrations and is testable with the rest of the server. A separate Claude config dir would stop resumes too, but the drive's own chats then lose the human's login, plugins and the transcripts the drive shows as history, and the launcher already decided against relocating the config dir.
**Assumed.** Alternative: scrub the copy with SQL in the drive setup script and change no server code, or give the drive its own Claude config dir (the brief offered both).
**Challenged:** A drive boots the driven branch's own server code, so drives of branches cut before this merges keep leaking until they take main; a second guard outside the branch's code would cover them. The answer stands: the drive setup script also runs from the driven branch, so an SQL scrub there has the same gap, and leads take main routinely.

## 2. An agent the driver talks to in a drive starts a fresh conversation
**Decision:** In a drive, a chat still shows its real history (read-only, from the transcript on disk), but the first message the driver sends starts a new conversation with no memory of it. The real one is never continued, forked or switched. This holds for Claude Code and Codex conversations alike.
**Why:** It is the smallest rule that guarantees the real transcript is untouched and costs nothing until the driver actually talks to an agent. Drives of runcastle test runcastle's own screens and flows, which a fresh agent serves.
**Assumed.** Alternative: open each drive chat as a fork, a private copy of the real conversation that keeps its memory, at the cost of re-reading the whole conversation (hundreds of thousands of tokens on a long lead) on the first message.

## 3. Runs that were running in the live install end quietly in the copy
**Decision:** A round or other run still running in the live install when the drive copied it is closed in the copy as "still running in your real runcastle when this drive started", with its burning tickets likewise. No lead is woken, no orchestrator hears about it, and the close does no git work: nothing is landed on a real branch.
**Why:** Today the drive's boot calls those runs "interrupted by a server restart" and wakes their leads: the 22 phantom prompts, the re-dispatch that failed with "auth token missing", and the out-of-order round reports all start here. Even with conversations cut loose (decision 2), a wake would start a fresh lead in the drive that could dispatch a real round. Today's restart cleanup also lands a parked chat branch onto the real feature branch, which a copy has no business doing.
**Assumed.** Alternative: leave them running in the copy and only stop the wakes, so the drive shows a round as running that nothing drives.

## 4. A drive never recovers the live install's drives
**Decision:** The drive's server does not take any drive recorded in the copy (including the very drive it belongs to) as one "cut off by a restart", so it never holds that drive's slot or offers to Stop it.
**Why:** The copy always holds the live drive's start, and the real checkout sits on that branch, so the drive's server takes it for its own leftover. Stopping it from inside the drive runs the real drive's stop script: that is the "stopped the leftover drive" that belonged to a live review.
**Assumed.** Alternative: none worth keeping; recovering a drive only makes sense for the server that started it.

## 5. A drive never pings the human's phone from the copy
**Decision:** The copy drops the phone subscriptions it inherited, so nothing that happens in a drive reaches the human's real phone. A drive that tests phone pings subscribes a device to the drive itself.
**Why:** Phone subscriptions live in the database, so today a drive pings the real phone whenever a copied feature "starts needing" the human: fake news on the lock screen, the same family as the phantom prompts.
**Assumed.** Alternative: keep them, so a drive can test phone pings without subscribing again.

## 6. History stays visible in the drive
**Decision:** Records are kept, not deleted: features, tickets, rounds, events and each chat's history all stay in the copy. Only the links that let the drive act on the live install go (conversation ids, running state, drive slots, phone subscriptions).
**Why:** Drives exist to exercise runcastle against real data at every step; an emptied copy would test a blank app.
**Assumed.** Alternative: delete the agent session records from the copy outright, which is simpler but leaves every chat in the drive empty.

## 7. When the human merges and it conflicts, the orchestrator is told it is in hand
**Decision:** The orchestrator's news line for a merge conflict says who merged. When the human merged, it says the human has the Resolve button on the feature and the orchestrator should not relay the conflict unless the human asks. The orchestrator also hears when a conflict is resolved. A conflict on the orchestrator's own merge is unchanged: the merge tool already returns it.
**Why:** Today the news line itself says "Resolve it in the feature's worktree, then merge_feature again", so the orchestrator relayed a conflict the human had already sent the lead to resolve, four minutes later, after the lead had finished (12M tokens including a two-subagent review).
**Assumed.** Alternative: block or annotate any orchestrator message to a lead while a resolve is under way, which needs runcastle to guess what a free-text message is about.

## 8. A lead checks a conflict still stands before resolving it
**Decision:** Before resolving a merge conflict, from any source, the lead checks git: if the base is already in the branch, it says so in one line and stops, with no re-verification or review.
**Why:** It is the last guard that holds whatever order messages arrive in, and it costs one git command.
**Assumed.** Alternative: rely on decision 7 alone.

## 9. In a drive, only the driver starts a conversation
**Decision:** runcastle's automatic messages in a drive (orchestrator news, round-end wakes, any other wake) reach only conversations that began in this drive. A copied thread with no conversation yet stays quiet until the driver types to it; from then on it hears news like any other thread.
**Why:** Cutting conversation ids (decision 2) means the next automatic message would start a fresh agent in the drive, unasked: tokens spent, and an agent with tools that dispatch real rounds on the human's account. Once the driver has started a conversation, its wakes are part of what the drive tests.
**Assumed.** Alternative: let automatic messages start fresh agents in a drive as they would in the live install, so the drive behaves exactly like the real app.
