# Purpose

The human reported (2026-11-11) that they cannot tell where to answer: "If the agent told me to go talk to a feature agent, it shouldn't ask me itself. There shouldn't be confusion to the user ('where should I answer, the epic agent or the feature agent'). Things should be very streamlined and smooth." They want to feel in control and to know everything going on.

The orchestrator found there is no single rule a human can hold today. Where they answer depends on who owns the feature, how big it is and what kind of decision it is. A design can be asked about in the epic and also waits in the feature's Design tab. Ownership can flip halfway ("Yours to plan · then <Chat>"). The root is that the human has two real modes, hands-on and "do it while I'm gone", but runcastle models them as two separate settings (how a feature is planned, and how far the orchestrator takes it), and combining them makes the epic the owner of features the human is actively watching.

The human explained the two modes in their own words:
- Automatic planning ("plan it yourself") exists for simple features where the agent will get most of it right: "I just have to look at the plan it creates and modify that if needed", instead of a long grill.
- Epic ownership makes sense "when I want to get done with a couple features while I'm AFK", e.g. concrete fixes: "get these features started and merge them while I'm gone".

## Decided with the human

1. **A feature that plans itself stays the human's.** Its plan, its questions, its designs and its "ready" arrive in the feature's own chat. Planning alone no longer hands a feature to the epic.
2. **The epic owns a feature only when the human says so in words** ("run these for me", "do these while I'm gone"). Everything else is the human's, and they talk to its agent directly.
3. **One place per feature.** A feature is either the human's (they answer in its chat) or the epic's (they answer in the epic). Its header says which, and the other agent never asks the human anything about it. An agent that points the human somewhere else does not also ask the question itself.
4. **The epic never carries the human's decisions.** When a feature the epic is running needs the human (one of the never-guessed questions, a design to approve, anything only they can decide), that feature becomes the human's: the epic tells them once ("Fix B needs you, open its chat") and keeps the rest of the batch moving. The human answers in the feature's chat and it carries on from there.
5. **The epic asks the human only two things about features it runs**: before starting, anything unclear about the batch; at the end, one report with what to look at, and "merge these?" when they chose to see them first. Test-drive feedback beyond a plain yes goes to the feature's own chat.
6. **The per-cut question changes with it**: features are the human's by default; for the ones they hand to the epic, the orchestrator asks "show you first, or merge".
7. The accepted cost: an away batch where three features each need the human means three chats to open. It should be rare, since a batch left running is meant to hold work with nothing left to decide.

# Must not swallow

- What news reaches the epic, including merge notices: the sibling "The epic hears when its features merge". This feature only needs to keep "the epic a feature came from" distinct from "who owns it", so that sibling has something to build on.
- The never-guess rule and the rename of "plan it yourself": the sibling "Agents never guess what, where or who", which merges first. Use whatever name it settled.
- A redesign of the epic or orchestrator layer. The charter says the feature loop is the product and the layer above is plumbing.

# Understood

- This amends two shipped features: `every-feature-has-one-owner` and `the-orchestrator-recommends-which-features-you-grill` (their docs are at `docs/features/<slug>/`), and touches ADR-0016 (orchestrator threads hold features). Read them first; an ADR amendment is the orchestrator's to write, so hand that back rather than editing `docs/adr/`.
- It is server behaviour as well as instruction text: `create_feature`'s `planning` and `finish` choices, who becomes owner at creation and at the plan's yes, `hand_back`, `wait_for_you` being refused under a chat owner, `send_to_feature`'s `relaysHuman`, the feature header's owner line, and the project and feature skills.
- Relaying has already failed in practice: feature agents refuse a design approval that comes through the epic, so the human answered twice.
- A lead's cross-feature question still goes to the epic first by tool (facts and a recommendation), and the lead then asks the human in the feature's chat. That works and stays.

# Open (for the grill)

- What happens to features an epic owns today when this ships.
- What the feature header and the sidebar say for each of the two states, and how the hand-over to the human reads ("needs you, it is yours now").
- Whether `relaysHuman` is removed outright or kept for the end-of-batch "merge these?" go-ahead.
- How the human hands a feature back to the epic after answering ("carry on, run it for me again"), if at all.
- Whether "you build it and show me before merging" keeps its drive step under the epic, given feedback beyond a yes now goes to the feature's chat.
- How "what is waiting for me?" lists items so each names its one place.

# Ordering

Second of three from the epic "Agent Behaviour Tuning". Waits on "Agents never guess what, where or who" (same instruction files). "The epic hears when its features merge" waits on this one.

Planning mode: grill with you
