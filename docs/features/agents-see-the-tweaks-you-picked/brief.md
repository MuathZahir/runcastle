## Purpose

The human said: "Agents can't see the tweaks that were chosen by the user in the design panel."

When an agent is unsure about a look (accent, density, which layout), the feature skill's design guide (`packages/skills/packs/runcastle/skills/feature/references/design.md`, section 4 "Tweaks") has it add a small collapsible Tweaks menu to the design page, folded into the "Design · states" switcher panel. The page runs on the feature's design server, cross-origin, in an iframe inside runcastle's Design tab (`apps/web/src/components/PreviewPanel.tsx`; phone: `PhoneDesignView.tsx` via the design-pass proxy). The human's picks stay inside that frame. On Approve, the lead gets only `allApprovedLine` (`packages/server/src/services/designs.ts`): the design's title and path, no values. The only bridge today is a one-line readout of the values the human is meant to copy and paste, a rule kept by the shipped feature `one-design-per-screen-with-its-states-inside`. In practice agents don't see the picks.

## Decided with the human (orchestrator grill, 2026-11-10)

1. **When the values reach the agent:** on Approve, AND with every chat message the human sends while a design is open in the Design tab. So "make this darker" arrives with the tweak values and the state they are looking at.
2. **Only the open design.** When a feature has several designs, a chat message carries only the tweaks and state of the design that is open, never the others'. Approve carries the approved design's values.
3. **Drop the copy-paste readout line** from the design guide. The Tweaks menu itself stays (three or four controls, deleted at approval, as today).
4. **No silent gaps.** When a design page reported no tweak values (an older page, or an agent that forgot to wire it), the agent's message says plainly that this design reported no tweak values, so silence is never read as "no changes".

## Understood

- The mechanism leaned towards: the design guide tells agents to make the design page `postMessage` its current state and tweak values up to the parent window whenever they change (one standard browser call, any framework, works through the phone's design-pass proxy). The Design tab keeps the latest values per design, and runcastle attaches them to the approval line and to the human's chat messages. How it is built is the feature's call. The values the human sees must be what the agent gets.
- Approve should use the last values reported for that design, even if the frame isn't loaded at the moment of the click (e.g. approving from a card).
- Language-agnostic: runcastle only relays what the page reports. It never parses design code.
- The guide change reaches live sessions only after runcastle is published and reinstalled (sessions read the globally installed skill pack).

## Must not swallow

- Redesigning the Tweaks menu or the state switcher.
- Reworking how approval works (the Approve button, design states, the quiet-until-last rule).
- Migrating design pages already committed.
- A shared switcher/tweaks helper component (the shipped feature decided against one).

## Open

- The exact message format the agent sees, and how the state is shown alongside the tweaks: the plan's call, kept short and readable.
- The human wants to try it with a real design that has tweaks before it merges (finish: show me before merging).

## Ordering

Standalone. No siblings in this cut; nothing waits on it.

Planning mode: plans itself
