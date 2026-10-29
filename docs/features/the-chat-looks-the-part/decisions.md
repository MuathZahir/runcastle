# Decisions — The chat looks the part

Planned without the human (2026-10-29). Each decision below is the planner's
own recommendation, accepted so the plan could be finished; the ones marked
**Assumed.** wait for the human's word.

## 1. This pass keeps the approved chat and restyles it
**Decision:** The chat keeps the shape the human approved in "Chat as web components" (its decision 8): a raised composer floating over the thread's faded foot, the agent's words as full-width prose with no avatar or name, your words in a bubble on the right, a settled turn's work folded to "Worked for …", the changed-files card, and asks docking in the composer's place. This feature puts that shape on the shared material and fixes its layout; it adds no behaviour. It applies to every chat at once, because feature chats, side threads, scenario chats, the Orchestrator's chats and the preparation chat all render through the one chat column.
**Why:** The human approved that shape three days ago after asking for "t3code's level"; the brief asks for the shared style applied and the chat's own layout fixed, not a new direction.
**Assumed.** Alternative: a fresh direction, such as a name and mark on every message or both sides as bubbles.
**Challenged:** The brief says to show directions, plural; the Tweaks menu's small switches are not a real choice of direction, so one bolder alternative should be drawn too.

## 2. A turn is the unit of space
**Decision:** Space in the thread follows the conversation: the parts of one turn (your message, the agent's work line, its answer, the changed-files card, an answered-ask line) sit close together, 12px apart, and a new turn starts after 32px of air. Dividers ("Now on Sonnet 5.5", "Conversation compacted") take the same air as a new turn.
**Why:** Today every item is 24px from the next, so an answer sits as far from its own question as from the next one, and a long thread reads as an even list rather than a conversation.
**Assumed.** Alternative: keep the even 24px spacing and only restyle the pieces.

## 3. Your message keeps today's bubble
**Decision:** Your message keeps today's bubble: its stronger tint with the inner highlight, at 10px corners. The other surfaces in the thread that mixed their own tint (the changed-files card) wear the shared card.
**Why:** The human compared the card, the well and today's bubble in the preview and chose today's (2026-10-29).

## 4. The composer is one object
**Decision:** The agent's task list ("2 of 5 · Keep code blocks whole …") and its running background commands move inside the composer's box as its top section, under a hairline, instead of a separate tab of another colour sitting on the box. The context meter moves into the composer's own footer row, beside attach and send. Where the agent works ("Feature worktree · feature/x") stays a quiet caption under the box.
**Why:** Today the composer is three stacked things in three grounds (the inset tab, the raised box, a caption line with a lone ring under it); one box with sections reads calmer and puts every control where the hand already is.
**Assumed.** Alternative: keep the strip as a tab over the box and the meter beside the caption.

## 5. The header leads with the feature's name; the thread trails it
**Decision:** In the page's one header row over a chat, the feature's title (or the project's name) reads first at full strength, the thread in front follows it in quieter type, then the status line. Its content and buttons stay as they are. This needs one shared change: the breadcrumb (`Crumbs`, shared by every page header) gains a way to show its last item quietly. The human chose this over today's emphasis in the preview (2026-10-29).
**Why:** The page is the feature; "Feature chat" in bold beside a dimmed feature title reads backwards, and the sidebar already marks which thread is open.

## 6. The notice cards drop the retired marks
**Decision:** The cards that float over the chat (a round finished, a run failed, what to test) keep their place, their stacking and their words. They lose what the design guide has retired: the uppercase eyebrow becomes sentence case, the coloured glow from the corner goes, the "×3" pill becomes a plain count, the title drops to medium weight, and the tinted action becomes the shared small button. The phase colour stays on the card's glyph and its eyebrow word.
**Why:** The design guide retires uppercase tracked labels, glows and tinted pills; these cards are the last place in the chat that still carries all three.
**Assumed.** Alternative: keep the coloured cards as they are; they are louder on purpose, since they call you to the panel.
**Challenged:** These cards call you to act; with only a small coloured glyph, a finished round or a failed run could be missed in a calm thread. Keep one clear phase-coloured mark, such as a coloured left edge.

## 7. A new thread keeps its composer at the foot
**Decision:** An empty thread shows its "New thread" note centred in the column, and the composer stays at the foot where every other thread has it.
**Why:** The composer never moves, so the eye always finds it in one place, and the first message does not make it jump.
**Assumed.** Alternative: centre the composer in an empty thread, as many chat apps do, and drop it to the foot on the first message.

## 8. The agent's formatted text keeps the shared Markdown look
**Decision:** Headings, lists, tables, inline code and code blocks in the agent's answers keep the look of the app's one Markdown renderer, which also draws specs and docs. This feature changes only the space around the answer, not the Markdown inside it.
**Why:** The renderer is shared; restyling it here would change every doc view in the app, which the brief leaves to the foundation and to "The rest of the app looks the part".
**Assumed.** Alternative: restyle code blocks and tables for the chat alone, at the cost of the chat and the docs drawing Markdown two ways.

## 9. Live work keeps showing step by step
**Decision:** While a turn runs, its work keeps showing each step as it lands (the call in flight shimmering, narration between), then folds to "Worked for …" when the turn ends, as approved. Only the space around it changes.
**Why:** The human approved the live steps in "Chat as web components"; a single updating line would hide what the agent is doing, which is behaviour, not look.
**Assumed.** Alternative: one quiet line that updates in place while the turn runs.

## 10. While the agent asks, the task list waits with the composer
**Decision:** When the agent asks you something (an approval, a question, a form), the ask takes the composer's place as today, and the task list and background commands, now inside the composer, are out of view until you answer.
**Why:** The ask is the one thing to look at in that moment, and it is how the chat behaves today; the task list returns with the composer.
**Assumed.** Alternative: keep the task list showing above the ask, so you keep the context of what the agent was doing.

## 11. An answer's actions hang under its changed-files card
**Decision:** When a turn ends with a changed-files card, the answer and the card are one block, and the answer's hover actions (copy, branch, the model's name) hang under the card instead of in the gap between the answer and the card.
**Why:** The human's note "Weird spacing" (2026-10-29) shows those actions floating between an answer and its card. With decision 2's tighter 12px gap they would cover the card.
**Assumed.** Alternative: keep the actions under the answer's text and leave the old 24px gap before the card.

## Revisited 2026-10-29 (after the human looked at the designs)

## 12. Calls of one kind in a row read as one line
**Decision:** Two or more calls of one family in a row fold into one line, as Claude Code reads them: looking around ("Read 3 files, searched for 1 pattern"), changing files ("Edited 5 files +40 −12", a file edited twice counted once), and running commands ("Ran 3 commands"). The line opens to each call. While one call in the run is in flight, the line reads in the present ("Running 2 commands") and names that call, so you see what is happening without opening it. A failed call adds "· 1 failed". A single call, an MCP tool, a skill and a review still read as their own line.
**Why:** The human: "multiple edits would read as 'Edited 5 files' and can be expanded to see the tool calls."

## 13. A subagent is a card
**Decision:** A subagent the turn delegates to is a card (the shared card material): its head says "Subagent", what it was asked and how many calls it made, and opens to its calls, grouped as in decision 12. While it runs, its call in flight shows under the head, and only that call spins.
**Why:** The human: "The subagent tool call looks bad. It should probably be a card." It is a piece of work on its own, not one more line among the calls.

## 14. One spinner at a time; "Working" moves into the composer
**Decision:** The thread loses its "Working 1m 18s · Esc to stop" line. While a turn runs, the composer says "Working 1m 18s" beside Stop, with no spinner of its own, and the box's travelling edge light stays. The only spinner in view is the call in flight. The context meter becomes a short bar with its percentage, so it no longer looks like a third spinner; it steps aside for "Working" while a turn runs.
**Why:** The human found the two circling spinners while a command runs weird ("maybe we remove the working, make it look different"). The meter's partial ring read as a spinner too.

## 15. The last message's buttons clear the composer
**Decision:** The thread keeps room under its last message for the hover buttons (copy, branch, the model's name), and the composer's fade above its box is shorter (24px), so at the foot of the thread those buttons are never under the fade.
**Why:** The human: scrolled all the way down, the copy and branch buttons were partly covered by the composer's background.

## 16. Three materials, one per job
**Decision:** Every container in the chat is one of three materials, chosen by what it is. Raised floats over the thread: the composer, a message being edited, an ask, a notice card (the raised ground, one soft shadow). The well sits in the thread: your message, a turn's changed files, a subagent (a see-through tint with a hairline edge, today's bubble look). Inset is code-shaped and sits inside one of the two: a command, its output, a diff, an attached image. Raised and well catch the same 1px highlight on their top edge. Each material is defined once, in the chat's own module, and nothing in the chat styles a container by hand. Supersedes: 3's line that the changed-files card wears the shared card, and 13's card material.
**Why:** The human: "there's a lot of different card styles and colors … the input text box is different than the message which is different than the subagent card." The chat had six hand-mixed recipes for its containers; three, each with one job, read as one design.

## 17. "/" lists commands and skills anywhere in the message
**Decision:** Typing "/" at the start of the message or after a space opens the list of commands and skills, as "@" does for files; picking one puts its name in place and keeps the rest of the message.
**Why:** The human: skill autocomplete only works at the start. It is a small change to the box being restyled here; whether the agent acts on a name in mid-message is up to the agent, as when you type it by hand.
