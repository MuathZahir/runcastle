# One place to answer

## Problem

The human cannot tell where to answer. A feature's question can reach them in the epic (the orchestrator chat that cut it) and in the feature's own chat; a design can be asked about in the epic and also wait in the feature's Design tab; ownership flips halfway ("Yours to plan · then <Epic>"). An epic told them to go to a feature's chat and asked the question itself as well. Relaying their answers through the epic has failed: leads refuse a design approval that arrives that way, so the human answered twice. The root: the human has two modes, hands-on and "do it while I'm gone", and runcastle made the epic the owner of features the human was actively watching whenever a feature planned itself.

## Approach

**From the human's side.** A feature is theirs unless they told an epic "run it for me". Theirs means they answer in its chat; the epic's means they answer in the epic. Its header button says which ("Yours", "<Epic> · you merge", "<Epic> · merges it") and the other agent never asks them anything about it (decisions 1–3). When a feature an epic runs needs them, it becomes theirs: the feature's chat shows a runcastle line "This is yours now: it needed you. <Epic> carries on with the rest of the batch." above the lead's question, the row goes yellow as for any of their features, and the epic says once "<Feature> needs you, so it's yours now. Open its chat to answer." (decisions 4, 9, 13). Once theirs, it never goes back by itself; the owner button or "run it for me" in the epic gives it back (decision 8). About features it runs, the epic asks only what is unclear before starting and, at the end, one report: what to look at, a drive started for the first "show me first" feature, and "merge these?". A plain yes is given there; anything wrong is typed in the feature's chat, which makes it theirs (decisions 5, 12). Asked "what's waiting for me?", the epic names each item's one place — "answer in its chat", "answer here", "in <that epic>" — and never restates a feature's question (decision 15).

**Cutting.** The epic asks one question per feature (decision 14): **Plan it with me** (theirs, grilled), **Plan automatically** (theirs, plans alone and shows the plan in its chat), or **Run it for me** (the epic's, plans automatically; then "show you first, or merge?"). For a "Plan automatically" feature of the human's that it cut, the epic may start it and start its planning run once, when the cut's order says it is that feature's turn; nothing else (decision 16).

**Server shape.** Identifiers stay (`planning: 'with-me' | 'self'`, `finish: 'you' | 'show' | 'merge'`, `held_by` as owner, `chat_id` as the epic it came from).

- **`create_feature` from an epic**: the epic owns the feature exactly when `finish` is not `you` ("run it for me"), whatever `planning` says; `planning: 'with-me'` with a `finish` other than `you` is refused with a line saying a grilled feature is the human's and can be given to the epic afterwards. Its parameter descriptions say the three answers.
- **No hand-over at the plan's yes**: `hand_back`'s `planAgreed` parameter and the pass-at-plan-yes step go. A human-owned feature's finish is always `you` (decision 8).
- **`wait_for_you` under an epic owner** is no longer refused: it releases the feature to the human (a new owner-change cause, beside "typed"; finish becomes `you`; one owner-changed event; any outstanding handback cleared), records the wait as today, and wakes the owning epic with one line naming the feature and telling it to say "<Feature> needs you, so it's yours now. Open its chat to answer." and nothing more about it. The release also produces the runcastle line in the feature's chat (decision 13). `hand_back` under an epic owner stays for what the epic answers itself: the plan's yes under automatic planning, "ready", merge conflicts. `notify_human` under an epic owner stays refused.
- **The relay goes** (decision 11): `send_to_feature` loses `relaysHuman` and the "The human's own answer, relayed by the project's orchestrator" header. Plain "From the project's orchestrator, not the human" notes stay.
- **The epic's acting tools** stay refused on the human's features, with one allowance: starting, and starting the planning run of, a feature whose epic (`chat_id`) is the calling chat, whose brief says "Planning mode: automatic", and which has never had a planning run (decision 16).
- **Move at ship** (decision 10): a one-time, marker-guarded boot step, as the earlier holder moves were. Features an epic owns keep it and their finish. A feature the human owns with a finish other than `you` gets `you`. It records what it moved.
- `hand_back` from the human's feature to the epic it came from (questions beyond the feature) is unchanged, as is taking a feature by typing in its chat.

**Web.** The owner reading loses its "planning" state: a feature with no holder reads "Yours" whatever its finish. "Yours to plan · then <Epic>" and its sidebar variant go. The owner menu's two epic hints gain "If it needs you, it becomes yours." The feature's chat renders the runcastle hand-over line at the point the feature became the human's because it needed them (not when they took it by typing). No other new words: the row reads "Yours · <its need>".

**Skills.**

- **Feature lead**: "talk to your owner" keeps one rule but changes under an epic: anything only the human can decide (a what/where/who question, a design to approve, a stuck worker, a "for the human" decision in an automatic plan) goes to `wait_for_you`, which makes the feature the human's; the plan's yes, ready and conflicts go to the epic by `hand_back`. The plan-yes hand-over (`planAgreed`) and the rule that a relayed answer counts as the human go. The lone-planning reference follows the same split.
- **Project (epic)**: the cut asks the one three-answer question; "run it for me" is the only way it owns a feature it cuts; it never relays the human's words, never restates a feature's question, and points the human to the feature's chat; when a feature it runs becomes the human's it says the one line and carries on with the batch; its end report lists what to look at, starts the first drive for "show me first" features, and asks "merge these?"; feedback beyond a yes goes to the feature's chat; "what's waiting for me?" names each item's place; it may start the planning run of the human's "Plan automatically" features per decision 16. Mentions of `relaysHuman`, the plan-yes hand-over, and relaying a grilled feature's yes go.

## Seams

All existing.

- **The ownership service** (the single writer of owner, epic and finish): observe the new release-because-it-needs-you cause (finish `you`, one event, handback cleared), the ship-time move, and that no plan-yes pass remains.
- **The MCP tools**: `create_feature` owner by finish and the refused grilled-plus-epic mix; `wait_for_you` under an epic owner releasing and waking the epic with its line; `hand_back` without `planAgreed`; `send_to_feature` without `relaysHuman`; the start/plan allowance and its limits (another epic's feature, a "Plan it with me" brief, a second planning run).
- **The owner reading and owner control** (web unit and component tests): no planning state; the new hints.
- **The feature chat**: the hand-over line appears after a needs-you release and not after a typed take.
- **The skill text tests** (orchestrator, feature, lone-planning): the three-answer cut question, the lead's split, no relay, the one-place listing.

## Out of scope

- What news reaches the epic, merge notices included: the sibling "The epic hears when its features merge" (the epic a feature came from stays its own field, distinct from the owner).
- Any redesign of the epic or orchestrator layer, and a "Waiting for you" screen (decision 15).
- Amending ADR-0016 and the charter: the orchestrator writes those; this feature hands back what changed.
- Historical feature docs.

## Open questions

None.
