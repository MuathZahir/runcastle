# Decisions — Agents see the tweaks you picked

Planned without the human (headless run, 2026-11-10). Decisions 1–4 were settled
with the human in the orchestrator's grill; the human chose 12 in chat and said
yes to the plan holding the rest. 8 and 9 were superseded before that yes and
keep their marks as history.

## 1. When the values reach the agent
**Decision:** On Approve, and with every chat message the human sends while a design is open in the Design tab. "Make this darker" arrives with the tweak values and the state the human is looking at.
**Why:** Both are moments the agent acts on the look; the human should never have to retype what they picked.
**Superseded by 12.**

## 2. Only the open design
**Decision:** When a feature has several designs, a chat message carries only the tweaks and state of the design that is open, never the others'. Approve carries the approved design's values.
**Why:** The open design is what the human is talking about; the others are noise.

## 3. Drop the copy-paste readout line
**Decision:** The design guide no longer asks for a one-line readout of the values for the human to copy. The Tweaks menu itself stays (three or four controls, deleted at approval, as today).
**Why:** The readout was a workaround for exactly the gap this feature closes.

## 4. No silent gaps
**Decision:** When a design page reported no tweak values (an older page, or an agent that forgot to wire it), the agent's message says plainly that this design reported no tweak values, so silence is never read as "no changes".
**Why:** An agent that assumes "no values" means "defaults" would build the wrong look.

## 5. The design page reports; runcastle only relays
**Decision:** The design guide tells agents to make the design page send its current state and tweak values up to the window around it (one standard browser message) on load and on every change. The Design tab listens to the frame it shows and to nothing else. Runcastle never reads design code; it passes on what the page said.
**Why:** It works in any framework and any language, through the phone's design proxy as well as on desktop, and the values the agent gets are the ones the page shows.

## 6. Runcastle keeps each design's last report
**Decision:** Runcastle stores the latest state and tweak values each design page reported, on the design itself, so they survive a reload and reach another device. Approve uses that stored report, even when approved from a card, on the phone, or with the frame not loaded. The lead also finds it on each design in its feature context.
**Why:** The brief wants Approve to use the last values reported even when the frame is not loaded; only a stored copy does that across reloads and devices.

## 7. Approval carries each approved design's values in the one line
**Decision:** Approvals stay quiet until the last waiting design is approved, as today. Each Approve click keeps a copy of that design's last report at that moment. The one line sent when the last design is approved gives, for each approved design, the tweak values kept at its click (or says it reported none), and tells the lead to write those values into the code before deleting the Tweaks menu. The state the human last looked at is left out of the approval line.
**Why:** Keeps the approval rules untouched (the brief rules out reworking them) while every approved design's picks arrive, and fiddling with a design after approving it cannot leak into what was approved. At approval the state is noise: the whole page is approved, not one state.

## 8. On the phone, the design you just left counts as open
**Decision:** On the phone, the chat and the design view are never on screen together. So a message sent from the chat carries the design the human last had open, until they open another view or leave the feature. On desktop, the open design is the one the Design tab shows; when the side panel shows something else, nothing goes along.
**Why:** Without this, "make it darker" typed on the phone after looking at a design would never carry the values, which is the main thing the feature is for.
**Assumed.** Alternative: the phone attaches nothing to chat messages and only Approve carries values there.
**For the human.** On the phone, messages carry a design's values after you have left the design view.
**Superseded by 12.**

## 9. You see what goes along with your message
**Decision:** While a design counts as open, a quiet line above the composer says what will go with the message ("Invoice list · state full · accent teal, density compact"). The sent message shows the same line under the human's own words. The agent gets the human's words followed by one `[runcastle]` line naming the design, its state and its tweak values. It goes with every message, changed or not, and the human cannot edit or remove it: to correct a value they change the Tweak, or say so in words.
**Why:** The human should never be surprised by what the agent was told, and the sent line is the record of it. Every message carries it by the brief's own decision, so an off switch or an editable line adds controls nobody asked for, and an edited line would stop matching the page.
**Assumed.** Alternative: attach it invisibly, with the human seeing nothing.
**For the human.** A new line above the composer and under your sent messages while a design is open.
**Superseded by 12.**

## 10. "No Tweaks menu" is said by the page, never guessed
**Decision:** A page reports its tweaks as a set of values, empty when it has no Tweaks menu. A report with an empty set is told to the agent as "no Tweaks menu". A report with no tweaks field at all, or no report from the page, is told as "this design reported no tweak values". Both are said plainly in the agent's line; the human's line shows "reported nothing" for the second. The guide asks every design page to report, single-state pages included.
**Why:** Most designs have no Tweaks menu; telling the lead "reported no tweak values" for every one of them would teach it to ignore the warning decision 4 asks for. Guessing "no menu" from a missing field would hide a page that forgot to wire its menu, the very gap decision 4 forbids.

## 11. A page remembers its tweaks across a reload
**Decision:** The guide asks a design page to keep its tweak values in its own browser storage and restore them on load, so a reload (the agent's code edit, a remount, the human pressing reload) shows the human's picks again rather than the defaults. Runcastle sends nothing back into the page: what the page reports on load is what it shows, and that is what is stored.
**Why:** A page that reset on every reload would report its defaults and quietly overwrite the human's picks before Approve. Keeping it in the page costs a few lines there and keeps runcastle a one-way relay.

## 12. The values go to the agent only on Approve
**Decision:** The tweak values reach the agent only in the approval line. Chat messages carry nothing extra, there is no button to send the values, and nothing new appears above the composer or under sent messages. Supersedes: 1 (the chat-message half), 8 and 9; decision 2 now applies to Approve only.
**Why:** The human chose it: Approve is the moment the picks matter, and sending them with every message (or behind a button) was machinery they did not want.
