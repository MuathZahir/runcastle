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

## 3. Your message wears the card
**Decision:** Your message bubble is the app's one material, the card (a faint fill with a hairline edge), at the card's 10px corners, instead of its own stronger tint with an inner highlight. The preview's Tweaks menu offers the well (a slightly stronger fill, no edge) and today's bubble to compare.
**Why:** The sidebar's selected row, the Working bay and a live drive already wear the card; your message is the one hand-mixed surface left in the thread, and it reads heavier than everything around it.
**Assumed.** Alternative: keep today's stronger bubble, which stands out more in a long thread.
**Challenged:** Elsewhere the card marks something selected or live (the selected row, the Working bay, a live drive); putting it on every message you send weakens that meaning, so the well (a stronger fill, no edge) is the better fit.

## 4. The composer is one object
**Decision:** The agent's task list ("2 of 5 · Keep code blocks whole …") and its running background commands move inside the composer's box as its top section, under a hairline, instead of a separate tab of another colour sitting on the box. The context meter moves into the composer's own footer row, beside attach and send. Where the agent works ("Feature worktree · feature/x") stays a quiet caption under the box.
**Why:** Today the composer is three stacked things in three grounds (the inset tab, the raised box, a caption line with a lone ring under it); one box with sections reads calmer and puts every control where the hand already is.
**Assumed.** Alternative: keep the strip as a tab over the box and the meter beside the caption.

## 5. The header leads with the feature's name; the thread trails it
**Decision:** In the page's one header row over a chat, the feature's title (or the project's name) reads first at full strength, the thread in front follows it in quieter type, then the status line. Its content and buttons stay as they are. This needs one shared change: the breadcrumb (`Crumbs`, shared by every page header) gains a way to show its last item quietly. The preview's Tweaks menu offers today's emphasis, where the thread is the bold item, to compare.
**Why:** The page is the feature; "Feature chat" in bold beside a dimmed feature title reads backwards, and the sidebar already marks which thread is open.
**Assumed.** Alternative: keep the breadcrumb's usual emphasis, the thread bold and the feature dim.
**Challenged:** The breadcrumb is shared by every page and the foundation feature owns shared pieces, so the change should be put to the human openly rather than made inside a chat feature.

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
