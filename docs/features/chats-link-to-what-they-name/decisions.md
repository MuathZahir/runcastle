# Decisions — Chats link to what they name

Planned without the human (a headless planning run, 2026-11-13). The brief settles what the human wants: an agent can link what it names, a feature and a worker's chat first; one click opens it; it works the same on a phone; a link to something that does not exist reads as plain text. Every decision below is the lead's assumption, to be checked.

Check first: 1, 2, 3, 4, 6

An independent challenger read the brief and decisions 1–6. Its unasked branches became decisions 7–11; where it disagreed, the decision carries a **Challenged:** line and the lead's answer stands.

## 1. Agents write ordinary markdown links with a runcastle target
**Decision:** An agent links what it names with a markdown link whose target names a runcastle thing: `[Faster reviews](feature:faster-cheaper-reviews)`. Nothing turns into a link unless the agent wrote it as one.
**Why:** Every agent already writes markdown links, so the habit is free; the agent chooses what is a link, so no ordinary word lights up by mistake. Turning known names into links by themselves would catch common words that happen to be feature titles ("Review", "Settings") and would link every mention, not the one the agent points at.
**Assumed.** Alternative: any known feature slug or title in an agent's words becomes a link by itself.
**For the human.** How links appear in chats depends on this: only where the agent chose to link.

## 2. Three things can be linked: a feature, its Plan or Design tab, and a worker's chat
**Decision:** `feature:<slug>` opens a feature. `feature:<slug>/plan` and `feature:<slug>/design` open its Plan or Design tab. `worker:<worker id>` opens that worker's chat, in whichever feature owns it. Files shown with `show_file` are not linkable, and a design links only as far as its feature's Design tab.
**Why:** Features and workers are what the brief asks for. The Plan and Design tabs cost one word each, because the app already opens a feature on a given tab; they are where "look at the plan" and "approve the design" send the human. A shown file is already a card in the same chat, and no address for one design exists yet.
**Assumed.** Alternative: features and workers only; or a link to one exact design and to shown files too.
**For the human.** It decides where an agent can send them with one click.

## 3. A feature link lands where a sidebar click lands
**Decision:** Clicking a feature link does exactly what clicking the feature in the sidebar does: on a phone it opens the feature's chat; on a desktop it opens the feature on the view the human last had open there. A worker link opens that worker's chat inside its feature, as the worker row in a feature does today.
**Why:** One feature should open one way, whichever door the human uses; a second rule for links would surprise them. On a phone, where most of the "go look at this" happens, both rules already give the chat.
**Assumed.** Alternative: a feature link always opens the feature's lead chat, even on a desktop.
**Challenged:** a link carries the agent's intent ("go talk to that lead"), so it should always open the lead's chat; the remembered view could be a diff or a settings view. The lead's answer stands: on a desktop the lead's chat sits beside whatever panel is open, so the human lands with the lead in view either way.
**For the human.** It decides where they land after a click.

## 4. A link looks like any other link in chat text
**Decision:** A runcastle link uses the one link look chat text already has (accent-coloured text, underlined on hover). No chip, icon or status dot. A link to something that does not exist, or that the chat cannot resolve, shows its words as plain text with no mark.
**Why:** The human asked for a click, not a new kind of badge; a plain link keeps the agent's sentence reading as a sentence. A status dot beside a feature's name belongs with the "Needs you is the agent's call" work, which this feature must not swallow.
**Assumed.** Alternative: a small chip with the feature's status dot, or a link icon, so runcastle links stand out from web links.
**Challenged:** the look is right, but a silent miss hides agents that get slugs wrong; log failed links where a lead or a test can see them. The lead's answer stands (decision 11): agents link only names a tool gave them, and logging misses is machinery for a problem not yet seen.
**For the human.** It is how links look in every chat.

## 5. Every agent chat renders them, on desktop and phone
**Decision:** Links work in the orchestrator's chat, every feature lead's chat and every worker's chat (the Review worker's included), on desktop and phone alike. Links resolve within the chat's own project; a target in another project reads as plain text.
**Why:** The brief asks for any agent. Every chat's agent text already goes through one markdown renderer, so covering all of them is the same work as covering one. Projects never share features, and an agent has no reason to send the human across projects.
**Assumed.** Alternative: links only in the orchestrator's and the leads' chats.

## 6. One linking rule, in every briefing that talks to the human
**Decision:** One rule, a line or two, goes into each place an agent is briefed: the orchestrator's skill, the feature lead's skill, the Q&A skill, the briefing every worker gets, and the Review worker's briefing. It says: when you point the human at a feature, a worker or a feature's Plan or Design tab, link it, and gives the three target forms. Nothing else in those briefings changes.
**Why:** The brief asks for one line per skill and leaves the skill rewrite to "Skills become short rules". Workers have no skill file: their briefing is built by the server, so the rule goes there too, or workers would never link.
**Assumed.** Alternative: the rule only in the orchestrator's and the lead's skills, the two that most often send the human somewhere.
**Challenged:** workers mostly talk to their lead, not the human, so their briefing could stay unchanged. The lead's answer stands: the human steps into "with you" workers and reads their words, and the rule costs one line.

## 7. Finished things still open
**Decision:** A link to a merged, archived or backlog feature opens it like any other feature, and a link to a landed or dropped worker opens that worker's past chat. Only a target the app has no record of reads as plain text.
**Why:** Old chats are full of names that have since finished; a link that silently stops working once its feature merges would teach the human not to trust links. The app already lists every feature of the project and every worker of a feature, finished or not, and slugs never change after a feature is created.
**Assumed.** Alternative: links to finished features and workers turn into plain text.
**For the human.** It decides what old chats' links do.

## 8. Back returns you, and a feature link is a real address
**Decision:** A feature link carries the feature's real address, so the browser's Back returns the human to the chat they clicked from, and Ctrl-click, middle-click or a long press on a phone opens it in a new tab. A worker link opens its feature's chat address, so Back works there too.
**Why:** On a phone, a link with no way back is worse than no link. The app already keeps its address in step with what is open and pushes a history entry on each move, so this is the link using that, not new machinery.
**Assumed.** Alternative: links switch the view in place, with no address of their own.
**For the human.** It decides how they get back after a click.

## 9. Chat text only
**Decision:** Links work in what agents write in chats. Feature docs shown in the Plan tab (brief, decisions, spec), phone notifications and the Review Package's findings keep showing names as plain text.
**Why:** The brief is about chats, and the docs render in a sealed frame that cannot reach the app's navigation. A notification's tap already lands on the chat that sent it, where the link is.
**Assumed.** Alternative: also link names in feature docs shown in the Plan tab.

## 10. No link to the orchestrator's chat
**Decision:** There is no target for the orchestrator's chat. "Your lead" is reached with a feature link, which opens the lead's chat.
**Why:** A project can hold several orchestrator conversations, so "the orchestrator" names no one chat; and leads and workers reach the orchestrator through their own tools, not by sending the human there.
**Assumed.** Alternative: an `orchestrator` target that opens the project's newest orchestrator chat.

## 11. Agents link only names a tool gave them; a miss stays quiet
**Decision:** The linking rule tells agents to use a slug or worker id they read from a runcastle tool, never one they guessed. The orchestrator gets worker ids from a full read of a feature. A link that resolves to nothing reads as plain text and is not logged anywhere.
**Why:** Agents already read slugs and worker ids from their context tools, so a correct link costs no lookup. A wrong link degrades to the words the agent would have written anyway, which is no worse than today; tracking misses would be machinery for a problem nobody has seen yet.
**Assumed.** Alternative: count or log links that resolve to nothing, so a lead or a test can spot agents getting names wrong.
